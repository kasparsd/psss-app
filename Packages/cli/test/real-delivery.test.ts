// The real binary against a vault location that refuses writes: set, rm, restore and import keep the change, say so, and exit 0; status never says
// Up to date meanwhile; the next write or import sends what was left, as stored; a killed writer's temporary files are cleaned up.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { newDatabase, newEntry, writeKdbx } from '../../kdbx/src/index.ts';
import { device, files, segments } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';

const canBlock = process.getuid?.() !== 0; // as root a read-only folder does not stop a write
const flat = (text: string) => text.replace(/\n/g, ' ');

function ready(t: TestContext): { d: Device; block: () => void; unblock: () => void; outbox: () => string[] } {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup: init');
  assert.equal(d.psss(['set', '--create', 'psss://Existing/password'], { stdin: 'p0' }).code, 0, 'setup: one item');
  const dir = path.dirname(segments(d.vaultPath('Personal'))[0]!); // the folder this device's records go to
  const unblock = () => { try { chmodSync(dir, 0o700); } catch { /* gone */ } };
  t.after(unblock);
  return { d, block: () => chmodSync(dir, 0o500), unblock, outbox: () => (existsSync(path.join(d.stateDir('Personal'), 'outbox')) ? readdirSync(path.join(d.stateDir('Personal'), 'outbox')).filter((n) => n.endsWith('.sealed') && !n.startsWith('.tmp-')) : []) };
}

function kdbx(d: Device, n: number): { file: string; env: Record<string, string> } {
  const now = new Date(1_700_000_000_000);
  const db = newDatabase({ name: 'src', now });
  for (let i = 0; i < n; i++) db.root.entries.push(newEntry({ title: `Site ${i}`, username: `u${i}`, password: `pw-${i}` }, { now }));
  const file = path.join(d.cwd, 'Family.kdbx');
  writeFileSync(file, writeKdbx(db, { password: 'file-pw' }, { version: '4.1' }));
  const pwFile = path.join(d.root, 'kdbx-pw.txt');
  writeFileSync(pwFile, 'file-pw\n', { mode: 0o600 });
  return { file, env: { PSSS_KDBX_PASSWORD_FILE: pwFile } };
}

test('set to a location that refuses it: exit 0, one plain warning on standard error, status never says Up to date, and the next write delivers the old change first', (t) => {
  if (!canBlock) return t.skip('running as root');
  const { d, block, unblock, outbox } = ready(t);
  block();
  const r = d.psss(['set', 'psss://Existing/password'], { stdin: 'p1' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Saved "password" in Existing/);
  assert.equal(flat(r.stderr).trim(), 'warning: 1 change is kept on this computer only; ~/Psss/Personal.psss could not be written (permission denied). Run psss sync to deliver it.');
  assert.ok(!r.stdout.includes('warning') && !r.stderr.includes('p1'));
  assert.equal(outbox().length, 1);

  const j = d.psss(['set', 'psss://Existing/password', '--json'], { stdin: 'p2' });
  assert.equal(j.code, 0);
  const body = JSON.parse(j.stdout) as { delivery: { undelivered: number; locations: Array<{ label: string; path: string; reason: string }> } };
  assert.equal(body.delivery.undelivered, 2, 'the earlier change still waits, and this one with it');
  assert.deepEqual(body.delivery.locations.map((l) => [l.path, l.reason]), [[d.vaultPath('Personal'), 'permission denied']]);
  assert.match(j.stderr, /^warning: 2 changes are kept on this computer only/);

  const status = d.psss(['status']);
  assert.equal(status.code, 0);
  assert.ok(!status.stdout.includes('Up to date'), status.stdout);
  assert.match(status.stdout, /Behind\n/);
  assert.match(status.stdout, /2 changes are kept on this computer only, not in every location yet\.\nRun psss sync to deliver them\.\n/);
  const sj = JSON.parse(d.psss(['status', '--json']).stdout) as { undelivered: number; locations: Array<{ state: string }> };
  assert.deepEqual([sj.undelivered, sj.locations.map((l) => l.state)], [2, ['behind']]);

  unblock();
  const next = d.psss(['set', 'psss://Existing/password'], { stdin: 'p3' });
  assert.equal(next.code, 0);
  assert.equal(next.stderr, '', 'nothing is left over: the old changes were delivered before this one');
  assert.deepEqual(outbox(), []);
  assert.match(d.psss(['status']).stdout, /Up to date\n/);
  assert.equal(d.psss(['get', 'psss://Existing/password']).stdout, 'p3');
  assert.equal(d.psss(['verify']).code, 0, 'the chain at the location has no gap');
});

test('rm and restore say the same, and sync delivers what they kept', (t) => {
  if (!canBlock) return t.skip('running as root');
  const { d, block, unblock, outbox } = ready(t);
  block();
  const rm = d.psss(['rm', 'psss://Existing']);
  assert.equal(rm.code, 0, rm.stderr);
  assert.match(flat(rm.stderr), /^warning: 1 change is kept on this computer only; ~\/Psss\/Personal\.psss could not be written \(permission denied\)\. Run psss sync to deliver it\./);
  const restore = d.psss(['restore', 'psss://Existing', '--json']);
  assert.equal(restore.code, 0);
  assert.equal((JSON.parse(restore.stdout) as { delivery: { undelivered: number } }).delivery.undelivered, 2);
  unblock();
  assert.equal(d.psss(['sync']).code, 0);
  assert.deepEqual(outbox(), []);
  assert.match(d.psss(['status']).stdout, /Up to date\n/);
});

test('import to a location that refuses it: exit 0 with the warning; a rerun adds nothing, delivers the old records, and a dry run touches nothing', (t) => {
  if (!canBlock) return t.skip('running as root');
  const { d, block, unblock, outbox } = ready(t);
  const { file, env } = kdbx(d, 150);
  block();
  const r = d.psss(['import', file], { env });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Added 150 items to Only Me\./);
  assert.match(flat(r.stderr), /warning: 150 changes are kept on this computer only; ~\/Psss\/Personal\.psss could not be written \(permission denied\)\. Run psss sync to deliver them\./);
  assert.equal(outbox().length, 150);
  assert.ok(!d.psss(['status']).stdout.includes('Up to date'));

  const before = files(d.stateDir('Personal')).join('\n');
  const dry = d.psss(['import', file, '--dry-run'], { env });
  assert.equal(dry.code, 0);
  assert.ok(!dry.stderr.includes('kept on this computer only'), 'a dry run says nothing about delivery');
  assert.equal(files(d.stateDir('Personal')).join('\n'), before, 'and touches no state');

  unblock();
  const again = d.psss(['import', file], { env });
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /^Nothing new to add to Only Me\.\n150 items are already here, unchanged\./);
  assert.equal(again.stderr, '');
  assert.deepEqual(outbox(), [], 'the rerun delivered what the first run left');
  assert.match(d.psss(['status']).stdout, /Up to date\n/);
  assert.equal((JSON.parse(d.psss(['list', '--json']).stdout) as { items: unknown[] }).items.length, 151);
  assert.equal(d.psss(['verify']).code, 0);
});

test('a write cleans up the temporary outbox files a killed process left behind, and only those', (t) => {
  const { d, outbox } = ready(t);
  const dir = path.join(d.stateDir('Personal'), 'outbox');
  const dead = 2 ** 22 + 12345; // beyond the pid range of the platforms we run on
  const name = `${'ab'.repeat(32)}-0000000009.sealed`;
  writeFileSync(path.join(dir, `.tmp-${dead}-aabbccddeeff-${name}`), 'half');
  writeFileSync(path.join(dir, `.tmp-${process.pid}-aabbccddee01-${name}`), 'a live writer');
  assert.equal(d.psss(['set', 'psss://Existing/password'], { stdin: 'x' }).code, 0);
  const left = readdirSync(dir);
  assert.ok(!left.some((n) => n.includes(String(dead))), 'the dead writer\'s file is gone');
  assert.ok(left.some((n) => n.includes(`.tmp-${process.pid}-`)), 'a live process\'s young file is not touched');
  assert.deepEqual(outbox(), []);
});
