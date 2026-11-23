import { rules } from './limits.ts';
// Edwards25519 point checks for section 1.2, in BigInt. Used only to decide whether an encoding is acceptable; the signature
// equation itself is left to node:crypto.
const P = (1n << 255n) - 19n;
export const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(b: bigint, e: bigint): bigint {
  let r = 1n; b = mod(b);
  for (; e > 0n; e >>= 1n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; }
  return r;
}
const inv = (a: bigint) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

export type Point = { x: bigint; y: bigint };

/** RFC 8032 section 5.1.3 decoding, plus the canonical-encoding rules: y < p, and no sign bit on x = 0. Returns null if rejected. */
export function decodePoint(b: Uint8Array): Point | null {
  if (b.length !== 32) return null;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]! & (i === 31 ? 0x7f : 0xff));
  const sign = (b[31]! >> 7) & 1;
  if (y >= P) return null;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n), v = mod(D * y2 + 1n);
  const x2 = mod(u * inv(v));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x) !== x2) x = mod(x * SQRT_M1);
  if (mod(x * x) !== x2) return null; // not on the curve
  if (x === 0n && sign === 1) return null;
  if (Number(x & 1n) !== sign) x = mod(-x);
  return { x, y };
}

function add(p: Point, q: Point): Point {
  const t = mod(D * p.x * q.x * p.y * q.y);
  return { x: mod((p.x * q.y + q.x * p.y) * inv(1n + t)), y: mod((p.y * q.y + p.x * q.x) * inv(1n - t)) };
}

/** A point of order dividing 8 (the identity included). */
export function isSmallOrder(p: Point): boolean {
  let q = p;
  for (let i = 0; i < 3; i++) q = add(q, q);
  return q.x === 0n && q.y === 1n;
}

export function scalarLessThanL(s: Uint8Array): boolean {
  let v = 0n;
  for (let i = s.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(s[i]!);
  return v < L;
}

export type SigProblem = 'bad_public_key' | 'small_order_public_key' | 'bad_signature_encoding' | 'scalar_not_reduced' | null;

/** Section 1.2, implemented here rather than trusted to the platform. */
export function checkSignatureInputs(pk: Uint8Array, sig: Uint8Array): SigProblem {
  if (pk.length !== 32) return 'bad_public_key';
  if (sig.length !== 64) return 'bad_signature_encoding';
  const a = decodePoint(pk);
  if (!a) return 'bad_public_key';
  if (isSmallOrder(a)) return 'small_order_public_key';
  if (!decodePoint(sig.subarray(0, 32))) return 'bad_signature_encoding';
  if (rules.checkScalarLessThanL && !scalarLessThanL(sig.subarray(32))) return 'scalar_not_reduced';
  return null;
}
