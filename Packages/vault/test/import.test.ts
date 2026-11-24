// What a KeePass import must keep true when it is not alone and when it does not finish: the lock, the count of what was written, ids that
// repeat, what a report says and how it names things, and what an export hands back to KeePass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDatabase, newEntry, readKdbx, writeKdbx, type KdbxDatabase } from '../../kdbx/src/index.ts';
import { ImportInterrupted, lockPath, openVault, readKeepass, seededRandom, withLock } from '../src/index.ts';
import { base32Decode } from '../src/keepass.ts';
import { newVault } from './helpers.ts';

const NOW = 1_700_000_000_000;
const NODE_ARGS = ['--disable-warning=ExperimentalWarning'];
const here = (name: string) => new URL(name, import.meta.url).pathname;

function database(n: number, make: (i: number) => Parameters<typeof newEntry>[0] = (i) => ({ title: `Site ${i}`, username: `user${i}`, password: `pw-${i}` })): KdbxDatabase {
  const db = newDatabase({ name: 'src', now: new Date(NOW) });
  for (let i = 0; i < n; i++) db.root.entries.push(newEntry(make(i), { now: new Date(NOW) }));
  return db;
}
function listing(dir: string): string[] {
  if (!existsSync(dir)) return ['(absent)'];
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else out.push(`${p} ${s.size} ${s.mtimeMs}`); } };
  walk(dir);
  return out;
}
const run = (child: ReturnType<typeof spawn>) => new Promise<{ ok: boolean; added?: number; unchanged?: number; error?: string }>((resolve) => {
  let out = '';
  child.stdout!.on('data', (d) => { out += d; });
  child.on('close', () => resolve(JSON.parse(out.trim().split('\n').pop()!)));
});

// ---------------------------------------------------------------- the lock

test('two imports of one file at once add each entry once: the second finds the first one\'s items', async (t) => {
  const e = newVault(t, { durable: false }, 'two');
  const N = 60;
  const file = join(e.dir, 'src.kdbx');
  writeFileSync(file, writeKdbx(database(N), { password: 'pw' }, { version: '4.1' }));
  const go = join(e.dir, 'go');
  const children = [0, 1].map(() => spawn(process.execPath, [...NODE_ARGS, here('child-import.ts'), e.location, e.keyFile, e.stateDir, go, file], { stdio: ['ignore', 'pipe', 'inherit'] }));
  t.after(() => children.forEach((c) => c.kill()));
  const results = children.map(run);
  writeFileSync(go, '');
  const done = await Promise.all(results);
  assert.ok(done.every((r) => r.ok), JSON.stringify(done));
  assert.deepEqual(done.map((r) => r.added).sort((a, b) => a! - b!), [0, N], 'one of them added everything and the other found it all there');
  assert.deepEqual(done.map((r) => r.unchanged).sort((a, b) => a! - b!), [0, N]);
  const again = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, durable: false });
  assert.equal(again.list().length, N, 'the vault holds N items, not 2N');
  assert.equal(again.verify().ok, true, 'and still verifies');
});

test('a dry run takes no lock and writes nothing, even while another import holds the vault', async (t) => {
  const e = newVault(t, { durable: false }, 'dry');
  const db = database(5);
  const ro = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, readOnly: true, now: e.clock.now });
  const holder = spawn(process.execPath, [...NODE_ARGS, here('child-hold.ts'), e.stateDir, '1500'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => holder.kill());
  await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()));
  const before = [...listing(e.location), ...listing(e.stateDir)];
  const started = Date.now();
  const plan = ro.importKdbx(db, { dryRun: true });
  assert.ok(Date.now() - started < 1000, 'it did not wait for the lock');
  assert.equal(plan.added, 5);
  assert.deepEqual([...listing(e.location), ...listing(e.stateDir)].filter((l) => !l.endsWith('/lock') && !/lock /.test(l)), before.filter((l) => !/\/lock /.test(l)), 'no file of the vault or the device state changed');
});

test('a long import keeps its lock fresh, so that nobody takes it over while the import is still running', (t) => {
  const e = newVault(t, {}, 'beat'); // durable, so that 300 records take well over 0.4 s
  e.vault.lockOptions = { staleMs: 400 }; // the lock counts as abandoned after 0.4 s; the import beats every 0.1 s
  const db = database(300);
  const seen: string[] = [];
  const ages: number[] = [];
  e.vault.importKdbx(db, {
    progress: (done) => {
      if (done !== 250) return;
      // by now the import has run for much longer than 0.4 s, so its lock is only held because it was beaten. Read the lock here, in the importer's own
      // thread, where no child start-up can delay a beat: its age must be well under the 0.4 s the lock would count as abandoned after.
      const lock = JSON.parse(readFileSync(lockPath(e.stateDir), 'utf8')) as { time: number };
      ages.push(Date.now() - lock.time);
      // A second process must be refused while the holder is alive. Its clock is the lock's own time plus a millisecond: the check does not depend on how
      // long the child takes to start (it cannot be beaten while this thread waits for it), which made an earlier version of this test fail under load.
      const r = spawnSync(process.execPath, [...NODE_ARGS, '-e', `
        import('${here('../src/index.ts')}').then(({ withLock }) => {
          try { withLock(process.argv[1], () => console.log('took it'), { waitMs: 100, staleMs: 400, clock: () => Number(process.argv[2]) + 1 }); } catch (e) { console.log(e.code + ' ' + (e.what ?? '')); }
        });`, e.stateDir, String(lock.time)], { encoding: 'utf8' });
      seen.push(r.stdout.trim());
    },
  });
  assert.deepEqual(seen, ['state_locked import'], 'the other process was refused, and told that an import is running');
  assert.equal(ages.length, 1);
  assert.ok(ages[0]! < 400, `the lock was beaten: it was ${ages[0]} ms old after an import that ran for much longer than the 400 ms it would count as abandoned after`);
  assert.equal(e.vault.list().length, 300);
  assert.equal(existsSync(lockPath(e.stateDir)), false, 'and the lock is gone when the import is done');
  void withLock;
});

// ---------------------------------------------------------------- stopping part of the way

test('an import that fails after k records says how many were added, keeps them, and running it again finishes the job', (t) => {
  const e = newVault(t, { durable: false }, 'stop');
  const db = database(10);
  let error: unknown;
  try {
    e.vault.importKdbx(db, { progress: (done) => { if (done === 3) throw new Error('disk exploded'); } });
  } catch (x) { error = x; }
  assert.ok(error instanceof ImportInterrupted, 'a failure part of the way is an ImportInterrupted');
  assert.equal((error as ImportInterrupted).added, 3);
  assert.equal((error as ImportInterrupted).updated, 0);
  assert.equal(e.vault.list().length, 3, 'the three stay');
  assert.equal(e.vault.outbox().length, 0, 'and were delivered');
  e.clock.tick();
  const rest = e.vault.importKdbx(db);
  assert.equal(rest.added, 7);
  assert.equal(rest.unchanged, 3);
  assert.equal(e.vault.list().length, 10, 'no duplicates after running it again');
  assert.equal(e.vault.verify().ok, true);
  const again = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, durable: false });
  assert.equal(again.list().length, 10, 'and a fresh open sees the same');
});

// ---------------------------------------------------------------- entries that share a UUID

test('entries that share a UUID are separate items and none overwrites another, run after run', (t) => {
  const e = newVault(t, { durable: false }, 'dup');
  const db = newDatabase({ name: 'src', now: new Date(NOW) });
  const a = newEntry({ title: 'First', username: 'u1', password: 'p1' }, { now: new Date(NOW) });
  const b = newEntry({ title: 'Second', username: 'u2', password: 'p2' }, { now: new Date(NOW) });
  const c = newEntry({ title: 'Third', username: 'u3', password: 'p3' }, { now: new Date(NOW) });
  b.uuid = a.uuid; c.uuid = a.uuid;
  db.root.entries.push(a, b, c);
  const first = e.vault.importKdbx(db);
  assert.equal(first.added, 3, 'all three came in');
  assert.ok(first.issues.some((i) => i.kind === 'duplicateId' && i.item === 'Second'));
  assert.equal(first.issues.filter((i) => i.kind === 'duplicateId').length, 2);
  e.clock.tick();
  const pw = (t: string) => (e.vault.get(`psss://${t}/password`) as { value: string }).value;
  assert.deepEqual([pw('First'), pw('Second'), pw('Third')], ['p1', 'p2', 'p3']);
  for (let i = 0; i < 3; i++) {
    e.clock.tick();
    const again = e.vault.importKdbx(db, { update: true });
    assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 3], `run ${i + 2} changes nothing: they do not flip-flop`);
  }
  b.fields.find((f) => f.name === 'Password')!.value = 'p2-new';
  e.clock.tick();
  const upd = e.vault.importKdbx(db, { update: true });
  assert.equal(upd.updated, 1);
  assert.deepEqual([pw('First'), pw('Second'), pw('Third')], ['p1', 'p2-new', 'p3'], 'only the entry that changed is updated');
  // the same ids come from the same file whether or not the Recycle Bin is read
  assert.deepEqual(readKeepass(db, { now: NOW }).items.map((i) => i.uuid), readKeepass(db, { now: NOW, includeTrash: true }).items.map((i) => i.uuid));
});

// ---------------------------------------------------------------- what a report says

test('findings are grouped by kind and part of the item: a long title and long notes are two findings, each true', () => {
  const db = database(1, () => ({ title: 'T'.repeat(70_000), username: 'u', password: 'p', notes: 'N'.repeat(300_000) }));
  const r = readKeepass(db, { now: NOW });
  const long = r.issues.filter((i) => i.kind === 'tooLarge');
  assert.deepEqual(long.map((i) => i.field).sort(), ['The notes', 'The title']);
  const title = long.find((i) => i.field === 'The title')!, notes = long.find((i) => i.field === 'The notes')!;
  assert.match(title.detail, /^The title is longer than the 65,536 bytes/);
  assert.match(notes.detail, /^The notes are longer than the 262,144 bytes/, 'the notes are, not the notes is');
  assert.ok(!/notes/.test(title.detail) && !/title/.test(notes.detail), 'each sentence names only its own part');
  assert.equal(r.refusedFields, 2);
  assert.equal(r.invalidFields, 0, 'a size limit is not an invalid character: --strip-invalid would not help');
});

test('a field that is too large and a field with bad characters are counted apart', () => {
  const db = database(1, () => ({ title: 'T', username: 'u', password: 'p', fields: [{ name: 'Big', value: 'x'.repeat(70_000), protected: false }, { name: 'Odd', value: 'a\u0001b', protected: false }] }));
  const r = readKeepass(db, { now: NOW });
  assert.equal(r.refusedFields, 2);
  assert.equal(r.invalidFields, 1);
  const kinds = r.issues.map((i) => `${i.kind}/${i.field}`).sort();
  assert.deepEqual(kinds, ['invalidCharacters/A field', 'tooLarge/A field']);
  assert.ok(r.issues.every((i) => !/"(Big|Odd)"/.test(i.detail)), 'a sentence about "a field" does not name one field of several');
});

test('item names in a report are cut to 60 characters, whatever the title', () => {
  const db = database(1, () => ({ title: 'x'.repeat(70_000), username: 'u', password: 'p', fields: [{ name: 'Odd', value: 'a\u0001b', protected: false }] }));
  const r = readKeepass(db, { now: NOW });
  assert.ok(r.issues.length > 0 && r.issues.every((i) => i.item === undefined || [...i.item].length <= 60), 'every name is at most 60 characters');
});

test('the per-entry lines of an import report are cut to 60 characters too', (t) => {
  const e = newVault(t, { durable: false }, 'names2');
  const db = database(1, () => ({ title: 'y'.repeat(5_000), username: 'u', password: 'p' }));
  const r = e.vault.importKdbx(db);
  assert.equal(r.issues.length, 0);
  assert.ok(r.items.every((i) => [...i.title].length <= 60), 'the per-entry lines are cut too');
});

// ---------------------------------------------------------------- the round trip

test('an export imported into the same vault reads as nothing new, also for an item with a verification code whose label the export filled in', (t) => {
  const e = newVault(t, { durable: false }, 'roundtrip');
  e.vault.addItem({ title: 'Mail', username: 'ada@example.com', password: 'pw', url: 'https://mail.example.com',
    otp: { secret: base32Decode('JBSWY3DPEHPK3PXP')!, digits: 6, period: 30, algorithm: 1 } });
  e.clock.tick();
  e.vault.addItem({ title: 'Bank', username: 'ada', password: 'pw2', otp: { secret: base32Decode('JBSWY3DPEHPK3PXP')!, digits: 6, period: 30, algorithm: 1, issuer: 'The Bank', account: 'someone else' } });
  const out = e.vault.exportKdbx();
  const back = readKdbx(writeKdbx(out.db, { password: 'x' }, { version: '4.1' }), { password: 'x' });
  e.clock.tick();
  const r = e.vault.importKdbx(back);
  assert.deepEqual([r.added, r.updated, r.conflicts, r.changedInFile, r.keptYours, r.unchanged], [0, 0, 0, 0, 0, 2], 'nothing new, and no false "changed in both"');
  assert.equal(r.issues.filter((i) => i.kind === 'mergeConflict' || i.kind === 'changedInFile').length, 0);
});

test('an export keeps the UUID of the KeePass entry an item came from, and the item id for every other item', (t) => {
  const e = newVault(t, { durable: false }, 'uuids');
  const src = newDatabase({ name: 'src', now: new Date(NOW) });
  const x = newEntry({ title: 'FromFile', username: 'u', password: 'p' }, { now: new Date(NOW) });
  src.root.entries.push(x);
  e.vault.importKdbx(src);
  const own = e.vault.addItem({ title: 'MadeHere', password: 'q' });
  const out = e.vault.exportKdbx();
  const entries = out.db.root.groups.flatMap((g) => g.entries);
  const title = (en: typeof entries[number]) => en.fields.find((f) => f.name === 'Title')!.value;
  assert.equal(entries.find((en) => title(en) === 'FromFile')!.uuid, x.uuid, 'KeePassXC merge can pair this entry with the original database');
  assert.equal(entries.find((en) => title(en) === 'MadeHere')!.uuid, own.id, 'an item made here has its own id');
  // and it still finds its own item when read back
  const back = readKdbx(writeKdbx(out.db, { password: 'x' }, { version: '4.1' }), { password: 'x' });
  e.clock.tick();
  assert.equal(e.vault.importKdbx(back).added, 0);
});

test('two items from entries that shared a UUID export under different UUIDs', (t) => {
  const e = newVault(t, { durable: false }, 'uuids2');
  const db = newDatabase({ name: 'src', now: new Date(NOW) });
  const a = newEntry({ title: 'A', password: 'p' }, { now: new Date(NOW) });
  const b = newEntry({ title: 'B', password: 'p' }, { now: new Date(NOW) });
  b.uuid = a.uuid;
  db.root.entries.push(a, b);
  e.vault.importKdbx(db);
  const uuids = e.vault.exportKdbx().db.root.groups.flatMap((g) => g.entries).map((en) => en.uuid);
  assert.equal(new Set(uuids).size, 2, 'no two entries of the file share a UUID');
  void seededRandom;
});
