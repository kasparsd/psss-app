// Section 4 (sealed records, padding, body, clock) and the payload shapes of sections 5 and 6, and the reader's step 1 and 2
// of section 9.
import { concat, cmp, eq, label, readU32, u32, zeros } from './bytes.ts';
import { CborError, cmap, decode, encode, isBytes, isMap, isUint, onlyKeys, strictlySortedByEncoding,
         type CborValue, type CMap } from './cbor.ts';
import { limits, rules } from './limits.ts';
import { AeadError, chachaOpen, chachaSeal, ed25519Check, ed25519Sign, hkdf, sha256 } from './prims.ts';
import { cardShape, FormatError, type Person } from './keys.ts';

export const MAGIC = new TextEncoder().encode('PSR1');
export const HEADER_LEN = 72; // 4.1
export const TAG_LEN = 16;

export const KIND = { genesis: 1, member: 2, epoch: 3, replace: 4, remove: 5, item: 16, checkpoint: 32, purge: 33 } as const;
export const MEMBERSHIP_KINDS: number[] = [KIND.genesis, KIND.member, KIND.epoch, KIND.replace, KIND.remove];
/** 4.3: kinds 16 and above are content records and carry `mhead`. */
export const isContentKind = (k: number) => k >= 16;

/** 4.2 size(n) = 256 x ceil(n/256) when that is at most 4096, otherwise 4096 x ceil(n/4096). */
export function paddedLength(n: number): number {
  const a = limits.paddingStep * Math.ceil(n / limits.paddingStep);
  return a <= limits.paddingThreshold ? a : limits.paddingBigStep * Math.ceil(n / limits.paddingBigStep);
}

export function header(gid: Uint8Array, epoch: number, salt: Uint8Array): Uint8Array {
  if (gid.length !== 32 || salt.length !== 32) throw new Error('gid and salt are 32 bytes');
  return concat(MAGIC, gid, u32(epoch), salt);
}

/** 4.1 rk = HKDF(ikm = K_epoch, salt = salt, info = "psss/v1/record") */
export const recordKey = (groupKey: Uint8Array, salt: Uint8Array): Uint8Array => hkdf(groupKey, salt, label('psss/v1/record'));

/** 4.1 (draft 3) salt = HKDF(ikm = K_epoch, salt = SHA-256(body_without_9), info = "psss/v1/salt"). */
export const deriveSalt = (groupKey: Uint8Array, bodyWithout9: CMap): Uint8Array => hkdf(groupKey, sha256(encode(bodyWithout9)), label('psss/v1/salt'));

/** 4.2 plaintext = u32(len(body)) || body || zero bytes (padded to size(n)). */
export function padPlaintext(body: Uint8Array): Uint8Array {
  const n = 4 + body.length;
  const p = new Uint8Array(paddedLength(n));
  p.set(u32(body.length), 0);
  p.set(body, 4);
  return p;
}

/** Encrypt an arbitrary (already padded) plaintext as a sealed record. Exposed for negative vectors. */
export function sealPlaintext(gid: Uint8Array, epoch: number, groupKey: Uint8Array, salt: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const h = header(gid, epoch, salt);
  return concat(h, chachaOpenOrSeal(recordKey(groupKey, salt), h, plaintext));
}
const chachaOpenOrSeal = (rk: Uint8Array, h: Uint8Array, pt: Uint8Array) => chachaSeal(rk, zeros(12), h, pt);

export const recordId = (sealed: Uint8Array): Uint8Array => sha256(sealed);

export type Clock = [number, number]; // [wall_ms, counter]

export interface BodyFields {
  author: Uint8Array; device: Uint8Array; seq: number; prev: Uint8Array | null;
  clock: Clock; kind: number; payload: CborValue;
  /** key 10: content records only (4.3) */
  mhead?: Uint8Array;
  /** extension keys (section 2): integer keys of 128 and above, covered by the signature and ignored by readers */
  extensions?: [number | bigint, CborValue][];
}

export function bodyMap(f: BodyFields): CMap {
  const m = cmap([[1, 1], [2, f.author], [3, f.device], [4, f.seq], [5, f.prev], [6, [f.clock[0], f.clock[1]]], [7, f.kind], [8, f.payload]]);
  if (f.mhead) m.set(10, f.mhead);
  for (const [k, v] of f.extensions ?? []) m.set(k as number, v);
  return cmap([...m.entries()] as [number, CborValue][]);
}

/** 4.3 sig = Ed25519(author's sign_seed, "psss/v1/record-sig" || header || body_without_9) */
export const signedBytes = (hdr: Uint8Array, bodyWithout9: CMap): Uint8Array =>
  concat(label('psss/v1/record-sig'), hdr, encode(bodyWithout9));

/** Sealing is deterministic (4.1): the salt is derived from the key and the body. `opts.salt` is for negative vectors only. */
export function sealRecord(signer: Person, gid: Uint8Array, epoch: number, groupKey: Uint8Array, f: BodyFields,
                           opts: { sigOverride?: Uint8Array; salt?: Uint8Array } = {}): Uint8Array {
  const body = bodyMap(f);
  const salt = opts.salt ?? deriveSalt(groupKey, body);
  const h = header(gid, epoch, salt);
  const sig = opts.sigOverride ?? ed25519Sign(signer.signSeed, signedBytes(h, body));
  body.set(9, sig);
  return sealPlaintext(gid, epoch, groupKey, salt, padPlaintext(encode(body)));
}

export interface Rec {
  sealed: Uint8Array;
  id: Uint8Array;
  gid: Uint8Array;
  epoch: number;
  /** The group key that opened it (an epoch record's commitment is checked against this). */
  key: Uint8Array;
  author: Uint8Array; device: Uint8Array; seq: number; prev: Uint8Array | null;
  wall: number; counter: number; kind: number;
  mhead: Uint8Array | null;
  payload: CMap;
  body: CMap;
  /** 4.5 order tuple (wall_ms, counter, author, device, seq) */
  key5: OrderKey;
}
export type OrderKey = [number, number, Uint8Array, Uint8Array, number];

/** 4.5: compare tuples element by element, byte strings bytewise. */
export function compareKeys(a: OrderKey, b: OrderKey): number {
  return (a[0] - b[0]) || (a[1] - b[1]) || cmp(a[2], b[2]) || cmp(a[3], b[3]) || (a[4] - b[4]);
}
export const sortRecords = <T extends { key5: OrderKey }>(rs: T[]): T[] => [...rs].sort((x, y) => compareKeys(x.key5, y.key5));

export type KeyRing = { gids: Uint8Array[]; keys: (gid: Uint8Array, epoch: number) => Uint8Array[] };

/** A key ring from a list of [gid, epoch, key]; several keys may be held for one epoch (6.5, 7.1). */
export function keyRing(entries: [Uint8Array, number, Uint8Array][]): KeyRing {
  return {
    gids: entries.map((e) => e[0]),
    keys: (gid, epoch) => entries.filter((e) => eq(e[0], gid) && e[1] === epoch).map((e) => e[2]),
  };
}

/** Section 9, steps 1 and 2. Throws FormatError: disposition `wait` for a record without a key yet, `discard` for the rest. */
export function openRecord(sealed: Uint8Array, ring: KeyRing): Rec {
  // Step 1: can it be opened yet?
  if (sealed.length < HEADER_LEN + TAG_LEN) throw new FormatError('too_short', 'discard');
  if (!eq(sealed.subarray(0, 4), MAGIC)) throw new FormatError('bad_magic', 'discard');
  const gid = sealed.slice(4, 36);
  if (!ring.gids.some((g) => eq(g, gid))) throw new FormatError('no_key', 'wait', 'unknown gid');
  const epoch = readU32(sealed, 36);
  const keys = ring.keys(gid, epoch);
  if (keys.length === 0) throw new FormatError('no_key', 'wait', 'epoch');
  // Step 2: is it well formed?
  if (sealed.length > limits.maxSealed) throw new FormatError('too_large', 'discard');
  const hdr = sealed.subarray(0, HEADER_LEN);
  const salt = sealed.subarray(40, 72);
  let plaintext: Uint8Array | null = null;
  let key: Uint8Array = keys[0]!;
  for (const k of keys) {
    try { plaintext = chachaOpen(recordKey(k, salt), zeros(12), hdr, sealed.subarray(HEADER_LEN)); key = k; break; }
    catch (e) { if (!(e instanceof AeadError)) throw e; }
  }
  if (!plaintext) throw new FormatError('bad_tag', 'discard');
  if (plaintext.length < 4) throw new FormatError('bad_size', 'discard');
  const len = readU32(plaintext, 0);
  if (len > limits.maxBody) throw new FormatError('body_too_large', 'discard');
  if (paddedLength(4 + len) !== plaintext.length) throw new FormatError('bad_size', 'discard'); // exactly size(n), 4.2
  for (let i = 4 + len; i < plaintext.length; i++) if (plaintext[i] !== 0) throw new FormatError('bad_padding', 'discard');
  let body: CborValue;
  try { body = decode(plaintext.subarray(4, 4 + len)); }
  catch (e) { if (e instanceof CborError) throw new FormatError('bad_body', 'discard', e.reason); throw e; }
  const f = bodyFields(body);
  let payload: CMap;
  try { payload = checkPayload(f.kind, f.payload); }
  catch (e) { if (e instanceof CborError) throw new FormatError('bad_payload', 'discard', e.message); throw e; }
  const m = body as CMap;
  const without9 = new Map(m);
  without9.delete(9);
  // 9 step 2 (draft 4): tag, padding, body, payload shape, then the recomputed salt, then author and signature, in that order.
  const saltBad = rules.checkSalt && !eq(deriveSalt(key, without9 as CMap), salt);
  if (saltBad && rules.saltBeforeSignature) throw new FormatError('bad_salt', 'discard');
  const problem = ed25519Check(f.author, signedBytes(hdr, without9), m.get(9) as Uint8Array);
  if (saltBad && !problem) throw new FormatError('bad_salt', 'discard');
  if (problem === 'bad_public_key' || problem === 'small_order_public_key') throw new FormatError('bad_author', 'discard', problem);
  if (problem) throw new FormatError('bad_signature', 'discard', problem);
  return {
    sealed, id: recordId(sealed), gid, epoch, key, author: f.author, device: f.device, seq: f.seq, prev: f.prev,
    wall: f.clock[0], counter: f.clock[1], kind: f.kind, mhead: f.mhead ?? null, payload, body: m,
    key5: [f.clock[0], f.clock[1], f.author, f.device, f.seq],
  };
}

/** Body shape (4.3). */
function bodyFields(body: CborValue): BodyFields {
  const bad = (why: string): never => { throw new FormatError('bad_body_schema', 'discard', why); };
  if (!isMap(body)) return bad('not a map');
  const kind = body.get(7);
  if (!isUint(kind)) bad('kind');
  const k = kind as number;
  // 4.3 key 10: present in content records (16 and above), absent in membership records; kinds 0 and 5 to 15 are not defined.
  const need10 = isContentKind(k);
  const forbid10 = MEMBERSHIP_KINDS.includes(k);
  try { onlyKeys(body, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, ...(need10 ? [10] : [])], 'body', true); } catch (e) { return bad((e as Error).message); }
  if (forbid10 && body.has(10)) bad('membership record with mhead');
  if (body.get(1) !== 1) bad('v');
  const author = body.get(2), device = body.get(3), seq = body.get(4), prev = body.get(5), clock = body.get(6);
  if (!isBytes(author, 32)) bad('author');
  if (!isBytes(device, 16)) bad('device');
  if (!isUint(seq) || seq < 1) bad('seq');
  if (seq === 1 ? prev !== null : !isBytes(prev, 32)) bad('prev');
  if (!Array.isArray(clock) || clock.length !== 2 || !isUint(clock[0]) || !isUint(clock[1])) bad('clock');
  if (!isMap(body.get(8))) bad('payload');
  if (!isBytes(body.get(9), 64)) bad('sig');
  if (body.has(10) && !isBytes(body.get(10), 32)) bad('mhead');
  return { author: author as Uint8Array, device: device as Uint8Array, seq: seq as number, prev: prev as Uint8Array | null,
           clock: [(clock as number[])[0]!, (clock as number[])[1]!], kind: k, payload: body.get(8) as CMap,
           ...(body.has(10) ? { mhead: body.get(10) as Uint8Array } : {}) };
}

const sortedList = (v: unknown, what: string): CborValue[] => {
  if (!Array.isArray(v)) throw new CborError('bad_payload', what);
  if (!strictlySortedByEncoding(v)) throw new CborError('not_sorted', what);
  return v;
};

const clockShape = (ck: unknown): boolean =>
  Array.isArray(ck) && ck.length === 5 && isUint(ck[0]) && isUint(ck[1]) && isBytes(ck[2], 32) && isBytes(ck[3], 16) && isUint(ck[4]);

const cutShape = (v: unknown, what: string) => {
  for (const c of sortedList(v, what)) if (!Array.isArray(c) || c.length !== 2 || !isBytes(c[0], 16) || !isUint(c[1]) || (c[1] as number) < 1) throw new CborError('bad_payload', what);
};
const epochNo = (v: unknown) => isUint(v) && (v as number) >= 1;

/** Payload shapes by kind (sections 5 and 6). Unknown kinds are kept unchecked (4.3). Extension keys (2) are allowed in every payload. */
export function checkPayload(kind: number, p: CMap): CMap {
  const bad = (w: string) => new CborError('bad_payload', w);
  switch (kind) {
    case KIND.item: {
      onlyKeys(p, [1, 2, 3], [1, 2, 3], 'item', true);
      const set = p.get(2), clear = sortedList(p.get(3), 'clear');
      if (!isBytes(p.get(1), 16) || !isMap(set)) throw bad('item');
      for (const k of set.keys()) if (typeof k !== 'string') throw bad('set key');
      for (const f of clear) {
        if (typeof f !== 'string') throw bad('clear name');
        if (set.has(f)) throw bad('field in both set and clear'); // 5.1
      }
      if (set.has('deleted') && !isUint(set.get('deleted'))) throw bad('deleted is not an unsigned integer'); // 5.1
      return p;
    }
    case KIND.checkpoint: {
      // 5.3 (draft 3): { 1: set_id, 2: part, 3: parts, 4: covered, 5: items, 6: purged }
      onlyKeys(p, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 'checkpoint', true);
      const part = p.get(2), parts = p.get(3);
      if (!isBytes(p.get(1), 16) || !isUint(part) || !isUint(parts) || parts < 1 || part >= parts) throw bad('set, part or parts');
      const covered = sortedList(p.get(4), 'covered'), purged = sortedList(p.get(6), 'purged');
      if (part > 0 && (covered.length || purged.length)) throw bad('covered and purged are empty outside part 0');
      for (const c of covered) {
        if (!Array.isArray(c) || c.length !== 4 || !isBytes(c[0], 32) || !isBytes(c[1], 16) || !isUint(c[2]) || (c[2] as number) < 1 || !isBytes(c[3], 32)) throw bad('covered');
      }
      for (const it of sortedList(p.get(5), 'items')) {
        if (!Array.isArray(it) || it.length !== 2 || !isBytes(it[0], 16) || !isMap(it[1])) throw bad('item');
        for (const [name, ws] of it[1]) {
          if (typeof name !== 'string') throw bad('field');
          const list = sortedList(ws, 'writes');
          if (rules.checkpointFieldHasWrite && list.length === 0) throw bad('a field carries at least its winning write');
          for (const w of list) {
            if (!Array.isArray(w) || (w[0] === 1 ? w.length !== 3 || !clockShape(w[1]) : w[0] === 0 ? w.length !== 2 || !clockShape(w[1]) : true)) throw bad('write');
          }
        }
      }
      for (const pu of purged) {
        if (!Array.isArray(pu) || pu.length !== 2 || !isBytes(pu[0], 16) || !clockShape(pu[1])) throw bad('purged');
      }
      return p;
    }
    case KIND.purge: {
      onlyKeys(p, [1], [1], 'purge request', true);
      for (const id of sortedList(p.get(1), 'items')) if (!isBytes(id, 16)) throw bad('item id');
      return p;
    }
    case KIND.genesis:
      onlyKeys(p, [1, 2, 3, 4], [1, 2, 3, 4], 'genesis', true);
      // 6.1 (draft 4): min_reader is at least 1 (and, because 3.3 binds it as u32, at most 2^32 - 1)
      if (!isBytes(p.get(1), 32) || !isBytes(p.get(3), 32) || !isUint(p.get(4)) || (p.get(4) as number) < 1 || (p.get(4) as number) > 0xffffffff) throw bad('genesis');
      cardShape(p.get(2));
      return p;
    case KIND.member: {
      onlyKeys(p, [1, 2, 3, 4], [1, 2, 3], 'member', true);
      const t = p.get(2), role = p.get(3);
      if (!isBytes(p.get(1), 32) || !(isBytes(t, 32) || isMap(t)) || !isUint(role) || role < 1 || role > 3) throw bad('member'); // 6.2: role is 1, 2 or 3
      if (isMap(t)) cardShape(t);
      if (p.has(4)) cutShape(p.get(4), 'cut');
      return p;
    }
    case KIND.epoch:
      onlyKeys(p, [1, 2, 3, 4], [1, 2, 3, 4], 'epoch', true);
      if (!isBytes(p.get(1), 32) || !epochNo(p.get(2)) || !isBytes(p.get(3), 32) || !isBytes(p.get(4), 32)) throw bad('epoch');
      return p;
    case KIND.remove:
      onlyKeys(p, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 'remove', true);
      if (!isBytes(p.get(1), 32) || !isBytes(p.get(2), 32) || !epochNo(p.get(4)) || !isBytes(p.get(5), 32) || !isBytes(p.get(6), 32)) throw bad('remove');
      cutShape(p.get(3), 'cut');
      return p;
    case KIND.replace:
      onlyKeys(p, [1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7], 'replace', true);
      if (!isBytes(p.get(1), 32) || !isBytes(p.get(2), 32) || !epochNo(p.get(5)) || !isBytes(p.get(6), 32) || !isBytes(p.get(7), 32)) throw bad('replace');
      cardShape(p.get(3));
      cutShape(p.get(4), 'cut');
      return p;
    default:
      return p;
  }
}

// ---- 4.5 clock

/** 4.5 Writing: wall_ms is the larger of own time and the largest wall_ms among the accepted records (own included);
 *  counter is 0 when own time is larger than every accepted wall_ms, otherwise one more than the largest accepted counter
 *  with that wall_ms. `accepted` are the [wall_ms, counter] of the records the device has accepted in this group. */
export function nextClock(nowMs: number, accepted: Clock[]): Clock {
  const wall = Math.max(nowMs, ...accepted.map((c) => c[0]));
  const same = accepted.filter((c) => c[0] === wall).map((c) => c[1]);
  return [wall, same.length ? Math.max(...same) + 1 : 0];
}

/** 4.5 Reading: a reader MUST hold back a record whose wall_ms is more than 10 minutes ahead of its own time. */
export const heldBack = (wallMs: number, nowMs: number): boolean => wallMs - nowMs > limits.holdBackMs;
export const DAY_MS = 24 * 3600 * 1000;
export const TEN_MINUTES_MS = 10 * 60 * 1000;
