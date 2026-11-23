// Section 7: wrapped group keys, slots, recovery kit, and 5.2 attachment chunks.
import { concat, label, u32, utf8, zeros, eq, cmp } from './bytes.ts';
import { limits } from './limits.ts';
import { CborError, cmap, decode, encode, isBytes, isMap, isUint, onlyKeys, type CMap } from './cbor.ts';
import * as hpke from './hpke.ts';
import { ed25519PublicFromSeed, hkdf, argon2id, chachaOpen, chachaSeal, sha256, AeadError, type Argon2Params } from './prims.ts';
import { FormatError } from './keys.ts';
import { commitOf, derivePerson } from './keys.ts';
import type { EncapsulationInputs } from './xwing.ts';

// ---------------------------------------------------------------- 7.1 wrapped group keys

/** info = "psss/v1/group-key" || gid || u32(e) || recipient_pid */
export const wrapInfo = (gid: Uint8Array, epoch: number, recipientPid: Uint8Array): Uint8Array =>
  concat(label('psss/v1/group-key'), gid, u32(epoch), recipientPid);

/** wrap = HPKE.SealBase(recipient kem_pk, info, aad = empty, K_e): enc (1120) || ciphertext (48). */
export const wrapGroupKey = (gid: Uint8Array, epoch: number, key: Uint8Array, recipientPid: Uint8Array, recipientKemPk: Uint8Array,
                             kem?: EncapsulationInputs): Uint8Array =>
  hpke.sealBase(recipientKemPk, wrapInfo(gid, epoch, recipientPid), new Uint8Array(0), key, kem);

export function unwrapGroupKey(gid: Uint8Array, epoch: number, recipientPid: Uint8Array, recipientKemSeed: Uint8Array, wrap: Uint8Array): Uint8Array {
  try { return hpke.openBase(recipientKemSeed, wrapInfo(gid, epoch, recipientPid), new Uint8Array(0), wrap); } catch { throw new FormatError('bad_wrap'); }
}

// ---------------------------------------------------------------- 7.2 slots

export const SLOT_PASSWORD = 1, SLOT_KIT = 2, SLOT_DEVICE = 3;
export const DEFAULT_ARGON2: Argon2Params = { memory: 131072, passes: 3, lanes: 4 };

/** 7.2: a reader MUST refuse less than 65,536 KiB or fewer than 2 passes (a test-only switch lifts these), and MUST refuse more
 *  than 1,048,576 KiB, 16 passes or 16 lanes. Returns a code or null. */
export function argon2ParamsProblem(p: Argon2Params, testOnly = false): string | null {
  if (p.lanes < 1 || p.passes < 1 || p.memory < 8 * p.lanes) return 'bad_slot';
  if (p.memory > limits.argonMaxMemory || p.passes > limits.argonMaxPasses || p.lanes > limits.argonMaxLanes) return 'argon2_too_strong';
  if (!testOnly && (p.memory < limits.argonMinMemory || p.passes < limits.argonMinPasses)) return 'argon2_too_weak';
  return null;
}

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
  try { m = decode(slot); } catch (e) { if (e instanceof CborError) throw new FormatError('bad_slot', 'reject', e.reason); throw e; }
  if (!isMap(m)) throw new FormatError('bad_slot');
  // 7.2: a reader ignores a slot whose version or type it does not know.
  if (isUint(m.get(1)) && m.get(1) !== 1) throw new FormatError('unknown_slot', 'ignore');
  if (isUint(m.get(2)) && ![SLOT_PASSWORD, SLOT_KIT, SLOT_DEVICE].includes(m.get(2) as number)) throw new FormatError('unknown_slot', 'ignore');
  try { onlyKeys(m, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], 'slot'); } catch (e) { throw new FormatError('bad_slot', 'reject', (e as Error).message); }
  const type = m.get(2), pid = m.get(3), slotId = m.get(4), params = m.get(5), ct = m.get(6);
  if (m.get(1) !== 1 || !isUint(type) || !isBytes(pid, 32) || !isBytes(slotId, 16) || !isMap(params) || !isBytes(ct)) throw new FormatError('bad_slot');
  const f: SlotFields = { type, pid, slotId, params };
  const aad = slotAad(f);
  let ps: Uint8Array;
  try {
    if (type === SLOT_PASSWORD && 'password' in unlock) {
      onlyKeys(params, [1, 2, 3, 4], [1, 2, 3, 4], 'password params');
      const salt = params.get(1), memory = params.get(2), passes = params.get(3), lanes = params.get(4);
      if (!isBytes(salt, 16) || !isUint(memory) || !isUint(passes) || !isUint(lanes)) throw new FormatError('bad_slot');
      const problem = argon2ParamsProblem({ memory, passes, lanes }, !!opts.testOnly); // before any Argon2 work
      if (problem) throw new FormatError(problem);
      ps = chachaOpen(passwordKey(unlock.password, salt, { memory, passes, lanes }, slotId), zeros(12), aad, ct);
    } else if (type === SLOT_KIT && 'kit' in unlock) {
      onlyKeys(params, [], [], 'kit params');
      ps = chachaOpen(kitKey(unlock.kit, slotId), zeros(12), aad, ct);
    } else if (type === SLOT_DEVICE && 'deviceKemSeed' in unlock) {
      onlyKeys(params, [1], [1], 'device params');
      try { ps = hpke.openBase(unlock.deviceKemSeed, deviceSlotInfo(pid, slotId), aad, ct); } catch { throw new FormatError('bad_unlock'); }
    } else throw new FormatError('wrong_unlock_for_slot_type');
  } catch (e) {
    if (e instanceof AeadError) throw new FormatError('bad_unlock');
    if (e instanceof CborError) throw new FormatError('bad_slot', 'reject', e.reason);
    if (e instanceof FormatError) throw e;
    throw new FormatError('bad_unlock'); // HPKE open failure
  }
  // 7.2 Every slot: the PS inside MUST derive the slot's pid (slots are not signed).
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

/** 7.2: when reading, case, hyphens and spaces are ignored, I and L read as 1, and O reads as 0. */
export function kitFromText(text: string): Uint8Array {
  const t = text.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!t.startsWith('RK1')) throw new FormatError('bad_kit_prefix');
  const chars = t.slice(3);
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

// ---------------------------------------------------------------- 5.2 attachments

const u64 = (n: number): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
/** nonce = u32(0) || u64(index); aad = "psss/v1/chunk" || u64(size) || u32(number of chunks) */
export const chunkNonce = (index: number): Uint8Array => concat(u32(0), u64(index));
export const chunkAad = (size: number, count: number): Uint8Array => concat(label('psss/v1/chunk'), u64(size), u32(count));
export const sealChunk = (key: Uint8Array, index: number, size: number, count: number, data: Uint8Array): Uint8Array =>
  chachaSeal(key, chunkNonce(index), chunkAad(size, count), data);
export const chunkId = (sealed: Uint8Array): Uint8Array => sha256(sealed);

export interface AttachmentRef { key: Uint8Array; size: number; chunkIds: Uint8Array[] }

/** Split a file into chunks of 1,048,576 bytes (the last may be shorter) and seal them. */
export function sealAttachment(key: Uint8Array, data: Uint8Array): { ref: AttachmentRef; chunks: Uint8Array[] } {
  const n = Math.ceil(data.length / limits.chunkSize);
  const chunks = Array.from({ length: n }, (_, i) => sealChunk(key, i, data.length, n, data.subarray(i * limits.chunkSize, (i + 1) * limits.chunkSize)));
  return { ref: { key, size: data.length, chunkIds: chunks.map(chunkId) }, chunks };
}

/** Open an attachment from its reference and the sealed chunks, in order. Checks that the lengths add up to `size` (5.2). */
export function openAttachment(ref: AttachmentRef, chunks: Uint8Array[]): Uint8Array {
  if (chunks.length !== ref.chunkIds.length) throw new FormatError('chunk_count_mismatch');
  const parts: Uint8Array[] = [];
  chunks.forEach((c, i) => {
    if (!eq(chunkId(c), ref.chunkIds[i]!)) throw new FormatError('chunk_id_mismatch');
    let pt: Uint8Array;
    try { pt = chachaOpen(ref.key, chunkNonce(i), chunkAad(ref.size, chunks.length), c); } catch { throw new FormatError('chunk_tag'); }
    const last = i === chunks.length - 1;
    if (last ? pt.length > limits.chunkSize || pt.length === 0 : pt.length !== limits.chunkSize) throw new FormatError('bad_chunk_size');
    parts.push(pt);
  });
  const total = parts.reduce((a, p) => a + p.length, 0);
  if (total !== ref.size) throw new FormatError('size_mismatch');
  return concat(...parts);
}

// ---------------------------------------------------------------- 7.1 several wraps for one person and epoch

/** 7.1: a location may hold several wraps for one person and epoch; the reader tries each and uses the one whose key matches the
 *  commitment in the epoch record (or genesis). Returns null when none does. */
export function selectGroupKey(gid: Uint8Array, epoch: number, recipientPid: Uint8Array, recipientKemSeed: Uint8Array,
                               wraps: Uint8Array[], commit: Uint8Array): Uint8Array | null {
  for (const w of wraps) {
    try {
      const k = unwrapGroupKey(gid, epoch, recipientPid, recipientKemSeed, w);
      if (k.length === 32 && eq(commitOf(gid, epoch, k), commit)) return k;
    } catch { /* not for us, or damaged */ }
  }
  return null;
}
export { cmp, ed25519PublicFromSeed };
