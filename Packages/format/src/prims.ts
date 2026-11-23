// Thin wrappers over node:crypto for the primitives of section 1. No other dependency.
import * as c from 'node:crypto';
import { concat } from './bytes.ts';

const b = (x: Uint8Array | Buffer): Uint8Array => new Uint8Array(x.buffer, x.byteOffset, x.byteLength).slice();

export const sha256 = (...parts: Uint8Array[]): Uint8Array => b(c.createHash('sha256').update(concat(...parts)).digest());
export const sha3_256 = (...parts: Uint8Array[]): Uint8Array => b(c.createHash('sha3-256').update(concat(...parts)).digest());
export const shake256 = (data: Uint8Array, len: number): Uint8Array =>
  b(c.createHash('shake256', { outputLength: len }).update(data).digest());
export const hmac = (key: Uint8Array, data: Uint8Array): Uint8Array => b(c.createHmac('sha256', key).update(data).digest());

/** HKDF-SHA256 (RFC 5869), always 32 bytes (section 1). An empty salt means 32 zero bytes. */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len = 32): Uint8Array {
  return b(Buffer.from(c.hkdfSync('sha256', ikm, salt, info, len)));
}

export class AeadError extends Error {}

function chacha(dir: 'enc' | 'dec', key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, data: Uint8Array): Uint8Array {
  return aead('chacha20-poly1305', dir, key, nonce, aad, data);
}
function aead(alg: 'chacha20-poly1305' | 'aes-256-gcm', dir: 'enc' | 'dec', key: Uint8Array, nonce: Uint8Array,
              aad: Uint8Array, data: Uint8Array): Uint8Array {
  const opts = { authTagLength: 16 } as const;
  if (dir === 'enc') {
    const ci = c.createCipheriv(alg, key, nonce, opts) as c.CipherGCM;
    ci.setAAD(aad);
    return b(Buffer.concat([ci.update(data), ci.final(), ci.getAuthTag()]));
  }
  if (data.length < 16) throw new AeadError('short');
  const de = c.createDecipheriv(alg, key, nonce, opts) as c.DecipherGCM;
  de.setAAD(aad);
  de.setAuthTag(data.subarray(data.length - 16));
  try { return b(Buffer.concat([de.update(data.subarray(0, data.length - 16)), de.final()])); }
  catch { throw new AeadError('tag'); }
}
export const chachaSeal = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, pt: Uint8Array) => chacha('enc', key, nonce, aad, pt);
export const chachaOpen = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: Uint8Array) => chacha('dec', key, nonce, aad, ct);
export const aesGcmSeal = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, pt: Uint8Array) => aead('aes-256-gcm', 'enc', key, nonce, aad, pt);
export const aesGcmOpen = (key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ct: Uint8Array) => aead('aes-256-gcm', 'dec', key, nonce, aad, ct);

// ---- Ed25519 and X25519 from raw bytes (DER prefixes are fixed for 32-byte keys).
const hexb = (s: string) => Buffer.from(s, 'hex');
const ED_PRIV = hexb('302e020100300506032b657004220420');
const ED_PUB = hexb('302a300506032b6570032100');
const X_PRIV = hexb('302e020100300506032b656e04220420');
const X_PUB = hexb('302a300506032b656e032100');

const edPriv = (seed: Uint8Array) => c.createPrivateKey({ key: Buffer.concat([ED_PRIV, seed]), format: 'der', type: 'pkcs8' });
const rawPub = (k: c.KeyObject) => b(k.export({ format: 'der', type: 'spki' }).subarray(-32));

export const ed25519PublicFromSeed = (seed: Uint8Array): Uint8Array => rawPub(c.createPublicKey(edPriv(seed)));
export const ed25519Sign = (seed: Uint8Array, msg: Uint8Array): Uint8Array => b(c.sign(null, msg, edPriv(seed)));
export function ed25519Verify(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    const k = c.createPublicKey({ key: Buffer.concat([ED_PUB, pub]), format: 'der', type: 'spki' });
    return c.verify(null, msg, k, sig);
  } catch { return false; }
}
export const x25519PublicFromSeed = (sk: Uint8Array): Uint8Array =>
  rawPub(c.createPublicKey(c.createPrivateKey({ key: Buffer.concat([X_PRIV, sk]), format: 'der', type: 'pkcs8' })));
export function x25519(sk: Uint8Array, pub: Uint8Array): Uint8Array {
  return b(c.diffieHellman({
    privateKey: c.createPrivateKey({ key: Buffer.concat([X_PRIV, sk]), format: 'der', type: 'pkcs8' }),
    publicKey: c.createPublicKey({ key: Buffer.concat([X_PUB, pub]), format: 'der', type: 'spki' }),
  }));
}

// ---- ML-KEM-768 from a 64-byte seed (d || z): PKCS#8 seed-only form, then SPKI for the public key.
const MLKEM_PRIV = hexb('3054020100300b060960864801650304040204428040');
const MLKEM_PUB = hexb('308204b2300b0609608648016503040402038204a100');
export function mlkem768FromSeed(seed: Uint8Array): { pk: Uint8Array; decapsulate: (ct: Uint8Array) => Uint8Array } {
  if (seed.length !== 64) throw new Error('ML-KEM seed is 64 bytes');
  const priv = c.createPrivateKey({ key: Buffer.concat([MLKEM_PRIV, seed]), format: 'der', type: 'pkcs8' });
  const spki = c.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return { pk: b(spki.subarray(MLKEM_PUB.length)), decapsulate: (ct) => b(c.decapsulate(priv, ct)) };
}
/** Random encapsulation (Node offers no way to supply the randomness m). */
export function mlkem768Encapsulate(pk: Uint8Array): { ct: Uint8Array; ss: Uint8Array } {
  const pub = c.createPublicKey({ key: Buffer.concat([MLKEM_PUB, pk]), format: 'der', type: 'spki' });
  const r = c.encapsulate(pub);
  return { ct: b(r.ciphertext), ss: b(r.sharedKey) };
}

export interface Argon2Params { memory: number; passes: number; lanes: number }
export function argon2id(password: Uint8Array, salt: Uint8Array, p: Argon2Params,
                         extra?: { secret?: Uint8Array; ad?: Uint8Array }): Uint8Array {
  return b(c.argon2Sync('argon2id', {
    message: password, nonce: salt, parallelism: p.lanes, tagLength: 32, memory: p.memory, passes: p.passes,
    ...(extra?.secret ? { secret: extra.secret } : {}), ...(extra?.ad ? { associatedData: extra.ad } : {}),
  }));
}
