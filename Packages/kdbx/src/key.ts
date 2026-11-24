// The composite key: SHA-256 over the hash of each credential, as every KeePass implementation derives it.
import { createHash } from 'node:crypto';
import { sha256 } from './ciphers.ts';
import { concat, fromHex, equal } from './bytes.ts';
import { InvalidKey, Unsupported } from './errors.ts';
import { child, parseXml } from './xml.ts';

export interface KdbxKey {
  /**
   * The password, as text (UTF-8 is what gets hashed). An empty string counts as no password when a key file is also
   * given (KeePassXC does the same), so `{ password: '', keyFile }` opens a key-file-only database. On its own, an empty
   * string is the empty password (KeePassXC opens such a database).
   */
  password?: string;
  /** The key file's bytes: XML version 1 or 2, 32 raw bytes, 64 hex digits, or any other file (hashed whole). */
  keyFile?: Uint8Array;
  /** Hardware challenge-response (YubiKey, OnlyKey) is not supported: setting this throws `Unsupported`. */
  challengeResponse?: unknown;
}

export function compositeKey(key: KdbxKey): Uint8Array {
  if (key.challengeResponse !== undefined && key.challengeResponse !== false) {
    throw new Unsupported('challenge-response key', 'Unsupported: challenge-response keys (YubiKey, OnlyKey)');
  }
  const parts: Uint8Array[] = [];
  const emptyPasswordCounts = key.keyFile === undefined;
  if (key.password !== undefined && (key.password !== '' || emptyPasswordCounts)) parts.push(sha256(new TextEncoder().encode(key.password)));
  if (key.keyFile !== undefined) parts.push(keyFileHash(key.keyFile));
  if (parts.length === 0) throw new InvalidKey('Give a password, a key file, or both');
  return sha256(concat(...parts));
}

/**
 * XML key files (versions 1 and 2), a raw 32 bytes, 64 hex digits, or the SHA-256 of anything else. Follows KeePassXC:
 * XML key data that is not 32 bytes is zero-padded or cut to 32 (version 2 needs a matching Hash attribute for that);
 * an XML key file with empty or no data is hashed whole; invalid base64 (version 1) or hex (version 2) and a failing
 * checksum are `InvalidKey`.
 */
export function keyFileHash(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new InvalidKey('The key file is empty');
  let root;
  try {
    root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(data), { maxDepth: 16, maxNodes: 1000 });
  } catch {
    root = undefined; // not XML (or hostile XML): fall through to the raw forms
  }
  if (root && root.name === 'KeyFile') {
    const dataNode = child(child(root, 'Key'), 'Data');
    if (dataNode) {
      const version = (child(child(root, 'Meta'), 'Version')?.text ?? '1.0').trim();
      const text = dataNode.text.replace(/\s+/g, '');
      // As KeePassXC reads them: a key shorter than 32 bytes is padded with zeros, a longer one cut to its first 32.
      if (version.startsWith('2')) {
        let bytes: Uint8Array;
        try {
          bytes = fromHex(text);
        } catch {
          throw new InvalidKey('The key file (XML version 2) holds invalid hex data');
        }
        const check = dataNode.attributes.find(([n]) => n === 'Hash')?.[1];
        if (check !== undefined) {
          let expected: Uint8Array | undefined;
          try {
            expected = fromHex(check.replace(/\s+/g, ''));
          } catch {
            expected = undefined;
          }
          if (!expected || !equal(sha256(bytes).subarray(0, 4), expected.subarray(0, 4))) {
            throw new InvalidKey('The key file (XML version 2) fails its own checksum');
          }
        } else if (bytes.length !== 32) {
          throw new InvalidKey('The key file (XML version 2) does not hold 32 bytes');
        }
        if (bytes.length > 0) return fit32(bytes);
      } else if (text !== '') {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new InvalidKey('The key file (XML version 1) holds invalid base64 data');
        const bytes = new Uint8Array(Buffer.from(text, 'base64'));
        if (bytes.length > 0) return fit32(bytes);
      }
      // An XML key file with no key data is not an error: the whole file is hashed, as KeePassXC does.
    }
  }
  if (data.length === 32) return data.slice();
  if (data.length === 64) {
    try {
      return fromHex(new TextDecoder('ascii', { fatal: true }).decode(data));
    } catch {
      // not hex: hashed whole
    }
  }
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function fit32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytes.subarray(0, 32));
  return out;
}
