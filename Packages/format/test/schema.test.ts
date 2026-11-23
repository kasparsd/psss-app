// Property tests of the item schema with a seeded generator (the same seed gives the same cases on every run), and checks of the
// module's own contracts that the vectors do not state as vectors. The vectors are in vectors/schema.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHex } from '../src/bytes.ts';
import { cmap, decode, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { compareKeys } from '../src/record.ts';
import { checkpointItems, checkpointWritesOf, fold, isDeleted, type Change, type State } from '../src/fold.ts';
import * as S from '../src/schema.ts';
import { limits } from '../src/limits.ts';
import { viewJson, settingsJson } from './compute-schema.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)]!,
           shuffle: <T>(xs: T[]) => { const a2 = [...xs]; for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j]!, a2[i]!]; } return a2; } };
}
type R = ReturnType<typeof rng>;

const ITEM = new Uint8Array(16).fill(1);
const AUTHORS = ['aa', 'bb'].map((h) => fromHex(h.repeat(32)));
const DEVICES = ['11', '22', '33'].map((h) => fromHex(h.repeat(16)));
const id = (n: number) => n.toString(16).padStart(16, '0');
const bytes = (h: string) => fromHex(h);

interface Options { distinctPasswords?: boolean; noClears?: boolean; created?: boolean; hiddenAtOwnPlace?: boolean }

/** A random list of schema-level changes of one item: every field of the schema, some of the wrong shape, some unknown. A few distinct wall times
 *  and counters, so that ties and the order key's tie-breakers are exercised. */
function randomChanges(r: R, n: number, o: Options = {}): Change[] {
  const out: Change[] = [];
  const seq = new Map<string, number>();
  let pwCounter = 0;
  for (let i = 0; i < n; i++) {
    const a = r.int(AUTHORS.length), d = r.int(DEVICES.length);
    const k = `${a}/${d}`;
    const s = (seq.get(k) ?? 0) + 1;
    seq.set(k, s);
    const key: [number, number, Uint8Array, Uint8Array, number] = [1000 + 100 * r.int(8), r.int(3), AUTHORS[a]!, DEVICES[d]!, s];
    const c = new S.ItemChange();
    const pos = () => r.pick(['a', 'b', 'c', 'ai', 'i']);
    const ops = 1 + r.int(3);
    for (let j = 0; j < ops; j++) {
      switch (r.int(24)) {
        case 0: c.title(r.pick(['T1', 'T2', 'T3'])); break;
        case 1: c.notes(r.pick(['n1', 'n2'])); break;
        case 2: c.username(r.pick(['u1', 'u2'])); break;
        case 3: case 4: case 5: {
          const v = o.distinctPasswords ? `p${pwCounter++}` : r.pick(['p1', 'p2', 'p3']);
          // a device names a write it saw (or none); an older writer names nothing at all
          const how = r.int(4);
          if (how === 0) c.raw('password', v);
          else c.password(v, how === 1 || out.length === 0 ? null : out[r.int(out.length)]!.key5);
          break;
        }
        case 6: if (!o.noClears) c.remove('password'); break;
        case 7: case 8: c.website(id(1 + r.int(3)), r.pick(['a.example', 'b.example']), pos()); break;
        case 9: c.customField(id(1 + r.int(3)), r.pick(['L1', 'L2']), r.pick(['V1', 'V2']), r.int(2) === 0, pos()); break;
        case 10: c.tag(id(1 + r.int(4)), r.pick(['red', 'blue'])); break;
        case 11: if (!o.noClears) c.remove(`t/${id(1 + r.int(4))}`); break;
        case 12: if (!o.noClears) c.remove(`web/${id(1 + r.int(3))}`); break;
        case 13: c.deleted(r.int(5000)); break;
        case 14: if (!o.noClears) c.remove('deleted'); break;
        case 15: c.moved(bytes('52'.repeat(32)), r.int(5000)); break;
        case 16: if (!o.noClears) c.remove('moved'); break;
        case 17: if (o.hiddenAtOwnPlace) c.historyHidden(key); else c.historyHidden([1000 + 100 * r.int(8), r.int(3), AUTHORS[r.int(AUTHORS.length)]!, DEVICES[r.int(DEVICES.length)]!, 1 + r.int(4)]); break;
        case 18: c.passwordHistory(r.pick([[['h1', 5]], [['h2', 6], ['h1', 5]], []])); break;
        case 19: c.edited(r.int(5000)); break;
        case 20: c.source({ kind: 'k', id: 'i', baseline: bytes('0b') }); break;
        case 21: c.raw(r.pick(['colour', `z/${id(1)}`]), r.pick(['x', 'y'])); break;
        case 22: c.raw(r.pick(['title', 'notes', `web/${id(1)}`, 'otp']), r.pick([5, 'bad'])); break;
        case 23: c.type(1 + r.int(4) as 1 | 2 | 3 | 4); break;
      }
    }
    if (o.created && i === 0) c.created(500);
    out.push({ key5: key, payload: S.changePayload(ITEM, c.set, [...c.clear]) });
  }
  return out;
}

const fieldsOf = (st: State) => st.get(Buffer.from(ITEM).toString('hex')) ?? new Map();
const viewOf = (st: State) => viewJson(S.viewItem(fieldsOf(st)));

test('any permutation of a set of schema-level changes, with duplicates, gives the same view (40 seeds x 8 shuffles)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const changes = randomChanges(r, 5 + r.int(30));
    const base = viewOf(fold(changes));
    for (let k = 0; k < 8; k++) {
      assert.deepEqual(viewOf(fold(r.shuffle(k % 2 ? [...changes, ...r.shuffle(changes)] : changes))), base, `seed ${seed} shuffle ${k}`);
    }
  }
});

test('the same for the settings item (name and gone entries)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const zero = new Uint8Array(16);
    const changes: Change[] = [];
    const seq = new Map<number, number>();
    for (let i = 0; i < 12; i++) {
      const d = r.int(DEVICES.length), s = (seq.get(d) ?? 0) + 1;
      seq.set(d, s);
      const c = new S.ItemChange();
      switch (r.int(5)) {
        case 0: c.groupName(r.pick(['Family', 'Home'])); break;
        case 1: c.gone('kdbx', r.pick(['a', 'b']), r.int(100)); break;
        case 2: c.remove(`gone/${S.goneId('kdbx', r.pick(['a', 'b']))}`); break;
        case 3: c.rawAnyName(r.pick(['colour', 'title']), 'x'); break;
        default: c.rawAnyName('name', 5);
      }
      changes.push({ key5: [1000 + 100 * r.int(5), r.int(2), AUTHORS[0]!, DEVICES[d]!, s], payload: S.changePayload(zero, c.set, [...c.clear]) });
    }
    const show = (cs: Change[]) => settingsJson(S.viewSettings(fold(cs).get('00'.repeat(16)) ?? new Map()));
    const base = show(changes);
    for (let k = 0; k < 6; k++) assert.deepEqual(show(r.shuffle(changes)), base, `seed ${seed}`);
  }
});

/** A view without the given keys. */
const without = (v: Record<string, any>, ...keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));

/** Two views are the same, except that a previous password the checkpoint view dates may be dated later: a write that arrives after the
 *  checkpoint and lands inside a run of equal passwords replaces an entry, and the writes of that run the checkpoint left out are gone. */
function sameView(via: Record<string, any>, full: Record<string, any>, msg: string, ...except: string[]) {
  const strip = (v: Record<string, any>) => without({ ...v, previous: (v.previous ?? []).map((p: any) => ({ value: p.value, from: p.from })) }, ...except);
  assert.deepEqual(strip(via), strip(full), msg);
  const fp = full.previous ?? [], vp = via.previous ?? [];
  for (let i = 0; i < fp.length; i++) assert(vp[i].replaced >= fp[i].replaced, `${msg}: an entry is dated later, never earlier`);
}

/** A checkpoint of the prefix, through its encoding, folded with the rest. */
function viaCheckpoint(prefix: Change[], rest: Change[]): State {
  const cp = checkpointItems(fold(prefix));
  const parsed = checkpointWritesOf(cmap([[1, new Uint8Array(0)], [5, decode(encode(cp)) as CborValue], [6, []]]));
  return fold(rest, [parsed]);
}

test('a checkpoint at any point plus the remaining records gives the same view, previous passwords and the note included; the exceptions are Added (and so Edited) without created, and the date of an entry when a late write lands in a run of equal passwords (60 seeds)', () => {
  let withNote = 0;
  for (let seed = 300; seed < 360; seed++) {
    const r = rng(seed);
    const changes = randomChanges(r, 8 + r.int(30), { created: seed % 2 === 0, hiddenAtOwnPlace: true });
    const shuffled = r.shuffle(changes);
    const cut = r.int(shuffled.length + 1);
    const full = S.viewItem(fieldsOf(fold(changes)));
    const via = S.viewItem(fieldsOf(viaCheckpoint(shuffled.slice(0, cut), shuffled.slice(cut))));
    const a = viewJson(full), b = viewJson(via);
    if (a.password_note) withNote++;
    const hasCreated = full.carry.has('created') && S.shapeOk('created', full.carry.get('created')!);
    if (hasCreated) sameView(b, a, `seed ${seed}`);
    else {
      // only the winner of every field but password is kept: without created the earliest write may be gone, so Added can only get later
      assert((b.added ?? Infinity) >= (a.added ?? -Infinity), `seed ${seed}: Added from a checkpoint is never earlier`);
      sameView(b, a, `seed ${seed}`, 'added', 'added_estimated', 'edited', 'edited_raw');
    }
  }
  assert(withNote > 0, 'the generator must produce the note sometimes');
});

test('when the records after the checkpoint come later in the order, the view is exactly the full one, whatever the writes (60 seeds)', () => {
  for (let seed = 900; seed < 960; seed++) {
    const r = rng(seed);
    const changes = randomChanges(r, 8 + r.int(30), { created: true });
    const sorted = [...changes].sort((x, y) => compareKeys(x.key5, y.key5));
    const cut = r.int(sorted.length + 1);
    assert.deepEqual(viewOf(viaCheckpoint(sorted.slice(0, cut), sorted.slice(cut))), viewOf(fold(changes)), `seed ${seed}`);
  }
});

test('history_hidden can move back: a later write of it with an earlier place shows writes the checkpoint left out (the one case no retention can cover)', () => {
  const key = (i: number): Change['key5'] => [1000 * i, 0, AUTHORS[0]!, DEVICES[0]!, i];
  const pw = (i: number, v: string, over: number | null): Change => ({ key5: key(i), payload: S.changePayload(ITEM, new S.ItemChange().password(v, over === null ? null : key(over)).set, []) });
  const hide = (i: number, at: number): Change => ({ key5: key(i), payload: S.changePayload(ITEM, new S.ItemChange().historyHidden(key(at)).set, []) });
  const writes = [pw(1, 'p1', null), pw(2, 'p2', 1), pw(3, 'p3', 2), hide(4, 3)]; // cleared at the write of p3
  const moveBack = hide(5, 2); // a device that had seen only p2 cleared later by the clock
  const full = viewOf(fold([...writes, moveBack]));
  const via = viewOf(viaCheckpoint(writes, [moveBack]));
  assert.deepEqual(full.previous.map((p: any) => p.value), ['p2']);
  assert.deepEqual(via.previous, [], 'the checkpoint no longer holds p2 and p1');
});

test('a late write inside a run of equal passwords dates its entry by the next write the checkpoint kept, which can be later than in the full fold', () => {
  const key = (i: number): Change['key5'] => [1000 * i, 0, AUTHORS[0]!, DEVICES[0]!, i];
  const w = (i: number, v: string, over: number | null): Change => ({ key5: key(i), payload: S.changePayload(ITEM, new S.ItemChange().password(v, over === null ? null : key(over)).set, []) });
  const run = [w(1, 'p3', null), w(2, 'p3', 1), w(3, 'p3', 2), w(5, 'p3', 3)];
  const late = w(4, 'p2', 3); // arrives after the checkpoint, ordered before the last write of the run
  const full = viewOf(fold([...run, late]));
  const via = viewOf(viaCheckpoint(run, [late]));
  assert.deepEqual(full.previous, [{ value: 'p2', replaced: 5000, from: 'writes' }]);
  assert.deepEqual(via.previous, [{ value: 'p2', replaced: 5000, from: 'writes' }], 'here the next write was kept');
  const run2 = [w(1, 'p3', null), w(2, 'p3', 1), w(3, 'p3', 2), w(6, 'p3', 3)];
  const late2 = w(4, 'p2', 3);
  const f2 = viewOf(fold([...run2, w(5, 'p3', 4), late2])), v2 = viewOf(viaCheckpoint([...run2, w(5, 'p3', 4)], [late2]));
  assert.equal(f2.previous[0].replaced, 5000);
  assert(v2.previous[0].replaced >= f2.previous[0].replaced);
});

test('the same with a checkpoint taken on top of another checkpoint (40 seeds)', () => {
  for (let seed = 700; seed < 740; seed++) {
    const r = rng(seed);
    const changes = randomChanges(r, 10 + r.int(30), { created: true, hiddenAtOwnPlace: true });
    const full = viewOf(fold(changes));
    const sh = r.shuffle(changes);
    const c1 = r.int(sh.length + 1), c2 = c1 + r.int(sh.length - c1 + 1);
    const parse = (cp: CborValue[]) => checkpointWritesOf(cmap([[1, new Uint8Array(0)], [5, decode(encode(cp)) as CborValue], [6, []]]));
    const w1 = parse(checkpointItems(fold(sh.slice(0, c1))));
    const mid = fold(sh.slice(c1, c2), [w1]);
    const w2 = parse(checkpointItems(mid));
    sameView(viewOf(fold(sh.slice(c2), [w2])), full, `seed ${seed}`);
  }
});

test('previous passwords and the note are the same through any checkpoint, whatever the writes: cleared, equal neighbours, repeated values, imported history (80 seeds)', () => {
  for (let seed = 400; seed < 480; seed++) {
    const r = rng(seed);
    const pws: Change[] = [];
    for (let i = 0; i < 4 + r.int(40); i++) {
      const c = new S.ItemChange();
      if (r.int(7) === 0) c.remove('password'); else c.password(`p${r.int(seed % 2 ? 4 : 25)}`, i === 0 || r.int(3) === 0 ? null : pws[r.int(pws.length)]!.key5);
      pws.push({ key5: [1000 + i, 0, AUTHORS[0]!, DEVICES[0]!, i + 1], payload: S.changePayload(ITEM, c.set, [...c.clear]) });
    }
    const hist: Change = { key5: [900, 0, AUTHORS[0]!, DEVICES[0]!, 0], payload: S.changePayload(ITEM, new S.ItemChange().passwordHistory([['h2', 2], ['h1', 1]]).set, []) };
    const all = [hist, ...pws];
    const cut = r.int(all.length + 1);
    const full = viewJson(S.viewItem(fieldsOf(fold(all)))), via = viewJson(S.viewItem(fieldsOf(viaCheckpoint(all.slice(0, cut), all.slice(cut)))));
    sameView({ previous: via.previous }, { previous: full.previous }, `seed ${seed}`);
    assert.equal(via.password_note, full.password_note, `seed ${seed} note`);
  }
});

test('with ten entries that each need two writes the checkpoint keeps twenty writes of password and still shows the same ten (no exception)', () => {
  const key = (i: number): Change['key5'] => [1000 + i, 0, AUTHORS[0]!, DEVICES[0]!, i + 1];
  // 30 writes, each value written twice in a row
  const ws: Change[] = Array.from({ length: 30 }, (_, i) => ({ key5: key(i), payload: S.changePayload(ITEM, new S.ItemChange().password(`p${i >> 1}`, i === 0 ? null : key(i - 1)).set, []) }));
  const full = viewJson(S.viewItem(fieldsOf(fold(ws))));
  const via = viewJson(S.viewItem(fieldsOf(viaCheckpoint(ws, []))));
  assert.equal(full.previous.length, 10);
  assert.deepEqual(via.previous, full.previous);
  const kept = (checkpointItems(fold(ws)) as [Uint8Array, CMap][])[0]![1].get('password') as CborValue[];
  assert(kept.length <= 2 + 2 * limits.historyKept, `${kept.length} writes kept`);
});

test('the schema retention keeps the writes the Previous Passwords list and the note need, and the winner of every other field; a number still means that many of every field', () => {
  const r = rng(77);
  const changes = randomChanges(r, 60, { distinctPasswords: true });
  const items = checkpointItems(fold(changes));
  for (const [, fields] of items as [Uint8Array, CMap][]) {
    for (const [name, ws] of fields) assert((ws as CborValue[]).length <= (name === 'password' ? 2 + 2 * limits.historyKept : 1), `${name}`);
  }
  const numeric = checkpointItems(fold(changes), 3);
  for (const [, fields] of numeric as [Uint8Array, CMap][]) for (const [, ws] of fields) assert((ws as CborValue[]).length <= 4);
  const custom = checkpointItems(fold(changes), (_item, _name, writes) => writes);
  const total = (x: CborValue[]) => (x as [Uint8Array, CMap][]).reduce((n, [, f]) => n + [...f.values()].reduce((m, ws) => m + (ws as CborValue[]).length, 0), 0);
  assert(total(custom) > total(items), 'a caller-supplied policy is used');
});

test('positions: always between, always valid, also after many insertions at one place (60 seeds)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    let lo: string | null = r.int(3) === 0 ? null : S.positionAtEnd([]);
    let hi: string | null = lo === null ? null : S.positionBetween(lo, null);
    for (let k = 0; k < 120; k++) {
      const p = S.positionBetween(lo, hi);
      assert(S.validPosition(p), p);
      assert((lo === null || lo < p) && (hi === null || p < hi), `${lo} < ${p} < ${hi}`);
      if (r.int(2) === 0) hi = p; else lo = p;
    }
  }
  const list: string[] = [];
  for (let k = 0; k < 300; k++) { const p = S.positionAtEnd(list); assert(list.every((x) => x < p)); list.push(p); }
  assert(list.every((p) => S.validPosition(p)));
});

test('every builder produces a value the reader accepts, and the payload decodes back to the same writes', () => {
  const c = new S.ItemChange()
    .type(1).title('t').username('u').password('p').passwordRules('r')
    .otp({ secret: bytes('01'), digits: 6, period: 30, algorithm: 2, issuer: 'i', account: 'a' })
    .passkey({ credentialId: bytes('01'), privateKey: bytes('02'), relyingParty: 'rp', userName: 'n', userHandle: bytes('03'), created: 5 })
    .cardholder('h').card({ number: '4111', year: 2030, month: 1 }).cardCode('1').cardPin('2').notes('n').created(1).edited(2)
    .source({ kind: 'k', id: 'i', baseline: bytes('0b') }).passwordHistory([['a', 1]]).historyHidden([1, 0, AUTHORS[0]!, DEVICES[0]!, 1]).moved(bytes('52'.repeat(32)), 3).movedFrom(bytes('51'.repeat(32)), 2).deleted(4)
    .website(id(1), 'example.com', 'a').customField(id(2), 'l', 'v', false, 'a')
    .attachment(id(3), 'f', cmap([[1, bytes('0a'.repeat(32))], [2, 1], [3, []]]), 'a', 1).tag(id(4), 'x');
  for (const [name, value] of c.set) {
    assert(S.shapeOk(name, value), name);
    const k = S.classifyName(name);
    assert(k.kind !== 'invalid' && k.known, name);
  }
  assert.equal(c.set.size, 25);
  const round = decode(encode(c.payload(ITEM))) as CMap;
  assert.deepEqual([...(round.get(2) as CMap).keys()].sort(), [...c.set.keys()].sort());
  const v = S.viewItem(fold([{ key5: [1, 0, AUTHORS[0]!, DEVICES[0]!, 1], payload: round }]).get('01'.repeat(16))!);
  assert.deepEqual(v.invalid, []);
  assert.equal(v.websites[0]!.address, 'https://example.com');
});

test('a move keeps the item as it is shown, dates and source included; previous passwords and history_hidden stay behind (100 seeds, those not already moved)', () => {
  let checked = 0;
  const G1 = bytes('51'.repeat(32)), G2 = bytes('52'.repeat(32));
  for (let seed = 500; seed < 600; seed++) {
    const r = rng(seed);
    const changes = randomChanges(r, 6 + r.int(20), { created: seed % 2 === 0 });
    const view = S.viewItem(fieldsOf(fold(changes)));
    if (view.moved) continue;
    const m = S.moveRecords(view, G1, G2, 50_000);
    assert(!m.target.clear.some((n) => m.target.set.has(n)), 'a field is never both set and cleared');
    assert(!m.target.set.has('password_history') && !m.target.set.has('history_hidden'));
    const t: Change = { key5: [50_000, 0, AUTHORS[0]!, DEVICES[0]!, 99], payload: S.changePayload(ITEM, m.target.set, m.target.clear) };
    const a = viewJson(view), b = viewJson(S.viewItem(fieldsOf(fold([t]))));
    const skip = ['previous', 'moved', 'moved_from', 'password_note', 'added_estimated', 'carried'];
    assert.deepEqual(without(b, ...skip), without(a, ...skip), `seed ${seed}`);
    assert.deepEqual(b.moved_from, { gid: '51'.repeat(32), when: 50_000 });
    assert.equal(b.moved, undefined, 'moved is cleared');
    assert.equal(b.password_note, undefined, 'no note on arrival');
    assert.deepEqual(b.previous, [], 'previous passwords stay behind');
    checked++;
  }
  assert(checked > 20, `only ${checked} items were movable`);
});

test('a move carries Added, Edited and source, and moving back clears what the other copy has and the item no longer does', () => {
  const key = (wall: number): Change['key5'] => [wall, 0, AUTHORS[0]!, DEVICES[0]!, wall];
  const ch = (wall: number, f: (c: S.ItemChange) => void): Change => { const c = new S.ItemChange(); f(c); return { key5: key(wall), payload: S.changePayload(ITEM, c.set, [...c.clear]) }; };
  const view = S.viewItem(fieldsOf(fold([ch(1000, (c) => c.title('x').source({ kind: 'k', id: 'i', baseline: bytes('0b') })), ch(2000, (c) => c.notes('n'))])));
  assert.equal(view.added, 1000); assert.equal(view.edited, 2000);
  const m = S.moveRecords(view, bytes('51'.repeat(32)), bytes('52'.repeat(32)), 50_000);
  assert.equal(m.target.set.get('created'), 1000); assert.equal(m.target.set.get('edited'), 2000);
  assert(m.target.set.has('source'));
  const arrived = S.viewItem(fieldsOf(fold([{ key5: key(50_000), payload: S.changePayload(ITEM, m.target.set, m.target.clear) }])));
  assert.equal(arrived.added, 1000); assert.equal(arrived.edited, 2000);
  // the item comes back to a group that still holds an older copy with a field the item has lost
  const older = fieldsOf(fold([ch(100, (c) => c.title('old').username('gone'))]));
  const back = S.moveRecords(view, bytes('52'.repeat(32)), bytes('51'.repeat(32)), 60_000, { target: older });
  assert(back.target.clear.includes('username'));
  assert(!back.target.set.has('username'));
});

test('the delete rule reads only content fields: the default predicate, and one passed in', () => {
  const key = (wall: number): Change['key5'] => [wall, 0, AUTHORS[0]!, DEVICES[0]!, wall];
  const mk = (wall: number, f: (c: S.ItemChange) => void): Change => { const c = new S.ItemChange(); f(c); return { key5: key(wall), payload: S.changePayload(ITEM, c.set, [...c.clear]) }; };
  const st = fold([mk(1, (c) => c.title('x').deleted(5)), mk(10, (c) => c.raw('colour', 'x')), mk(11, (c) => c.created(1).edited(9))]);
  assert.equal(S.viewItem(fieldsOf(st)).deleted, true, 'an unknown field and dates do not bring it back');
  const st2 = fold([mk(1, (c) => c.title('x').deleted(5)), mk(10, (c) => c.notes('later'))]);
  assert.equal(S.viewItem(fieldsOf(st2)).deleted, false, 'a content field does');
  const f = fieldsOf(st);
  assert.equal(isDeleted(f, () => true), false, 'a predicate that counts every field brings it back');
  assert.equal(isDeleted(f), true);
});

test('a text of the schema limit is refused only by a writer, and a reader shows what it finds', () => {
  assert.throws(() => new S.ItemChange().title('a'.repeat(limits.textBytes + 1)), (e: any) => e.code === 'text_too_long');
  const c = new S.ItemChange().raw('title', 'a'.repeat(limits.textBytes + 1));
  const v = S.viewItem(fold([{ key5: [1, 0, AUTHORS[0]!, DEVICES[0]!, 1], payload: S.changePayload(ITEM, c.set, []) }]).get('01'.repeat(16))!);
  assert.equal(v.title!.length, limits.textBytes + 1);
});
