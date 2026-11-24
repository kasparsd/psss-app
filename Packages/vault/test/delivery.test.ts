// Delivery: what a write, an import and a sync leave in the outbox, and that the next write or import sends it first, as stored. Also the
// temporary files a killed writer leaves in the outbox folder, and the lock staying fresh while a long job runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hex } from '../../format/src/bytes.ts';
import { newDatabase, newEntry, type KdbxDatabase } from '../../kdbx/src/index.ts';
import { lockPath, openVault, seededRandom } from '../src/index.ts';
import { Insider, newVault } from './helpers.ts';

const NOW = 1_700_000_000_000;
const canBlock = process.getuid?.() !== 0; // as root a read-only folder does not stop a write
const reopen = (e: ReturnType<typeof newVault>) => openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, now: e.clock.now, random: seededRandom('reopen'), durable: false });
function database(n: number): KdbxDatabase {
  const db = newDatabase({ name: 'src', now: new Date(NOW) });
  for (let i = 0; i < n; i++) db.root.entries.push(newEntry({ title: `Site ${i}`, username: `user${i}`, password: `pw-${i}` }, { now: new Date(NOW) }));
  return db;
}
/** the folder this device's chain is written to in the vault: making it read-only makes every write to the location fail */
const chainFolder = (e: ReturnType<typeof newVault>) => { const i = new Insider(e.location, e.keyFile); return i.path(i.chainDirs()[0]!, '').replace(/\/$/, ''); };
const outboxNames = (e: ReturnType<typeof newVault>) => (existsSync(join(e.stateDir, 'outbox')) ? readdirSync(join(e.stateDir, 'outbox')).sort() : []);

test('a write to a location that refuses it is reported by delivery(); the next write sends the old records first, as stored, and leaves no gap', (t) => {
  if (!canBlock) return t.skip('running as root');
  const e = newVault(t, { durable: false });
  e.clock.tick(); e.vault.addItem({ title: 'Item', password: 'p0' });
  assert.deepEqual(e.vault.delivery(), { pending: 0, locations: [] }, 'nothing waits after a delivered write');
  const dir = chainFolder(e);
  chmodSync(dir, 0o500);
  t.after(() => { try { chmodSync(dir, 0o700); } catch { /* gone */ } });
  e.clock.tick(); const w1 = e.vault.setField('psss://Item/password', 'p1');
  e.clock.tick(); const w2 = e.vault.setField('psss://Item/password', 'p2');
  assert.equal(w1.inOutbox && w2.inOutbox, true);
  const d = e.vault.delivery();
  assert.equal(d.pending, 2, 'two records are kept on this device only');
  assert.deepEqual(d.locations.map((l) => l.location), [e.location], 'and the location that refused them is named');
  assert.match(d.locations[0]!.error, /EACCES|permission/i);
  const sealed = outboxNames(e).map((n) => readFileSync(join(e.stateDir, 'outbox', n)));
  assert.equal(sealed.length, 2);

  chmodSync(dir, 0o700);
  e.clock.tick(); const w3 = e.vault.setField('psss://Item/password', 'p3');
  assert.equal(w3.inOutbox, false);
  assert.deepEqual(e.vault.delivery(), { pending: 0, locations: [] }, 'the old records went first and the outbox is empty');
  assert.deepEqual(outboxNames(e), []);
  const ins = new Insider(e.location, e.keyFile);
  assert.deepEqual(ins.records().map((r) => r.seq), [1, 2, 3, 4, 5, 6], 'the chain has no gap');
  const here = new Set(ins.records().map((r) => hex(r.id)));
  assert.ok(here.has(w1.id) && here.has(w2.id), 'with the ids they were sealed with: nothing was sealed again');
  for (const s of sealed) assert.ok(ins.records().some((r) => Buffer.compare(r.sealed, s) === 0), 'byte for byte the stored bytes');
  assert.equal(e.vault.verify().ok, true);
});

test('an import that cannot write to the location keeps everything in the outbox; running it again sends it, and adds nothing twice', (t) => {
  if (!canBlock) return t.skip('running as root');
  const e = newVault(t, { durable: false });
  const dir = chainFolder(e);
  chmodSync(dir, 0o500);
  t.after(() => { try { chmodSync(dir, 0o700); } catch { /* gone */ } });
  const db = database(250);
  const r = e.vault.importKdbx(db);
  assert.equal(r.added, 250, 'the import itself stored everything');
  const d = e.vault.delivery();
  assert.equal(d.pending, 250);
  assert.equal(d.locations.length, 1);
  assert.equal(outboxNames(e).length, 250);

  chmodSync(dir, 0o700);
  e.clock.tick();
  const again = reopen(e).importKdbx(db);
  assert.deepEqual([again.added, again.unchanged], [0, 250], 'a rerun adds nothing');
  const after = reopen(e);
  assert.equal(after.delivery().pending, 0, 'but it delivered the old records');
  assert.deepEqual(outboxNames(e), []);
  const ins = new Insider(e.location, e.keyFile);
  assert.deepEqual(ins.records().map((x) => x.seq), Array.from({ length: ins.records().length }, (_, i) => i + 1), 'no gap in the chain at the location');
  assert.equal(ins.records().length, 252, 'genesis and the group record, and 250 items');
  assert.equal(after.verify().ok, true);
});

test('a location that fails in the middle of an import gets no later batch: its copy of the chain has no gap', (t) => {
  if (!canBlock) return t.skip('running as root');
  const e = newVault(t, { durable: false });
  const dir = chainFolder(e);
  t.after(() => { try { chmodSync(dir, 0o700); } catch { /* gone */ } });
  let writes = 0;
  e.vault.beforeLocationWrite = () => { if (++writes === 2) chmodSync(dir, 0o500); }; // the second batch fails
  const r = e.vault.importKdbx(database(350));
  assert.equal(r.added, 350);
  assert.equal(writes, 2, 'the third and fourth batch were not even tried');
  assert.equal(e.vault.delivery().pending, 250, 'the first batch (100 records) was delivered, 250 wait');
  const seqs = new Insider(e.location, e.keyFile).records().map((x) => x.seq);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1), 'what the location holds has no gap');
  chmodSync(dir, 0o700);
  e.vault.beforeLocationWrite = undefined;
  assert.equal(e.vault.sync().outbox, 0, 'sync still delivers the rest');
});

test('a dry run with records waiting in the outbox delivers nothing and touches no file of the device state or the vault', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.setOffline(true);
  e.vault.addItem({ title: 'Item', password: 'p0' });
  const list = (d: string): string[] => (existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((f) => f.isFile()).map((f) => { const p = join(f.parentPath, f.name); return `${p} ${statSync(p).size} ${statSync(p).mtimeMs}`; }).sort() : []);
  const before = [...list(e.stateDir), ...list(e.location)];
  const ro = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, readOnly: true, now: e.clock.now });
  const plan = ro.importKdbx(database(3), { dryRun: true });
  assert.equal(plan.added, 3);
  assert.deepEqual([...list(e.stateDir), ...list(e.location)], before);
  assert.equal(outboxNames(e).length, 1, 'the waiting record is still waiting');
});

// ---------------------------------------------------------------- orphans of a killed writer

test('temporary outbox files of a dead writer or of long ago are removed on the next write; a live writer\'s young file and the real entries are not', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.setOffline(true);
  e.vault.addItem({ title: 'Item', password: 'p0' }); // one real entry in the outbox (and the vault's own two earlier records are delivered)
  const dir = join(e.stateDir, 'outbox');
  const real = outboxNames(e);
  assert.equal(real.length, 1);
  const gone = Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim()); // a pid that is no longer running
  const make = (name: string, ageMs = 0) => { const p = join(dir, name); writeFileSync(p, 'half a record'); const t0 = (Date.now() - ageMs) / 1000; utimesSync(p, t0, t0); return name; };
  const hexName = (n: string) => `${'ab'.repeat(32)}-000000000${n}.sealed`;
  const orphans = [
    make(`.tmp-${gone}-aabbccddeeff-${hexName('7')}`),                         // writer is dead
    make(`.tmp-${process.pid}-aabbccddee01-${hexName('8')}`, 10 * 60_000),     // writer looks alive but the file is far older than the lock's limit
    make(`.tmp-aabbccddee02-${hexName('9')}`, 10 * 60_000),                    // no pid in the name (older format), old
  ];
  const keep = [
    make(`.tmp-${process.pid}-aabbccddee03-${hexName('6')}`),                  // a live process, just now: being written
    make(`.tmp-aabbccddee04-${hexName('5')}`),                                 // no pid, young
    make('notes.txt', 10 * 60_000),                                            // not ours
  ];
  const v = reopen(e);
  v.setField('psss://Item/password', 'p1'); // the first write of this process takes the lock and sweeps
  const left = readdirSync(dir).sort();
  for (const n of orphans) assert.ok(!left.includes(n), `${n} was removed`);
  for (const n of keep) assert.ok(left.includes(n), `${n} was kept`);
  assert.equal(left.filter((n) => !n.startsWith('.tmp-') && n !== 'notes.txt').length, 0, 'and the real entries went out as usual');
  assert.equal(v.delivery().pending, 0);
});

test('a lock refresh killed in the middle leaves a lock.<pid>.<token>.beat file: removed on the next write when its process is gone or it is old, not while it is young and alive', (t) => {
  const e = newVault(t, { durable: false });
  e.vault.addItem({ title: 'Item', password: 'p0' });
  const gone = Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim());
  const make = (name: string, ageMs = 0) => { const p = join(e.stateDir, name); writeFileSync(p, '{}'); const t0 = (Date.now() - ageMs) / 1000; utimesSync(p, t0, t0); return name; };
  const orphans = [make(`lock.${gone}.0011223344556677.beat`), make(`lock.${process.pid}.0011223344556678.beat`, 10 * 60_000), make('lock.0011223344556679.beat', 10 * 60_000)];
  const keep = [make(`lock.${process.pid}.001122334455667a.beat`), make('lock.001122334455667b.beat')];
  const v = reopen(e);
  v.setField('psss://Item/password', 'p1');
  const left = readdirSync(e.stateDir);
  for (const n of orphans) assert.ok(!left.includes(n), `${n} was removed`);
  for (const n of keep) assert.ok(left.includes(n), `${n} was kept`);
});

// ---------------------------------------------------------------- heartbeat

test('a long run of entries that write nothing does not let the lock go stale (checked on an injected clock)', (t) => {
  const e = newVault(t, { durable: false });
  const db = database(6);
  e.vault.importKdbx(db);
  let fake = Date.now();
  e.vault.lockOptions = { staleMs: 120_000, clock: () => fake };
  const ages: number[] = [];
  const again = e.vault.importKdbx(db, { progress: () => { ages.push(fake - JSON.parse(readFileSync(lockPath(e.stateDir), 'utf8')).time); fake += 100_000; } });
  assert.equal(again.unchanged, 6, 'the entries were all here already: nothing was queued');
  assert.ok(ages.length >= 6);
  assert.ok(Math.max(...ages) <= 120_000, `the lock was never older than the limit (ages in seconds: ${ages.map((a) => a / 1000).join(', ')})`);
});

test('the lock is refreshed after a slow write to a location, not only before it', (t) => {
  const e = newVault(t, { durable: false });
  let fake = Date.now();
  e.vault.lockOptions = { staleMs: 120_000, clock: () => fake };
  let writes = 0;
  e.vault.beforeLocationWrite = () => { writes++; fake += 200_000; }; // each write to the location takes longer than the lock's limit
  const ages: number[] = [];
  e.vault.importKdbx(database(250), { progress: () => { if (existsSync(lockPath(e.stateDir))) ages.push(fake - JSON.parse(readFileSync(lockPath(e.stateDir), 'utf8')).time); } });
  assert.ok(writes >= 3, 'three batches went to the location');
  assert.ok(Math.max(...ages) <= 120_000, `right after a slow write the lock is fresh again (ages: ${ages.map((a) => a / 1000).join(', ')})`);
  assert.equal(existsSync(lockPath(e.stateDir)), false);
});
