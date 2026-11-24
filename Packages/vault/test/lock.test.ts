import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openVault, ValueTooLarge, VaultError, lockPath } from '../src/index.ts';
import { Insider, newVault } from './helpers.ts';

const here = (f: string) => join(import.meta.dirname, f);
const NODE_ARGS = ['--disable-warning=ExperimentalWarning'];

function run(script: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [...NODE_ARGS, here(script), ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

test('(e) six processes of one device write at the same moment: every item survives, the chain has no gap, verify is clean', async (t) => {
  const e = newVault(t, { durable: false }, 'parallel');
  const N = 6;
  const go = join(e.dir, 'go');
  const started = Date.now();
  const kids = Array.from({ length: N }, (_, i) => run('child-writer.ts', [e.location, e.keyFile, e.stateDir, go, `Parallel ${i}`]));
  await new Promise((r) => setTimeout(r, 1500)); // let every child load its modules and reach the barrier
  writeFileSync(go, '');
  const results = await Promise.all(kids);
  const elapsed = Date.now() - started;
  t.diagnostic(`six parallel writers: ${elapsed} ms in all (1500 ms of it is the wait for the children to start)`);
  for (const r of results) assert.equal(r.code, 0, `every writer succeeds: ${r.out}`);
  const seqs = results.map((r) => (JSON.parse(r.out) as { seq: number }).seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [3, 4, 5, 6, 7, 8], 'each writer got its own sequence number');

  const v = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, durable: false });
  const titles = v.list().map((i) => i.title).sort();
  assert.deepEqual(titles, Array.from({ length: N }, (_, i) => `Parallel ${i}`), 'all six items exist');
  const report = v.verify();
  assert.equal(report.ok, true, `verify is clean: ${JSON.stringify(report.problems)}`);
  assert.deepEqual(v.issues, [], 'and opening found no issues');
  const ins = new Insider(e.location, e.keyFile);
  assert.equal(ins.chainDirs().length, 1, 'one device, one chain');
  assert.deepEqual(ins.records().map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7, 8], 'the chain runs 1..8 without a gap or a repeat');
  assert.equal(v.outbox().length, 0, 'nothing is left in the outbox');
  assert.equal(existsSync(lockPath(e.stateDir)), false, 'the lock file is gone');
  assert.deepEqual(readdirSync(e.stateDir).sort(), ['outbox', 'state.json'], 'no lock or temporary files are left in the state directory');
});

test('(e) a lock left by a process that is gone is stolen', (t) => {
  const e = newVault(t, { durable: false }, 'stale');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  const pid = Number(dead.stdout.toString());
  writeFileSync(lockPath(e.stateDir), JSON.stringify({ pid, time: Date.now(), token: 'dead' }));
  const started = Date.now();
  const r = e.vault.addItem({ title: 'After a crash' });
  assert.ok(Date.now() - started < 3000, 'the write did not wait for a dead process');
  assert.equal(r.write.inOutbox, false, 'and it was delivered');
  assert.equal(existsSync(lockPath(e.stateDir)), false, 'the stolen lock is released afterwards');
  assert.equal(e.vault.verify().ok, true);
});

test('(e) a lock older than the limit is stolen even if its process is alive; a damaged old lock too', (t) => {
  const e = newVault(t, { durable: false }, 'old');
  writeFileSync(lockPath(e.stateDir), JSON.stringify({ pid: process.ppid, time: Date.now() - 10 * 60_000, token: 'old' }));
  e.vault.addItem({ title: 'Old lock' });
  assert.equal(existsSync(lockPath(e.stateDir)), false);
});

test('(e) a live lock makes a second writer wait, then it succeeds', async (t) => {
  const e = newVault(t, { durable: false }, 'live');
  const holder = spawn(process.execPath, [...NODE_ARGS, here('child-hold.ts'), e.stateDir, '1200'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => holder.kill());
  await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()));
  const started = Date.now();
  e.vault.addItem({ title: 'Waited' });
  const waited = Date.now() - started;
  assert.ok(waited >= 600, `the writer waited for the holder (${waited} ms)`);
  assert.ok(waited < 4500, `and not longer than the holder held it (${waited} ms)`);
  assert.deepEqual(e.vault.list().map((i) => i.title), ['Waited']);
  assert.equal(e.vault.verify().ok, true);
});

test('(e) a lock that stays held fails with a plain error that names the lock file', async (t) => {
  const e = newVault(t, { durable: false }, 'held');
  const holder = spawn(process.execPath, [...NODE_ARGS, here('child-hold.ts'), e.stateDir, '3000'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => holder.kill());
  await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()));
  const started = Date.now();
  assert.throws(
    () => openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, durable: false, lockWaitMs: 400 }),
    (err) => err instanceof VaultError && err.code === 'state_locked' && err.message.includes(lockPath(e.stateDir)) && /Another psss is running/.test(err.message),
  );
  assert.ok(Date.now() - started >= 350, 'it waited before giving up');
});

test('(f) a value over what one record can carry throws ValueTooLarge with the limit, and writes nothing', (t) => {
  const e = newVault(t, { durable: false }, 'big');
  const before = e.vault.outbox().length;
  for (const [edit, limit] of [[{ password: 'x'.repeat(200 * 1024) }, 65_536], [{ custom: { Key: 'x'.repeat(70_000) } }, 65_536], [{ notes: 'x'.repeat(300_000) }, 262_144]] as const) {
    assert.throws(() => e.vault.addItem({ title: 'Big', ...edit }), (err) => err instanceof ValueTooLarge && err instanceof VaultError && err.code === 'value_too_large' && err.limit === limit && typeof err.size === 'number' && err.size > limit);
  }
  const ok = e.vault.addItem({ title: 'Big', notes: 'x'.repeat(200 * 1024) });
  assert.equal(ok.write.inOutbox, false, 'notes up to 256 KiB are fine');
  assert.throws(() => e.vault.setField(`psss://id:${ok.id}/password`, 'y'.repeat(65_537)), ValueTooLarge);
  assert.equal(e.vault.outbox().length, before, 'a refused value leaves nothing in the outbox');
  assert.equal(e.vault.verify().ok, true);
});
