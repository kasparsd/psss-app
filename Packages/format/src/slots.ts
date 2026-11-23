// Section 7: wrapped group keys, slots, recovery kit, and 5.2 attachment chunks.
import { concat, label, u32, u96, utf8 } from './bytes.ts';
import { CborError, cmap, decode, encode, isBytes, isMap, isUint, onlyKeys, type CMap } from './cbor.ts';
import * as hpke from './hpke.ts';
import { ed25519PublicFromSeed, hkdf, argon2id, chachaOpen, chachaSeal, sha256, AeadError, type Argon2Params } from './prims.ts';
import { FormatError } from './keys.ts';
import { zeros, eq } from './bytes.ts';
import { derivePerson } from './keys.ts';
import type { EncapsulationInputs } from './xwing.ts';

// ---------------------------------------------------------------- 7.1 wrapped group keys

/** info = "psss/v1/group-key" || gid || u32(e) || recipient_pid */
export const wrapInfo = (gid: Uint8Array, epoch: number, recipientPid: Uint8Array): Uint8Array =>
  concat(label('psss/v1/group-key'), gid, u32(epoch), recipientPid);

/** wrap = HPKE.SealBase(recipient kem_pk, info, aad = empty, K_e): enc (1120) || ciphertext (48). */
export const wrapGroupKey = (gid: Uint8Array, epoch: number, key: Uint8Array, recipientPid: Uint8Array, recipientKemPk: Uint8Array,
                             kem?: EncapsulationInputs): Uint8Array =>
  hpke.sealBase(recipientKemPk, wrapInfo(gid, epoch, recipientPid), new Uint8Array(0), key, kem);

export const unwrapGroupKey = (gid: Uint8Array, epoch: number, recipientPid: Uint8Array, recipientKemSeed: Uint8Array, wrap: Uint8Array): Uint8Array =>
  hpke.openBase(recipientKemSeed, wrapInfo(gid, epoch, recipientPid), new Uint8Array(0), wrap);

// ---------------------------------------------------------------- 7.2 slots

export const SLOT_PASSWORD = 1, SLOT_KIT = 2, SLOT_DEVICE = 3;
export const DEFAULT_ARGON2: Argon2Params = { memory: 131072, passes: 3, lanes: 4 };
export const MIN_MEMORY_KIB = 65536, MIN_PASSES = 2;

export interface SlotFields { type: number; pid: Uint8Array; slotId: Uint8Array; params: CMap }

const slotMap = (f: SlotFields, ciphertext?: Uint8Array): CMap => {
  const m = cmap([[1, 1], [2, f.type], [3, f.pid], [4, f.slotId], [5, f.params]]);
  if (ciphertext) m.set(6, ciphertext);
  return m;
};
/** `aad` is the same map without key 6. */
export const slotAad = (f: SlotFields): Uint8Array => encode(slotMap(f));

const nfcBytes = (pw: string) => utf8(pw.normalize('NFC'));
export const passwordParams = (salt: Uint8Array, p: Argon2Params): CMap => cmap([[1, salt], [2, p.memory], [3, p.passes], [4, p.lanes]]);

function passwordKey(password: string, salt: Uint8Array, p: Argon2Params, slotId: Uint8Array): Uint8Array {
  const kek = argon2id(nfcBytes(password), salt, p);
  return hkdf(kek, slotId, label('psss/v1/slot/password'));
}
const kitKey = (kit: Uint8Array, slotId: Uint8Array) => hkdf(kit, slotId, label('psss/v1/slot/kit'));

export function sealPasswordSlot(ps: Uint8Array, pid: Uint8Array, slotId: Uint8Array, salt: Uint8Array, p: Argon2Params, password: string): Uint8Array {
  const f: SlotFields = { type: SLOT_PASSWORD, pid, slotId, params: passwordParams(salt, p) };
  return encode(slotMap(f, chachaSeal(passwordKey(password, salt, p, slotId), zeros(12), slotAad(f), ps)));
}
export function sealKitSlot(ps: Uint8Array, pid: Uint8Array, slotId: Uint8Array, kit: Uint8Array): Uint8Array {
  const f: SlotFields = { type: SLOT_KIT, pid, slotId, params: cmap([]) };
  return encode(slotMap(f, chachaSeal(kitKey(kit, slotId), zeros(12), slotAad(f), ps)));
}
export const deviceSlotInfo = (pid: Uint8Array, slotId: Uint8Array) => concat(label('psss/v1/slot/device'), pid, slotId);
export function sealDeviceSlot(ps: Uint8Array, pid: Uint8Array, slotId: Uint8Array, deviceKemPk: Uint8Array, kem?: EncapsulationInputs): Uint8Array {
  const f: SlotFields = { type: SLOT_DEVICE, pid, slotId, params: cmap([[1, deviceKemPk]]) };
  return encode(slotMap(f, hpke.sealBase(deviceKemPk, deviceSlotInfo(pid, slotId), slotAad(f), ps, kem)));
}

export type Unlock = { password: string } | { kit: Uint8Array } | { deviceKemSeed: Uint8Array };

/** Open a slot and return PS. `testOnly` lifts the Argon2id floor (7.2: "except when running test vectors"). */
export function openSlot(slot: Uint8Array, unlock: Unlock, opts: { testOnly?: boolean } = {}): Uint8Array {
  let m;
  try { m = decode(slot); } catch (e) { if (e instanceof CborError) throw new FormatError('bad_slot', 0, e.reason); throw e; }
  if (!isMap(m)) throw new FormatError('bad_slot');
  try { onlyKeys(m, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 'slot'); } catch (e) { throw new FormatError('bad_slot', 0, (e as Error).message); }
  const type = m.get(2), pid = m.get(3), slotId = m.get(4), params = m.get(5), ct = m.get(6);
  if (m.get(1) !== 1 || !isUint(type) || !isBytes(pid, 32) || !isBytes(slotId, 16) || !isMap(params) || !isBytes(ct)) throw new FormatError('bad_slot');
  const f: SlotFields = { type, pid, slotId, params };
  const aad = slotAad(f);
  let ps: Uint8Array;
  try {
    if (type === SLOT_PASSWORD && 'password' in unlock) {
      onlyKeys(params, [1, 2, 3, 4], [1, 2, 3, 4], 'password params');
      const salt = params.get(1), memory = params.get(2), passes = params.get(3), lanes = params.get(4);
      if (!isBytes(salt, 16) || !isUint(memory) || !isUint(passes) || !isUint(lanes) || lanes < 1) throw new FormatError('bad_slot');
      if (!opts.testOnly && (memory < MIN_MEMORY_KIB || passes < MIN_PASSES)) throw new FormatError('argon2_too_weak');
      ps = chachaOpen(passwordKey(unlock.password, salt, { memory, passes, lanes }, slotId), zeros(12), aad, ct);
    } else if (type === SLOT_KIT && 'kit' in unlock) {
      onlyKeys(params, [], [], 'kit params');
      ps = chachaOpen(kitKey(unlock.kit, slotId), zeros(12), aad, ct);
    } else if (type === SLOT_DEVICE && 'deviceKemSeed' in unlock) {
      onlyKeys(params, [1], [1], 'device params');
      ps = hpke.openBase(unlock.deviceKemSeed, deviceSlotInfo(pid, slotId), aad, ct);
    } else throw new FormatError('wrong_unlock_for_slot_type');
  } catch (e) {
    if (e instanceof AeadError) throw new FormatError('bad_unlock');
    if (e instanceof CborError) throw new FormatError('bad_slot', 0, e.reason);
    if (e instanceof FormatError) throw e;
    throw new FormatError('bad_unlock', 0, (e as Error).message); // HPKE open failure
  }
  // Not in the spec: a device slot is unauthenticated against anyone who knows the device's public key, so PS must be
  // checked against the slot's pid.
  if (ps.length !== 32 || !eq(derivePerson(ps).pid, pid)) throw new FormatError('ps_does_not_match_pid');
  return ps;
}

// ---------------------------------------------------------------- recovery kit

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 7.2: "RK1-" followed by the 32 Crockford base32 characters in groups of four. The separator is not specified;
 *  a hyphen is used. */
export function kitToText(kit: Uint8Array): string {
  if (kit.length !== 20) throw new Error('a recovery kit is 20 bytes');
  let bits = 0n;
  for (const b of kit) bits = (bits << 8n) | BigInt(b);
  let s = '';
  for (let i = 31; i >= 0; i--) s += CROCKFORD[Number((bits >> BigInt(5 * i)) & 31n)];
  return 'RK1-' + s.match(/.{4}/g)!.join('-');
}

/** Reads the printed form back; Crockford's usual leniency (case, hyphens, I/L as 1, O as 0) is applied, which the spec does not say. */
export function kitFromText(text: string): Uint8Array {
  const t = text.trim().toUpperCase();
  if (!t.startsWith('RK1-')) throw new FormatError('bad_kit_prefix');
  const chars = t.slice(4).replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (chars.length !== 32) throw new FormatError('bad_kit_length');
  let bits = 0n;
  for (const ch of chars) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new FormatError('bad_kit_character');
    bits = (bits << 5n) | BigInt(v);
  }
  const out = new Uint8Array(20);
  for (let i = 19; i >= 0; i--) { out[i] = Number(bits & 255n); bits >>= 8n; }
  return out;
}

// ---------------------------------------------------------------- 5.2 attachment chunks

/** ChaCha20-Poly1305(key, nonce = u96(chunk index), aad = "psss/v1/chunk", data); chunk_id = SHA-256(sealed chunk). */
export const sealChunk = (key: Uint8Array, index: number, data: Uint8Array): Uint8Array =>
  chachaSeal(key, u96(index), label('psss/v1/chunk'), data);
export const openChunk = (key: Uint8Array, index: number, sealed: Uint8Array): Uint8Array =>
  chachaOpen(key, u96(index), label('psss/v1/chunk'), sealed);
export const chunkId = (sealed: Uint8Array): Uint8Array => sha256(sealed);
export { ed25519PublicFromSeed };
