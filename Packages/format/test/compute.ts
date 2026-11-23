// compute(type, input) -> expected, for every vector type. The generator uses it to fill `expected`; the tests call it again
// from the parsed JSON (hex only) and compare. Hand-written expectations in the generator are checked against it.
import { fromHex, hex } from '../src/bytes.ts';
import { CborError, cmap, decode, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { checkpointItems, checkpointPayload, checkpointWritesOf, fold, summarize, type Change } from '../src/fold.ts';
import { evaluateGroup } from '../src/group.ts';
import * as hpke from '../src/hpke.ts';
import { commitOf, derivePerson, FormatError, gidOf, makeCard, verifyCardBytes } from '../src/keys.ts';
import { compareKeys, header, heldBack, keyRing, nextClock, openRecord, paddedLength, recordKey, recordId, signedBytes, bodyMap,
         padPlaintext, sealPlaintext, sealRecord, type OrderKey, type Rec } from '../src/record.ts';
import { ed25519Check, ed25519Sign, sha256 } from '../src/prims.ts';
import * as slots from '../src/slots.ts';
import * as xw from '../src/xwing.ts';
import { appendRecord, frame, initFolder, listFiles, putSlot, putWrap, readFrames, readGroupLog } from '../src/folder.ts';
import { limits } from '../src/limits.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromNotation, toNotation, type N } from './notation.ts';

type J = Record<string, any>;
const F = fromHex;
const H = hex;
export const err = (e: unknown): J => {
  if (e instanceof FormatError) return { error: { code: e.code, disposition: e.disposition } };
  if (e instanceof CborError) return { error: { code: e.reason } };
  return { error: { code: 'failure', message: (e as Error).message } };
};

const ringOf = (keys: J[]) => keyRing(keys.map((k) => [F(k.gid), k.epoch, F(k.key)] as [Uint8Array, number, Uint8Array]));
const kemOf = (i: J) => ({ ekX: F(i.ek_x), mlkem: { ct: F(i.mlkem_ct), ss: F(i.mlkem_ss) } });

export function clockOf(c: J): OrderKey { return [c.wall, c.counter, F(c.author), F(c.device), c.seq]; }
const clockTuple = (c: J): OrderKey => clockOf(c);
const changeOf = (c: J): Change => ({ key5: [c.clock[0], c.clock[1], F(c.author), F(c.device), c.seq], payload: decode(F(c.payload)) as CMap });

const sortObj = (o: J) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1));
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : 1;

export function groupJson(gid: Uint8Array, sealed: Uint8Array[], keys: J[], nowMs?: number): J {
  const ring = ringOf(keys);
  const recs: Rec[] = [];
  const rejected: J[] = [];
  sealed.forEach((s, index) => {
    try { recs.push(openRecord(s, ring)); } catch (e) { const f = e as FormatError; rejected.push({ index, code: f.code, disposition: f.disposition }); }
  });
  const v = evaluateGroup(gid, recs, nowMs);
  const m = v.membership;
  return {
    rejected,
    chain: m.chain.map((r) => H(r.id)),
    ignored: sortObj(Object.fromEntries(m.ignored)),
    lost: [...m.lost].sort(),
    epoch: m.epoch,
    roles: sortObj(Object.fromEntries(m.roles)),
    cuts: m.cuts.map((c) => ({ pid: c.pid, record: c.record, epoch: c.epoch, cut: sortObj(Object.fromEntries(c.cut)) })),
    waiting_for_key: m.waitingForKey,
    pending_epoch: m.pendingEpoch,
    may_seal_content: v.maySealContent,
    membership_forks: [...m.forks].sort((a, b) => a.mprev < b.mprev ? -1 : 1).map((f) => ({ mprev: f.mprev, candidates: [...f.candidates].sort(), winner: f.winner, rule: f.rule })),
    duplicate_genesis: [...m.duplicateGenesis].sort(),
    chain_forks: sortObj(Object.fromEntries([...v.chains.forks].map(([k, f]) => [k, { seq: f.seq, ids: f.ids.map(H).sort() }]))),
    fork_blocked: v.chains.forkBlocked.map((r) => H(r.id)).sort(),
    rejected_checkpoints: v.accepted.filter((r) => r.kind === 32 && !v.checkpoints.includes(r)).map((r) => H(r.id)).sort(),
    waiting: v.chains.waiting.map((w) => ({ id: H(w.rec.id), reason: w.reason })).sort((a, b) => a.id < b.id ? -1 : 1),
    checkpoint_mismatches: v.chains.mismatches.map((r) => H(r.id)).sort(),
    held_back: v.held.map((r) => H(r.id)).sort(),
    checkpoints: v.checkpoints.map((r) => H(r.id)).sort(),
    content: v.content.map((c) => ({ id: H(c.rec.id), status: c.status })).sort(byId),
    state: summarize(v.state),
  };
}

function foldChanges(changes: J[], order?: number[]): J {
  const cs = changes.map(changeOf);
  const picked = order ? order.map((i) => cs[i]!) : cs;
  return summarize(fold(picked));
}

/** The pattern recipes use for large data: byte i is (7 i + 3) mod 256. */
export const rampBytes = (len: number): Uint8Array => Uint8Array.from({ length: len }, (_, i) => (i * 7 + 3) & 255);

const openResult = (sealed: Uint8Array, ring: ReturnType<typeof keyRing>): J => {
  try { openRecord(sealed, ring); return { ok: true }; } catch (e) { return err(e); }
};

/** Everything `checkpoint.run` returns for one checkpoint: payload bytes. */
function checkpointOf(c: J, changes: Change[]): { payload: CMap; bytes: Uint8Array } {
  const inc = (c.include as number[]).map((n) => changes[n]!);
  const items = checkpointItems(fold(inc));
  const purged = (c.purged ?? []).map((p: J) => [F(p.item), clockTuple(p.clock)] as [Uint8Array, OrderKey]);
  const covered = (c.covered ?? []).map((x: J) => [F(x.author), F(x.device), x.seq, F(x.record_id)] as [Uint8Array, Uint8Array, number, Uint8Array]);
  const payload = checkpointPayload(items, covered, purged);
  return { payload, bytes: encode(payload) };
}

export function compute(type: string, i: J): J {
  switch (type) {
    case 'cbor.encode': return { hex: H(encode(fromNotation(i.value as N))) };
    case 'cbor.reject':
      try { decode(F(i.hex)); return { accepted: true }; } catch (e) { return err(e); }
    case 'cbor.accept':
      try { const v = decode(F(i.hex)); return { value: toNotation(v), reencoded: H(encode(v)) }; } catch (e) { return err(e); }
    case 'person.derive': {
      const p = derivePerson(F(i.ps));
      const card = makeCard(p);
      return { sign_seed: H(p.signSeed), kem_seed: H(p.kemSeed), pid: H(p.pid), kem_pk: H(p.kemPk),
               card_sig: H(card.get(3) as Uint8Array), card: H(encode(card)) };
    }
    case 'card.verify':
      try { const c = verifyCardBytes(F(i.card)); return { ok: true, pid: H(c.pid) }; } catch (e) { return err(e); }
    case 'signature.verify': return { result: ed25519Check(F(i.pk), F(i.msg), F(i.sig)) ?? 'ok' };
    case 'gid': return { gid: H(gidOf(F(i.creator_pid), F(i.genesis_nonce), F(i.k0))) };
    case 'commit': return { commit: H(commitOf(F(i.gid), i.epoch, F(i.key))) };
    case 'xwing.keygen': return { pk: H(xw.publicKey(F(i.seed))) };
    case 'xwing.encapsulate': { const r = xw.encapsulate(F(i.pk), kemOf(i)); return { ct: H(r.ct), ss: H(r.ss) }; }
    case 'xwing.decapsulate': return { ss: H(xw.decapsulate(F(i.seed), F(i.ct))) };
    case 'hpke.seal': return { blob: H(hpke.sealBase(F(i.pk), F(i.info), F(i.aad), F(i.pt), kemOf(i))) };
    case 'hpke.open':
      try { return { pt: H(hpke.openBase(F(i.seed), F(i.info), F(i.aad), F(i.blob))) }; } catch (e) { return err(e); }
    case 'padding.length': return { padded: paddedLength(i.plaintext_len) };
    case 'record.key': return { rk: H(recordKey(F(i.key), F(i.salt))) };
    case 'record.seal': {
      const signer = derivePerson(F(i.signer_ps));
      const f = { author: F(i.author), device: F(i.device), seq: i.seq, prev: i.prev === null ? null : F(i.prev),
                  clock: i.clock as [number, number], kind: i.kind, payload: decode(F(i.payload)),
                  ...(i.mhead ? { mhead: F(i.mhead) } : {}) };
      const gid = F(i.gid), salt = F(i.salt), key = F(i.key);
      const hdr = header(gid, i.epoch, salt);
      const body = bodyMap(f);
      const msg = signedBytes(hdr, body);
      const sig = i.sig_override ? F(i.sig_override) : ed25519Sign(signer.signSeed, msg);
      const sealed = sealRecord(signer, gid, i.epoch, key, salt, f, i.sig_override ? { sigOverride: sig } : {});
      body.set(9, sig);
      const plain = padPlaintext(encode(body));
      return { header: H(hdr), body_without_sig: H(encode(bodyMap(f))), signed_message: H(msg), sig: H(sig),
               plaintext_len_before_padding: 4 + encode(body).length, padded_len: plain.length,
               sealed: H(sealed), sealed_len: sealed.length, record_id: H(recordId(sealed)),
               opens: openResult(sealed, keyRing([[gid, i.epoch, key]])) };
    }
    case 'record.seal_large': {
      // A record whose payload is one field of `bytes_len` bytes (the ramp pattern): the JSON stays small.
      const signer = derivePerson(F(i.signer_ps));
      const payload = cmap([[1, F(i.item)], [2, new Map([['f', rampBytes(i.bytes_len)]]) as CborValue], [3, []]]);
      const f = { author: F(i.author), device: F(i.device), seq: i.seq, prev: null, clock: i.clock as [number, number], kind: 16, payload, mhead: F(i.mhead) };
      const gid = F(i.gid), salt = F(i.salt), key = F(i.key);
      const sealed = sealRecord(signer, gid, i.epoch, key, salt, f);
      const body = bodyMap(f);
      body.set(9, new Uint8Array(64));
      return { body_len: encode(body).length, sealed_len: sealed.length, sealed_sha256: H(sha256(sealed)), record_id: H(recordId(sealed)),
               opens: openResult(sealed, keyRing([[gid, i.epoch, key]])) };
    }
    case 'record.craft': {
      // A plaintext of `plaintext_len` bytes: u32(declared_body_len) then zeros (or, when `body` is given, that body then zeros).
      const gid = F(i.gid), salt = F(i.salt), key = F(i.key);
      const pt = new Uint8Array(i.plaintext_len);
      new DataView(pt.buffer).setUint32(0, i.declared_body_len);
      if (i.body) pt.set(F(i.body), 4);
      const sealed = sealPlaintext(gid, i.epoch, key, salt, pt);
      return { sealed_len: sealed.length, sealed_sha256: H(sha256(sealed)), opens: openResult(sealed, keyRing([[gid, i.epoch, key]])) };
    }
    case 'record.open': {
      try {
        const r = openRecord(F(i.sealed), ringOf(i.keys));
        return { ok: { epoch: r.epoch, author: H(r.author), device: H(r.device), seq: r.seq, prev: r.prev ? H(r.prev) : null,
                       clock: [r.wall, r.counter], kind: r.kind, mhead: r.mhead ? H(r.mhead) : null, record_id: H(r.id), payload: H(encode(r.payload)) } };
      } catch (e) { return err(e); }
    }
    case 'clock.order': {
      const ks = (i.clocks as J[]).map(clockOf);
      return { order: ks.map((_, n) => n).sort((a, b) => compareKeys(ks[a]!, ks[b]!)) };
    }
    case 'clock.next': return { clock: nextClock(i.now_ms, i.seen as [number, number][]) };
    case 'clock.held_back': return { held_back: heldBack(i.wall_ms, i.now_ms) };
    case 'fold.run': {
      const out: J = { state: foldChanges(i.changes) };
      if (i.orders) out.states_by_order = (i.orders as number[][]).map((o) => foldChanges(i.changes, o));
      return out;
    }
    case 'checkpoint.run': {
      // `checkpoints[k]` restates the winning writes of the changes it includes; each run folds some changes and some checkpoints.
      const changes = (i.changes as J[]).map(changeOf);
      const cps = (i.checkpoints as J[]).map((c) => checkpointOf(c, changes));
      const parsed = cps.map((c) => checkpointWritesOf(decode(c.bytes) as CMap));
      return {
        payloads: cps.map((c) => H(c.bytes)),
        states: (i.runs as J[]).map((r) => summarize(fold((r.changes as number[]).map((n) => changes[n]!), (r.checkpoints as number[]).map((n) => parsed[n]!)))),
      };
    }
    case 'group.evaluate': return groupJson(F(i.gid), (i.records as string[]).map(F), i.keys, i.now_ms);
    case 'slot.seal_password':
      return { slot: H(slots.sealPasswordSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.salt), i.params, i.password)) };
    case 'slot.craft_password': {
      // A password slot whose ciphertext is made-up bytes: for slots a reader must refuse before doing any Argon2id work.
      const m = slots.passwordParams(F(i.salt), i.params);
      return { slot: H(encode(cmap([[1, 1], [2, 1], [3, F(i.pid)], [4, F(i.slot_id)], [5, m], [6, new Uint8Array(48)]]))) };
    }
    case 'slot.craft_other': {
      const m = cmap([[1, i.version], [2, i.slot_type], [3, F(i.pid)], [4, F(i.slot_id)], [5, cmap([])], [6, new Uint8Array(48)]]);
      return { slot: H(encode(m)) };
    }
    case 'slot.seal_kit': return { slot: H(slots.sealKitSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.kit))) };
    case 'slot.seal_device': return { slot: H(slots.sealDeviceSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.device_kem_pk), kemOf(i))) };
    case 'slot.open': {
      const u = i.unlock;
      const unlock = u.password !== undefined ? { password: u.password as string } : u.kit ? { kit: F(u.kit) } : { deviceKemSeed: F(u.device_kem_seed) };
      try { return { ps: H(slots.openSlot(F(i.slot), unlock, { testOnly: !!i.test_only })) }; } catch (e) { return err(e); }
    }
    case 'kit.text': return { text: slots.kitToText(F(i.kit)) };
    case 'kit.parse': try { return { kit: H(slots.kitFromText(i.text)) }; } catch (e) { return err(e); }
    case 'wrap.seal': return { wrap: H(slots.wrapGroupKey(F(i.gid), i.epoch, F(i.key), F(i.recipient_pid), F(i.recipient_kem_pk), kemOf(i))) };
    case 'wrap.open':
      try { return { key: H(slots.unwrapGroupKey(F(i.gid), i.epoch, F(i.recipient_pid), F(i.recipient_kem_seed), F(i.wrap))) }; } catch (e) { return err(e); }
    case 'wrap.select': {
      const k = slots.selectGroupKey(F(i.gid), i.epoch, F(i.recipient_pid), F(i.recipient_kem_seed), (i.wraps as string[]).map(F), F(i.commit));
      return { key: k ? H(k) : null };
    }
    case 'chunk.seal': { const s = slots.sealChunk(F(i.key), i.index, i.size, i.count, F(i.data)); return { sealed: H(s), chunk_id: H(slots.chunkId(s)) }; }
    case 'attachment.run': return attachmentRun(i);
    case 'folder.segment': {
      const ring = i.keys ? ringOf(i.keys) : null;
      const seqOf = ring ? (s: Uint8Array) => { try { return openRecord(s, ring).seq; } catch { return null; } } : undefined;
      const r = readFrames(F(i.hex), seqOf);
      return { frames: r.frames.map(H), incomplete_tail_bytes: r.incompleteTail, stopped: r.stopped };
    }
    case 'folder.frame_length': {
      // A segment that is only a length prefix of `len` followed by `body_len` bytes.
      const data = new Uint8Array(4 + i.body_len);
      new DataView(data.buffer).setUint32(0, i.len);
      const r = readFrames(data);
      return { frames: r.frames.length, stopped: r.stopped, incomplete_tail_bytes: r.incompleteTail };
    }
    case 'folder.tree': return folderTree(i);
    case 'folder.append_after': return folderAppendAfter(i);
    default: throw new Error(`unknown vector type ${type}`);
  }
}

/** 5.2: seal a file of `data_len` ramp bytes (or `chunk_lens` bytes per chunk), then open it, possibly after changing something. */
function attachmentRun(i: J): J {
  const key = F(i.key);
  const lens: number[] = i.chunk_lens ?? (() => {
    const out: number[] = []; for (let left = i.data_len; left > 0; left -= limits.chunkSize) out.push(Math.min(left, limits.chunkSize)); return out;
  })();
  const total = lens.reduce((a, b) => a + b, 0);
  const data = rampBytes(total);
  const claimedSize = i.claimed_size ?? total;
  const count = i.claimed_count ?? lens.length;
  let at = 0;
  let chunks = lens.map((len, n) => { const c = slots.sealChunk(key, n, claimedSize, count, data.subarray(at, at + len)); at += len; return c; });
  const ids = chunks.map(slots.chunkId);
  let refIds = ids;
  if (i.drop_last_chunk) chunks = chunks.slice(0, -1);
  if (i.drop_last_id) refIds = ids.slice(0, -1);
  if (i.duplicate_last_chunk) { chunks = [...chunks, chunks[chunks.length - 1]!]; refIds = [...refIds, ids[ids.length - 1]!]; }
  let result: J;
  try { const out = slots.openAttachment({ key, size: i.reader_size ?? claimedSize, chunkIds: refIds }, chunks); result = { opens: true, bytes: out.length, sha256: H(sha256(out)) }; }
  catch (e) { result = { opens: false, ...err(e) }; }
  return { chunk_count: lens.length, chunk_ids: ids.map(H), data_sha256: H(sha256(data)), ...result };
}

function folderTree(i: J): J {
  const root = mkdtempSync(join(tmpdir(), 'psss-folder-'));
  try {
    initFolder(root);
    for (const s of i.slots as J[]) putSlot(root, F(s.pid), F(s.slot_id), F(s.slot));
    for (const w of i.wraps as J[]) putWrap(root, F(i.gid), w.epoch, F(w.pid), F(w.name), F(w.wrap));
    for (const r of i.records as J[]) appendRecord(root, F(i.gid), F(r.author), F(r.device), r.seq, F(r.sealed), !!r.membership);
    const files: J = {};
    for (const p of listFiles(root)) files[p] = p.endsWith('.seg') && readFileSync(join(root, p)).length > 4096 ? { bytes: readFileSync(join(root, p)).length, sha256: H(sha256(new Uint8Array(readFileSync(join(root, p))))) } : H(new Uint8Array(readFileSync(join(root, p))));
    const read = readGroupLog(root, F(i.gid)).map((x) => ({ path: x.path, record_id: H(recordId(x.sealed)) }));
    return { files, read_back: read };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
export { frame };

/** 8.1 rotation: the newest segment of a chain is `newest_size` bytes; the next record goes into the same file or a new one. */
function folderAppendAfter(i: J): J {
  const root = mkdtempSync(join(tmpdir(), 'psss-rot-'));
  try {
    initFolder(root);
    const gid = new Uint8Array(32).fill(1), author = new Uint8Array(32).fill(2), device = new Uint8Array(16).fill(3);
    // lay down the newest segment (and, when asked, a membership segment after it), then append one more record
    const dir = join(root, 'groups', H(gid), 'log', `${H(author)}-${H(device)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${String(i.first_seq).padStart(10, '0')}.seg`), new Uint8Array(i.newest_size));
    if (i.then_membership) writeFileSync(join(dir, `${String(i.first_seq + 1).padStart(10, '0')}.mseg`), new Uint8Array(100));
    const file = appendRecord(root, gid, author, device, i.next_seq, new Uint8Array(100), !!i.next_is_membership);
    const sizes: J = {};
    for (const p of listFiles(root)) if (p.includes('/log/')) sizes[p.split('/').pop()!] = readFileSync(join(root, p)).length;
    return { wrote: file.split('/').pop(), files: sizes };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
