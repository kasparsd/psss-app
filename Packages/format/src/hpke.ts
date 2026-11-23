// HPKE (RFC 9180) base mode, single-shot, KEM X-Wing (0x647a), KDF HKDF-SHA256 (0x0001), AEAD AES-256-GCM (0x0002).
import { concat, utf8, zeros } from './bytes.ts';
import { aesGcmOpen, aesGcmSeal, hmac } from './prims.ts';
import * as xwing from './xwing.ts';
import { FormatError } from './keys.ts';

export const suiteIdOf = (kem: number, kdf: number, aead: number): Uint8Array =>
  concat(utf8('HPKE'), Uint8Array.of(kem >> 8, kem & 255, kdf >> 8, kdf & 255, aead >> 8, aead & 255));
const SUITE_ID = suiteIdOf(0x647a, 0x0001, 0x0002);
const V1 = utf8('HPKE-v1');
export const NENC = xwing.CT_LEN; // 1120
export const TAG = 16;

const labeledExtract = (suite: Uint8Array, salt: Uint8Array, lab: string, ikm: Uint8Array) =>
  hmac(salt.length ? salt : zeros(32), concat(V1, suite, utf8(lab), ikm));

function labeledExpand32(suite: Uint8Array, prk: Uint8Array, lab: string, info: Uint8Array, len: number): Uint8Array {
  if (len > 32) throw new Error('single block only');
  const full = concat(Uint8Array.of(len >> 8, len & 255), V1, suite, utf8(lab), info);
  return hmac(prk, concat(full, Uint8Array.of(1))).slice(0, len); // HKDF-Expand, first block
}

/** RFC 9180 section 5.1 KeySchedule, mode_base (0x00), empty psk and psk_id. `nk` is the AEAD key length. */
export function keySchedule(suite: Uint8Array, sharedSecret: Uint8Array, info: Uint8Array, nk = 32): { key: Uint8Array; nonce: Uint8Array } {
  const none = new Uint8Array(0);
  const pskIdHash = labeledExtract(suite, none, 'psk_id_hash', none);
  const infoHash = labeledExtract(suite, none, 'info_hash', info);
  const ctx = concat(Uint8Array.of(0), pskIdHash, infoHash);
  const secret = labeledExtract(suite, sharedSecret, 'secret', none);
  return { key: labeledExpand32(suite, secret, 'key', ctx, nk), nonce: labeledExpand32(suite, secret, 'base_nonce', ctx, 12) };
}

/** SealBase(pkR, info, aad, pt) = enc || ciphertext. `kem` options let a test fix the KEM randomness. */
export function sealBase(pkR: Uint8Array, info: Uint8Array, aad: Uint8Array, pt: Uint8Array,
                         kem: xwing.EncapsulationInputs = {}): Uint8Array {
  const { ct: enc, ss } = xwing.encapsulate(pkR, kem);
  const { key, nonce } = keySchedule(SUITE_ID, ss, info);
  return concat(enc, aesGcmSeal(key, nonce, aad, pt));
}

/** OpenBase(enc, skR, info, aad, ct); the private key is the 32-byte X-Wing seed. Throws on failure. */
export function openBase(seed: Uint8Array, info: Uint8Array, aad: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < NENC + TAG) throw new FormatError('bad_hpke', 'reject', 'shorter than enc and a tag');
  try {
    const ss = xwing.decapsulate(seed, blob.subarray(0, NENC));
    const { key, nonce } = keySchedule(SUITE_ID, ss, info);
    return aesGcmOpen(key, nonce, aad, blob.subarray(NENC));
  } catch { throw new FormatError('bad_hpke'); }
}
