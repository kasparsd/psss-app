import { createHmac, randomBytes } from 'node:crypto';

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';
export type Totp = { secret: string; digits: number; period: number; algorithm: Algorithm };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function randomSecret(): string { return base32Encode(randomBytes(20)); }

/** RFC 6238 code for the time step that contains `at` (milliseconds). */
export function code(totp: Totp, at: number = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(at / 1000 / totp.period) + stepOffset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(totp.algorithm.toLowerCase(), base32Decode(totp.secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** totp.digits).padStart(totp.digits, '0');
}

/** The code is accepted for the current step and one step either side, as most sites do. */
export function verify(totp: Totp, typed: string, at: number = Date.now()): boolean {
  const clean = typed.replace(/\s/g, '');
  return [-1, 0, 1].some((offset) => code(totp, at, offset) === clean);
}

export function secondsLeft(totp: Totp, at: number = Date.now()): number {
  return totp.period - (Math.floor(at / 1000) % totp.period);
}

export function otpauthURI(totp: Totp, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret: totp.secret, issuer, algorithm: totp.algorithm, digits: String(totp.digits), period: String(totp.period) });
  return `otpauth://totp/${label}?${query}`;
}

export function parseOptions(input: { secret?: string; digits?: unknown; period?: unknown; algorithm?: unknown }): Totp {
  const algorithm = String(input.algorithm ?? 'SHA1').toUpperCase().replace('-', '');
  if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') throw new Error('algorithm must be SHA1, SHA256 or SHA512');
  const digits = Number(input.digits ?? 6);
  if (![6, 7, 8].includes(digits)) throw new Error('digits must be 6, 7 or 8');
  const period = Number(input.period ?? 30);
  if (!Number.isInteger(period) || period < 1 || period > 300) throw new Error('period must be 1 to 300 seconds');
  const secret = (input.secret || randomSecret()).replace(/[\s=-]/g, '').toUpperCase();
  base32Decode(secret);
  return { secret, digits, period, algorithm };
}
