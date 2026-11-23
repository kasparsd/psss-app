// Section 3: person, card, gid, key commitment.
import { concat, eq, label, u32 } from './bytes.ts';
import { CborError, cmap, decode, encode, isBytes, isMap, onlyKeys, type CMap } from './cbor.ts';
import { ed25519PublicFromSeed, ed25519Sign, ed25519Verify, hkdf, sha256 } from './prims.ts';
import * as xwing from './xwing.ts';

export class FormatError extends Error {
  code: string;
  step: number;
  constructor(code: string, step = 0, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.step = step;
  }
}

export interface Person {
  ps: Uint8Array;
  signSeed: Uint8Array;
  pid: Uint8Array; // Ed25519 public key
  kemSeed: Uint8Array; // X-Wing private key (32-byte seed)
  kemPk: Uint8Array; // 1216 bytes
}

/** 3.1 */
export function derivePerson(ps: Uint8Array): Person {
  if (ps.length !== 32) throw new FormatError('bad_person_secret');
  const none = new Uint8Array(0);
  const signSeed = hkdf(ps, none, label('psss/v1/person/sign'));
  const kemSeed = hkdf(ps, none, label('psss/v1/person/kem'));
  return { ps, signSeed, pid: ed25519PublicFromSeed(signSeed), kemSeed, kemPk: xwing.publicKey(kemSeed) };
}

/** 3.1 card = { 1: pid, 2: kem_pk, 3: sig }, sig = Ed25519(sign_seed, "psss/v1/card" || pid || kem_pk) */
export function makeCard(p: Person): CMap {
  const sig = ed25519Sign(p.signSeed, concat(label('psss/v1/card'), p.pid, p.kemPk));
  return cmap([[1, p.pid], [2, p.kemPk], [3, sig]]);
}

export interface Card { pid: Uint8Array; kemPk: Uint8Array }

/** Shape only (used when reading a record: step 2). */
export function cardShape(v: unknown): CMap {
  if (!isMap(v)) throw new CborError('bad_card');
  onlyKeys(v, [1, 2, 3], [1, 2, 3], 'card');
  if (!isBytes(v.get(1), 32) || !isBytes(v.get(2), xwing.PK_LEN) || !isBytes(v.get(3), 64)) throw new CborError('bad_card');
  return v;
}

/** Shape and signature. */
export function verifyCard(v: unknown): Card {
  const m = cardShape(v);
  const pid = m.get(1) as Uint8Array;
  const kemPk = m.get(2) as Uint8Array;
  if (!ed25519Verify(pid, concat(label('psss/v1/card'), pid, kemPk), m.get(3) as Uint8Array)) throw new FormatError('bad_card_signature');
  return { pid, kemPk };
}

export const cardBytes = (p: Person): Uint8Array => encode(makeCard(p));
export const verifyCardBytes = (b: Uint8Array): Card => verifyCard(decode(b));

/** 3.3 gid = SHA-256("psss/v1/gid" || creator_pid || genesis_nonce) */
export const gidOf = (creatorPid: Uint8Array, genesisNonce: Uint8Array): Uint8Array =>
  sha256(label('psss/v1/gid'), creatorPid, genesisNonce);

/** 3.3 commit(e) = SHA-256("psss/v1/key-commit" || gid || u32(e) || K_e) */
export const commitOf = (gid: Uint8Array, epoch: number, key: Uint8Array): Uint8Array =>
  sha256(label('psss/v1/key-commit'), gid, u32(epoch), key);

export { eq };
