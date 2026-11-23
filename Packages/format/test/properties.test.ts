// Property-style tests with a seeded PRNG: the same seed gives the same cases on every run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concat, hex } from '../src/bytes.ts';
import { CborError, cmap, decode, encode, type CborValue } from '../src/cbor.ts';
import { applyChange, checkpointItems, fold, summarize, current } from '../src/fold.ts';
import { evaluateGroup } from '../src/group.ts';
import { openRecord, sortRecords } from '../src/record.ts';
import { kitFromText, kitToText } from '../src/slots.ts';
import { groupJson } from './compute.ts';
import { Scenario, itemId } from './scenario.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)]!,
           shuffle: <T>(xs: T[]) => { const a2 = [...xs]; for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j]!, a2[i]!]; } return a2; } };
}

function randomGroup(seed: number) {
  const r = rng(seed);
  const s = new Scenario();
  const recs = [s.genesis(), s.setRole('alice', 'a1', 'bob', 2, { card: true }), s.setRole('alice', 'a1', 'carol', 2, { card: true })];
  const items = [itemId('p1'), itemId('p2'), itemId('p3')];
  const fields = ['title', 'url', 'note', 'deleted', 'tags'];
  const authors: [string, string][] = [['alice', 'a1'], ['bob', 'b1'], ['bob', 'b2'], ['carol', 'c1']];
  for (let i = 0; i < 40; i++) {
    const [who, dev] = r.pick(authors);
    const set: [string, CborValue][] = [];
    const clear: string[] = [];
    for (const f of fields) {
      const x = r.int(5);
      if (x === 0) set.push([f, f === 'deleted' ? r.int(100) : `v${r.int(9)}`]);
      else if (x === 1) clear.push(f);
    }
    // few distinct wall_ms and counters, so that ties and the author/device tie-breakers are exercised
    recs.push(s.item(who, dev, r.pick(items), set, clear, { clock: [1000 + r.int(6), r.int(3)] }));
  }
  return { s, recs, r };
}

test('folding any permutation of a record set gives the same state (whole reader, 20 seeds x 12 shuffles)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { s, recs, r } = randomGroup(seed);
    const keys = s.keyList();
    const base = groupJson(s.gid, recs.map((x) => x.sealed), keys);
    for (let k = 0; k < 12; k++) {
      assert.deepEqual(groupJson(s.gid, r.shuffle(recs).map((x) => x.sealed), keys), base, `seed ${seed} shuffle ${k}`);
    }
    assert(Object.keys(base.state).length > 0);
  }
});

test('fold alone: permutations, duplicates, and applying a record twice change nothing', () => {
  for (let seed = 100; seed < 120; seed++) {
    const { recs, r } = randomGroup(seed);
    const changes = recs.filter((x) => x.kind === 16);
    const base = JSON.stringify(summarize(fold(changes)));
    assert.equal(JSON.stringify(summarize(fold(r.shuffle(changes)))), base);
    assert.equal(JSON.stringify(summarize(fold([...changes, ...r.shuffle(changes)]))), base, 'folding twice');
    const st = fold(changes);
    for (const c of changes) applyChange(st, c);
    assert.equal(JSON.stringify(summarize(st)), base, 'apply again');
  }
});

test('a checkpoint of any prefix plus the remaining records equals folding everything (current values)', () => {
  const strip = (st: ReturnType<typeof fold>) => JSON.stringify(Object.fromEntries([...st].sort().map(([id, fs]) =>
    [id, Object.fromEntries([...fs].sort().map(([n, l]) => [n, [current(l).cleared ? null : hex(encode(current(l).value)), current(l).key.map((x) => x instanceof Uint8Array ? hex(x) : x)]]))])));
  for (let seed = 200; seed < 220; seed++) {
    const { recs, r } = randomGroup(seed);
    const changes = recs.filter((x) => x.kind === 16);
    const cut = r.int(changes.length + 1);
    const shuffled = r.shuffle(changes);
    const before = shuffled.slice(0, cut), after = shuffled.slice(cut);
    const cp = checkpointItems(fold(before));
    // The checkpoint goes through its encoding, as it would on disk.
    const parsed = decode(encode(cp)) as CborValue[];
    assert.equal(strip(fold(after, [{ items: parsed, purged: [] }])), strip(fold(changes)), `seed ${seed}`);
  }
});

test('any single flipped bit of a sealed record is rejected', () => {
  const { s, recs } = randomGroup(7);
  const rec = recs[3]!;
  const ring = s.ring();
  assert.doesNotThrow(() => openRecord(rec.sealed, ring));
  let rejected = 0;
  for (let bit = 0; bit < rec.sealed.length * 8; bit++) {
    const c = rec.sealed.slice();
    c[bit >> 3]! ^= 1 << (bit & 7);
    assert.throws(() => openRecord(c, ring), `bit ${bit}`);
    rejected++;
  }
  assert.equal(rejected, rec.sealed.length * 8);
});

test('truncating or extending a sealed record is rejected', () => {
  const { s, recs } = randomGroup(8);
  const rec = recs[4]!;
  for (const n of [1, 16, 72, 88, rec.sealed.length - 1]) assert.throws(() => openRecord(rec.sealed.slice(0, n), s.ring()));
  assert.throws(() => openRecord(concat(rec.sealed, new Uint8Array(1)), s.ring()));
});

// ---- the strict decoder against non-deterministic encodings

function randomValue(r: ReturnType<typeof rng>, depth = 0): CborValue {
  const k = r.int(depth > 2 ? 5 : 8);
  switch (k) {
    case 0: return r.pick([0, 1, 23, 24, 255, 256, 65535, 65536, 2 ** 32 - 1, 2 ** 32, 2 ** 40, 2n ** 64n - 1n]);
    case 1: return Uint8Array.from({ length: r.int(30) }, () => r.int(256));
    case 2: return r.pick(['', 'a', 'IETF', 'é', 'x'.repeat(30), 'z'.repeat(300)]);
    case 3: return r.pick([true, false, null]);
    case 4: return r.int(1000);
    case 5: return Array.from({ length: r.int(5) }, () => randomValue(r, depth + 1));
    case 6: return cmap(Array.from({ length: r.int(5) }, () => [r.int(300), randomValue(r, depth + 1)] as [number, CborValue]));
    default: return cmap(Array.from({ length: r.int(5) }, () => [r.pick(['a', 'b', 'aa', 'B', 'key', 'é', 'zz']) + r.int(3), randomValue(r, depth + 1)] as [string, CborValue]));
  }
}

const headBytes = (major: number, n: bigint, widen: number): Uint8Array => {
  // widen > 0 forces a longer-than-necessary argument; returns a head with `size` argument bytes where possible
  const sizes = [0, 1, 2, 4, 8];
  const need = n < 24n ? 0 : n < 256n ? 1 : n < 65536n ? 2 : n < 4294967296n ? 4 : 8;
  let idx = sizes.indexOf(need) + widen;
  if (idx > 4) idx = 4;
  const size = sizes[idx]!;
  if (size === 0) return Uint8Array.of((major << 5) | Number(n));
  const out = new Uint8Array(1 + size);
  out[0] = (major << 5) | (24 + [1, 2, 4, 8].indexOf(size));
  let x = n;
  for (let i = size; i >= 1; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
};

/** An encoder that sometimes deviates from section 2. Returns the bytes and whether it deviated. */
function noisyEncode(v: CborValue, r: ReturnType<typeof rng>, rate: number): { bytes: Uint8Array; bad: boolean } {
  let bad = false;
  const widen = () => { if (r.next() < rate) { bad = true; return 1; } return 0; };
  const go = (x: CborValue): Uint8Array => {
    if (x === null) return Uint8Array.of(0xf6);
    if (typeof x === 'boolean') return Uint8Array.of(x ? 0xf5 : 0xf4);
    if (typeof x === 'number' || typeof x === 'bigint') { const w = widen(); const b = BigInt(x); return headBytes(0, b, w); }
    if (typeof x === 'string') { const t = new TextEncoder().encode(x); const w = widen(); return concat(headBytes(3, BigInt(t.length), w), t); }
    if (x instanceof Uint8Array) { const w = widen(); return concat(headBytes(2, BigInt(x.length), w), x); }
    if (Array.isArray(x)) { const w = widen(); return concat(headBytes(4, BigInt(x.length), w), ...x.map(go)); }
    const entries = [...x.entries()].map(([k, val]) => [go(k), go(val)] as const);
    entries.sort((p, q) => hex(p[0]) < hex(q[0]) ? -1 : 1);
    if (entries.length >= 2 && r.next() < rate) { bad = true; entries.reverse(); }
    const w = widen();
    return concat(headBytes(5, BigInt(entries.length), w), ...entries.flatMap(([k, val]) => [k, val]));
  };
  return { bytes: go(v), bad };
}

test('decoder: canonical encodings round trip; any deviation from section 2 is rejected', () => {
  const r = rng(42);
  let rejected = 0, accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const v = randomValue(r);
    const canon = encode(v);
    const back = decode(canon);
    assert.equal(hex(encode(back)), hex(canon));
    const { bytes, bad } = noisyEncode(v, r, 0.15);
    // Widening a head that cannot widen (an 8-byte argument) is not a deviation, and sorting the same hex order can tie only for
    // equal keys: so compare against the canonical form instead of trusting the flag alone.
    if (hex(bytes) === hex(canon)) { assert.doesNotThrow(() => decode(bytes)); accepted++; continue; }
    assert(bad, 'bytes differ from canonical but no deviation was recorded');
    assert.throws(() => decode(bytes), CborError);
    rejected++;
  }
  assert(rejected > 500 && accepted > 500, `rejected ${rejected}, accepted ${accepted}`);
});

test('decoder: random bytes either decode to a value that re-encodes identically, or throw CborError (nothing else)', () => {
  const r = rng(43);
  let ok = 0;
  for (let i = 0; i < 20000; i++) {
    const b = Uint8Array.from({ length: r.int(24) }, () => r.pick([0, 1, 0x18, 0x40, 0x61, 0x80, 0x81, 0xa0, 0xa1, 0xf4, 0xf6, 0xc0, 0xff, r.int(256)]));
    try { const v = decode(b); assert.equal(hex(encode(v)), hex(b)); ok++; }
    catch (e) { assert(e instanceof CborError, `${hex(b)}: ${(e as Error).message}`); }
  }
  assert(ok > 100);
});

test('recovery kit text round trips', () => {
  const r = rng(44);
  for (let i = 0; i < 200; i++) {
    const kit = Uint8Array.from({ length: 20 }, () => r.int(256));
    const t = kitToText(kit);
    assert.match(t, /^RK1-([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(hex(kitFromText(t)), hex(kit));
  }
});

test('the whole reader never throws on a random mix of valid records, with or without some of them', () => {
  const { s, recs, r } = randomGroup(9);
  for (let i = 0; i < 20; i++) {
    const subset = recs.filter(() => r.next() < 0.7);
    const opened = subset.map((x) => openRecord(x.sealed, s.ring()));
    assert.doesNotThrow(() => evaluateGroup(s.gid, sortRecords(opened)));
  }
});
