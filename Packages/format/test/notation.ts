// A JSON notation for CBOR values in vectors, so that a vector can describe an unsorted map or a big integer in text.
import { cmap, type CborValue } from '../src/cbor.ts';
import { fromHex, hex } from '../src/bytes.ts';

export type N = { uint: string } | { bytes: string } | { text: string } | { array: N[] } | { map: [N, N][] } | { bool: boolean } | { null: true };

export function fromNotation(n: N): CborValue {
  if ('uint' in n) { const b = BigInt(n.uint); return b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b; }
  if ('bytes' in n) return fromHex(n.bytes);
  if ('text' in n) return n.text;
  if ('array' in n) return n.array.map(fromNotation);
  if ('map' in n) return cmap(n.map.map(([k, v]) => [fromNotation(k) as number | string, fromNotation(v)]));
  if ('bool' in n) return n.bool;
  return null;
}

export function toNotation(v: CborValue): N {
  if (v === null) return { null: true };
  if (typeof v === 'boolean') return { bool: v };
  if (typeof v === 'number' || typeof v === 'bigint') return { uint: String(v) };
  if (typeof v === 'string') return { text: v };
  if (v instanceof Uint8Array) return { bytes: hex(v) };
  if (Array.isArray(v)) return { array: v.map(toNotation) };
  return { map: [...v].map(([k, x]) => [toNotation(k), toNotation(x)] as [N, N]) };
}
