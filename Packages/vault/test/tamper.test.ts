import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { frame } from '../../format/src/folder.ts';
import { derivePerson } from '../../format/src/keys.ts';
import { openVault, seededRandom, type Problem, type Vault } from '../src/index.ts';
import { Insider, copyDir, newVault, read, write, type Env } from './helpers.ts';

/** A vault with five items: records 1 and 2 are genesis and the group name, 3 to 7 the items. */
function populated(t: Parameters<typeof newVault>[0], seed = 'tamper'): { e: Env; ins: Insider; chain: string; file: (seq: number) => string } {
  const e = newVault(t, {}, seed);
  for (let i = 1; i <= 5; i++) { e.clock.tick(); e.vault.addItem({ title: `Item ${i}`, password: `p${i}` }); }
  const ins = new Insider(e.location, e.keyFile);
  const chain = ins.chainDirs()[0]!;
  return { e, ins, chain, file: (seq) => ins.path(chain, `${String(seq).padStart(10, '0')}-${String(seq).padStart(10, '0')}.seg`.replace(/\.seg$/, seq <= 1 ? '.mseg' : '.seg')) };
}
const reopen = (e: Env, extra: string[] = []): Vault =>
  openVault({ locations: [e.location, ...extra], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, now: e.clock.now, random: seededRandom('tamper-open') });
const codes = (ps: Problem[]) => ps.map((p) => p.code).sort();

test('(d) a clean vault verifies, and says what it checked', (t) => {
  const { e } = populated(t);
  const report = reopen(e).verify();
  assert.equal(report.ok, true, `a vault nobody touched has no problems: ${JSON.stringify(report.problems)}`);
  assert.equal(report.checked, 7, 'seven records were checked: genesis, the group name and five items');
  assert.deepEqual(report.locations.map((l) => [l.state, l.records, l.problems]), [['vault', 7, 0]], 'per location: its state, its records, its problems');
});

test('(d) a flipped bit in a record is reported, and the records after it wait', (t) => {
  const { e, file } = populated(t);
  const path = file(4);
  const bytes = read(path);
  bytes[4 + 100] ^= 0x01; // one bit inside the ciphertext of the frame
  write(path, bytes);
  const v = reopen(e);
  const report = v.verify();
  assert.equal(report.ok, false, 'one flipped bit makes verify fail');
  const flipped = report.problems.find((p) => p.code === 'bad_tag');
  assert.ok(flipped, `the record whose tag fails is named: ${JSON.stringify(report.problems)}`);
  assert.equal(flipped!.location, e.location, 'with the location');
  assert.match(flipped!.detail, /0000000004-0000000004\.seg/, 'and the file');
  assert.ok(report.problems.some((p) => p.code === 'gap' && /record 4 missing/.test(p.detail)), 'the later records of that chain wait for it, which is a gap');
  assert.deepEqual(v.list().map((i) => i.title), ['Item 1'], 'only what the chain reaches is shown; nothing past the damage is trusted');
  assert.equal(report.problems.some((p) => p.code === 'rolled_back'), false, 'the newest record is still there, so it is not a rollback: the remembered heads do not see damage in the middle of a chain');
});

test('(d) every flipped byte of the header, the body or the tag is caught by one of the checks of section 9', (t) => {
  const { e, file } = populated(t, 'flip');
  const original = read(file(5));
  const seen = new Set<string>();
  for (const offset of [4, 4 + 3, 4 + 10, 4 + 36, 4 + 40, 4 + 71, 4 + 72, 4 + 200, original.length - 1]) {
    const bytes = original.slice();
    bytes[offset] ^= 0x80;
    write(file(5), bytes);
    const report = reopen(e).verify();
    assert.equal(report.ok, false, `a flipped bit at byte ${offset} of the frame must be reported`);
    for (const p of report.problems) seen.add(p.code);
  }
  write(file(5), original);
  assert.ok(seen.has('bad_tag'), `bit flips in the salt and the ciphertext fail the tag; seen: ${[...seen].join(', ')}`);
  assert.ok(seen.has('bad_magic') || seen.has('no_key'), 'a flip in the magic or the group id is reported too');
  assert.equal(reopen(e).verify().ok, true, 'restoring the file restores a clean verify');
});

test('(d) a dropped record in the middle of a chain is reported as a gap', (t) => {
  const { e, file } = populated(t);
  rmSync(file(5));
  const v = reopen(e);
  const report = v.verify();
  const gap = report.problems.filter((p) => p.code === 'gap');
  assert.equal(gap.length, 1, `one gap in one chain is one problem: ${JSON.stringify(report.problems)}`);
  assert.match(gap[0]!.detail, /record 5 missing, so record 6 and later wait/, 'the report says which record is missing');
  assert.equal(report.ok, false, 'verify fails');
  assert.deepEqual(v.list().map((i) => i.title), ['Item 1', 'Item 2'], 'the items before the gap are shown, the ones after wait');
  assert.equal(v.info().locations[0]!.status, 'upToDate', 'a location cannot know a record is missing: it holds all it holds');
});

test('(d) two records swapped are reported: two files swapped, and two frames out of order in one file', (t) => {
  {
    const { e, file } = populated(t, 'swap-files');
    const a = read(file(4)), b = read(file(5));
    write(file(4), b); write(file(5), a);
    const report = reopen(e).verify();
    const swapped = report.problems.filter((p) => p.code === 'swapped_record');
    assert.equal(swapped.length, 2, `both files are named for records they do not hold: ${JSON.stringify(report.problems)}`);
    assert.equal(report.ok, false, 'verify fails on swapped files even though every record is still there');
  }
  {
    const { e, file } = populated(t, 'swap-frames');
    const four = read(file(4)).slice(4), five = read(file(5)).slice(4);
    rmSync(file(4)); rmSync(file(5));
    writeFileSync(join(e.location, 'groups', new Insider(e.location, e.keyFile).gidHex, 'log', new Insider(e.location, e.keyFile).chainDirs()[0]!, '0000000004-0000000005.seg'), Buffer.concat([frame(five), frame(four)]));
    const report = reopen(e).verify();
    assert.ok(report.problems.some((p) => p.code === 'swapped_record' && /out of sequence/.test(p.detail)), `frames out of order in a file are reported: ${JSON.stringify(report.problems)}`);
    assert.ok(report.problems.some((p) => p.code === 'gap'), 'and the record that was read out of place leaves a gap');
  }
});

test('(d) a record sealed by someone the membership chain does not allow is reported and never shown', (t) => {
  const { e, ins } = populated(t);
  const stranger = derivePerson(seededRandom('stranger')(32));
  const device = seededRandom('stranger-device')(16);
  const sealed = ins.seal(stranger, device, 1, null, ins.itemPayload(seededRandom('evil-item')(16), 'Evil'), e.clock.now() + 1);
  ins.put(sealed, { author: stranger.pid, device, seq: 1 });
  const v = reopen(e);
  const report = v.verify();
  const p = report.problems.find((x) => x.code === 'unauthorized_author');
  assert.ok(p, `the record of a non-member is named: ${JSON.stringify(report.problems)}`);
  assert.equal(p!.location, e.location, 'with its location');
  assert.equal(v.list().some((i) => i.title === 'Evil'), false, 'and what it says is not shown');
  assert.equal(report.ok, false, 'verify fails');
  assert.equal(v.list().length, 5, 'the five real items are still there');
});

test('(d) a record that names a membership record nobody holds waits, and is reported (5, 9 step 3)', (t) => {
  const { e, ins } = populated(t);
  const device = seededRandom('d')(16);
  const bogusMhead = seededRandom('bogus')(32);
  const sealed = ins.seal(ins.person, device, 1, null, ins.itemPayload(seededRandom('i')(16), 'Orphan'), e.clock.now() + 1, bogusMhead);
  ins.put(sealed, { author: ins.person.pid, device, seq: 1 });
  const report = reopen(e).verify();
  assert.ok(report.problems.some((p) => p.code === 'waiting_for_membership'), `a record that names a membership record nobody holds waits and is reported: ${JSON.stringify(report.problems)}`);
});

test('(d) a location rolled back against the heads this device remembers is reported', (t) => {
  const { e } = populated(t);
  copyDir(e.location, join(e.dir, 'older-copy'));
  for (let i = 6; i <= 8; i++) { e.clock.tick(); e.vault.addItem({ title: `Item ${i}`, password: `p${i}` }); }
  assert.equal(e.vault.verify().ok, true, 'before the rollback all is well');
  rmSync(e.location, { recursive: true });
  copyDir(join(e.dir, 'older-copy'), e.location); // the sync service delivers last week's folder
  const v = reopen(e);
  const info = v.info();
  assert.equal(info.locations[0]!.status, 'behind', 'the location is behind');
  assert.match(info.locations[0]!.reason ?? '', /rolled back/, 'and says it was rolled back');
  const report = v.verify();
  const rolled = report.problems.filter((p) => p.code === 'rolled_back');
  assert.equal(rolled.length, 1, `exactly one chain went backwards: ${JSON.stringify(report.problems)}`);
  assert.match(rolled[0]!.detail, /accepted up to record 10, the location offers 7/, 'with the numbers');
  assert.equal(report.ok, false, 'verify fails');
  assert.equal(v.sync().rolledBack.length, 1, 'sync reports the rollback it found before it wrote anything');
});

test('(d) a location that lost its newest record is reported as rolled back, while the union of the locations has no gap', (t) => {
  const { e } = populated(t, 'two');
  const second = join(e.dir, 'Second.psss');
  const v = reopen(e, [second]);
  v.sync();
  e.clock.tick(); v.addItem({ title: 'Item 6' });
  const ins = new Insider(e.location, e.keyFile);
  rmSync(ins.path(ins.chainDirs()[0]!, '0000000008-0000000008.seg')); // the first location loses its newest record only
  const report = reopen(e, [second]).verify();
  assert.equal(report.problems.filter((p) => p.code === 'rolled_back').length, 1, 'the location that lost the record is reported');
  assert.equal(report.problems.find((p) => p.code === 'rolled_back')!.location, e.location, 'and it is the right one');
  assert.equal(report.problems.filter((p) => p.code === 'gap').length, 0, 'while the union of the locations has no gap');
});

test('(d) a fork of a device chain across two locations is reported and neither record is trusted', (t) => {
  const { e, ins, chain } = populated(t, 'fork');
  const second = join(e.dir, 'Second.psss');
  copyDir(e.location, second);
  const ins2 = new Insider(second, e.keyFile);
  // in the second location the record at seq 7 is replaced by another record of the same chain and seq: same author, device, seq and prev
  const original = ins.records().find((r) => r.seq === 7)!;
  rmSync(ins2.path(chain, '0000000007-0000000007.seg'));
  const forged = ins.seal(ins.person, original.device, 7, original.prev, ins.itemPayload(seededRandom('forged')(16), 'Forged'), e.clock.now() + 1, original.mhead!);
  ins2.put(forged, original);
  const v = reopen(e, [second]);
  const report = v.verify();
  const forks = report.problems.filter((p) => p.code === 'fork');
  assert.equal(forks.length, 2, `each of the two records is named, in its own location: ${JSON.stringify(report.problems)}`);
  assert.deepEqual(forks.map((p) => p.location).sort(), [e.location, second].sort(), 'one in each location');
  assert.deepEqual(v.list().map((i) => i.title), ['Item 1', 'Item 2', 'Item 3', 'Item 4'], 'records before the fork are accepted, neither of the two and nothing after (4.4)');
  assert.equal(v.list().some((i) => i.title === 'Forged'), false, 'the forged record is not shown');
});

test('(d) verify repairs nothing and does not change what the device remembers', (t) => {
  const { e, file } = populated(t, 'norepair');
  rmSync(file(5));
  const v = reopen(e);
  const before = JSON.stringify(readdirSync(e.location, { recursive: true }));
  const state = JSON.stringify(read(join(e.stateDir, 'state.json')));
  v.verify(); v.verify();
  assert.equal(JSON.stringify(readdirSync(e.location, { recursive: true })), before, 'the files of the location are exactly as they were');
  assert.equal(JSON.stringify(read(join(e.stateDir, 'state.json'))), state, 'the device state is untouched by verify');
});

// ---- vault.issues: what opening found, with a sentence for a person

const noInternals = (plain: string) => { assert.match(plain, /^[A-Z~].*\.$/, `one sentence: ${plain}`); assert.doesNotMatch(plain, /[0-9a-f]{8}/, `no ids in: ${plain}`); assert.doesNotMatch(plain, /chain /, `no internals in: ${plain}`); };
const supersetOfIssues = (v: Vault) => {
  const verified = new Set(v.verify().problems.map((p) => p.code));
  for (const i of v.issues) assert.ok(verified.has(i.code), `verify reports every code of an issue (${i.code})`);
};

test('(i) a clean vault opens with no issues', (t) => {
  const { e } = populated(t, 'issues-clean');
  assert.deepEqual(reopen(e).issues, []);
});

test('(i) a record changed after it was written is an issue, found by opening, and says so in plain words', (t) => {
  const { e, file } = populated(t, 'issues-tag');
  const bytes = read(file(4));
  bytes[4 + 100] ^= 0x01;
  write(file(4), bytes);
  const v = reopen(e);
  const bad = v.issues.filter((i) => i.code === 'bad_tag');
  assert.equal(bad.length, 1, JSON.stringify(v.issues));
  assert.equal(bad[0]!.location, e.location);
  assert.match(bad[0]!.detail, /0000000004-0000000004\.seg/, 'the technical detail keeps the file');
  assert.equal(bad[0]!.plain, `A record in ${e.location} was changed after it was written and is ignored.`);
  noInternals(bad[0]!.plain.replace(e.location, '<location>'));
  assert.ok(v.issues.some((i) => i.code === 'gap'), 'the records after it wait, which is a gap');
  supersetOfIssues(v);
});

test('(i) a gap in a chain is an issue', (t) => {
  const { e, file } = populated(t, 'issues-gap');
  rmSync(file(5));
  const v = reopen(e);
  const gap = v.issues.filter((i) => i.code === 'gap');
  assert.equal(gap.length, 1);
  assert.equal(gap[0]!.plain, `A record is missing from the middle of a device's history in ${e.location}. The ones after it wait for it.`);
  assert.match(gap[0]!.detail, /record 5 missing/);
  supersetOfIssues(v);
});

test('(i) records moved or swapped are issues', (t) => {
  const { e, file } = populated(t, 'issues-swap');
  const a = read(file(4)), b = read(file(5));
  write(file(4), b); write(file(5), a);
  const v = reopen(e);
  const swapped = v.issues.filter((i) => i.code === 'swapped_record');
  assert.equal(swapped.length, 2);
  assert.equal(swapped[0]!.plain, `A record in ${e.location} is stored under the wrong name or in the wrong place, so it was moved or swapped after it was written.`);
  supersetOfIssues(v);
});

test('(i) a fork is an issue in each location', (t) => {
  const { e, ins, chain } = populated(t, 'issues-fork');
  const second = join(e.dir, 'Second.psss');
  copyDir(e.location, second);
  const ins2 = new Insider(second, e.keyFile);
  const original = ins.records().find((r) => r.seq === 7)!;
  rmSync(ins2.path(chain, '0000000007-0000000007.seg'));
  ins2.put(ins.seal(ins.person, original.device, 7, original.prev, ins.itemPayload(seededRandom('forged')(16), 'Forged'), e.clock.now() + 1, original.mhead!), original);
  const v = reopen(e, [second]);
  const forks = v.issues.filter((i) => i.code === 'fork');
  assert.deepEqual(forks.map((i) => i.location).sort(), [e.location, second].sort());
  for (const f of forks) assert.equal(f.plain, `Two different records in ${f.location} claim the same place in one device's history, so neither is trusted.`);
  supersetOfIssues(v);
});

test('(i) a record of a non-member is an issue', (t) => {
  const { e, ins } = populated(t, 'issues-stranger');
  const stranger = derivePerson(seededRandom('stranger')(32));
  const device = seededRandom('stranger-device')(16);
  ins.put(ins.seal(stranger, device, 1, null, ins.itemPayload(seededRandom('evil-item')(16), 'Evil'), e.clock.now() + 1), { author: stranger.pid, device, seq: 1 });
  const v = reopen(e);
  const p = v.issues.find((i) => i.code === 'unauthorized_author');
  assert.ok(p, JSON.stringify(v.issues));
  assert.equal(p!.plain, `A record in ${e.location} was written by someone who is not allowed to write to this vault and is ignored.`);
  supersetOfIssues(v);
});

test('(i) a rollback against the remembered heads is an issue', (t) => {
  const { e } = populated(t, 'issues-rollback');
  copyDir(e.location, join(e.dir, 'older-copy'));
  for (let i = 6; i <= 8; i++) { e.clock.tick(); e.vault.addItem({ title: `Item ${i}` }); }
  rmSync(e.location, { recursive: true });
  copyDir(join(e.dir, 'older-copy'), e.location);
  const v = reopen(e);
  const r = v.issues.filter((i) => i.code === 'rolled_back');
  assert.equal(r.length, 1, JSON.stringify(v.issues));
  assert.equal(r[0]!.plain, `${e.location} is missing records this computer saw before. It may have been rolled back.`);
  assert.match(r[0]!.detail, /accepted up to record 10, the location offers 7/);
  supersetOfIssues(v);
});

test('(i) a location that is only unreachable is not an integrity issue, and a waiting key is not either', (t) => {
  const { e } = populated(t, 'issues-unreachable');
  const v = reopen(e, [join(e.dir, 'Nowhere.psss')]);
  assert.deepEqual(v.issues, []);
});
