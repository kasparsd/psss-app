// Section 4 (sealed records, padding, body, clock) and the payload shapes of sections 5 and 6.
import { concat, cmp, eq, label, readU32, u32, zeros } from './bytes.ts';
import { CborError, cmap, decode, encode, isBytes, isMap, isUint, onlyKeys, strictlySortedByEncoding,
         type CborValue, type CMap } from './cbor.ts';
import { AeadError, chachaOpen, chachaSeal, ed25519Sign, ed25519Verify, hkdf, sha256 } from './prims.ts';
import { cardShape, FormatError, type Person } from './keys.ts';

export const MAGIC = new TextEncoder().encode('PSR1');
export const HEADER_LEN = 72; // 4.1
export const TAG_LEN = 16;
export const MAX_BODY = 1 << 20; // 4.2: "body is at most 1 MiB"

export const KIND = { genesis: 1, member: 2, epoch: 3, replace: 4, item: 16, checkpoint: 32 } as const;
export const MEMBERSHIP_KINDS: number[] = [KIND.genesis, KIND.member, KIND.epoch, KIND.replace];

/** 4.2: pad to the next multiple of 256 when that is at most 4096, otherwise the next multiple of 4096.
 *  "Next multiple" is read as "smallest multiple that is >= n" (an exact multiple stays); see findings. */
export function paddedLength(n: number): number {
  const a = Math.ceil(n / 256) * 256;
  return a <= 4096 ? a : Math.ceil(n / 4096) * 4096;
}

/** Is `len` a permitted plaintext size at all (4.2)? */
export const permittedSize = (len: number): boolean =>
  len > 0 && ((len % 256 === 0 && len <= 4096) || len % 4096 === 0);

export function header(gid: Uint8Array, epoch: number, salt: Uint8Array): Uint8Array {
  if (gid.length !== 32 || salt.length !== 32) throw new Error('gid and salt are 32 bytes');
  return concat(MAGIC, gid, u32(epoch), salt);
}

/** 4.1 rk = HKDF(ikm = K_epoch, salt = salt, info = "psss/v1/record") */
export const recordKey = (groupKey: Uint8Array, salt: Uint8Array): Uint8Array => hkdf(groupKey, salt, label('psss/v1/record'));

/** 4.2 plaintext = u32(len(body)) || body || zero bytes (padded). */
export function padPlaintext(body: Uint8Array): Uint8Array {
  const n = 4 + body.length;
  const p = new Uint8Array(paddedLength(n));
  p.set(u32(body.length), 0);
  p.set(body, 4);
  return p;
}

/** Encrypt an arbitrary (already padded) plaintext as a sealed record. Exposed for negative vectors. */
export function sealPlaintext(gid: Uint8Array, epoch: number, groupKey: Uint8Array, salt: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const h = header(gid, epoch, salt);
  return concat(h, chachaSeal(recordKey(groupKey, salt), zeros(12), h, plaintext));
}

export const recordId = (sealed: Uint8Array): Uint8Array => sha256(sealed);

export type Clock = [number, number]; // [wall_ms, counter]

export interface BodyFields {
  author: Uint8Array; device: Uint8Array; seq: number; prev: Uint8Array | null;
  clock: Clock; kind: number; payload: CborValue;
}

export function bodyMap(f: BodyFields): CMap {
  return cmap([[1, 1], [2, f.author], [3, f.device], [4, f.seq], [5, f.prev], [6, [f.clock[0], f.clock[1]]], [7, f.kind], [8, f.payload]]);
}

/** 4.3 sig = Ed25519(author's sign_seed, "psss/v1/record-sig" || header || body_without_9) */
export const signedBytes = (hdr: Uint8Array, bodyWithout9: CMap): Uint8Array =>
  concat(label('psss/v1/record-sig'), hdr, encode(bodyWithout9));

export function sealRecord(signer: Person, gid: Uint8Array, epoch: number, groupKey: Uint8Array, salt: Uint8Array, f: BodyFields,
                           opts: { sigOverride?: Uint8Array } = {}): Uint8Array {
  const h = header(gid, epoch, salt);
  const body = bodyMap(f);
  const sig = opts.sigOverride ?? ed25519Sign(signer.signSeed, signedBytes(h, body));
  body.set(9, sig);
  return sealPlaintext(gid, epoch, groupKey, salt, padPlaintext(encode(body)));
}

export interface Rec {
  sealed: Uint8Array;
  id: Uint8Array;
  gid: Uint8Array;
  epoch: number;
  /** The group key that opened it (an epoch record's commitment is checked against this). */
  key: Uint8Array;
  author: Uint8Array; device: Uint8Array; seq: number; prev: Uint8Array | null;
  wall: number; counter: number; kind: number;
  payload: CMap;
  body: CMap;
  /** 4.5 order tuple (wall_ms, counter, author, device, seq) */
  key5: OrderKey;
}
export type OrderKey = [number, number, Uint8Array, Uint8Array, number];

/** 4.5: compare tuples element by element, byte strings bytewise. */
export function compareKeys(a: OrderKey, b: OrderKey): number {
  return (a[0] - b[0]) || (a[1] - b[1]) || cmp(a[2], b[2]) || cmp(a[3], b[3]) || (a[4] - b[4]);
}
export const sortRecords = <T extends { key5: OrderKey }>(rs: T[]): T[] => [...rs].sort((x, y) => compareKeys(x.key5, y.key5));

export type KeyRing = { gids: Uint8Array[]; keys: (gid: Uint8Array, epoch: number) => Uint8Array[] };

/** A key ring from a list of [gid, epoch, key]. */
export function keyRing(entries: [Uint8Array, number, Uint8Array][]): KeyRing {
  return {
    gids: entries.map((e) => e[0]),
    keys: (gid, epoch) => entries.filter((e) => eq(e[0], gid) && e[1] === epoch).map((e) => e[2]),
  };
}

/** Section 9, steps 1 to 3. Throws FormatError (code, step); a record that throws is discarded. */
export function openRecord(sealed: Uint8Array, ring: KeyRing): Rec {
  // Step 1: magic, a gid it knows, an epoch it holds a key for.
  if (sealed.length < HEADER_LEN + TAG_LEN) throw new FormatError('too_short', 1);
  if (!eq(sealed.subarray(0, 4), MAGIC)) throw new FormatError('bad_magic', 1);
  const gid = sealed.slice(4, 36);
  if (!ring.gids.some((g) => eq(g, gid))) throw new FormatError('unknown_gid', 1);
  const epoch = readU32(sealed, 36);
  const keys = ring.keys(gid, epoch);
  if (keys.length === 0) throw new FormatError('no_key', 1);
  // Step 2: AEAD tag, padding, deterministic form of the body.
  const hdr = sealed.subarray(0, HEADER_LEN);
  const salt = sealed.subarray(40, 72);
  let plaintext: Uint8Array | null = null;
  let key: Uint8Array = keys[0]!;
  for (const k of keys) {
    try { plaintext = chachaOpen(recordKey(k, salt), zeros(12), hdr, sealed.subarray(HEADER_LEN)); key = k; break; }
    catch (e) { if (!(e instanceof AeadError)) throw e; }
  }
  if (!plaintext) throw new FormatError('bad_tag', 2);
  if (!permittedSize(plaintext.length)) throw new FormatError('bad_size', 2);
  const len = readU32(plaintext, 0);
  if (len > MAX_BODY) throw new FormatError('body_too_large', 2);
  if (4 + len > plaintext.length) throw new FormatError('bad_length', 2);
  if (paddedLength(4 + len) !== plaintext.length) throw new FormatError('bad_size', 2, 'padding is not minimal');
  for (let i = 4 + len; i < plaintext.length; i++) if (plaintext[i] !== 0) throw new FormatError('bad_padding', 2);
  let body: CborValue;
  try { body = decode(plaintext.subarray(4, 4 + len)); }
  catch (e) { if (e instanceof CborError) throw new FormatError('bad_body', 2, e.reason); throw e; }
  const f = bodyFields(body);
  let payload: CMap;
  try { payload = checkPayload(f.kind, f.payload); }
  catch (e) { if (e instanceof CborError) throw new FormatError('bad_payload', 2, e.message); throw e; }
  // Step 3: author, then the signature over header and body.
  const m = body as CMap;
  const sig = m.get(9) as Uint8Array;
  const without9 = new Map(m);
  without9.delete(9);
  if (!ed25519Verify(f.author, signedBytes(hdr, without9), sig)) throw new FormatError('bad_signature', 3);
  return {
    sealed, id: recordId(sealed), gid, epoch, key, author: f.author, device: f.device, seq: f.seq, prev: f.prev,
    wall: f.clock[0], counter: f.clock[1], kind: f.kind, payload, body: m,
    key5: [f.clock[0], f.clock[1], f.author, f.device, f.seq],
  };
}

/** Body shape (4.3), step 2. */
function bodyFields(body: CborValue): BodyFields {
  const bad = (why: string): never => { throw new FormatError('bad_body_schema', 2, why); };
  if (!isMap(body)) return bad('not a map');
  try { onlyKeys(body, [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9], 'body'); } catch (e) { return bad((e as Error).message); }
  if (body.get(1) !== 1) bad('v');
  const author = body.get(2), device = body.get(3), seq = body.get(4), prev = body.get(5), clock = body.get(6);
  if (!isBytes(author, 32)) bad('author');
  if (!isBytes(device, 16)) bad('device');
  if (!isUint(seq) || seq < 1) bad('seq');
  if (seq === 1 ? prev !== null : !isBytes(prev, 32)) bad('prev');
  if (!Array.isArray(clock) || clock.length !== 2 || !isUint(clock[0]) || !isUint(clock[1])) bad('clock');
  const kind = body.get(7);
  if (!isUint(kind)) bad('kind');
  if (!isMap(body.get(8))) bad('payload');
  if (!isBytes(body.get(9), 64)) bad('sig');
  return { author: author as Uint8Array, device: device as Uint8Array, seq: seq as number, prev: prev as Uint8Array | null,
           clock: [(clock as number[])[0]!, (clock as number[])[1]!], kind: kind as number, payload: body.get(8) as CMap };
}

const sortedList = (v: unknown, what: string): CborValue[] => {
  if (!Array.isArray(v)) throw new CborError('bad_payload', what);
  if (!strictlySortedByEncoding(v)) throw new CborError('not_sorted', what);
  return v;
};

/** Payload shapes by kind (sections 5 and 6). Unknown kinds are kept unchecked (see findings). */
export function checkPayload(kind: number, p: CMap): CMap {
  const bad = (w: string) => new CborError('bad_payload', w);
  switch (kind) {
    case KIND.item: {
      onlyKeys(p, [1, 2, 3], [1, 2, 3], 'item');
      const set = p.get(2), clear = sortedList(p.get(3), 'clear');
      if (!isBytes(p.get(1), 16) || !isMap(set)) throw bad('item');
      for (const k of set.keys()) if (typeof k !== 'string') throw bad('set key');
      for (const f of clear) {
        if (typeof f !== 'string') throw bad('clear name');
        if (set.has(f)) throw bad('field in both set and clear'); // 5.1
      }
      if (set.has('deleted') && !isUint(set.get('deleted'))) throw bad('deleted is not a wall_ms');
      return p;
    }
    case KIND.checkpoint: {
      onlyKeys(p, [1, 2, 3], [1, 2, 3], 'checkpoint');
      const covered = sortedList(p.get(1), 'covered');
      for (const c of covered) {
        if (!Array.isArray(c) || c.length !== 4 || !isBytes(c[0], 32) || !isBytes(c[1], 16) || !isUint(c[2]) || (c[2] as number) < 1 || !isBytes(c[3], 32)) throw bad('covered');
      }
      if (!isBytes(p.get(2), 32)) throw bad('mhead');
      const items = sortedList(p.get(3), 'items');
      for (const it of items) {
        if (!Array.isArray(it) || it.length !== 2 || !isBytes(it[0], 16) || !isMap(it[1])) throw bad('item');
        for (const [name, e] of it[1]) {
          if (typeof name !== 'string' || !Array.isArray(e) || e.length !== 2) throw bad('field');
          const ck = e[1];
          if (!Array.isArray(ck) || ck.length !== 5 || !isUint(ck[0]) || !isUint(ck[1]) || !isBytes(ck[2], 32) || !isBytes(ck[3], 16) || !isUint(ck[4])) throw bad('field clock');
        }
      }
      return p;
    }
    case KIND.genesis:
      onlyKeys(p, [1, 2, 3], [1, 2, 3], 'genesis');
      if (!isBytes(p.get(1), 32) || !isBytes(p.get(3), 32)) throw bad('genesis');
      cardShape(p.get(2));
      return p;
    case KIND.member: {
      onlyKeys(p, [1, 2, 3, 4], [1, 2, 3], 'member');
      const t = p.get(2), role = p.get(3);
      if (!isBytes(p.get(1), 32) || !(isBytes(t, 32) || isMap(t)) || !isUint(role) || role > 3) throw bad('member');
      if (isMap(t)) cardShape(t);
      if (p.has(4)) {
        for (const c of sortedList(p.get(4), 'cut')) if (!Array.isArray(c) || c.length !== 2 || !isBytes(c[0], 16) || !isUint(c[1]) || (c[1] as number) < 1) throw bad('cut');
      }
      return p;
    }
    case KIND.epoch:
      onlyKeys(p, [1, 2, 3, 4], [1, 2, 3, 4], 'epoch');
      if (!isBytes(p.get(1), 32) || !isUint(p.get(2)) || !isBytes(p.get(3), 32) || !isBytes(p.get(4), 32)) throw bad('epoch');
      return p;
    case KIND.replace:
      onlyKeys(p, [1, 2, 3], [1, 2, 3], 'replace');
      if (!isBytes(p.get(1), 32) || !isBytes(p.get(2), 32)) throw bad('replace');
      cardShape(p.get(3));
      return p;
    default:
      return p;
  }
}

// ---- 4.5 clock

/** 4.5: wall_ms is the larger of own time and the largest wall_ms accepted; counter is one more than the largest counter
 *  seen for that wall_ms, or 0. `seen` are the [wall_ms, counter] of every record the device has accepted or written. */
export function nextClock(nowMs: number, seen: Clock[]): Clock {
  const wall = Math.max(nowMs, ...seen.map((c) => c[0]));
  const same = seen.filter((c) => c[0] === wall).map((c) => c[1]);
  return [wall, same.length ? Math.max(...same) + 1 : 0];
}

export const DAY_MS = 24 * 3600 * 1000;
/** 4.5: a reader SHOULD hold back a record whose wall_ms is more than 24 hours ahead of its own time. */
export const heldBack = (wallMs: number, nowMs: number): boolean => wallMs - nowMs > DAY_MS;
