// Vectors for sections 4.4 to 6.6: chains, membership, the fork rule, cuts, content records and checkpoints end to end.
import assert from 'node:assert/strict';
import { cmp } from '../src/bytes.ts';
import { cmap, type CborValue } from '../src/cbor.ts';
import { checkpointItems, fold } from '../src/fold.ts';
import { commitOf, makeCard } from '../src/keys.ts';
import { KIND, type Rec } from '../src/record.ts';
import { BASE_MS, Scenario, bytesOf, itemId } from '../test/scenario.ts';
import { H, Out, file } from './vec-common.ts';
import type { J } from './vec-common.ts';

function groupVector(o: Out, name: string, desc: string, s: Scenario, recs: Rec[], labels: Record<string, Rec>, extra: J = {}): J {
  const lab: J = {};
  for (const [k, r] of Object.entries(labels)) lab[H(r.id)] = k;
  const people: J = {};
  for (const [k, p] of s.persons) people[k] = H(p.pid);
  return o.add(`group/${name}`, desc, 'group.evaluate', { gid: H(s.gid), keys: s.keyList(), records: recs.map((r) => H(r.sealed)), ...extra, labels: lab, people });
}

const D = (name: string) => (name === 'alice' ? 'a1' : `${name}1`);
const I = itemId('i1');
const idOf = (r: Rec) => H(r.id);
const statusOf = (v: J, r: Rec) => v.expected.content.find((c: J) => c.id === idOf(r))?.status;
const fork = (v: J, n = 0) => v.expected.membership_forks[n];

/** Three managers (alice created the group), and the order of their pids. */
function world() {
  const s = new Scenario();
  const g = s.genesis('a1');
  const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
  const addCarol = s.setRole('alice', 'a1', 'carol', 3, { card: true });
  const [lo, mid, hi] = s.pidOrder('alice', 'bob', 'carol') as [string, string, string];
  return { s, g, addBob, addCarol, head: s.mhead!, lo, mid, hi };
}
/** Run `f` as if the author had accepted the membership chain up to `head` in epoch `epoch`. */
const at = <T>(s: Scenario, head: Uint8Array, epoch: number, f: () => T): T => { s.mhead = head; s.epoch = epoch; return f(); };

export function groupVectors(): J {
  const o = new Out();

  { // lifecycle
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const bob1 = s.item('bob', 'b1', I, [['title', 'Hi']]); const carol1 = s.item('carol', 'c1', I, [['note', 'by a reader']]);
    const dave1 = s.item('dave', 'd1', I, [['x', 1]]);
    const promote = s.setRole('alice', 'a1', 'carol', 2); const carol2 = s.item('carol', 'c1', I, [['note', 'by a writer']]);
    const v = groupVector(o, 'lifecycle-roles', 'Genesis, a writer, a reader. A reader\'s record and a stranger\'s are ignored. Carol\'s first record names a mhead from when she was a reader and stays ignored after she is promoted; her second, written after the promotion, is accepted (draft 2 judges the author as of mhead; draft 1 said "at some point in its epoch").',
      s, [g, addBob, addCarol, bob1, carol1, dave1, promote, carol2], { g, addBob, addCarol, bob1, carol1, dave1, promote, carol2 });
    assert.equal(statusOf(v, carol1), 'ignored:not_writer'); assert.equal(statusOf(v, carol2), 'accepted'); assert.equal(statusOf(v, bob1), 'accepted');
  }
  { // removal with cut, unlisted devices
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]); const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2dev = s.item('bob', 'b2', I, [['n', 7]]);
    const remove = s.setRole('alice', 'a1', 'bob', 0, { cut: [[s.device('b1'), 1]] });
    s.key(1); const ep = s.newEpoch('alice', 'a1', 1);
    // Bob has not seen the removal: his later records name the membership head he knew and are sealed in epoch 0, which he still holds.
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { mhead: addBob.id, epoch: 0 });
    const b3new = s.item('bob', 'b3', I, [['n', 9]], [], { mhead: addBob.id, epoch: 0 });
    // A record sealed with epoch 1's key (he should not have it) naming the epoch record as mhead: he is removed as of that point.
    const bLeak = s.item('bob', 'b1', I, [['n', 4]], [], { mhead: ep.id, epoch: 1 });
    const a1 = s.item('alice', 'a1', I, [['title', 'after']], [], { mhead: ep.id, epoch: 1 });
    const v = groupVector(o, 'remove-with-cut-unlisted-device-and-new-epoch', 'Bob writes twice on device b1 and once on device b2, then is removed with a cut that lists only (b1, seq 1); an epoch record follows. His b1 seq 1 is accepted. His b1 seq 2 and 3 (beyond the cut) and every record on devices b2 and b3 (chains the cut does not list, including one from a device nobody had seen) are ignored when sealed in epoch 0. A record sealed in epoch 1 is ignored because he is not a writer as of its mhead.',
      s, [g, addBob, b1, b2, b2dev, remove, ep, b3, b3new, bLeak, a1], { g, addBob, b1, b2, b2dev, remove, ep, b3, b3new, bLeak, a1 });
    assert.equal(statusOf(v, b1), 'accepted'); assert.equal(statusOf(v, b2), 'ignored:beyond_cut'); assert.equal(statusOf(v, b2dev), 'ignored:beyond_cut');
    assert.equal(statusOf(v, b3), 'ignored:beyond_cut'); assert.equal(statusOf(v, b3new), 'ignored:beyond_cut'); assert.equal(statusOf(v, bLeak), 'ignored:not_writer');
    assert.equal(statusOf(v, a1), 'accepted');
  }
  { // waiting for a new key
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const remove = s.setRole('alice', 'a1', 'bob', 0, { cut: [[s.device('b1'), 1]] });
    const written = s.item('alice', 'a1', I, [['title', 'written while waiting']]); // a device must not seal this (6.3); a reader has no rule against it
    const v1 = groupVector(o, 'waiting-for-new-key-after-removal', 'A removal with no epoch record after it: the group is waiting for a new key, so devices MUST NOT seal content records (may_seal_content false). A content record sealed anyway, under the old epoch with the removal as mhead, is accepted by this implementation: the specification gives a reader no rule against it (finding).',
      s, [g, addBob, b1, remove, written], { g, addBob, b1, remove, written });
    assert.equal(v1.expected.waiting_for_key, true); assert.equal(v1.expected.may_seal_content, false); assert.deepEqual(v1.expected.pending_epoch, [idOf(remove)]);
    s.key(1); const ep = s.newEpoch('alice', 'a1', 1);
    const v2 = groupVector(o, 'new-key-after-removal', 'The same group once the epoch record has arrived: no longer waiting.', s, [g, addBob, b1, remove, written, ep], { g, addBob, b1, remove, written, ep });
    assert.equal(v2.expected.waiting_for_key, false); assert.equal(v2.expected.may_seal_content, true); assert.deepEqual(v2.expected.pending_epoch, []);
  }
  { // waiting after replacement, and while an epoch is on a losing branch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const rep = s.replace('bob', 'b1', 'bob', 'bob2', { cut: [[s.device('b1'), 1]] });
    const v = groupVector(o, 'waiting-for-new-key-after-replacement', 'A replacement (kind 4) also leaves the group waiting for a new key until an epoch record follows.', s, [g, addBob, b1, rep], { g, addBob, b1, rep });
    assert.equal(v.expected.waiting_for_key, true); assert.equal(v.expected.may_seal_content, false);
  }
  { // lower writer to reader; raising needs a new epoch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const lower = s.setRole('alice', 'a1', 'bob', 1, { cut: [[s.device('b1'), 1]] });
    const lowerHead = s.mhead!;
    const b2old = s.item('bob', 'b1', I, [['n', 2]], [], { mhead: addBob.id });
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { mhead: lower.id });
    const raiseBad = s.setRole('alice', 'a1', 'bob', 2, { mprev: lowerHead });
    s.mhead = lowerHead; s.key(1);
    const ep = s.newEpoch('alice', 'a1', 1, { mprev: lowerHead });
    const raiseOk = s.setRole('alice', 'a1', 'bob', 2);
    const b4 = s.item('bob', 'b1', I, [['n', 4]], [], { mhead: raiseOk.id });
    const v = groupVector(o, 'lower-writer-then-raise-needs-new-epoch', 'A writer is lowered to reader with a cut, which needs no new epoch: a record beyond the cut (written with the old mhead) and one written as a reader are both ignored. Raising him again in the same epoch is invalid (6.2) and is ignored; after an epoch record the same raise is valid, and his record sealed in epoch 1 is accepted.',
      s, [g, addBob, b1, lower, b2old, b3, raiseBad, ep, raiseOk, b4], { g, addBob, b1, lower, b2old, b3, raiseBad, ep, raiseOk, b4 });
    assert.equal(v.expected.ignored[idOf(raiseBad)], 'raise_needs_new_epoch'); assert.equal(statusOf(v, b2old), 'ignored:beyond_cut');
    assert.equal(statusOf(v, b3), 'ignored:not_writer'); assert.equal(statusOf(v, b4), 'accepted'); assert.equal(v.expected.roles[H(s.person('bob').pid)], 2);
  }
  { // invalid membership records
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const head = s.mhead!;
    const keep = <T>(f: () => T): T => { const h = s.mhead; const e = s.epoch; const r = f(); s.mhead = h; s.epoch = e; return r; };
    const byReader = keep(() => s.setRole('carol', 'c1', 'dave', 1, { card: true }));
    const byWriter = keep(() => s.setRole('bob', 'b1', 'dave', 1, { card: true }));
    const addNoCard = keep(() => s.setRole('alice', 'a1', 'dave', 1));
    const cardForMember = keep(() => s.setRole('alice', 'a1', 'bob', 3, { card: true }));
    const lowerNoCut = keep(() => s.setRole('alice', 'a1', 'bob', 1));
    const raiseWithCut = keep(() => s.setRole('alice', 'a1', 'carol', 2, { cut: [[s.device('c1'), 1]] }));
    const removeStranger = keep(() => s.setRole('alice', 'a1', 'erin', 0, { cut: [] }));
    const replaceByWriter = keep(() => s.replace('bob', 'b1', 'carol', 'dave'));
    s.key(1); s.key(2);
    const ep = (e: number, commitKey: Uint8Array, prevKey: Uint8Array, by = 'alice', dev = 'a1') =>
      keep(() => s.seal(by, dev, KIND.epoch, cmap([[1, head], [2, e], [3, commitOf(s.gid, e, commitKey)], [4, prevKey]]), { epoch: e }));
    const epBadCommit = ep(1, s.key(2), s.key(0));
    const epBadPrev = ep(1, s.key(1), s.key(2));
    const epSkip = ep(2, s.key(2), s.key(1));
    const epByWriter = ep(1, s.key(1), s.key(0), 'bob', 'b1');
    const wrongEpoch = keep(() => s.seal('alice', 'a1', KIND.member, cmap([[1, head], [2, makeCard(s.person('dave'))], [3, 1]]), { epoch: 1 }));
    const goodAdd = s.setRole('alice', 'a1', 'dave', 1, { card: true });
    const labels = { g, addBob, addCarol, byReader, byWriter, addNoCard, cardForMember, lowerNoCut, raiseWithCut, removeStranger, replaceByWriter, epBadCommit, epBadPrev, epSkip, epByWriter, wrongEpoch, goodAdd };
    const v = groupVector(o, 'invalid-membership-records', 'Records that name the current head as mprev and are each invalid for a different reason (reasons in `ignored`); they are kept and ignored, and the one valid add continues the chain.', s, Object.values(labels), labels);
    for (const k of ['byReader', 'byWriter', 'addNoCard', 'cardForMember', 'lowerNoCut', 'raiseWithCut', 'removeStranger', 'replaceByWriter', 'epBadCommit', 'epBadPrev', 'epSkip', 'epByWriter', 'wrongEpoch'] as const) {
      assert(v.expected.ignored[idOf(labels[k])], `${k} should be ignored`);
    }
    assert.equal(v.expected.chain.length, 4);
  }

  // ---- the fork rule (6.5): each step, three or more candidates, and what follows
  { // step 1: an epoch record by the author of a removal wins, though another candidate has the smaller author
    const { s, g, addBob, addCarol, lo, hi } = world();
    const addDave = at(s, s.mhead!, 0, () => s.setRole(hi, D(hi), 'dave', 2, { card: true }));
    const removal = s.setRole(hi, D(hi), 'dave', 0, { cut: [] });
    const head = removal.id;
    s.key(1);
    const epoch = at(s, head, 0, () => s.newEpoch(hi, D(hi), 1, { mprev: head }));
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const v = groupVector(o, 'fork-1-epoch-record-after-removal', `${hi} removes dave; ${hi} writes the epoch record; ${lo} concurrently adds erin with the removal as mprev. ${lo} has the smaller pid, but step 1 of 6.5 makes the epoch record by the author of the removal win. The group is no longer waiting.`,
      s, [g, addBob, addCarol, addDave, removal, addErin, epoch], { g, addBob, addCarol, addDave, removal, addErin, epoch });
    assert.equal(fork(v).rule, 'epoch_after_removal'); assert.equal(fork(v).winner, idOf(epoch)); assert.equal(v.expected.waiting_for_key, false);
    assert.equal(v.expected.ignored[idOf(addErin)], 'lost_fork');
  }
  { // an epoch record by another manager does not get step 1
    const { s, g, addBob, addCarol, lo, hi } = world();
    const addDave = s.setRole(lo, D(lo), 'dave', 2, { card: true });
    const removal = s.setRole(lo, D(lo), 'dave', 0, { cut: [] });
    const head = removal.id;
    s.key(1);
    const epoch = at(s, head, 0, () => s.newEpoch(hi, D(hi), 1, { mprev: head }));
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const v = groupVector(o, 'fork-1-epoch-record-by-another-manager', `${lo} removes dave. ${hi} writes the epoch record, ${lo} (the author of the removal) adds erin. Step 1 needs an epoch record by the author of the removal, so it does not apply; no one is dropped (step 2); step 3 picks the smaller author, ${lo}, so the addition wins and the group is left waiting for a new key.`,
      s, [g, addBob, addCarol, addDave, removal, addErin, epoch], { g, addBob, addCarol, addDave, removal, addErin, epoch });
    assert.equal(fork(v).rule, 'least_author_device_seq'); assert.equal(fork(v).winner, idOf(addErin)); assert.equal(v.expected.waiting_for_key, true);
  }
  { // step 2: a candidate whose author is removed by another candidate is dropped
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const removeLo = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 0, { mprev: head, cut: [] }));
    s.key(1); const ep = s.newEpoch(hi, D(hi), 1);
    const v = groupVector(o, 'fork-2-author-removed-by-another-candidate', `${lo} adds erin; ${hi} removes ${lo}. ${lo} has the smaller pid and would win step 3, but step 2 drops the candidate whose author is removed by another candidate, so the removal wins.`,
      s, [g, addBob, addCarol, addErin, removeLo, ep], { g, addBob, addCarol, addErin, removeLo, ep });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(removeLo));
  }
  { // step 2 with a lowering
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const lowerLo = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const v = groupVector(o, 'fork-2-author-lowered-by-another-candidate', `${lo} adds erin; ${hi} lowers ${lo} to reader. Lowering counts like removal in step 2 (no epoch is needed for it).`,
      s, [g, addBob, addCarol, addErin, lowerLo], { g, addBob, addCarol, addErin, lowerLo });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(lowerLo));
  }
  { // step 2 with a replacement
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const replaceLo = at(s, head, 0, () => s.replace(hi, D(hi), lo, 'dave', { mprev: head }));
    const v = groupVector(o, 'fork-2-author-replaced-by-another-candidate', `${lo} adds erin; ${hi} replaces ${lo}'s secret. A replacement counts like a removal in step 2.`,
      s, [g, addBob, addCarol, addErin, replaceLo], { g, addBob, addCarol, addErin, replaceLo });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(replaceLo));
  }
  { // step 2 drops them all: keep them all
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const loRemoves = at(s, head, 0, () => s.setRole(lo, D(lo), hi, 0, { mprev: head, cut: [] }));
    const hiRemoves = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 0, { mprev: head, cut: [] }));
    const v = groupVector(o, 'fork-2-mutual-removal-keeps-all', `Each of ${lo} and ${hi} removes the other at the same mprev. Step 2 would drop both, so it keeps both and step 3 picks the smaller author: ${lo}'s removal of ${hi} wins.`,
      s, [g, addBob, addCarol, loRemoves, hiRemoves], { g, addBob, addCarol, loRemoves, hiRemoves });
    assert.equal(fork(v).rule, 'all_dropped_least'); assert.equal(fork(v).winner, idOf(loRemoves));
  }
  { // step 3 alone
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const loAdds = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const hiAdds = at(s, head, 0, () => s.setRole(hi, D(hi), 'frank', 2, { card: true, mprev: head }));
    const followLo = at(s, loAdds.id, 0, () => s.setRole(lo, D(lo), 'gina', 1, { card: true }));
    const followHi = at(s, hiAdds.id, 0, () => s.setRole(hi, D(hi), 'hank', 1, { card: true }));
    const v = groupVector(o, 'fork-3-least-author', `${lo} and ${hi} add different people at the same mprev; neither removes the other, so the smaller author (${lo}) wins. The loser and the record that follows it on its branch are ignored (lost_fork, off_chain).`,
      s, [g, addBob, addCarol, loAdds, hiAdds, followLo, followHi], { g, addBob, addCarol, loAdds, hiAdds, followLo, followHi });
    assert.equal(fork(v).rule, 'least_author_device_seq'); assert.equal(fork(v).winner, idOf(loAdds));
    assert.equal(v.expected.ignored[idOf(followHi)], 'off_chain');
  }
  { // step 3: same author, two devices
    const { s, g, addBob, addCarol, head } = world();
    const [d1, d2] = cmp(s.device('a1'), s.device('a2')) < 0 ? ['a1', 'a2'] : ['a2', 'a1'];
    const fromLoDev = at(s, head, 0, () => s.setRole('alice', d1, 'erin', 2, { card: true, mprev: head }));
    const fromHiDev = at(s, head, 0, () => s.setRole('alice', d2, 'frank', 2, { card: true, mprev: head }));
    const v = groupVector(o, 'fork-3-same-author-two-devices', 'One manager writes two different additions from two devices at the same mprev (two chains, so neither is a chain fork). The tuple (author, device, seq, record_id) is compared element by element: the smaller device_id wins.',
      s, [g, addBob, addCarol, fromLoDev, fromHiDev], { g, addBob, addCarol, fromLoDev, fromHiDev });
    assert.equal(fork(v).winner, idOf(fromLoDev));
  }
  { // three candidates
    const { s, g, addBob, addCarol, head, lo, mid, hi } = world();
    const hiRemovesLo = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 0, { mprev: head, cut: [] }));
    const loAdds = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const midAdds = at(s, head, 0, () => s.setRole(mid, D(mid), 'frank', 2, { card: true, mprev: head }));
    const v = groupVector(o, 'fork-three-candidates', `Three managers at the same mprev. ${hi} removes ${lo}; ${lo} adds erin; ${mid} adds frank. Step 2 drops ${lo}'s candidate (its author is removed by another), leaving ${hi}'s removal and ${mid}'s addition; step 3 picks the smaller author, ${mid}. Without step 2 ${lo}'s would have won.`,
      s, [g, addBob, addCarol, hiRemovesLo, loAdds, midAdds], { g, addBob, addCarol, hiRemovesLo, loAdds, midAdds });
    assert.equal(fork(v).candidates.length, 3); assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(midAdds));
  }
  { // three candidates in a cycle
    const { s, g, addBob, addCarol, head, lo, mid, hi } = world();
    const loRemovesMid = at(s, head, 0, () => s.setRole(lo, D(lo), mid, 0, { mprev: head, cut: [] }));
    const midRemovesHi = at(s, head, 0, () => s.setRole(mid, D(mid), hi, 0, { mprev: head, cut: [] }));
    const hiRemovesLo = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 0, { mprev: head, cut: [] }));
    const v = groupVector(o, 'fork-three-candidates-cycle', `${lo} removes ${mid}, ${mid} removes ${hi}, ${hi} removes ${lo}, all at the same mprev. Every candidate's author is removed by another, so step 2 drops them all and keeps them all; step 3 picks the smallest author, ${lo}.`,
      s, [g, addBob, addCarol, loRemovesMid, midRemovesHi, hiRemovesLo], { g, addBob, addCarol, loRemovesMid, midRemovesHi, hiRemovesLo });
    assert.equal(fork(v).rule, 'all_dropped_least'); assert.equal(fork(v).winner, idOf(loRemovesMid));
  }
  { // content records whose mhead is on a losing branch, unknown, or on the winning branch
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const loAdds = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const hiAdds = at(s, head, 0, () => s.setRole(hi, D(hi), 'frank', 2, { card: true, mprev: head }));
    const onWinner = s.item('erin', 'e1', I, [['n', 1]], [], { mhead: loAdds.id });
    const onLoser = s.item('frank', 'f1', I, [['n', 2]], [], { mhead: hiAdds.id });
    const managerOnLoser = s.item(hi, D(hi) + 'x', I, [['n', 3]], [], { mhead: hiAdds.id });
    const frankOnWinner = s.item('frank', 'f2', I, [['n', 4]], [], { mhead: loAdds.id });
    const unknown = s.item('erin', 'e2', I, [['n', 5]], [], { mhead: bytesOf('a membership record nobody has') });
    const v = groupVector(o, 'content-mhead-on-losing-branch', `Two additions fork at one mprev; ${lo}'s wins. Erin's record names the winner as mhead: accepted. Records that name the losing addition as mhead are ignored, even from a manager (the author writes the change again). Frank is not a member on the winning chain, so a record naming the winner is ignored too. A record whose mhead is not held waits.`,
      s, [g, addBob, addCarol, loAdds, hiAdds, onWinner, onLoser, managerOnLoser, frankOnWinner, unknown], { g, addBob, addCarol, loAdds, hiAdds, onWinner, onLoser, managerOnLoser, frankOnWinner, unknown });
    assert.equal(statusOf(v, onWinner), 'accepted'); assert.equal(statusOf(v, onLoser), 'ignored:mhead_not_on_chain'); assert.equal(statusOf(v, managerOnLoser), 'ignored:mhead_not_on_chain');
    assert.equal(statusOf(v, frankOnWinner), 'ignored:not_writer'); assert.equal(statusOf(v, unknown), 'waits:mhead_unknown');
  }
  { // genesis: smallest record id; wrong nonce; card of someone else
    const s = new Scenario();
    const g1 = s.genesis('a1');
    const g2 = s.genesis('a2', { clock: [BASE_MS + 999, 0] });
    const wrongNonce = s.seal('alice', 'a3', KIND.genesis, cmap([[1, bytesOf('another nonce')], [2, makeCard(s.person('alice'))], [3, commitOf(s.gid, 0, s.key(0))]]), { epoch: 0 });
    const bobsCard = s.seal('alice', 'a4', KIND.genesis, cmap([[1, s.nonce], [2, makeCard(s.person('bob'))], [3, commitOf(s.gid, 0, s.key(0))]]), { epoch: 0 });
    const badCommit = s.seal('alice', 'a5', KIND.genesis, cmap([[1, s.nonce], [2, makeCard(s.person('alice'))], [3, commitOf(s.gid, 0, s.key(1))]]), { epoch: 0 });
    const v = groupVector(o, 'genesis-duplicates-and-invalid', 'Two valid genesis records (same creator, nonce and K_0, different device and clock): the one with the smaller record_id is used and the other is ignored as a duplicate (6.1). Three invalid ones are ignored: a nonce that does not give this gid, a card that is not the creator\'s, and a commitment that does not match K_0.',
      s, [g1, g2, wrongNonce, bobsCard, badCommit], { g1, g2, wrongNonce, bobsCard, badCommit });
    assert.equal(v.expected.duplicate_genesis.length, 1); assert.equal(v.expected.chain.length, 1);
    assert.equal(v.expected.ignored[idOf(wrongNonce)], 'gid_mismatch'); assert.equal(v.expected.ignored[idOf(bobsCard)], 'card_is_not_the_creators'); assert.equal(v.expected.ignored[idOf(badCommit)], 'commit_mismatch');
  }

  // ---- chains (4.4)
  { // fork, duplicate delivery and the same change sealed twice
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2fork = s.item('bob', 'b1', I, [['n', 20]], [], { seq: 2, prev: b1.id });
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { seq: 3, prev: b2.id });
    const c1 = s.item('alice', 'a2', I, [['m', 1]]);
    const v = groupVector(o, 'chain-fork', 'Bob\'s device b1 has two different records with seq 2. Neither is accepted, nothing later in the chain (seq 3) is accepted, seq 1 is; both are kept and the fork is shown. Alice\'s other chain is unaffected.',
      s, [g, addBob, b1, b2, b2fork, b3, c1], { g, addBob, b1, b2, b2fork, b3, c1 });
    assert.equal(Object.keys(v.expected.chain_forks).length, 1);
    groupVector(o, 'chain-duplicate-delivery', 'The same sealed record delivered twice (identical bytes) is one record.', s, [g, addBob, b1, b1, b2, b2], { g, addBob, b1, b2 });
    const s2 = new Scenario();
    const g2 = s2.genesis(); const addBob2 = s2.setRole('alice', 'a1', 'bob', 2, { card: true });
    const x1 = s2.item('bob', 'b1', I, [['n', 1]]);
    const x2 = s2.item('bob', 'b1', I, [['n', 2]], [], { clock: [BASE_MS + 50_000, 0], salt: bytesOf('first salt') });
    const x2again = s2.item('bob', 'b1', I, [['n', 2]], [], { seq: 2, prev: x1.id, clock: [BASE_MS + 50_000, 0], salt: bytesOf('second salt') });
    const same = groupVector(o, 'chain-same-body-sealed-twice', 'A device seals the same change (same body fields) twice with different salts, which a device MUST NOT do (4.4). Section 4.4 calls records with "the same body bytes" one record "whatever their salts", but the body includes the signature, which covers the header and so the salt: two such records never have the same body bytes. This implementation reads "body bytes" literally, so the two are different records with the same seq, a fork (finding).',
      s2, [g2, addBob2, x1, x2, x2again], { g2, addBob2, x1, x2, x2again });
    assert.equal(Object.keys(same.expected.chain_forks).length, 1);
  }
  { // gap and prev mismatch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b3 = s.item('bob', 'b1', I, [['n', 3]]);
    const x1 = s.item('bob', 'b2', I, [['n', 10]]);
    const x2 = s.item('bob', 'b2', I, [['n', 11]], [], { seq: 2, prev: bytesOf('some other record') });
    const v = groupVector(o, 'chain-gap-and-prev-mismatch', 'Bob\'s b1 chain is missing seq 2 (seq 3 waits: gap). His b2 chain has a seq 2 whose prev is not the record the reader holds as seq 1 (waits: prev_mismatch). Both are "behind", never errors.',
      s, [g, addBob, b1, b3, x1, x2], { g, addBob, b1, b3, x1, x2 });
    assert.equal(v.expected.waiting.length, 2);
    void b2;
  }
  // ---- held back (4.5)
  for (const [name, plus, held, desc] of [['held-back-exactly-24h', 0, false, 'A record exactly 24 hours ahead of the reader\'s time is accepted, and so is the one after it.'],
                                          ['held-back-one-ms-over', 1, true, 'A record 24 hours and 1 ms ahead is held back, and the record after it waits behind it (gap): its chain has a hole until the reader\'s time catches up.']] as const) {
    const s = new Scenario();
    const g = s.genesis(); const a1 = s.item('alice', 'a1', I, [['n', 1]]);
    const future = s.item('alice', 'a1', I, [['n', 2]], [], { clock: [BASE_MS + 5000 + 86400000 + plus, 0] });
    const after = s.item('alice', 'a1', I, [['n', 3]], [], { clock: [BASE_MS + 5000 + 86400000 + plus, 1] });
    const v = groupVector(o, name, desc + ' The reader\'s time is BASE_MS + 5000.', s, [g, a1, future, after], { g, a1, future, after }, { now_ms: BASE_MS + 5000 });
    assert.equal(v.expected.held_back.includes(idOf(future)), held);
    if (held) assert.equal(statusOf(v, after), undefined); else assert.equal(statusOf(v, after), 'accepted');
  }
  { // a membership record held back
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }, );
    const addCarol = s.setRole('alice', 'a1', 'carol', 2, { card: true, clock: [BASE_MS + 5000 + 86400000 + 1, 0] });
    const carol1 = s.item('carol', 'c1', I, [['n', 1]]);
    const bob1 = s.item('bob', 'b1', I, [['n', 2]]);
    const v = groupVector(o, 'held-back-membership-record', 'A membership record 24 hours and 1 ms ahead is held back, so it is not on the chain; carol\'s record names it as mhead and waits (mhead_unknown), and bob\'s, which names the head before it, is accepted.',
      s, [g, addBob, addCarol, carol1, bob1], { g, addBob, addCarol, carol1, bob1 }, { now_ms: BASE_MS + 5000 });
    assert.equal(statusOf(v, carol1), 'waits:mhead_unknown');
  }

  // ---- replacing a secret (6.4)
  { // by the person, with a cut
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    s.key(1);
    const rep = s.replace('bob', 'b1', 'bob', 'bob2', { cut: [[s.device('b1'), 1]] });
    const ep = s.newEpoch('alice', 'a1', 1);
    const bobOldInCut = s.item('bob', 'b2', I, [['n', 6]], [], { mhead: addBob.id, epoch: 0 });
    const bobOldAfter = s.item('bob', 'b1', I, [['n', 666]], [], { mhead: addBob.id, epoch: 0, clock: [BASE_MS + 100000, 0] });
    const bob2 = s.item('bob2', 'n1', I, [['n', 2]]);
    const v = groupVector(o, 'replace-secret-by-the-person-with-cut', 'Bob replaces his own secret (signed with the old key) with a cut listing (b1, seq 1); alice writes the epoch record. The new pid takes bob\'s role. Draft 2 gives kind 4 a cut: bob\'s b1 seq 2, a record on a device the cut does not list, and a late record written with the old key are all ignored (beyond_cut). The new pid\'s record sealed in epoch 1 is accepted.',
      s, [g, addBob, b1, b2, rep, ep, bobOldInCut, bobOldAfter, bob2], { g, addBob, b1, b2, rep, ep, bobOldInCut, bobOldAfter, bob2 });
    assert.equal(statusOf(v, b1), 'accepted'); assert.equal(statusOf(v, b2), 'ignored:beyond_cut'); assert.equal(statusOf(v, bobOldInCut), 'ignored:beyond_cut');
    assert.equal(statusOf(v, bobOldAfter), 'ignored:beyond_cut'); assert.equal(statusOf(v, bob2), 'accepted');
    assert.equal(v.expected.roles[H(s.person('bob2').pid)], 2); assert.equal(v.expected.roles[H(s.person('bob').pid)], 0);
  }
  { // rules
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const head = s.mhead!;
    const bad1 = s.replace('alice', 'a1', 'bob', 'carol', { mprev: head }); s.mhead = head;
    const bad2 = s.replace('carol', 'c1', 'bob', 'bob2', { mprev: head }); s.mhead = head;
    const bad3 = s.replace('alice', 'a1', 'dave', 'bob2', { mprev: head }); s.mhead = head;
    const ok = s.replace('alice', 'a1', 'bob', 'bob2', { mprev: head });
    const v = groupVector(o, 'replace-secret-rules', 'A replacement naming a pid that is already a member, one written by someone who is neither a manager nor the person, and one for a pid that is not a member are ignored; a manager\'s replacement is valid.',
      s, [g, addBob, addCarol, bad1, bad2, bad3, ok], { g, addBob, addCarol, bad1, bad2, bad3, ok });
    assert(v.expected.ignored[idOf(bad1)] && v.expected.ignored[idOf(bad2)] && v.expected.ignored[idOf(bad3)]);
  }

  // ---- checkpoints end to end (5.3)
  { // restating writes, bridging a deleted range
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const x1 = s.item('alice', 'a1', I, [['title', 'one']]); const x2 = s.item('alice', 'a1', I, [['url', 'u']]); const x3 = s.item('alice', 'a1', itemId('i2'), [['t', 1]]);
    const addCarol = s.setRole('alice', 'a1', 'carol', 2, { card: true });
    const x4 = s.item('alice', 'a1', I, [['title', 'two']]);
    const b1 = s.item('bob', 'b1', I, [['note', 'n']], [], { mhead: addBob.id });
    const items = checkpointItems(fold([x1, x2, x3, b1].map((r) => ({ key5: r.key5, payload: r.payload }))));
    const cp = at(s, addBob.id, 0, () => s.checkpoint('bob', 'b1', items, [['alice', 'a1', x3], ['bob', 'b1', b1]]));
    s.mhead = addCarol.id;
    const after = s.item('carol', 'c1', I, [['note', 'later']], [], { mhead: addCarol.id });
    const full = groupVector(o, 'checkpoint-full-history', 'Alice\'s items, a checkpoint by manager bob that restates the winning writes and covers alice\'s chain up to seq 5 and his own first record, then later records. All records present: covered content is folded from the checkpoint and the records, the rest on top.',
      s, [g, addBob, x1, x2, x3, addCarol, x4, b1, cp, after], { g, addBob, x1, x2, x3, addCarol, x4, b1, cp, after });
    const del = groupVector(o, 'checkpoint-covered-records-deleted', 'The same group after the covered content records (alice seq 3 to 5) were deleted from storage. Alice\'s membership record at seq 6 is accepted only because the checkpoint covers the gap. The current values are unchanged; the history before the checkpoint is gone.',
      s, [g, addBob, addCarol, x4, b1, cp, after], { g, addBob, addCarol, x4, b1, cp, after });
    assert.deepEqual(full.expected.checkpoints, [idOf(cp)]); assert.deepEqual(del.expected.checkpoints, [idOf(cp)]);
    const cur = (st: J) => JSON.stringify(Object.fromEntries(Object.entries(st).map(([k, x]: [string, any]) => [k, Object.fromEntries(Object.entries(x.fields).map(([f, y]: [string, any]) => [f, y.current]))])));
    assert.equal(cur(full.expected.state), cur(del.expected.state));
    const bogus = at(s, addCarol.id, 0, () => s.seal('carol', 'c2', KIND.checkpoint, cmap([[1, [[s.person('alice').pid, s.device('a1'), 99, bytesOf('x')]] as CborValue], [2, []], [3, []]])));
    const nm = groupVector(o, 'checkpoint-by-non-manager', 'A checkpoint written by a writer (not a manager) is ignored and covers nothing.', s, [g, addBob, addCarol, x1, x2, x3, x4, bogus], { g, addBob, addCarol, x1, x2, x3, x4, bogus });
    assert.deepEqual(nm.expected.rejected_checkpoints, [idOf(bogus)]);
    // a fresh group of three managers for the purge and overlap cases
    const t = new Scenario();
    const tg = t.genesis('a1'); const tBob = t.setRole('alice', 'a1', 'bob', 3, { card: true }); const tCarol = t.setRole('alice', 'a1', 'carol', 3, { card: true });
    // purged
    const p1 = t.item('alice', 'a1', itemId('secret'), [['password', 'old password']], [], { mhead: tCarol.id });
    const p2 = t.item('alice', 'a1', itemId('secret'), [['password', 'newer password']], [], { mhead: tCarol.id });
    const p3 = t.item('alice', 'a1', itemId('secret'), [['password', 'newest password']], [], { mhead: tCarol.id });
    const cpPurge = at(t, tCarol.id, 0, () => t.checkpoint('bob', 'b1', [], [['alice', 'a1', p3]], [[itemId('secret'), p2.key5]]));
    const pv = groupVector(o, 'checkpoint-purged', 'A manager\'s checkpoint names the item and the place of the second write in `purged`: the first two writes of its password are forgotten (no history), the third survives. A reader that still holds the records for the first two drops them from its state too.',
      t, [tg, tBob, tCarol, p1, p2, p3, cpPurge], { tg, tBob, tCarol, p1, p2, p3, cpPurge });
    if (process.env.DBG) console.log(JSON.stringify({ content: pv.expected.content, waiting: pv.expected.waiting, cps: pv.expected.checkpoints, rej: pv.expected.rejected_checkpoints, ign: pv.expected.ignored, state: Object.keys(pv.expected.state) }, null, 1));
    const secret = pv.expected.state[H(itemId('secret'))];
    assert.equal(secret.fields.password.history.length, 0);
    // two overlapping checkpoints, in both input orders
    const q1 = t.item('alice', 'a2', itemId('over'), [['a', 1]], [], { mhead: tCarol.id });
    const q2 = t.item('alice', 'a2', itemId('over'), [['b', 2]], [], { mhead: tCarol.id });
    const q3 = t.item('alice', 'a2', itemId('over'), [['a', 3]], ['b'], { mhead: tCarol.id });
    const itemsA = checkpointItems(fold([q1, q2].map((r) => ({ key5: r.key5, payload: r.payload }))));
    const itemsB = checkpointItems(fold([q2, q3].map((r) => ({ key5: r.key5, payload: r.payload }))));
    const cpA = at(t, tCarol.id, 0, () => t.checkpoint('bob', 'b2', itemsA, [['alice', 'a2', q2]]));
    const cpB = at(t, tCarol.id, 0, () => t.checkpoint('carol', 'c2', itemsB, [['alice', 'a2', q3]], [], { mhead: tCarol.id }));
    const base = [tg, tBob, tCarol, q1, q2, q3];
    const ord1 = groupVector(o, 'checkpoint-overlapping-order-1', 'Two checkpoints by two managers overlap: the first covers alice\'s chain up to q2, the second up to q3 (q2 is in both). Records listed with the first checkpoint first.',
      t, [...base, cpA, cpB], { tg, tBob, tCarol, q1, q2, q3, cpA, cpB });
    const ord2 = groupVector(o, 'checkpoint-overlapping-order-2', 'The same records listed with the second checkpoint first (and in reverse): the same result.',
      t, [cpB, cpA, ...base.slice().reverse()], { tg, tBob, tCarol, q1, q2, q3, cpA, cpB });
    assert.deepEqual(ord1.expected.state, ord2.expected.state);
    assert.deepEqual(ord1.expected.checkpoints, [idOf(cpA), idOf(cpB)].sort());
    assert.deepEqual(ord2.expected.checkpoints, ord1.expected.checkpoints);
  }
  return file('Chains, membership, the fork rule, cuts, content records and checkpoints end to end (sections 4.4, 5, 6, 9).', o);
}
