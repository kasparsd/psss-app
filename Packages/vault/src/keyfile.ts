// The device key file: the X-Wing private key of this device (spec 3.2, 7.2), the key that opens the device slot (type 3).
// A small JSON text so that it can also be passed in an environment variable (`{ keyBytes }`):
//   {"format":"psss-device-key","version":1,"kem_seed":"<64 lowercase hex digits>"}
// The seed is the whole secret; the public key and everything else are derived from it. Nothing about the vault, the person or the
// device id is in it: the device id belongs to the device state, since it goes with the sequence numbers.
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromHex, hex } from '../../format/src/bytes.ts';
import * as xwing from '../../format/src/xwing.ts';
import { VaultError } from './errors.ts';
import type { Random } from './random.ts';

export interface DeviceKey { kemSeed: Uint8Array; kemPk: Uint8Array }

export const keyFileText = (kemSeed: Uint8Array): string =>
  `${JSON.stringify({ format: 'psss-device-key', version: 1, kem_seed: hex(kemSeed) })}\n`;

export function deviceKeyFromSeed(kemSeed: Uint8Array): DeviceKey {
  return { kemSeed, kemPk: xwing.publicKey(kemSeed) };
}

/** A new device key and the text of its key file. */
export function generateDeviceKey(random: Random): DeviceKey & { text: string } {
  const key = deviceKeyFromSeed(random(xwing.SEED_LEN));
  return { ...key, text: keyFileText(key.kemSeed) };
}

export function parseKeyFile(content: Uint8Array | string): DeviceKey {
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new VaultError('bad_key_file', 'not JSON'); }
  const o = j as { format?: unknown; version?: unknown; kem_seed?: unknown };
  if (!o || o.format !== 'psss-device-key' || o.version !== 1) throw new VaultError('bad_key_file', 'not a psss device key, version 1');
  if (typeof o.kem_seed !== 'string' || !/^[0-9a-f]{64}$/.test(o.kem_seed)) throw new VaultError('bad_key_file', 'kem_seed is 64 lowercase hex digits');
  return deviceKeyFromSeed(fromHex(o.kem_seed));
}

/** Writes the key file with mode 0600 and refuses to replace one: a device key is never overwritten. */
export function writeKeyFile(path: string, kemSeed: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(path, 'wx', 0o600);
    try { writeSync(fd, keyFileText(kemSeed)); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError('key_file_exists', `${path} exists; a device key is never overwritten`);
    throw e;
  }
  chmodSync(path, 0o600); // the umask may have narrowed it, never widened; this states the intent
}

export const readKeyFile = (path: string): DeviceKey => {
  try { return parseKeyFile(readFileSync(path)); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('no_key_file', `${path} does not exist`);
    throw e;
  }
};

/** Anything wider than owner-only is worth telling the person about (not on Windows, which has no such mode). */
export function keyFileWarning(path: string): string | null {
  if (process.platform === 'win32') return null;
  try {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) return `The key file ${path} can be read by other users (mode ${mode.toString(8)}). Run: chmod 600 ${path}`;
  } catch { /* unreadable: the open fails on its own */ }
  return null;
}
