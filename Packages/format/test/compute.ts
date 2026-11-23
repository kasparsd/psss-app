// compute(type, input) -> expected, for every vector type. The generator uses it to fill `expected`; the tests call it again
// from the parsed JSON (hex only) and compare. Hand-written expectations in the generator are checked against it.
import { fromHex, hex } from '../src/bytes.ts';
import { CborError, decode, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { checkpointPayload, fold, summarize, type Change } from '../src/fold.ts';
import { evaluateGroup } from '../src/group.ts';
import * as hpke from '../src/hpke.ts';
import { commitOf, derivePerson, FormatError, gidOf, makeCard, verifyCardBytes } from '../src/keys.ts';
import { compareKeys, DAY_MS, header, heldBack, keyRing, nextClock, openRecord, paddedLength, recordKey, signedBytes, bodyMap,
         padPlaintext, sealRecord, type OrderKey, type Rec } from '../src/record.ts';
import { ed25519Sign } from '../src/prims.ts';
import * as slots from '../src/slots.ts';
import * as xw from '../src/xwing.ts';
import { appendRecord, frame, initFolder, listFiles, readFrames, readGroupLog } from '../src/folder.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromNotation, toNotation, type N } from './notation.ts';

type J = Record<string, any>;
const F = fromHex;
const H = hex;
const err = (e: unknown): J => {
  if (e instanceof FormatError) return { error: { code: e.code, step: e.step } };
  if (e instanceof CborError) return { error: { code: e.reason } };
  return { error: { code: 'failure', message: (e as Error).message } };
};

const ringOf = (keys: J[]) => keyRing(keys.map((k) => [F(k.gid), k.epoch, F(k.key)] as [Uint8Array, number, Uint8Array]));

export function clockOf(c: J): OrderKey { return [c.wall, c.counter, F(c.author), F(c.device), c.seq]; }

function changeOf(c: J): Change { return { key5: [c.clock[0], c.clock[1], F(c.author), F(c.device), c.seq], payload: decode(F(c.payload)) as CMap }; }

export function groupJson(gid: Uint8Array, sealed: Uint8Array[], keys: J[], nowMs?: number): J {
  const ring = ringOf(keys);
  const recs: Rec[] = [];
  const rejected: J[] = [];
  sealed.forEach((s, index) => {
    try { recs.push(openRecord(s, ring)); } catch (e) { const f = e as FormatError; rejected.push({ index, code: f.code, step: f.step }); }
  });
  const v = evaluateGroup(gid, recs, nowMs);
  const m = v.membership;
  const sortObj = (o: J) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1));
  return {
    rejected,
    chain: m.chain.map((r) => H(r.id)),
    ignored: sortObj(Object.fromEntries(m.ignored)),
    epoch: m.epoch,
    roles: sortObj(Object.fromEntries(m.roles)),
    writers_by_epoch: sortObj(Object.fromEntries([...m.writersByEpoch].map(([e, s]) => [String(e), [...s].sort()]))),
    cuts: m.cuts.map((c) => ({ pid: c.pid, record: c.record, cut: sortObj(Object.fromEntries(c.cut)) })),
    pending_epoch: m.pendingEpoch,
    genesis_fork: m.genesisFork,
    membership_forks: m.forks,
    chain_forks: sortObj(Object.fromEntries([...v.chains.forks].map(([k, f]) => [k, { seq: f.seq, ids: f.ids.map(H).sort() }]))),
    fork_blocked: v.chains.forkBlocked.map((r) => H(r.id)).sort(),
    rejected_checkpoints: v.accepted.filter((r) => r.kind === 32 && !v.checkpoints.includes(r)).map((r) => H(r.id)).sort(),
    waiting: v.chains.waiting.map((w) => ({ id: H(w.rec.id), reason: w.reason })).sort((a, b) => a.id < b.id ? -1 : 1),
    checkpoint_mismatches: v.chains.mismatches.map((r) => H(r.id)).sort(),
    held_back: v.held.map((r) => H(r.id)).sort(),
    checkpoints: v.checkpoints.map((r) => H(r.id)).sort(),
    content: v.content.map((c) => ({ id: H(c.rec.id), status: c.status })).sort((a, b) => a.id < b.id ? -1 : 1),
    state: summarize(v.state),
  };
}

function foldChanges(changes: J[], order?: number[]): J {
  const cs = changes.map(changeOf);
  const picked = order ? order.map((i) => cs[i]!) : cs;
  return summarize(fold(picked));
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
    case 'gid': return { gid: H(gidOf(F(i.creator_pid), F(i.genesis_nonce))) };
    case 'commit': return { commit: H(commitOf(F(i.gid), i.epoch, F(i.key))) };
    case 'xwing.keygen': return { pk: H(xw.publicKey(F(i.seed))) };
    case 'xwing.encapsulate': {
      const r = xw.encapsulate(F(i.pk), { ekX: F(i.ek_x), mlkem: { ct: F(i.mlkem_ct), ss: F(i.mlkem_ss) } });
      return { ct: H(r.ct), ss: H(r.ss) };
    }
    case 'xwing.decapsulate': return { ss: H(xw.decapsulate(F(i.seed), F(i.ct))) };
    case 'hpke.seal':
      return { blob: H(hpke.sealBase(F(i.pk), F(i.info), F(i.aad), F(i.pt), { ekX: F(i.ek_x), mlkem: { ct: F(i.mlkem_ct), ss: F(i.mlkem_ss) } })) };
    case 'hpke.open':
      try { return { pt: H(hpke.openBase(F(i.seed), F(i.info), F(i.aad), F(i.blob))) }; } catch (e) { return err(e); }
    case 'padding.length': return { padded: paddedLength(i.plaintext_len) };
    case 'record.key': return { rk: H(recordKey(F(i.key), F(i.salt))) };
    case 'record.seal': {
      const signer = derivePerson(F(i.signer_ps));
      const f = { author: F(i.author), device: F(i.device), seq: i.seq, prev: i.prev === null ? null : F(i.prev),
                  clock: i.clock as [number, number], kind: i.kind, payload: decode(F(i.payload)) };
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
               sealed: H(sealed), sealed_len: sealed.length, record_id: H(openRecordId(sealed)) };
    }
    case 'record.open': {
      try {
        const r = openRecord(F(i.sealed), ringOf(i.keys));
        return { ok: { epoch: r.epoch, author: H(r.author), device: H(r.device), seq: r.seq, prev: r.prev ? H(r.prev) : null,
                       clock: [r.wall, r.counter], kind: r.kind, record_id: H(r.id), payload: H(encode(r.payload)) } };
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
    case 'checkpoint.fold': {
      const before = (i.before as J[]).map(changeOf);
      const after = (i.after as J[]).map(changeOf);
      const items = checkpointItemsOf(fold(before));
      const payload = checkpointPayload(items, (i.covered as J[]).map((c) => [F(c.author), F(c.device), c.seq, F(c.record_id)]), F(i.mhead));
      const parsed = decode(encode(payload)) as CMap;
      return { payload: H(encode(payload)), state_after: summarize(fold(after, [parsed.get(3) as CborValue[]])),
               state_full: summarize(fold([...before, ...after])) };
    }
    case 'checkpoint.null_collision': {
      const mk = (cleared: boolean) => {
        const s = fold([{ key5: [1, 0, F(i.author), F(i.device), 1],
                          payload: new Map<number, CborValue>([[1, F(i.item)], [2, new Map(cleared ? [] : [['f', null]]) as CborValue], [3, cleared ? ['f'] : []]]) as CMap }]);
        return H(encode(checkpointPayload(checkpointItemsOf(s), [], new Uint8Array(32))));
      };
      const a = mk(false), b = mk(true);
      return { payload_field_set_to_null: a, payload_field_cleared: b, identical: a === b };
    }
    case 'group.evaluate':
      return groupJson(F(i.gid), (i.records as string[]).map(F), i.keys, i.now_ms);
    case 'slot.seal_password':
      return { slot: H(slots.sealPasswordSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.salt), i.params, i.password)) };
    case 'slot.seal_kit': return { slot: H(slots.sealKitSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.kit))) };
    case 'slot.seal_device':
      return { slot: H(slots.sealDeviceSlot(F(i.ps), F(i.pid), F(i.slot_id), F(i.device_kem_pk), { ekX: F(i.ek_x), mlkem: { ct: F(i.mlkem_ct), ss: F(i.mlkem_ss) } })) };
    case 'slot.open': {
      const u = i.unlock;
      const unlock = u.password !== undefined ? { password: u.password as string } : u.kit ? { kit: F(u.kit) } : { deviceKemSeed: F(u.device_kem_seed) };
      try { return { ps: H(slots.openSlot(F(i.slot), unlock, { testOnly: !!i.test_only })) }; } catch (e) { return err(e); }
    }
    case 'kit.text': return { text: slots.kitToText(F(i.kit)) };
    case 'kit.parse': try { return { kit: H(slots.kitFromText(i.text)) }; } catch (e) { return err(e); }
    case 'wrap.seal':
      return { wrap: H(slots.wrapGroupKey(F(i.gid), i.epoch, F(i.key), F(i.recipient_pid), F(i.recipient_kem_pk), { ekX: F(i.ek_x), mlkem: { ct: F(i.mlkem_ct), ss: F(i.mlkem_ss) } })) };
    case 'wrap.open':
      try { return { key: H(slots.unwrapGroupKey(F(i.gid), i.epoch, F(i.recipient_pid), F(i.recipient_kem_seed), F(i.wrap))) }; } catch (e) { return err(e); }
    case 'chunk.seal': { const s = slots.sealChunk(F(i.key), i.index, F(i.data)); return { sealed: H(s), chunk_id: H(slots.chunkId(s)) }; }
    case 'chunk.open':
      try { return { data: H(slots.openChunk(F(i.key), i.index, F(i.sealed))) }; } catch (e) { return err(e); }
    case 'folder.segment': { const r = readFrames(F(i.hex)); return { frames: r.frames.map(H), incomplete_tail_bytes: r.incompleteTail }; }
    case 'folder.tree': return folderTree(i);
    default: throw new Error(`unknown vector type ${type}`);
  }
}


import { checkpointItems as checkpointItemsOf } from '../src/fold.ts';

function folderTree(i: J): J {
  const root = mkdtempSync(join(tmpdir(), 'psss-folder-'));
  try {
    initFolder(root);
    for (const s of i.slots as J[]) putSlotFile(root, s);
    for (const w of i.wraps as J[]) putWrapFile(root, i.gid, w);
    for (const r of i.records as J[]) appendRecord(root, F(i.gid), F(r.author), F(r.device), r.seq, F(r.sealed));
    const files: J = {};
    for (const p of listFiles(root)) files[p] = H(new Uint8Array(readFileSync(join(root, p))));
    const read = readGroupLog(root, F(i.gid)).map((x) => ({ path: x.path, record_id: H(openRecordId(x.sealed)) }));
    return { files, read_back: read };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
import { putSlot, putWrap } from '../src/folder.ts';
import { recordId as openRecordId } from '../src/record.ts';
function putSlotFile(root: string, s: J) { putSlot(root, F(s.pid), F(s.slot_id), F(s.slot)); }
function putWrapFile(root: string, gid: string, w: J) { putWrap(root, F(gid), w.epoch, F(w.pid), F(w.wrap)); }
export { DAY_MS, frame };
