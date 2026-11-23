// X-Wing KEM (ML-KEM-768 + X25519), after draft-connolly-cfrg-xwing-kem, built on node:crypto.
// Section 3.1: the private key is a 32-byte seed; the public key is 1216 bytes; an encapsulation is 1120 bytes.
import { concat, hex } from './bytes.ts';
import { sha3_256, shake256, mlkem768FromSeed, mlkem768Encapsulate, x25519, x25519PublicFromSeed } from './prims.ts';

export const SEED_LEN = 32;
export const PK_LEN = 1216;
export const CT_LEN = 1120;
/** XWingLabel: the six bytes \.//^\ */
export const LABEL = Uint8Array.of(0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c);

/** expandDecapsulationKey: SHAKE256(seed, 96) = ML-KEM seed d||z (64) || X25519 secret (32). */
export function expand(seed: Uint8Array): { mlkemSeed: Uint8Array; xSk: Uint8Array } {
  if (seed.length !== SEED_LEN) throw new Error('X-Wing seed is 32 bytes');
  const e = shake256(seed, 96);
  return { mlkemSeed: e.slice(0, 64), xSk: e.slice(64, 96) };
}

export function publicKey(seed: Uint8Array): Uint8Array {
  const { mlkemSeed, xSk } = expand(seed);
  return concat(mlkem768FromSeed(mlkemSeed).pk, x25519PublicFromSeed(xSk));
}

const combine = (ssM: Uint8Array, ssX: Uint8Array, ctX: Uint8Array, pkX: Uint8Array) =>
  sha3_256(ssM, ssX, ctX, pkX, LABEL);

export function decapsulate(seed: Uint8Array, ct: Uint8Array): Uint8Array {
  if (ct.length !== CT_LEN) throw new Error('X-Wing ciphertext is 1120 bytes');
  const { mlkemSeed, xSk } = expand(seed);
  const ssM = mlkem768FromSeed(mlkemSeed).decapsulate(ct.subarray(0, 1088));
  const ctX = ct.subarray(1088);
  return combine(ssM, x25519(xSk, ctX), ctX, x25519PublicFromSeed(xSk));
}

export interface EncapsulationInputs {
  /** X25519 ephemeral secret. Default: random. */
  ekX?: Uint8Array;
  /** An ML-KEM-768 encapsulation to reuse: Node cannot supply the encapsulation randomness, so a
   *  deterministic seal takes ctM and its shared secret ssM from a prior random encapsulation. */
  mlkem?: { ct: Uint8Array; ss: Uint8Array };
}

export function encapsulate(pk: Uint8Array, inp: EncapsulationInputs = {}): { ct: Uint8Array; ss: Uint8Array } {
  if (pk.length !== PK_LEN) throw new Error('X-Wing public key is 1216 bytes');
  const pkM = pk.subarray(0, 1184);
  const pkX = pk.subarray(1184);
  const m = inp.mlkem ?? mlkem768Encapsulate(pkM);
  const ek = inp.ekX ?? crypto.getRandomValues(new Uint8Array(32));
  const ctX = x25519PublicFromSeed(ek);
  const ssX = x25519(ek, pkX);
  return { ct: concat(m.ct, ctX), ss: combine(m.ss, ssX, ctX, pkX) };
}

/** Known-answer self test input for debugging only. */
export const debugHex = hex;
