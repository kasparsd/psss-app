// The stream and block ciphers of KDBX, over node:crypto. Salsa20 is the one cipher written here.
import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import { Salsa20 } from './salsa20.ts';
import { concat } from './bytes.ts';
import { Corrupt, Unsupported } from './errors.ts';

export interface StreamCipher {
  process(data: Uint8Array): Uint8Array;
}

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function sha512(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha512');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function hmacSha256(key: Uint8Array, ...parts: Uint8Array[]): Uint8Array {
  const h = createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

/** ChaCha20 (RFC 8439 block function, 32-bit counter, 12-byte nonce) through OpenSSL: its IV is the counter then the nonce. */
export function chacha20(key: Uint8Array, nonce: Uint8Array, counter = 0): StreamCipher {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('ChaCha20 needs a 32-byte key and a 12-byte nonce');
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(0, counter, true);
  iv.set(nonce, 4);
  const c = createCipheriv('chacha20', key, iv);
  return { process: (data) => new Uint8Array(c.update(data)) };
}

export function salsa20(key: Uint8Array, iv: Uint8Array): StreamCipher {
  return new Salsa20(key, iv);
}

const SALSA_IV = Uint8Array.from([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]);

/** The inner random stream that hides protected values. id 2 is Salsa20 (KDBX 3), id 3 is ChaCha20 (KDBX 4). */
export function innerStream(id: number, key: Uint8Array): StreamCipher {
  if (id === 3) {
    const d = sha512(key);
    return chacha20(d.subarray(0, 32), d.subarray(32, 44));
  }
  if (id === 2) return salsa20(sha256(key), SALSA_IV);
  if (id === 1) throw new Unsupported('ArcFour inner stream', 'Unsupported: the ArcFour protected-value cipher (inner stream 1)');
  throw new Unsupported(`inner stream ${id}`, `Unsupported: protected-value cipher number ${id}`);
}

/** AES-256-CBC without padding handling, for callers that check padding themselves. */
export function aesCbcRaw(data: Uint8Array, key: Uint8Array, iv: Uint8Array, encrypt: boolean): Uint8Array {
  if (data.length % 16 !== 0) throw new Corrupt('the encrypted payload is not a whole number of AES blocks');
  const c = encrypt ? createCipheriv('aes-256-cbc', key, iv) : createDecipheriv('aes-256-cbc', key, iv);
  c.setAutoPadding(false);
  return new Uint8Array(concat(c.update(data), c.final()));
}

export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const n = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + n);
  out.set(data);
  out.fill(n, data.length);
  return out;
}

/** Strips PKCS#7 padding; null when the padding is not valid. */
export function pkcs7Unpad(data: Uint8Array): Uint8Array | null {
  if (data.length === 0 || data.length % 16 !== 0) return null;
  const n = data[data.length - 1]!;
  if (n < 1 || n > 16) return null;
  for (let i = data.length - n; i < data.length; i++) if (data[i] !== n) return null;
  return data.subarray(0, data.length - n);
}
