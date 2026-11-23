// Deterministic CBOR, section 2. Encoder and strict decoder, written from the spec's subset only.
//
// Value mapping: unsigned integer <-> number (bigint above 2^53-1), byte string <-> Uint8Array, text string <-> string,
// array <-> Array, map <-> Map (keys: all numbers or all strings), false/true <-> boolean, null <-> null.
import { cmp, concat } from './bytes.ts';

export type CborValue = number | bigint | boolean | null | string | Uint8Array | CborValue[] | Map<number | string, CborValue>;

export class CborError extends Error {
  reason: string;
  constructor(reason: string, detail = '') {
    super(detail ? `${reason}: ${detail}` : reason);
    this.reason = reason;
  }
}

/** Section 2: nesting is not limited by the spec; this implementation refuses deeper than this (see findings). */
export const MAX_DEPTH = 64;

const textEnc = new TextEncoder();
const strictText = new TextDecoder('utf-8', { fatal: true });

function head(major: number, n: number | bigint): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new CborError('integer_out_of_range');
  const m = major << 5;
  if (v < 24n) return Uint8Array.of(m | Number(v));
  const out = (ai: number, size: number) => {
    const b = new Uint8Array(1 + size);
    b[0] = m | ai;
    let x = v;
    for (let i = size; i >= 1; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
    return b;
  };
  if (v < 0x100n) return out(24, 1);
  if (v < 0x10000n) return out(25, 2);
  if (v < 0x100000000n) return out(26, 4);
  return out(27, 8);
}

export function encode(v: CborValue): Uint8Array {
  if (v === null) return Uint8Array.of(0xf6);
  if (v === false) return Uint8Array.of(0xf4);
  if (v === true) return Uint8Array.of(0xf5);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || v < 0) throw new CborError('integer_out_of_range', String(v));
    return head(0, v);
  }
  if (typeof v === 'bigint') return head(0, v);
  if (typeof v === 'string') {
    if (v.normalize('NFC') !== v) throw new CborError('non_nfc');
    const t = textEnc.encode(v);
    return concat(head(3, t.length), t);
  }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  if (Array.isArray(v)) return concat(head(4, v.length), ...v.map(encode));
  if (v instanceof Map) {
    const kinds = new Set([...v.keys()].map((k) => typeof k));
    if (kinds.size > 1) throw new CborError('mixed_key_kinds');
    const entries = [...v.entries()].map(([k, val]) => [encode(k), encode(val)] as const);
    entries.sort((a, b2) => cmp(a[0], b2[0]));
    return concat(head(5, entries.length), ...entries.flatMap(([k, val]) => [k, val]));
  }
  throw new CborError('unsupported_type');
}

class Reader {
  data: Uint8Array;
  pos = 0;
  constructor(data: Uint8Array) { this.data = data; }

  take(n: number): Uint8Array {
    if (n > this.data.length - this.pos) throw new CborError('truncated');
    const s = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }

  read(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new CborError('too_deep');
    const ib = this.take(1)[0]!;
    const major = ib >> 5;
    const ai = ib & 31;
    if (major === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22) return null;
      if (ai === 23) throw new CborError('undefined');
      if (ai === 24 || ai < 20) throw new CborError('simple_value');
      if (ai >= 25 && ai <= 27) throw new CborError('float');
      if (ai === 31) throw new CborError('break');
      throw new CborError('reserved_additional_info');
    }
    let n: bigint;
    if (ai < 24) n = BigInt(ai);
    else if (ai <= 27) {
      const size = 1 << (ai - 24);
      n = 0n;
      for (const x of this.take(size)) n = (n << 8n) | BigInt(x);
      const min = [24n, 256n, 65536n, 4294967296n][ai - 24]!;
      if (n < min) throw new CborError('non_shortest');
    } else if (ai === 31) {
      throw new CborError(major >= 2 && major <= 5 ? 'indefinite_length' : 'malformed');
    } else throw new CborError('reserved_additional_info');

    switch (major) {
      case 0: return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
      case 1: throw new CborError('negative_integer');
      case 6: throw new CborError('tag');
      case 2: return this.take(this.len(n)).slice();
      case 3: {
        const raw = this.take(this.len(n));
        let s: string;
        try { s = strictText.decode(raw); } catch { throw new CborError('invalid_utf8'); }
        if (s.normalize('NFC') !== s) throw new CborError('non_nfc');
        return s;
      }
      case 4: {
        const len = this.len(n);
        if (len > this.data.length - this.pos) throw new CborError('truncated');
        const out: CborValue[] = [];
        for (let i = 0; i < len; i++) out.push(this.read(depth + 1));
        return out;
      }
      default: { // 5: map
        const len = this.len(n);
        if (len * 2 > this.data.length - this.pos) throw new CborError('truncated');
        const out = new Map<number | string, CborValue>();
        let kind: string | null = null;
        let prev: Uint8Array | null = null;
        for (let i = 0; i < len; i++) {
          const start = this.pos;
          const first = this.data[start]! >> 5;
          if (first !== 0 && first !== 3) {
            // Peek: anything that is not an unsigned integer or text string cannot be a key.
            this.read(depth + 1); // surfaces a more specific error (tag, float, ...) if there is one
            throw new CborError('bad_key_type');
          }
          const key = this.read(depth + 1) as number | bigint | string;
          const kb = this.data.subarray(start, this.pos);
          const k = typeof key === 'string' ? 'text' : 'uint';
          if (kind !== null && kind !== k) throw new CborError('mixed_key_kinds');
          kind = k;
          if (prev) {
            const c = cmp(prev, kb);
            if (c === 0) throw new CborError('duplicate_key');
            if (c > 0) throw new CborError('unsorted_keys');
          }
          prev = kb;
          const val = this.read(depth + 1);
          // Integer keys beyond 2^53 never occur in this format; keep them as bigint-safe strings of risk: reject.
          if (typeof key === 'bigint') throw new CborError('bad_key_type', 'key too large for this implementation');
          out.set(key, val);
        }
        return out;
      }
    }
  }

  len(n: bigint): number {
    if (n > BigInt(this.data.length - this.pos) && n > BigInt(this.data.length)) throw new CborError('truncated');
    return Number(n);
  }
}

/** Strict decode of exactly one item that fills `data`. Throws CborError with a stable `reason`. */
export function decode(data: Uint8Array): CborValue {
  const r = new Reader(data);
  const v = r.read(0);
  if (r.pos !== data.length) throw new CborError('trailing_bytes');
  return v;
}

// ---- Typed access helpers used by the schemas of sections 3 to 7.

export type CMap = Map<number | string, CborValue>;
export const isMap = (v: unknown): v is CMap => v instanceof Map;
export const isBytes = (v: unknown, n?: number): v is Uint8Array => v instanceof Uint8Array && (n === undefined || v.length === n);
export const isUint = (v: unknown): v is number => typeof v === 'number';

/** Build a map from pairs. */
export const cmap = (pairs: [number | string, CborValue][]): CMap => new Map(pairs);

/** A map defined by the spec MUST NOT carry keys it does not define (section 2). */
export function onlyKeys(m: CMap, allowed: number[], required: number[], what: string): void {
  for (const k of m.keys()) if (!allowed.includes(k as number)) throw new CborError('unknown_key', `${what}: ${String(k)}`);
  for (const k of required) if (!m.has(k)) throw new CborError('missing_key', `${what}: ${k}`);
}

/** "Sorted" arrays (clear, covered, cut, items) are read as sorted and unique by the bytewise order of their encodings,
 *  the same rule as map keys. The spec does not say so; see findings. */
export function strictlySortedByEncoding(items: CborValue[]): boolean {
  for (let i = 1; i < items.length; i++) if (cmp(encode(items[i - 1]!), encode(items[i]!)) >= 0) return false;
  return true;
}
