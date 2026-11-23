// HPKE (RFC 9180) base mode, single-shot, KEM X-Wing (0x647a), KDF HKDF-SHA256 (0x0001), AEAD AES-256-GCM (0x0002).
import { concat, utf8, zeros } from './bytes.ts';
import { aesGcmOpen, aesGcmSeal, hmac } from './prims.ts';
import * as xwing from './xwing.ts';

const SUITE_ID = concat(utf8('HPKE'), Uint8Array.of(0x64, 0x7a, 0x00, 0x01, 0x00, 0x02));
const V1 = utf8('HPKE-v1');
export const NENC = xwing.CT_LEN; // 1120
export const TAG = 16;

const labeledExtract = (salt: Uint8Array, lab: string, ikm: Uint8Array) =>
  hmac(salt.length ? salt : zeros(32), concat(V1, SUITE_ID, utf8(lab), ikm));

function labeledExpand32(prk: Uint8Array, lab: string, info: Uint8Array, len: number): Uint8Array {
  if (len > 32) throw new Error('single block only');
  const full = concat(Uint8Array.of(len >> 8, len & 255), V1, SUITE_ID, utf8(lab), info);
  return hmac(prk, concat(full, Uint8Array.of(1))).slice(0, len); // HKDF-Expand, first block
}

/** KeyScheduleS/R, mode_base (0x00), empty psk and psk_id. */
function keySchedule(sharedSecret: Uint8Array, info: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const pskIdHash = labeledExtract(new Uint8Array(0), 'psk_id_hash', new Uint8Array(0));
  const infoHash = labeledExtract(new Uint8Array(0), 'info_hash', info);
  const ctx = concat(Uint8Array.of(0), pskIdHash, infoHash);
  const secret = labeledExtract(sharedSecret, 'secret', new Uint8Array(0));
  return { key: labeledExpand32(secret, 'key', ctx, 32), nonce: labeledExpand32(secret, 'base_nonce', ctx, 12) };
}

/** SealBase(pkR, info, aad, pt) = enc || ciphertext. `enc` options let a test fix the KEM randomness. */
export function sealBase(pkR: Uint8Array, info: Uint8Array, aad: Uint8Array, pt: Uint8Array,
                         kem: xwing.EncapsulationInputs = {}): Uint8Array {
  const { ct: enc, ss } = xwing.encapsulate(pkR, kem);
  const { key, nonce } = keySchedule(ss, info);
  return concat(enc, aesGcmSeal(key, nonce, aad, pt));
}

/** OpenBase(enc, skR, info, aad, ct); the private key is the 32-byte X-Wing seed. Throws on failure. */
export function openBase(seed: Uint8Array, info: Uint8Array, aad: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < NENC + TAG) throw new Error('hpke: short');
  const ss = xwing.decapsulate(seed, blob.subarray(0, NENC));
  const { key, nonce } = keySchedule(ss, info);
  return aesGcmOpen(key, nonce, aad, blob.subarray(NENC));
}
