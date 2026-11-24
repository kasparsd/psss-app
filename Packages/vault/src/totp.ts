// RFC 4226 and 6238 verification codes, for the computed `code` field of an item (the `otp` field of the item schema).
import { createHmac } from 'node:crypto';

const ALGORITHMS: Record<number, string> = { 1: 'sha1', 2: 'sha256', 3: 'sha512' };

export function hotp(secret: Uint8Array, counter: bigint, digits: number, algorithm: number): string {
  const name = ALGORITHMS[algorithm];
  if (!name) throw new Error(`unknown algorithm ${algorithm}`);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const mac = createHmac(name, secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const truncated = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** digits).padStart(digits, '0');
}

export function totp(otp: { secret: Uint8Array; digits: number; period: number; algorithm: number }, timeMs: number): { code: string; expiresInSeconds: number } {
  const seconds = Math.floor(timeMs / 1000);
  return {
    code: hotp(otp.secret, BigInt(Math.floor(seconds / otp.period)), otp.digits, otp.algorithm),
    expiresInSeconds: otp.period - (seconds % otp.period),
  };
}
