// Vectors for sections 4.4 to 6.6: chains, membership, the fork rule, cuts, content records and checkpoints end to end.
// Where a vector has an `expectGroup` call, the outcome of every record (and the final field values) is written out by hand in this
// file and the library is asserted to agree; the other vectors take their expectation from the library and assert only the key points.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cmp } from '../src/bytes.ts';
import { cmap, type CborValue } from '../src/cbor.ts';
import { checkpointItems, fold } from '../src/fold.ts';
import { commitOf, gidOf, makeCard } from '../src/keys.ts';
import { KIND, type Rec } from '../src/record.ts';
import { BASE_MS, Scenario, bytesOf, itemId } from '../test/scenario.ts';
import { CLEARED, E, H, Out, expectGroup, file, historyView, itemNames, outcome, stateView } from './vec-common.ts';
import type { J } from './vec-common.ts';

type Labels = Record<string, Rec>;

function groupVector(o: Out, name: string, desc: string, s: Scenario, labels: Labels, extra: J = {}, raw: Uint8Array[] = [], order?: (xs: Rec[]) => Rec[]): J {
  const lab: J = {};
  for (const [k, r] of Object.entries(labels)) lab[H(r.id)] = k;
  const people: J = {};
  for (const [k, p] of s.persons) people[k] = H(p.pid);
  const recs = order ? order(Object.values(labels)) : Object.values(labels);
  return o.add(`group/${name}`, desc, 'group.evaluate', { gid: H(s.gid), keys: s.keyList(), records: [...recs.map((r) => H(r.sealed)), ...raw.map(H)], ...extra, labels: lab, people });
}

const D = (name: string) => (name === 'alice' ? 'a1' : `${name}1`);
const I = itemId('i1');
const idOf = (r: Rec) => H(r.id);
const fork = (v: J, n = 0) => v.expected.membership_forks[n];
const NAMES = itemNames(['i1', I], ['i2', itemId('i2')]);
const TEN_MIN = 600_000;

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
/** Run `f`, then put the scenario's view (newest membership record, epoch) back. */
const keep = <T>(s: Scenario, f: () => T): T => { const h = s.mhead, e = s.epoch; const r = f(); s.mhead = h; s.epoch = e; return r; };

export function groupVectors(): J {
  const o = new Out();

  // ------------------------------------------------------------------ roles, cuts, removal
  { // lifecycle
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const bob1 = s.item('bob', 'b1', I, [['title', 'Hi']]); const carol1 = s.item('carol', 'c1', I, [['note', 'by a reader']]);
    const dave1 = s.item('dave', 'd1', I, [['x', 1]]);
    const promote = s.setRole('alice', 'a1', 'carol', 2); const carol2 = s.item('carol', 'c1', I, [['note', 'by a writer']]);
    const labels = { g, addBob, addCarol, bob1, carol1, dave1, promote, carol2 };
    const v = groupVector(o, 'lifecycle-roles', 'Genesis, a writer, a reader. A reader\'s record and a stranger\'s are ignored. Carol\'s first record names a mhead from when she was a reader and stays ignored after she is promoted; her second, written after the promotion, is accepted.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', bob1: 'accepted', carol1: 'ignored:not_writer', dave1: 'ignored:not_writer', promote: 'chain', carol2: 'accepted' },
      { i1: { deleted: false, fields: { title: 'Hi', note: 'by a writer' } } }, NAMES);
  }
  { // removal with cut, unlisted devices; the removal record starts the new epoch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]); const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2dev = s.item('bob', 'b2', I, [['n', 7]]);
    const remove = s.remove('alice', 'a1', 'bob', 1, { cut: [[s.device('b1'), 1]] });
    // Bob has not seen the removal: his later records name the membership head he knew and are sealed in epoch 0, which he still holds.
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { mhead: addBob.id, epoch: 0 });
    const b3new = s.item('bob', 'b3', I, [['n', 9]], [], { mhead: addBob.id, epoch: 0 });
    // A record sealed with epoch 1's key (he should not have it) naming the removal as mhead: he is removed as of that point.
    const bLeak = s.item('bob', 'b1', I, [['n', 4]], [], { mhead: remove.id, epoch: 1 });
    const a1 = s.item('alice', 'a1', I, [['title', 'after']], [], { mhead: remove.id, epoch: 1 });
    const labels = { g, addBob, b1, b2, b2dev, remove, b3, b3new, bLeak, a1 };
    const v = groupVector(o, 'remove-with-cut-unlisted-device', 'Bob writes twice on device b1 and once on device b2, then is removed (kind 5, which starts epoch 1 in the same record and is sealed under K_1) with a cut that lists only (b1, seq 1). His b1 seq 1 is accepted. His b1 seq 2 and 3 (beyond the cut) and every record on devices b2 and b3 (chains the cut does not list, including one from a device nobody had seen) are ignored when sealed in epoch 0. A record sealed in epoch 1 is ignored because he is not a writer as of its mhead.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', b2: 'ignored:beyond_cut', b2dev: 'ignored:beyond_cut', remove: 'chain', b3: 'ignored:beyond_cut', b3new: 'ignored:beyond_cut', bLeak: 'ignored:not_writer', a1: 'accepted' },
      { i1: { deleted: false, fields: { n: 1, title: 'after' } } }, NAMES);
    assert.equal(v.expected.epoch, 1);
    // The removed person's view: he holds only K_0, so the removal record (sealed under K_1) cannot be opened and the chain stops before it.
    const view = o.add('group/removed-person-holds-only-the-old-key', 'The same records read by someone who holds only K_0 (the removed person): the removal, bob\'s record sealed with K_1 and alice\'s epoch-1 record are sealed under K_1 and wait for a key (no_key), so the chain stops at bob\'s addition and bob\'s records are judged as of it. There is no state of waiting for a new key for the group; this reader just cannot read on.',
      'group.evaluate', { gid: H(s.gid), keys: s.keyList().filter((k) => k.epoch === 0), records: Object.values(labels).map((r) => H(r.sealed)), labels: {}, people: {} });
    assert.deepEqual(view.expected.rejected.map((r: J) => [r.code, r.disposition]), [['no_key', 'wait'], ['no_key', 'wait'], ['no_key', 'wait']]);
    assert.equal(view.expected.epoch, 0);
    // By hand: the three records under K_1 are not seen at all; the chain ends at bob's addition, so all of bob's records are judged as of it (a writer, no cut yet).
    const seen = Object.fromEntries(Object.entries(labels).filter(([k]) => !['remove', 'bLeak', 'a1'].includes(k)));
    for (const [k, r] of Object.entries(labels)) if (['remove', 'bLeak', 'a1'].includes(k)) assert.equal(outcome(view, r), 'absent', k);
    for (const [k, r] of Object.entries(seen)) assert.equal(outcome(view, r), k === 'g' || k === 'addBob' ? 'chain' : 'accepted', k);
    assert.deepEqual(stateView(view.expected.state, NAMES), { i1: { deleted: false, fields: { n: 9 } } });
    o.add('membership/remove-sealed-under-new-key-unreadable-with-old-key', 'The removal record opened with K_0 only: it is sealed under K_1, so it waits for a key (6.4: the removed person cannot read it).', 'record.open',
      { keys: s.keyList().filter((k) => k.epoch === 0), sealed: H(remove.sealed) }, E('no_key', 'wait'));
    o.add('membership/remove-opens-with-new-key', 'The same record opened with K_1.', 'record.open', { keys: s.keyList().filter((k) => k.epoch === 1), sealed: H(remove.sealed) });
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
    s.mhead = lowerHead;
    const ep = s.newEpoch('alice', 'a1', 1, { mprev: lowerHead });
    const raiseOk = s.setRole('alice', 'a1', 'bob', 2);
    const b4 = s.item('bob', 'b1', I, [['n', 4]], [], { mhead: raiseOk.id });
    const labels = { g, addBob, b1, lower, b2old, b3, raiseBad, ep, raiseOk, b4 };
    const v = groupVector(o, 'lower-writer-then-raise-needs-new-epoch', 'A writer is lowered to reader with a cut, which needs no new epoch: a record beyond the cut (written with the old mhead) and one written as a reader are both ignored. Raising him again in the same epoch is invalid (6.2) and is ignored; after an epoch record the same raise is valid, and his record sealed in epoch 1 is accepted.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', lower: 'chain', b2old: 'ignored:beyond_cut', b3: 'ignored:not_writer', raiseBad: 'ignored:raise_needs_new_epoch', ep: 'chain', raiseOk: 'chain', b4: 'accepted' },
      { i1: { deleted: false, fields: { n: 4 } } }, NAMES);
    assert.equal(v.expected.roles[H(s.person('bob').pid)], 2);
  }
  { // a removed person added again writes in the epoch of their return, with no extra epoch record (6.4, draft 4)
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const bOld = s.item('bob', 'b1', I, [['n', 2]]);
    const remove = s.remove('alice', 'a1', 'bob', 1, { cut: [[s.device('b1'), 1]] });
    const readd = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const bNew = s.item('bob', 'b1', I, [['n', 3]]);
    const bNewDevice = s.item('bob', 'b9', itemId('i2'), [['t', 1]]);
    const bStale = s.item('bob', 'b1', I, [['n', 4]], [], { mhead: addBob.id, epoch: 0 });
    const labels = { g, addBob, b1, bOld, remove, readd, bNew, bNewDevice, bStale };
    const v = groupVector(o, 'removed-person-added-again-writes-at-once', 'Bob is removed (kind 5, which starts epoch 1) with a cut that lists (b1, seq 1), and added again with a card at once (kind 2, in epoch 1). The cut reaches only epochs before 1, so no epoch record is needed and his records sealed in epoch 1 are accepted: one on device b1 beyond the cut\'s seq and one on a device the cut does not list. His b1 seq 2, sealed in epoch 0, is beyond the cut, and so is a record sealed in epoch 0 that names his old addition as mhead (its epoch is still the epoch as of that mhead): both are ignored.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', bOld: 'ignored:beyond_cut', remove: 'chain', readd: 'chain', bNew: 'accepted', bNewDevice: 'accepted', bStale: 'ignored:beyond_cut' },
      { i1: { deleted: false, fields: { n: 3 } }, i2: { deleted: false, fields: { t: 1 } } }, NAMES);
    assert.equal(v.expected.epoch, 1); assert.equal(v.expected.roles[H(s.person('bob').pid)], 2);
  }
  { // kind 2 no longer removes
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const bad = s.raw('alice', 'a1', KIND.member, cmap([[1, addBob.id], [2, s.person('bob').pid], [3, 0], [4, []]]));
    o.add('membership/kind-2-with-role-0-is-malformed', 'Kind 2 with role 0: removing a person is kind 5 (6.4), and role is 1, 2 or 3 (6.2). The payload does not have the shape the kind requires, so the record is discarded.', 'record.open', { keys: s.keyList(), sealed: H(bad) }, E('bad_payload', 'discard'));
    const bad4 = s.raw('alice', 'a1', KIND.member, cmap([[1, addBob.id], [2, s.person('bob').pid], [3, 4]]));
    o.add('membership/kind-2-with-role-4-is-malformed', 'Kind 2 with role 4.', 'record.open', { keys: s.keyList(), sealed: H(bad4) }, E('bad_payload', 'discard'));
    void g;
  }
  { // invalid membership records
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const head = s.mhead!;
    const byReader = keep(s, () => s.setRole('carol', 'c1', 'dave', 1, { card: true }));
    const byWriter = keep(s, () => s.setRole('bob', 'b1', 'dave', 1, { card: true }));
    const addNoCard = keep(s, () => s.setRole('alice', 'a1', 'dave', 1));
    const cardForMember = keep(s, () => s.setRole('alice', 'a1', 'bob', 3, { card: true }));
    const lowerNoCut = keep(s, () => s.setRole('alice', 'a1', 'bob', 1));
    const raiseWithCut = keep(s, () => s.setRole('alice', 'a1', 'carol', 2, { cut: [[s.device('c1'), 1]] }));
    const removeStranger = keep(s, () => s.remove('alice', 'a1', 'erin', 1, { cut: [] }));
    const removeByWriter = keep(s, () => s.remove('bob', 'b1', 'carol', 1, { cut: [] }));
    const replaceByWriter = keep(s, () => s.replace('bob', 'b1', 'carol', 'dave', 1));
    const ep = (e: number, commitKey: Uint8Array, prevKey: Uint8Array, by = 'alice', dev = 'a1') =>
      keep(s, () => s.seal(by, dev, KIND.epoch, cmap([[1, head], [2, e], [3, commitOf(s.gid, e, commitKey)], [4, prevKey]]), { epoch: e }));
    s.key(1); s.key(2);
    const epBadCommit = ep(1, s.key(2), s.key(0));
    const epBadPrev = ep(1, s.key(1), s.key(2));
    const epSkip = ep(2, s.key(2), s.key(1));
    const epByWriter = ep(1, s.key(1), s.key(0), 'bob', 'b1');
    const wrongEpoch = keep(s, () => s.seal('alice', 'a1', KIND.member, cmap([[1, head], [2, makeCard(s.person('dave'))], [3, 1]]), { epoch: 1 }));
    const goodAdd = s.setRole('alice', 'a1', 'dave', 1, { card: true });
    const labels = { g, addBob, addCarol, byReader, byWriter, addNoCard, cardForMember, lowerNoCut, raiseWithCut, removeStranger, removeByWriter, replaceByWriter, epBadCommit, epBadPrev, epSkip, epByWriter, wrongEpoch, goodAdd };
    const v = groupVector(o, 'invalid-membership-records', 'Records that name the current head as mprev and are each invalid for a different reason (reasons in `ignored`); they are kept and ignored, and the one valid add continues the chain.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', byReader: 'ignored:author_not_manager', byWriter: 'ignored:author_not_manager', addNoCard: 'ignored:pid_for_a_non_member',
      cardForMember: 'ignored:card_for_a_member', lowerNoCut: 'ignored:lowering_needs_cut', raiseWithCut: 'ignored:cut_without_lowering', removeStranger: 'ignored:not_a_member',
      removeByWriter: 'ignored:author_not_manager', replaceByWriter: 'ignored:author_not_manager_or_the_person', epBadCommit: 'ignored:commit_mismatch', epBadPrev: 'ignored:previous_key_mismatch',
      epSkip: 'ignored:wrong_epoch', epByWriter: 'ignored:author_not_manager', wrongEpoch: 'ignored:wrong_epoch', goodAdd: 'chain' });
  }
  // The check of K_(e-1) against commit(e-1) (6.3, 6.4), for each of the three kinds that carry it.
  for (const kind of ['epoch', 'remove', 'replace'] as const) {
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const head = s.mhead!;
    const wrong = bytesOf('not the previous key');
    const make = (prevKey: Uint8Array) => at(s, head, 0, () => kind === 'epoch' ? s.newEpoch('alice', 'a1', 1, { mprev: head, prevKey })
      : kind === 'remove' ? s.remove('alice', 'a1', 'bob', 1, { mprev: head, cut: [], prevKey }) : s.replace('alice', 'a1', 'bob', 'bob2', 1, { mprev: head, cut: [], prevKey }));
    const bad = make(wrong);
    const good = make(s.key(0));
    const labels = { g, addBob, bad, good };
    const v = groupVector(o, `previous-key-mismatch-${kind}`, `Two ${kind === 'epoch' ? 'epoch (kind 3)' : kind === 'remove' ? 'remove (kind 5)' : 'replace (kind 4)'} records name the same mprev. One carries a key that does not match commit(0) as K_(e-1): it is ignored (previous_key_mismatch). The other carries K_0 and is valid.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', bad: 'ignored:previous_key_mismatch', good: 'chain' });
  }

  // The header of a record of kind 3, 4 or 5 names the epoch it starts (6.4, draft 4). Each record below is otherwise valid.
  for (const kind of ['epoch', 'remove', 'replace'] as const) {
    const label = kind === 'epoch' ? 'epoch (kind 3)' : kind === 'remove' ? 'remove (kind 5)' : 'replace (kind 4)';
    const build = (o2: { epoch: number; key: Uint8Array; commitKey?: Uint8Array }, s: Scenario, head: Uint8Array) => keep(s, () => at(s, head, 0, () => {
      const f = { mprev: head, prevKey: s.key(0), ...o2 };
      return kind === 'epoch' ? s.newEpoch('alice', 'a1', 1, f) : kind === 'remove' ? s.remove('alice', 'a1', 'bob', 1, { ...f, cut: [] }) : s.replace('alice', 'a1', 'bob', 'bob2', 1, { ...f, cut: [] });
    }));
    { // (a) sealed under the old key, the old epoch in the header, committing to that old key as the new one
      const s = new Scenario();
      const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
      const head = s.mhead!;
      const bad = build({ epoch: 0, key: s.key(0), commitKey: s.key(0) }, s, head);
      const good = build({ epoch: 1, key: s.key(1) }, s, head);
      const labels = { g, addBob, bad, good };
      const v = groupVector(o, `${kind}-sealed-under-old-key-with-old-epoch-is-refused`, `A ${label} record sealed under K_0 with epoch 0 in the header: it says epoch 1 in its payload and commits to K_0 as the key of epoch 1, so every other check passes (the commitment matches the key it was sealed under, K_(e-1) is K_0). It is refused because the header must name the epoch the record starts (6.4): the epoch would have had the old key, so nothing would have changed for whoever holds it. A valid ${kind} at the same mprev, sealed under K_1 with epoch 1 in the header, continues the chain.`, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', bad: 'ignored:wrong_header_epoch', good: 'chain' });
    }
    { // (b) the header names the new epoch, but the record is sealed under the old key
      const s = new Scenario();
      const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
      const head = s.mhead!;
      s.key(1);
      const bad = build({ epoch: 1, key: s.key(0) }, s, head);
      const labels = { g, addBob, bad };
      const v = groupVector(o, `${kind}-header-names-new-epoch-but-sealed-under-old-key`, `A ${label} record whose header names epoch 1 but which is sealed under K_0 (the reader holds both keys for epoch 1, so it opens), carrying the commitment to the real K_1: the commitment does not match the key the record was sealed under, so it is ignored (commit_mismatch).`, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', bad: 'ignored:commit_mismatch' });
      if (kind === 'remove') o.add('membership/remove-sealed-under-old-key-with-new-epoch-in-header-does-not-open-with-the-new-key', 'The same kind of record opened by a reader that holds K_0 for epoch 0 and K_1 for epoch 1 only: the header names epoch 1, K_1 does not open it, and it is discarded (bad_tag).', 'record.open',
        { keys: s.keyList().filter((k) => !(k.epoch === 1 && k.key === H(s.key(0)))), sealed: H(s.raw('alice', 'a1', KIND.remove, cmap([[1, head], [2, s.person('bob').pid], [3, []], [4, 1], [5, commitOf(s.gid, 1, s.key(1))], [6, s.key(0)]]), { epoch: 1, key: s.key(0) })) },
        E('bad_tag', 'discard'));
    }
  }

  // ------------------------------------------------------------------ the fork rule (6.5): two steps
  { // step 1 with a removal (kind 5)
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const removeLo = at(s, head, 0, () => s.remove(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const labels = { g, addBob, addCarol, addErin, removeLo };
    const v = groupVector(o, 'fork-1-author-removed-by-another-candidate', `${lo} adds erin; ${hi} removes ${lo}. ${lo} has the smaller pid and would win step 2, but step 1 drops the candidate whose author is removed by another candidate, so the removal wins.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', addErin: 'ignored:lost_fork', removeLo: 'chain' });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(removeLo));
  }
  { // step 1 with a lowering
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const lowerLo = at(s, head, 0, () => s.setRole(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const labels = { g, addBob, addCarol, addErin, lowerLo };
    const v = groupVector(o, 'fork-1-author-lowered-by-another-candidate', `${lo} adds erin; ${hi} lowers ${lo} to reader. Lowering counts like removal in step 1 (no epoch is needed for it).`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', addErin: 'ignored:lost_fork', lowerLo: 'chain' });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(lowerLo));
  }
  { // step 1 with a replacement
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const addErin = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const replaceLo = at(s, head, 0, () => s.replace(hi, D(hi), lo, 'dave', 1, { mprev: head }));
    const labels = { g, addBob, addCarol, addErin, replaceLo };
    const v = groupVector(o, 'fork-1-author-replaced-by-another-candidate', `${lo} adds erin; ${hi} replaces ${lo}'s secret. A replacement counts like a removal in step 1.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', addErin: 'ignored:lost_fork', replaceLo: 'chain' });
    assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(replaceLo));
  }
  { // step 1 drops them all: keep them all
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const loRemoves = at(s, head, 0, () => s.remove(lo, D(lo), hi, 1, { mprev: head, cut: [] }));
    const hiRemoves = at(s, head, 0, () => s.remove(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const labels = { g, addBob, addCarol, loRemoves, hiRemoves };
    const v = groupVector(o, 'fork-1-mutual-removal-keeps-all', `Each of ${lo} and ${hi} removes the other at the same mprev. Step 1 would drop both, so it keeps both and step 2 picks the smaller author: ${lo}'s removal of ${hi} wins.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', loRemoves: 'chain', hiRemoves: 'ignored:lost_fork' });
    assert.equal(fork(v).rule, 'all_dropped_least'); assert.equal(fork(v).winner, idOf(loRemoves));
  }
  { // step 2 alone: the least author
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const loAdds = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const hiAdds = at(s, head, 0, () => s.setRole(hi, D(hi), 'frank', 2, { card: true, mprev: head }));
    const followLo = at(s, loAdds.id, 0, () => s.setRole(lo, D(lo), 'gina', 1, { card: true }));
    const followHi = at(s, hiAdds.id, 0, () => s.setRole(hi, D(hi), 'hank', 1, { card: true }));
    const labels = { g, addBob, addCarol, loAdds, hiAdds, followLo, followHi };
    const v = groupVector(o, 'fork-2-least-author', `${lo} and ${hi} add different people at the same mprev; neither removes the other, so the smaller author (${lo}) wins. The loser and the record that follows it on its branch are ignored (lost_fork, off_chain).`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', loAdds: 'chain', hiAdds: 'ignored:lost_fork', followLo: 'chain', followHi: 'ignored:off_chain' });
    assert.equal(fork(v).rule, 'least_author_device_seq'); assert.equal(fork(v).decided_by, 'author');
  }
  { // the tie-break order: author first, then device, then seq (draft 4: no record_id)
    // (a) the author decides although the other candidate's device is smaller
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    let dLo = 'x0', dHi = 'x1';
    for (let n = 0; cmp(s.device(dLo), s.device(dHi)) <= 0; n++) { dLo = `x${n}`; dHi = `y${n}`; }
    assert(cmp(s.device(dLo), s.device(dHi)) > 0, 'the smaller author has the greater device');
    const loAdds = at(s, head, 0, () => s.setRole(lo, dLo, 'erin', 2, { card: true, mprev: head }));
    const hiAdds = at(s, head, 0, () => s.setRole(hi, dHi, 'frank', 2, { card: true, mprev: head }));
    const labels = { g, addBob, addCarol, loAdds, hiAdds };
    const v = groupVector(o, 'fork-2-author-before-device', `The candidate from the smaller author (${lo}) is on the greater device id; the other candidate (${hi}) is on the smaller one. The tuple is (author, device, seq) in that order, so the author decides: ${lo} wins. An implementation that compares the device first picks the other.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', loAdds: 'chain', hiAdds: 'ignored:lost_fork' });
    assert.equal(fork(v).decided_by, 'author');
  }
  { // (b) same author, two devices: the device decides
    const { s, g, addBob, addCarol, head } = world();
    const [d1, d2] = cmp(s.device('a2'), s.device('a3')) < 0 ? ['a2', 'a3'] : ['a3', 'a2'];
    const fromLoDev = at(s, head, 0, () => s.setRole('alice', d1, 'erin', 2, { card: true, mprev: head }));
    const fromHiDev = at(s, head, 0, () => s.setRole('alice', d2, 'frank', 2, { card: true, mprev: head }));
    const labels = { g, addBob, addCarol, fromHiDev, fromLoDev };
    const v = groupVector(o, 'fork-2-same-author-device-decides', 'One manager writes two different additions from two devices at the same mprev (two chains, so neither is a chain fork). The author is equal, so the smaller device id wins; the candidate from the greater device is listed first.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', fromHiDev: 'ignored:lost_fork', fromLoDev: 'chain' });
    assert.equal(fork(v).decided_by, 'device'); assert.equal(fork(v).winner, idOf(fromLoDev));
  }
  { // (c) same author and device, different seq: the smaller seq wins
    const { s, g, addBob, addCarol, head } = world();
    const first = at(s, head, 0, () => s.setRole('alice', 'a1', 'erin', 2, { card: true, mprev: head })); // alice a1 seq 4
    const second = at(s, head, 0, () => s.setRole('alice', 'a1', 'frank', 2, { card: true, mprev: head })); // alice a1 seq 5, the same mprev
    assert.equal(first.seq, 4); assert.equal(second.seq, 5);
    const labels = { g, addBob, addCarol, second, first };
    const v = groupVector(o, 'fork-2-same-author-and-device-seq-decides', 'One device writes two different additions that name the same mprev: seq 4 and then seq 5 on one chain (the second does not name the first; nothing forbids it). Author and device are equal, so the smaller seq wins; the later record is listed first.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', second: 'ignored:lost_fork', first: 'chain' });
    assert.equal(fork(v).decided_by, 'seq'); assert.equal(fork(v).winner, idOf(first));
  }
  { // (d) same author, device and seq, different record_id: a chain fork (4.4), so neither reaches the fork rule
    const { s, g, addBob, addCarol, head } = world();
    const a = at(s, head, 0, () => s.setRole('alice', 'a1', 'erin', 2, { card: true, mprev: head, seq: 4, prev: addCarol.id }));
    const b = at(s, head, 0, () => s.setRole('alice', 'a1', 'frank', 2, { card: true, mprev: head, seq: 4, prev: addCarol.id }));
    const labels = { g, addBob, addCarol, a, b };
    const v = groupVector(o, 'fork-2-same-author-device-seq-is-a-chain-fork', 'Two additions with the same author, device and seq and the same mprev. They are a fork of the device chain (4.4): neither is accepted, so neither reaches the membership fork rule and the chain stays at carol\'s addition. This is why 6.5 step 2 ends at seq: two candidates cannot share all three of author, device and seq.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', a: 'fork_blocked', b: 'fork_blocked' });
    assert.equal(v.expected.membership_forks.length, 0);
  }
  { // three candidates
    const { s, g, addBob, addCarol, head, lo, mid, hi } = world();
    const hiRemovesLo = at(s, head, 0, () => s.remove(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const loAdds = at(s, head, 0, () => s.setRole(lo, D(lo), 'erin', 2, { card: true, mprev: head }));
    const midAdds = at(s, head, 0, () => s.setRole(mid, D(mid), 'frank', 2, { card: true, mprev: head }));
    const labels = { g, addBob, addCarol, hiRemovesLo, loAdds, midAdds };
    const v = groupVector(o, 'fork-three-candidates', `Three managers at the same mprev. ${hi} removes ${lo}; ${lo} adds erin; ${mid} adds frank. Step 1 drops ${lo}'s candidate (its author is removed by another), leaving ${hi}'s removal and ${mid}'s addition; step 2 picks the smaller author, ${mid}.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', hiRemovesLo: 'ignored:lost_fork', loAdds: 'ignored:lost_fork', midAdds: 'chain' });
    assert.equal(fork(v).candidates.length, 3); assert.equal(fork(v).rule, 'dropped_by_other_candidate'); assert.equal(fork(v).winner, idOf(midAdds));
  }
  { // three candidates in a cycle
    const { s, g, addBob, addCarol, head, lo, mid, hi } = world();
    const loRemovesMid = at(s, head, 0, () => s.remove(lo, D(lo), mid, 1, { mprev: head, cut: [] }));
    const midRemovesHi = at(s, head, 0, () => s.remove(mid, D(mid), hi, 1, { mprev: head, cut: [] }));
    const hiRemovesLo = at(s, head, 0, () => s.remove(hi, D(hi), lo, 1, { mprev: head, cut: [] }));
    const labels = { g, addBob, addCarol, loRemovesMid, midRemovesHi, hiRemovesLo };
    const v = groupVector(o, 'fork-three-candidates-cycle', `${lo} removes ${mid}, ${mid} removes ${hi}, ${hi} removes ${lo}, all at the same mprev. Every candidate's author is removed by another, so step 1 drops them all and keeps them all; step 2 picks the smallest author, ${lo}.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', loRemovesMid: 'chain', midRemovesHi: 'ignored:lost_fork', hiRemovesLo: 'ignored:lost_fork' });
    assert.equal(fork(v).rule, 'all_dropped_least');
  }
  // A fork between a removal and an addition (6.4 removal starts the epoch itself, so there is no separate epoch record to race).
  for (const removerSmaller of [true, false]) {
    const { s, g, addBob, addCarol, lo, hi } = world();
    const [remover, adder] = removerSmaller ? [lo, hi] : [hi, lo];
    const addDave = s.setRole('alice', 'a1', 'dave', 2, { card: true });
    const head = s.mhead!;
    const removeDave = at(s, head, 0, () => s.remove(remover, D(remover), 'dave', 1, { mprev: head, cut: [] }));
    const addErin = at(s, head, 0, () => s.setRole(adder, D(adder), 'erin', 2, { card: true, mprev: head }));
    // dave's records: one naming the addition, sealed in epoch 0; one sealed under the removal's key K_1 naming the addition
    const daveOnAdd = at(s, addErin.id, 0, () => s.item('dave', 'd1', I, [['n', 1]]));
    const daveUnderK1 = at(s, addErin.id, 0, () => s.item('dave', 'd1', I, [['n', 2]], [], { epoch: 1 }));
    const alice1 = at(s, removeDave.id, 1, () => s.item('alice', 'a1', I, [['title', 'after the removal']]));
    const labels = { g, addBob, addCarol, addDave, removeDave, addErin, daveOnAdd, daveUnderK1, alice1 };
    const v = groupVector(o, removerSmaller ? 'fork-remove-against-add-removal-wins' : 'fork-remove-against-add-addition-wins',
      `${remover} removes dave (kind 5, which starts epoch 1) while ${adder} adds erin at the same mprev. Neither author is removed by the other, so the smaller author wins: ${removerSmaller ? 'the removal' : 'the addition'}. ${removerSmaller ? 'Dave is out and epoch 1 is the epoch; a record naming the losing addition is ignored (its mhead is not on the chain).' : 'Dave stays a writer in epoch 0 and the epoch is 0; a record sealed under the losing removal\'s key K_1 is ignored because its epoch is not the epoch as of its mhead (6.5: only the key committed on the winning chain counts).'}`, s, labels);
    if (removerSmaller) {
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', addDave: 'chain', removeDave: 'chain', addErin: 'ignored:lost_fork', daveOnAdd: 'ignored:mhead_not_on_chain', daveUnderK1: 'ignored:mhead_not_on_chain', alice1: 'accepted' },
        { i1: { deleted: false, fields: { title: 'after the removal' } } }, NAMES);
      assert.equal(v.expected.epoch, 1);
    } else {
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', addDave: 'chain', removeDave: 'ignored:lost_fork', addErin: 'chain', daveOnAdd: 'accepted', daveUnderK1: 'ignored:wrong_epoch', alice1: 'ignored:mhead_not_on_chain' },
        { i1: { deleted: false, fields: { n: 1 } } }, NAMES);
      assert.equal(v.expected.epoch, 0);
    }
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
    const labels = { g, addBob, addCarol, loAdds, hiAdds, onWinner, onLoser, managerOnLoser, frankOnWinner, unknown };
    const v = groupVector(o, 'content-mhead-on-losing-branch', `Two additions fork at one mprev; ${lo}'s wins. Erin's record names the winner as mhead: accepted. Records that name the losing addition as mhead are ignored, even from a manager (the author writes the change again). A record whose mhead nobody holds waits.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', loAdds: 'chain', hiAdds: 'ignored:lost_fork', onWinner: 'accepted', onLoser: 'ignored:mhead_not_on_chain',
      managerOnLoser: 'ignored:mhead_not_on_chain', frankOnWinner: 'ignored:not_writer', unknown: 'waits:mhead_unknown' }, { i1: { deleted: false, fields: { n: 1 } } }, NAMES);
  }
  { // a content record sealed under the other key of one epoch number after a fork of two epoch records
    const { s, g, addBob, addCarol, head, lo, hi } = world();
    const epLo = at(s, head, 0, () => s.newEpoch(lo, D(lo), 1, { mprev: head, variant: 'lo' }));
    const epHi = at(s, head, 0, () => s.newEpoch(hi, D(hi), 1, { mprev: head, variant: 'hi' }));
    const underWinner = at(s, epLo.id, 1, () => s.item(lo, D(lo), I, [['n', 1]], [], { key: s.key(1, 'lo') }));
    const underLoser = at(s, epLo.id, 1, () => s.item(lo, D(lo), I, [['n', 2]], [], { key: s.key(1, 'hi') }));
    const labels = { g, addBob, addCarol, epLo, epHi, underWinner, underLoser };
    const v = groupVector(o, 'content-sealed-under-the-losing-key-of-one-epoch', `Two epoch records (kind 3) for epoch 1 fork at one mprev and carry different keys; ${lo}'s wins. A content record sealed under the winning key is accepted; one sealed under the other key of epoch 1 names the winning epoch record as mhead but is ignored (wrong_epoch_key): only the key committed on the winning chain is that epoch's key.`, s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', epLo: 'chain', epHi: 'ignored:lost_fork', underWinner: 'accepted', underLoser: 'ignored:wrong_epoch_key' }, { i1: { deleted: false, fields: { n: 1 } } }, NAMES);
  }
  { // genesis: smallest record id; wrong nonce; card of someone else; min_reader
    const s = new Scenario();
    const g1 = s.genesis('a1');
    const g2 = s.genesis('a2', { clock: [BASE_MS + 999, 0] });
    const mk = (dev: string, nonce: Uint8Array, who: string, commit: Uint8Array) =>
      s.seal('alice', dev, KIND.genesis, cmap([[1, nonce], [2, makeCard(s.person(who))], [3, commit], [4, 1]]), { epoch: 0 });
    const wrongNonce = mk('a3', bytesOf('another nonce'), 'alice', commitOf(s.gid, 0, s.key(0)));
    const bobsCard = mk('a4', s.nonce, 'bob', commitOf(s.gid, 0, s.key(0)));
    const badCommit = mk('a5', s.nonce, 'alice', commitOf(s.gid, 0, s.key(1)));
    const labels = { g1, g2, wrongNonce, bobsCard, badCommit };
    const v = groupVector(o, 'genesis-duplicates-and-invalid', 'Two valid genesis records (same creator, nonce and K_0, different device and clock): the one with the smaller record_id is used and the other is ignored as a duplicate (6.1). Three invalid ones are ignored: a nonce that does not give the gid, a card that is not the creator\'s, a commitment that does not match K_0.', s, labels);
    const [small, big] = cmp(g1.id, g2.id) < 0 ? ['g1', 'g2'] : ['g2', 'g1'];
    expectGroup(v, labels, { [small]: 'chain', [big]: 'ignored:duplicate_genesis', wrongNonce: 'ignored:gid_mismatch', bobsCard: 'ignored:card_is_not_the_creators', badCommit: 'ignored:commit_mismatch' } as Record<string, string>);
  }
  { // min_reader above 1
    const s = new Scenario();
    const g = s.genesis('a1', { minReader: 2 }); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const x = s.item('bob', 'b1', I, [['n', 1]]);
    const labels = { g, addBob, x };
    const v = groupVector(o, 'genesis-min-reader-2', 'Genesis names min_reader 2 and this implementation reads version 1: it MUST NOT read or write the group (6.1). It reports the group as unsupported and shows no state and no content.', s, labels);
    assert.equal(v.expected.unsupported, true); assert.equal(v.expected.min_reader, 2); assert.deepEqual(v.expected.content, []); assert.deepEqual(v.expected.state, {});
    const s1 = new Scenario();
    const g1 = s1.genesis('a1', { minReader: 1 }); const x1 = s1.item('alice', 'a1', I, [['n', 1]]);
    const v1 = groupVector(o, 'genesis-min-reader-1', 'The same group with min_reader 1: read normally.', s1, { g1, x1 });
    assert.equal(v1.expected.unsupported, false);
    expectGroup(v1, { g1, x1 }, { g1: 'chain', x1: 'accepted' }, { i1: { deleted: false, fields: { n: 1 } } }, NAMES);
  }

  { // min_reader at the largest value, and 0
    const s = new Scenario();
    const g = s.genesis('a1', { minReader: 4294967295 });
    const v = groupVector(o, 'genesis-min-reader-largest', 'min_reader 4294967295, the largest value that fits the u32 of the gid: valid, and far above what this implementation reads, so the group is unsupported.', s, { g });
    assert.equal(v.expected.unsupported, true);
    const z = new Scenario();
    z.minReader = 0; z.gid = gidOf(z.person('alice').pid, z.nonce, z.key(0), 0);
    const zero = z.raw('alice', 'a1', KIND.genesis, cmap([[1, z.nonce], [2, makeCard(z.person('alice'))], [3, commitOf(z.gid, 0, z.key(0))], [4, 0]]), { epoch: 0 });
    o.add('membership/genesis-min-reader-0-is-malformed', 'A genesis with min_reader 0 (its gid computed with 0, everything else valid): min_reader is at least 1 (6.1, draft 4), so the payload is malformed and the record is discarded.', 'record.open', { keys: z.keyList(), sealed: H(zero) }, E('bad_payload', 'discard'));
    const zv = groupVector(o, 'genesis-min-reader-0-is-refused', 'The same genesis given to the whole reader: it is discarded (bad_payload), so the group has no chain at all.', z, {}, {}, [zero]);
    assert.deepEqual(zv.expected.rejected, [{ index: 0, code: 'bad_payload', disposition: 'discard' }]);
    assert.deepEqual(zv.expected.chain, []);
  }
  { // the gid binds min_reader (3.3)
    const s = new Scenario();
    const legacy = (() => { const sha = (...xs: Uint8Array[]) => new Uint8Array(createHash('sha256').update(Buffer.concat(xs)).digest());
      return sha(Buffer.from('psss/v1/gid'), s.person('alice').pid, s.nonce, sha(Buffer.from('psss/v1/gid-key'), s.key(0))); })();
    assert.notEqual(H(legacy), H(s.gid));
    s.gid = legacy; // the draft-3 formula: no min_reader in the gid
    const g = s.genesis('a1');
    const v = groupVector(o, 'genesis-gid-computed-without-min-reader', 'A genesis whose header gid is the draft-3 derivation (without min_reader) and whose min_reader is 1: the gid in the header is not the derivation of section 3.3 from author, genesis_nonce, K_0 and min_reader, so the genesis is ignored (gid_mismatch) and the group has no chain.', s, { g });
    expectGroup(v, { g }, { g: 'ignored:gid_mismatch' });
    const t = new Scenario();
    const g2 = t.seal('alice', 'a1', KIND.genesis, cmap([[1, t.nonce], [2, makeCard(t.person('alice'))], [3, commitOf(t.gid, 0, t.key(0))], [4, 2]]), { epoch: 0 });
    const v2 = groupVector(o, 'genesis-min-reader-is-not-the-one-in-the-gid', 'A genesis whose gid was derived with min_reader 1 but whose payload says min_reader 2: a group cannot be given a different lowest reader version than the one its gid commits to, so the genesis is ignored (gid_mismatch).', t, { g2 });
    expectGroup(v2, { g2 }, { g2: 'ignored:gid_mismatch' });
  }

  // ------------------------------------------------------------------ chains (4.4)
  { // fork, duplicate delivery
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const b2fork = s.item('bob', 'b1', I, [['n', 20]], [], { seq: 2, prev: b1.id });
    const b3 = s.item('bob', 'b1', I, [['n', 3]], [], { seq: 3, prev: b2.id });
    const c1 = s.item('alice', 'a2', I, [['m', 1]]);
    const labels = { g, addBob, b1, b2, b2fork, b3, c1 };
    const v = groupVector(o, 'chain-fork', 'Bob\'s device b1 has two different records with seq 2. Neither is accepted, nothing later in the chain (seq 3) is accepted, seq 1 is; both are kept and the fork is shown. Alice\'s other chain is unaffected.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', b2: 'fork_blocked', b2fork: 'fork_blocked', b3: 'fork_blocked', c1: 'accepted' }, { i1: { deleted: false, fields: { n: 1, m: 1 } } }, NAMES);
    assert.equal(Object.keys(v.expected.chain_forks).length, 1);
    const dup = groupVector(o, 'chain-duplicate-delivery', 'The same sealed record delivered twice (identical bytes) is one record.', s, { g, addBob, b1, b1again: b1, b2, b2again: b2 });
    assert.deepEqual(dup.expected.chain_forks, {});
    expectGroup(dup, { g, addBob, b1, b1again: b1, b2, b2again: b2 }, { g: 'chain', addBob: 'chain', b1: 'accepted', b1again: 'accepted', b2: 'accepted', b2again: 'accepted' }, { i1: { deleted: false, fields: { n: 2 } } }, NAMES);
  }
  { // the same body sealed twice is one record; a different salt is not a record at all
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const x1 = s.item('bob', 'b1', I, [['n', 1]]);
    const x2 = s.item('bob', 'b1', I, [['n', 2]], [], { clock: [BASE_MS + 50_000, 0] });
    const x2again = s.item('bob', 'b1', I, [['n', 2]], [], { seq: 2, prev: x1.id, clock: [BASE_MS + 50_000, 0] });
    assert.equal(H(x2.sealed), H(x2again.sealed), 'sealing is deterministic: the same body gives the same sealed record');
    const labels = { g, addBob, x1, x2, x2again };
    const same = groupVector(o, 'chain-same-body-sealed-twice', 'A device seals the same body twice (same fields, same clock). Sealing is deterministic (4.1), so the two are the same bytes and the same record_id: one record, no fork (4.4).', s, labels);
    expectGroup(same, labels, { g: 'chain', addBob: 'chain', x1: 'accepted', x2: 'accepted', x2again: 'accepted' }, { i1: { deleted: false, fields: { n: 2 } } }, NAMES);
    assert.deepEqual(same.expected.chain_forks, {});
    const odd = s.raw('bob', 'b1', KIND.item, cmap([[1, I], [2, new Map([['n', 2]]) as CborValue], [3, []]]), { seq: 2, prev: x1.id, clock: [BASE_MS + 50_000, 0], salt: bytesOf('not the derived salt') });
    const withOdd = groupVector(o, 'chain-same-body-different-salt-is-rejected', 'The same fields sealed with a salt that is not the derived one (a device that draws a random salt): the reader recomputes the salt, finds a mismatch and discards the record (bad_salt). There is no second record at seq 2 and no fork.', s, { g, addBob, x1, x2 }, {}, [odd]);
    assert.deepEqual(withOdd.expected.rejected, [{ index: 4, code: 'bad_salt', disposition: 'discard' }]);
    expectGroup(withOdd, { g, addBob, x1, x2 }, { g: 'chain', addBob: 'chain', x1: 'accepted', x2: 'accepted' }, { i1: { deleted: false, fields: { n: 2 } } }, NAMES);
    assert.deepEqual(withOdd.expected.chain_forks, {});
  }
  { // gap and prev mismatch
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    s.item('bob', 'b1', I, [['n', 2]]);
    const b3 = s.item('bob', 'b1', I, [['n', 3]]);
    const x1 = s.item('bob', 'b2', I, [['n', 10]]);
    const x2 = s.item('bob', 'b2', I, [['n', 11]], [], { seq: 2, prev: bytesOf('some other record') });
    const labels = { g, addBob, b1, b3, x1, x2 };
    const v = groupVector(o, 'chain-gap-and-prev-mismatch', 'Bob\'s b1 chain is missing seq 2 (seq 3 waits: gap). His b2 chain has a seq 2 whose prev is not the record the reader holds as seq 1 (waits: prev_mismatch). Both are "behind", never errors.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', b3: 'waits:gap', x1: 'accepted', x2: 'waits:prev_mismatch' }, { i1: { deleted: false, fields: { n: 10 } } }, NAMES);
  }

  // ------------------------------------------------------------------ held back (4.5): ten minutes
  for (const [name, plus, held, desc] of [['held-back-exactly-10-minutes', 0, false, 'A record exactly 10 minutes ahead of the reader\'s time is accepted, and so is the one after it.'],
                                          ['held-back-one-ms-over', 1, true, 'A record 10 minutes and 1 ms ahead is held back, and so is the next one (the same time); a record after those, with an ordinary time, waits behind them (gap): its chain has a hole until the reader\'s time catches up.']] as const) {
    const s = new Scenario();
    const g = s.genesis(); const a1 = s.item('alice', 'a1', I, [['n', 1]]);
    const future = s.item('alice', 'a1', I, [['n', 2]], [], { clock: [BASE_MS + 5000 + TEN_MIN + plus, 0] });
    const after = s.item('alice', 'a1', I, [['n', 3]], [], { clock: [BASE_MS + 5000 + TEN_MIN + plus, 1] });
    const behind = held ? s.item('alice', 'a1', I, [['n', 4]], [], { clock: [BASE_MS + 4000, 0] }) : undefined;
    const labels = { g, a1, future, after, ...(behind ? { behind } : {}) };
    const v = groupVector(o, name, desc + ' The reader\'s time is BASE_MS + 5000.', s, labels, { now_ms: BASE_MS + 5000 });
    if (held) expectGroup(v, labels, { g: 'chain', a1: 'accepted', future: 'held_back', after: 'held_back', behind: 'waits:gap' }, { i1: { deleted: false, fields: { n: 1 } } }, NAMES);
    else expectGroup(v, labels, { g: 'chain', a1: 'accepted', future: 'accepted', after: 'accepted' }, { i1: { deleted: false, fields: { n: 3 } } }, NAMES);
    assert.equal(v.expected.held_back.includes(idOf(future)), held);
  }
  { // a membership record held back
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const addCarol = s.setRole('alice', 'a1', 'carol', 2, { card: true, clock: [BASE_MS + 5000 + TEN_MIN + 1, 0] });
    const carol1 = s.item('carol', 'c1', I, [['n', 1]]);
    const bob1 = s.item('bob', 'b1', I, [['n', 2]], [], { mhead: addBob.id });
    const labels = { g, addBob, addCarol, carol1, bob1 };
    const v = groupVector(o, 'held-back-membership-record', 'A membership record 10 minutes and 1 ms ahead is held back, so it is not on the chain; carol\'s record names it as mhead and waits (mhead_unknown), and bob\'s, which names the head before it, is accepted.', s, labels, { now_ms: BASE_MS + 5000 });
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'held_back', carol1: 'waits:mhead_unknown', bob1: 'accepted' }, { i1: { deleted: false, fields: { n: 2 } } }, NAMES);
  }

  // ------------------------------------------------------------------ remembering what a location offered (4.4)
  {
    const A = 'aa'.repeat(32) + '/' + 'dd'.repeat(16), B = 'bb'.repeat(32) + '/' + 'dd'.repeat(16);
    const id = (n: string) => H(bytesOf(n));
    const mine = [{ chain: A, seq: 5, record_id: id('a5') }, { chain: B, seq: 2, record_id: id('b2') }];
    const offer = (chain: string, ...seqs: [number, string][]) => ({ chain, records: seqs.map(([seq, n]) => ({ seq, record_id: id(n) })) });
    const full = [offer(A, [4, 'a4'], [5, 'a5']), offer(B, [1, 'b1'], [2, 'b2'])];
    const r = (name: string, desc: string, offered: J[], expected: J, covered?: J[]) =>
      o.add(`remember/${name}`, desc, 'remember.check', { remembered: mine, offered, ...(covered ? { covered } : {}) }, expected);
    r('same-state', 'A location offers exactly what the device accepted from it: nothing to report.', full, { rolled_back: [] });
    r('offers-more', 'A location that offers more (a new record at seq 6) is not a rollback.', [offer(A, [5, 'a5'], [6, 'a6']), offer(B, [2, 'b2'])], { rolled_back: [] });
    r('offers-less', 'A location whose newest record of chain A is seq 4 while the device accepted seq 5 from it: rolled back, not treated as current.', [offer(A, [3, 'a3'], [4, 'a4']), offer(B, [2, 'b2'])],
      { rolled_back: [{ chain: A, reason: 'less', remembered: 5, offered: 4 }] });
    r('offers-nothing-of-a-chain', 'A location that no longer offers chain B at all.', [offer(A, [5, 'a5'])], { rolled_back: [{ chain: B, reason: 'less', remembered: 2, offered: null }] });
    r('different-record-at-accepted-seq', 'A location offers a different record at seq 5 of chain A than the one the device accepted.', [offer(A, [5, 'other']), offer(B, [2, 'b2'])],
      { rolled_back: [{ chain: A, reason: 'different', remembered: 5, offered: 5 }] });
    r('different-and-same', 'A location that has both the accepted record and another at seq 5 is showing a fork, not a rollback.', [offer(A, [5, 'a5'], [5, 'other']), offer(B, [2, 'b2'])], { rolled_back: [] });
    r('less-but-covered-by-a-checkpoint', 'A location dropped chain A\'s records up to seq 5, which a complete accepted checkpoint covers: not reported (the specification does not say; see findings).', [offer(B, [2, 'b2'])],
      { rolled_back: [] }, [{ chain: A, seq: 5 }]);
    r('two-chains-one-rolled-back', 'One chain fine, the other behind: only the second is reported.', [offer(A, [5, 'a5']), offer(B, [1, 'b1'])], { rolled_back: [{ chain: B, reason: 'less', remembered: 2, offered: 1 }] });
  }

  // ------------------------------------------------------------------ replacing a secret (6.4)
  { // by the person, with a cut
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const b1 = s.item('bob', 'b1', I, [['n', 1]]);
    const b2 = s.item('bob', 'b1', I, [['n', 2]]);
    const rep = s.replace('bob', 'b1', 'bob', 'bob2', 1, { cut: [[s.device('b1'), 1]] });
    const bobOldInCut = s.item('bob', 'b2', I, [['n', 6]], [], { mhead: addBob.id, epoch: 0 });
    const bobOldAfter = s.item('bob', 'b1', I, [['n', 666]], [], { mhead: addBob.id, epoch: 0, clock: [BASE_MS + 100000, 0] });
    const bob2 = s.item('bob2', 'n1', I, [['m', 2]]);
    const labels = { g, addBob, b1, b2, rep, bobOldInCut, bobOldAfter, bob2 };
    const v = groupVector(o, 'replace-secret-by-the-person-with-cut', 'Bob replaces his own secret (signed with the old key; kind 4 starts epoch 1 and is sealed under K_1) with a cut listing (b1, seq 1). The new pid takes bob\'s role. His b1 seq 1 is accepted, his b1 seq 2 and everything beyond the cut with the old key is ignored, and the new pid\'s record is accepted.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', b1: 'accepted', b2: 'ignored:beyond_cut', rep: 'chain', bobOldInCut: 'ignored:beyond_cut', bobOldAfter: 'ignored:beyond_cut', bob2: 'accepted' },
      { i1: { deleted: false, fields: { n: 1, m: 2 } } }, NAMES);
    assert.equal(v.expected.roles[H(s.person('bob2').pid)], 2); assert.equal(v.expected.roles[H(s.person('bob').pid)], 0);
    o.add('membership/replace-sealed-under-new-key-unreadable-with-old-key', 'The replace record opened with K_0 only: it is sealed under K_1, so it waits for a key.', 'record.open',
      { keys: s.keyList().filter((k) => k.epoch === 0), sealed: H(rep.sealed) }, E('no_key', 'wait'));
  }
  { // rules
    const s = new Scenario();
    const g = s.genesis(); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const bad1 = keep(s, () => s.replace('alice', 'a1', 'bob', 'carol', 1));
    const bad2 = keep(s, () => s.replace('carol', 'c1', 'bob', 'bob2', 1));
    const bad3 = keep(s, () => s.replace('alice', 'a1', 'dave', 'bob2', 1));
    const ok = s.replace('alice', 'a1', 'bob', 'bob2', 1);
    const labels = { g, addBob, addCarol, bad1, bad2, bad3, ok };
    const v = groupVector(o, 'replace-secret-rules', 'A replacement naming a pid that is already a member, one written by someone who is neither a manager nor the person, and one for a pid that is not a member are ignored; a manager\'s replacement is valid.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', addCarol: 'chain', bad1: 'ignored:new_pid_is_member', bad2: 'ignored:author_not_manager_or_the_person', bad3: 'ignored:not_a_member', ok: 'chain' });
  }

  // ------------------------------------------------------------------ checkpoints end to end (5.3)
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
    const full = { g, addBob, x1, x2, x3, addCarol, x4, b1, cp, after };
    const fv = groupVector(o, 'checkpoint-full-history', 'Alice\'s items, a checkpoint by manager bob that restates the winning writes and covers alice\'s chain up to seq 5 and his own first record, then later records. All records present: covered content is folded as well, and the state is the one the records alone give.', s, full);
    const finalState = { i1: { deleted: false, fields: { title: 'two', url: 'u', note: 'later' } }, i2: { deleted: false, fields: { t: 1 } } };
    expectGroup(fv, full, { g: 'chain', addBob: 'chain', x1: 'accepted', x2: 'accepted', x3: 'accepted', addCarol: 'chain', x4: 'accepted', b1: 'accepted', cp: 'checkpoint:accepted', after: 'accepted' }, finalState, NAMES);
    const deleted = { g, addBob, addCarol, x4, b1, cp, after };
    const dv = groupVector(o, 'checkpoint-covered-records-deleted', 'The same group after the covered content records (alice seq 3 to 5) were deleted from storage. Alice\'s membership record at seq 6 is accepted only because the checkpoint covers the gap, and the state is the same.', s, deleted);
    expectGroup(dv, deleted, { g: 'chain', addBob: 'chain', addCarol: 'chain', x4: 'accepted', b1: 'accepted', cp: 'checkpoint:accepted', after: 'accepted' }, finalState, NAMES);
    assert.deepEqual(dv.expected.complete_checkpoint_sets, [idOf(cp)]);
    // a checkpoint written by a writer is ignored and covers nothing
    const bogus = at(s, addCarol.id, 0, () => s.checkpoint('carol', 'c2', [], [['alice', 'a1', x3]]));
    const nl = { g, addBob, addCarol, x1, x2, x3, x4, bogus };
    const nm = groupVector(o, 'checkpoint-by-non-manager', 'A checkpoint written by a writer (not a manager) is ignored and covers nothing.', s, nl);
    expectGroup(nm, nl, { g: 'chain', addBob: 'chain', addCarol: 'chain', x1: 'accepted', x2: 'accepted', x3: 'accepted', x4: 'accepted', bogus: 'checkpoint:ignored' });
    assert.deepEqual(nm.expected.covered, {});
  }
  { // history carried by a checkpoint survives deletion of the covered records; a write left out is forgotten
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const h1 = s.item('alice', 'a1', I, [['password', 'one']]); const h2 = s.item('alice', 'a1', I, [['password', 'two']]); const h3 = s.item('alice', 'a1', I, [['password', 'three']]);
    const items = checkpointItems(fold([h1, h2, h3].map((r) => ({ key5: r.key5, payload: r.payload }))), 1); // winner and one earlier write
    const cp = at(s, addBob.id, 0, () => s.checkpoint('bob', 'b1', items, [['alice', 'a1', h3]]));
    const h4 = s.item('alice', 'a1', I, [['url', 'u']], [], { mhead: addBob.id });
    const withRecords = groupVector(o, 'checkpoint-history-records-present', 'Three passwords written in turn, then a checkpoint that carries the winner and one earlier write (history 1), then another record. With the records present the field\'s history is all earlier writes.', s, { g, addBob, h1, h2, h3, cp, h4 });
    expectGroup(withRecords, { g, addBob, h1, h2, h3, cp, h4 }, { g: 'chain', addBob: 'chain', h1: 'accepted', h2: 'accepted', h3: 'accepted', cp: 'checkpoint:accepted', h4: 'accepted' }, { i1: { deleted: false, fields: { password: 'three', url: 'u' } } }, NAMES);
    assert.deepEqual(historyView(withRecords.expected.state, H(I), 'password'), ['one', 'two']);
    const labels = { g, addBob, cp, h4 };
    const gone = groupVector(o, 'checkpoint-history-survives-deletion-of-covered-records', 'The same group after the three covered records were deleted. The checkpoint carried the winning write and one earlier one, so Previous Passwords still holds "two"; the write it left out ("one") is forgotten.', s, labels);
    expectGroup(gone, labels, { g: 'chain', addBob: 'chain', cp: 'checkpoint:accepted', h4: 'accepted' }, { i1: { deleted: false, fields: { password: 'three', url: 'u' } } }, NAMES);
    assert.deepEqual(historyView(gone.expected.state, H(I), 'password'), ['two']);
  }
  { // a checkpoint in three parts, in every order, and with a part missing
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
    const [A, B, C] = [itemId('a'), itemId('b'), itemId('c')];
    const w1 = s.item('alice', 'a1', A, [['title', 'A1']]); const w2 = s.item('alice', 'a1', B, [['title', 'B1']]); const w3 = s.item('alice', 'a1', C, [['title', 'C1']]);
    const w4 = s.item('alice', 'a1', A, [['url', 'ua']]);
    const sec1 = s.item('bob', 'b1', itemId('secret'), [['password', 'first']], [], { mhead: addBob.id }); const sec2 = s.item('bob', 'b1', itemId('secret'), [['password', 'second']], [], { mhead: addBob.id });
    const w5 = s.item('alice', 'a1', A, [['note', 'after the covered range']], [], { mhead: addBob.id });
    const part = (n: number, include: Rec[], covered: [string, string, Rec][], purged: [Uint8Array, Rec['key5']][]) =>
      at(s, addBob.id, 0, () => s.checkpoint('bob', 'b2', checkpointItems(fold(include.map((r) => ({ key5: r.key5, payload: r.payload })))), covered, purged, { set: { id: bytesOf('set one', 16), part: n, parts: 3 } }));
    const p0 = part(0, [w1], [['alice', 'a1', w4]], [[itemId('secret'), sec1.key5]]);
    const p1 = part(1, [w2], [], []);
    const p2 = part(2, [w3, w4], [], []);
    const names = itemNames(['a', A], ['b', B], ['c', C], ['secret', itemId('secret')]);
    const present = { g, addBob, sec1, sec2, w5, p0, p1, p2 };
    const completeFields = { a: { deleted: false, fields: { title: 'A1', url: 'ua', note: 'after the covered range' } }, b: { deleted: false, fields: { title: 'B1' } }, c: { deleted: false, fields: { title: 'C1' } },
                             secret: { deleted: false, fields: { password: 'second' } } };
    const orders: [string, (xs: Rec[]) => Rec[]][] = [['1', (xs) => xs], ['2', (xs) => [...xs].reverse()], ['3', (xs) => [xs[7]!, xs[3]!, xs[5]!, xs[0]!, xs[6]!, xs[2]!, xs[4]!, xs[1]!]]];
    let first: J | undefined;
    for (const [n, ord] of orders) {
      const v = groupVector(o, `checkpoint-three-parts-order-${n}`, 'One checkpoint in three records (parts 0, 1, 2 of one set), all present, records listed in another order each time. Alice\'s records at seq 3 to 6 (covered by part 0) were deleted from storage, so her seq 7 follows the covered range; `covered` and `purged` take effect because the set is complete: seq 7 is accepted and the first of bob\'s two writes of the secret is forgotten.', s, present, {}, [], ord);
      if (first) assert.deepEqual(v.expected, first.expected, 'every order gives one result'); else first = v;
      expectGroup(v, present, { g: 'chain', addBob: 'chain', sec1: 'accepted', sec2: 'accepted', w5: 'accepted', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', p2: 'checkpoint:accepted' }, completeFields, names);
    }
    assert.deepEqual(first!.expected.complete_checkpoint_sets, [idOf(p0)]);
    assert.deepEqual(historyView(first!.expected.state, H(itemId('secret')), 'password'), []);
    for (const [missing, label] of [[p2, 'part-2-missing'], [p1, 'part-1-missing'], [p0, 'part-0-missing']] as const) {
      const labels = Object.fromEntries(Object.entries(present).filter(([, r]) => r !== missing)) as Labels;
      const v = groupVector(o, `checkpoint-three-parts-${label}`, `The same records with ${label.replace('-missing', '')} of the set absent. The three parts are consecutive records of bob's device b2, so a part that follows the missing one also waits (gap) and its writes are not folded. The writes of an accepted part fold at once; \`covered\` and \`purged\` take effect only when every part is accepted, so alice's seq 7 waits for the missing seq 3 to 6 and the first secret write is not forgotten.`, s, labels);
      assert.deepEqual(v.expected.complete_checkpoint_sets, []);
      assert.deepEqual(v.expected.covered, {});
      // By hand: part 0 carries a's title and the covered range and the purge; part 1 carries b; part 2 carries c's title and a's url. Writes of the parts present fold; nothing else takes effect.
      const table = (ps: string[]) => ({ g: 'chain', addBob: 'chain', sec1: 'accepted', sec2: 'accepted', w5: 'waits:gap', ...Object.fromEntries(ps.map((x) => [x, 'checkpoint:accepted'])) });
      const sec = { secret: { deleted: false, fields: { password: 'second' } } };
      if (label === 'part-2-missing') expectGroup(v, labels, table(['p0', 'p1']), { a: { deleted: false, fields: { title: 'A1' } }, b: { deleted: false, fields: { title: 'B1' } }, ...sec }, names);
      if (label === 'part-1-missing') expectGroup(v, labels, { ...table(['p0']), p2: 'waits:gap' }, { a: { deleted: false, fields: { title: 'A1' } }, ...sec }, names);
      if (label === 'part-0-missing') expectGroup(v, labels, { ...table([]), p1: 'waits:gap', p2: 'waits:gap' }, { ...sec }, names);
      assert.deepEqual(historyView(v.expected.state, H(itemId('secret')), 'password'), ['first']);
    }
  }
  { // which records make a set (5.3, draft 4): the parts have one author, one device and one `parts`, and no part appears twice
    const mk = () => {
      const s = new Scenario();
      const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 3, { card: true });
      const [A, B, C] = [itemId('a'), itemId('b'), itemId('c')];
      const w1 = s.item('alice', 'a1', A, [['title', 'A1']]); const w2 = s.item('alice', 'a1', B, [['title', 'B1']]); const w3 = s.item('alice', 'a1', C, [['title', 'C1']]);
      const w5 = s.item('alice', 'a1', A, [['note', 'after the covered range']]); // alice a1 seq 6: follows the range 3..5 that part 0 covers
      const names = itemNames(['a', A], ['b', B], ['c', C]);
      const setId = bytesOf('set two', 16);
      const part = (by: string, dev: string, n: number, parts: number, items: Rec[], covered: [string, string, Rec][] = [], sid = setId) =>
        s.checkpoint(by, dev, checkpointItems(fold(items.map((r) => ({ key5: r.key5, payload: r.payload })))), covered, [], { set: { id: sid, part: n, parts }, mhead: addBob.id });
      return { s, g, addBob, w3, w5, names, part, w1, w2 };
    };
    const whole = { a: { deleted: false, fields: { title: 'A1', note: 'after the covered range' } }, b: { deleted: false, fields: { title: 'B1' } }, c: { deleted: false, fields: { title: 'C1' } } };
    const folded = { a: { deleted: false, fields: { title: 'A1' } }, b: { deleted: false, fields: { title: 'B1' } }, c: { deleted: false, fields: { title: 'C1' } } };
    const NOT = 'The writes of each accepted part fold at once, but `covered` takes effect only for a complete set, so alice\'s seq 6 (whose predecessors were deleted from storage and are covered only by part 0) waits for the gap.';
    { // control: author, device and parts agree
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('bob', 'b1', 1, 2, [w2, w3]);
      const labels = { g, addBob, p0, p1, w5 };
      const v = groupVector(o, 'checkpoint-set-two-parts-same-author-device-parts', 'A set of two parts by one author on one device with parts 2 on both: complete. Part 0 covers alice\'s chain up to seq 5, whose records are not held, so her seq 6 is accepted.', s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', w5: 'accepted' }, whole, names);
      assert.deepEqual(v.expected.complete_checkpoint_sets, [idOf(p0)]);
    }
    { // another author
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('alice', 'a2', 1, 2, [w2, w3]);
      const labels = { g, addBob, p0, p1, w5 };
      const v = groupVector(o, 'checkpoint-set-parts-by-different-authors', `Part 0 is written by bob and part 1, with the same set_id and parts, by alice. Records that share a set_id and differ in author belong to no set. ${NOT}`, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', w5: 'waits:gap' }, folded, names);
      assert.deepEqual(v.expected.complete_checkpoint_sets, []); assert.deepEqual(v.expected.covered, {});
    }
    { // another device
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('bob', 'b2', 1, 2, [w2, w3]);
      const labels = { g, addBob, p0, p1, w5 };
      const v = groupVector(o, 'checkpoint-set-parts-on-different-devices', `Part 0 is written by bob's device b1 and part 1, with the same set_id, author and parts, by his device b2. Records that share a set_id and differ in device belong to no set. ${NOT}`, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', w5: 'waits:gap' }, folded, names);
      assert.deepEqual(v.expected.complete_checkpoint_sets, []);
    }
    { // a stray record with another `parts`
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('bob', 'b1', 1, 2, [w2, w3]); const stray = part('bob', 'b1', 2, 3, []);
      const labels = { g, addBob, p0, p1, stray, w5 };
      const v = groupVector(o, 'checkpoint-set-with-a-record-that-has-another-parts', 'Parts 0 and 1 of a set of two, and a third record with the same set_id, author and device that says parts 3. Parts 0 and 1 would make a complete set; the third differs in `parts`, so the records that share the set_id belong to no set. ' + NOT, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', stray: 'checkpoint:accepted', w5: 'waits:gap' }, folded, names);
      assert.deepEqual(v.expected.complete_checkpoint_sets, []);
    }
    { // two different part-1 records
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('bob', 'b1', 1, 2, [w2, w3]); const p1b = part('bob', 'b1', 1, 2, [w2]);
      assert.notEqual(H(p1.id), H(p1b.id));
      const labels = { g, addBob, p0, p1, p1b, w5 };
      const v = groupVector(o, 'checkpoint-set-with-two-different-part-1-records', 'Part 0 and two different records that both say part 1 of the same set, by the same author on the same device. Two different records with the same part belong to no set. ' + NOT, s, labels);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', p1b: 'checkpoint:accepted', w5: 'waits:gap' }, folded, names);
      assert.deepEqual(v.expected.complete_checkpoint_sets, []);
    }
    { // the same part-1 record delivered twice is one record, and a different set is another set
      const { s, g, addBob, w3, w5, names, part, w1, w2 } = mk();
      const p0 = part('bob', 'b1', 0, 2, [w1], [['alice', 'a1', w3]]); const p1 = part('bob', 'b1', 1, 2, [w2, w3]);
      const labels = { g, addBob, p0, p1, p1again: p1, w5 };
      const v = groupVector(o, 'checkpoint-set-part-delivered-twice', 'The same part-1 record delivered twice is one record (the same bytes), so the set is still complete.', s, labels);
      assert.deepEqual(v.expected.complete_checkpoint_sets, [idOf(p0)]);
      expectGroup(v, labels, { g: 'chain', addBob: 'chain', p0: 'checkpoint:accepted', p1: 'checkpoint:accepted', p1again: 'checkpoint:accepted', w5: 'accepted' }, whole, names);
    }
  }
  { // purge request (5.4)
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true }); const addCarol = s.setRole('alice', 'a1', 'carol', 1, { card: true });
    const sec = itemId('secret');
    const s1 = s.item('bob', 'b1', sec, [['password', 'first']]); const s2 = s.item('bob', 'b1', sec, [['password', 'second']]);
    const other = s.item('bob', 'b1', I, [['title', 'kept']]);
    const req = s.purge('bob', 'b1', [sec]);
    const names = itemNames(['secret', sec], ['i1', I]);
    const hidden = { g, addBob, addCarol, s1, s2, other, req };
    const v1 = groupVector(o, 'purge-request-hides-at-once', 'Bob is a writer, not a manager. His purge request (kind 33) names the secret item: every reader hides it at once, though nothing has been removed yet. The other item is untouched.', s, hidden);
    expectGroup(v1, hidden, { g: 'chain', addBob: 'chain', addCarol: 'chain', s1: 'accepted', s2: 'accepted', other: 'accepted', req: 'accepted' }, { i1: { deleted: false, fields: { title: 'kept' } } }, names);
    assert.deepEqual(v1.expected.hidden, [H(sec)]);
    assert.equal(v1.expected.purge_requests.length, 1);
    const cp = at(s, addBob.id, 0, () => s.checkpoint('alice', 'a1', [], [['bob', 'b1', req]], [[sec, s2.key5]], { mhead: addCarol.id }));
    const answered = { ...hidden, cp };
    const v2 = groupVector(o, 'purge-request-answered-by-a-managers-checkpoint', 'The manager\'s device answers with a checkpoint whose `purged` names the item up to its last write: the writes are forgotten and the request is answered, so nothing is hidden any more and the item is gone.', s, answered);
    expectGroup(v2, answered, { g: 'chain', addBob: 'chain', addCarol: 'chain', s1: 'accepted', s2: 'accepted', other: 'accepted', req: 'accepted', cp: 'checkpoint:accepted' }, { i1: { deleted: false, fields: { title: 'kept' } } }, names);
    assert.deepEqual(v2.expected.hidden, []);
    const t = new Scenario();
    const tg = t.genesis('a1'); const tBob = t.setRole('alice', 'a1', 'bob', 2, { card: true }); const tCarol = t.setRole('alice', 'a1', 'carol', 1, { card: true });
    const t1 = t.item('bob', 'b1', sec, [['password', 'first']]);
    const byReader = t.purge('carol', 'c1', [sec]);
    const rl = { tg, tBob, tCarol, t1, byReader };
    const v3 = groupVector(o, 'purge-request-by-a-reader-is-ignored', 'A purge request from a reader (not a writer) is ignored: nothing is hidden.', t, rl);
    expectGroup(v3, rl, { tg: 'chain', tBob: 'chain', tCarol: 'chain', t1: 'accepted', byReader: 'ignored:not_writer' }, { secret: { deleted: false, fields: { password: 'first' } } }, names);
    assert.deepEqual(v3.expected.hidden, []);
  }
  { // a purge request covers the writes up to its own place; a later write stays visible (5.4, draft 4)
    const s = new Scenario();
    const g = s.genesis('a1'); const addBob = s.setRole('alice', 'a1', 'bob', 2, { card: true });
    const sec = itemId('secret');
    const s1 = s.item('bob', 'b1', sec, [['password', 'first']]); const s2 = s.item('bob', 'b1', sec, [['title', 'Bank']]);
    const req = s.purge('bob', 'b1', [sec]);
    const s3 = s.item('bob', 'b1', sec, [['password', 'third']]);
    const other = s.item('alice', 'a1', I, [['title', 'kept']]);
    const labels = { g, addBob, s1, s2, req, s3, other };
    const v = groupVector(o, 'purge-request-then-a-later-write', 'Bob writes two fields of an item, asks for the item to be removed for good, and then writes the item again. The request covers the writes up to its own place in the order, which readers hide at once; the later write is after it, so it stays and the item reappears with only what was written since (5.4, draft 4). The request is not yet answered by a checkpoint, so it is still listed as hidden.', s, labels);
    expectGroup(v, labels, { g: 'chain', addBob: 'chain', s1: 'accepted', s2: 'accepted', req: 'accepted', s3: 'accepted', other: 'accepted' },
      { secret: { deleted: false, fields: { password: 'third' } }, i1: { deleted: false, fields: { title: 'kept' } } }, itemNames(['secret', sec], ['i1', I]));
    assert.deepEqual(v.expected.hidden, [H(sec)]);
    assert.deepEqual(historyView(v.expected.state, H(sec), 'password'), []);
    // the request's place decides, not the order of arrival: a write the device made before the request but delivered after it is hidden too
    const early = s.item('bob', 'b2', sec, [['note', 'written earlier']], [], { clock: [BASE_MS + 1, 0] });
    const lv = groupVector(o, 'purge-request-covers-a-write-delivered-later-that-is-earlier-in-the-order', 'A write with a time before the request (from another device of bob\'s, delivered after the request) is earlier than the request in the order, so the request covers it and it stays hidden; the write after the request still shows.', s, { ...labels, early });
    expectGroup(lv, { ...labels, early }, { g: 'chain', addBob: 'chain', s1: 'accepted', s2: 'accepted', req: 'accepted', s3: 'accepted', other: 'accepted', early: 'accepted' },
      { secret: { deleted: false, fields: { password: 'third' } }, i1: { deleted: false, fields: { title: 'kept' } } }, itemNames(['secret', sec], ['i1', I]));
  }
  { // purged and overlapping checkpoints
    const t = new Scenario();
    const tg = t.genesis('a1'); const tBob = t.setRole('alice', 'a1', 'bob', 3, { card: true }); const tCarol = t.setRole('alice', 'a1', 'carol', 3, { card: true });
    const p1 = t.item('alice', 'a1', itemId('secret'), [['password', 'old password']], [], { mhead: tCarol.id });
    const p2 = t.item('alice', 'a1', itemId('secret'), [['password', 'newer password']], [], { mhead: tCarol.id });
    const p3 = t.item('alice', 'a1', itemId('secret'), [['password', 'newest password']], [], { mhead: tCarol.id });
    const cpPurge = at(t, tCarol.id, 0, () => t.checkpoint('bob', 'b1', [], [['alice', 'a1', p3]], [[itemId('secret'), p2.key5]]));
    const pl = { tg, tBob, tCarol, p1, p2, p3, cpPurge };
    const pv = groupVector(o, 'checkpoint-purged', 'A manager\'s checkpoint names the item and the place of the second write in `purged`: the first two writes of its password are forgotten (no history), the third survives. A reader that still holds the records forgets them too.', t, pl);
    expectGroup(pv, pl, { tg: 'chain', tBob: 'chain', tCarol: 'chain', p1: 'accepted', p2: 'accepted', p3: 'accepted', cpPurge: 'checkpoint:accepted' }, { secret: { deleted: false, fields: { password: 'newest password' } } }, itemNames(['secret', itemId('secret')]));
    assert.deepEqual(historyView(pv.expected.state, H(itemId('secret')), 'password'), []);
    // two overlapping checkpoints, in both input orders
    const q1 = t.item('alice', 'a2', itemId('over'), [['a', 1]], [], { mhead: tCarol.id });
    const q2 = t.item('alice', 'a2', itemId('over'), [['b', 2]], [], { mhead: tCarol.id });
    const q3 = t.item('alice', 'a2', itemId('over'), [['a', 3]], ['b'], { mhead: tCarol.id });
    const itemsA = checkpointItems(fold([q1, q2].map((r) => ({ key5: r.key5, payload: r.payload }))));
    const itemsB = checkpointItems(fold([q2, q3].map((r) => ({ key5: r.key5, payload: r.payload }))));
    const cpA = at(t, tCarol.id, 0, () => t.checkpoint('bob', 'b2', itemsA, [['alice', 'a2', q2]]));
    const cpB = at(t, tCarol.id, 0, () => t.checkpoint('carol', 'c2', itemsB, [['alice', 'a2', q3]], [], { mhead: tCarol.id }));
    const base = { tg, tBob, tCarol, q1, q2, q3 };
    const ord1 = groupVector(o, 'checkpoint-overlapping-order-1', 'Two checkpoints by two managers overlap: the first covers alice\'s chain up to q2, the second up to q3 (q2 is in both). Records listed with the first checkpoint first.', t, { ...base, cpA, cpB });
    const ord2 = groupVector(o, 'checkpoint-overlapping-order-2', 'The same records listed with the second checkpoint first (and in reverse): the same result.', t, { ...base, cpA, cpB }, {}, [], (xs) => [...xs].reverse());
    const olt = { tg, tBob, tCarol, q1, q2, q3, cpA, cpB };
    const overlapTable = { tg: 'chain', tBob: 'chain', tCarol: 'chain', q1: 'accepted', q2: 'accepted', q3: 'accepted', cpA: 'checkpoint:accepted', cpB: 'checkpoint:accepted' };
    const overlapState = { over: { deleted: false, fields: { a: 3, b: CLEARED } } };
    expectGroup(ord1, olt, overlapTable, overlapState, itemNames(['over', itemId('over')])); expectGroup(ord2, olt, overlapTable, overlapState, itemNames(['over', itemId('over')]));
    assert.deepEqual(ord1.expected.state, ord2.expected.state);
    assert.deepEqual(ord1.expected.checkpoints, [idOf(cpA), idOf(cpB)].sort());
    assert.deepEqual(ord2.expected.checkpoints, ord1.expected.checkpoints);
    assert.deepEqual(stateView(ord1.expected.state, itemNames(['over', itemId('over')], ['secret', itemId('secret')])).over, { deleted: false, fields: { a: 3, b: CLEARED } });
  }
  return file('Chains, membership, the fork rule, cuts, content records and checkpoints end to end (sections 4.4, 5, 6, 9).', o);
}
