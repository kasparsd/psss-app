// A second computer and a vault password with the real binary. The second computer is let in with the vault library
// (the invitation exchange is not specified); everything else goes through `psss`.

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createVaultService } from '../src/vault-service.ts';
import { admit, device, SECRET } from './real-helpers.ts';

const merge = (from: string, to: string) => cpSync(from, to, { recursive: true, force: false, errorOnExist: false });

test('two computers on one shared folder: both write, both sync, and get returns the same values on both', (t) => {
  const a = device(t, 'psss-real-a-');
  const b = device(t, 'psss-real-b-');
  assert.equal(a.psss(['init', 'Home', '--no-recovery']).code, 0, 'setup: init on computer A');
  const shared = a.vaultPath('Home');
  a.psss(['set', '--create', 'psss://Bank/password'], { stdin: 'start' });
  admit(a, b, 'Home');
  const onB = { PSSS_VAULT: shared };

  assert.equal(b.psss(['get', 'psss://Bank/password'], { env: onB }).stdout, 'start', 'computer B reads what A wrote, with its own key');
  assert.equal(a.psss(['set', 'psss://Bank/password'], { stdin: 'from-a' }).code, 0, 'A writes');
  assert.equal(b.psss(['set', 'psss://Bank/password'], { stdin: 'from-b' , env: onB }).code, 0, 'B writes the same field');
  assert.equal(b.psss(['set', '--create', 'psss://Wifi/password'], { stdin: 'wifi-b', env: onB }).code, 0, 'B adds an item');
  assert.equal(a.psss(['sync']).code, 0, 'A syncs');
  assert.equal(b.psss(['sync'], { env: onB }).code, 0, 'B syncs');

  const ga = a.psss(['get', 'psss://Bank/password']).stdout;
  const gb = b.psss(['get', 'psss://Bank/password'], { env: onB }).stdout;
  assert.equal(ga, gb, 'both computers agree on the value of the field written on both');
  assert.ok(['from-a', 'from-b'].includes(ga), 'and it is one of the two writes, never a mix');
  assert.equal(a.psss(['get', 'psss://Wifi/password']).stdout, 'wifi-b', 'A sees the item B added');
  assert.equal(a.psss(['verify']).code, 0, 'the merged vault verifies on A');
  assert.equal(b.psss(['verify'], { env: onB }).code, 0, 'and on B');
  assert.notEqual(a.stateDir('Home'), b.stateDir('Home'), 'each computer has its own device state');
});

test('two computers write while apart, a sync service moves the files, and sync then gives both the same values', (t) => {
  const a = device(t, 'psss-real-a-');
  const b = device(t, 'psss-real-b-');
  assert.equal(a.psss(['init', 'Home', '--no-recovery']).code, 0, 'setup: init on computer A');
  a.psss(['set', '--create', 'psss://Bank/password'], { stdin: 'start' });
  a.psss(['set', '--create', 'psss://Mail/password'], { stdin: 'mail-start' });
  admit(a, b, 'Home');
  mkdirSync(b.vaultFolder, { recursive: true });
  merge(a.vaultPath('Home'), b.vaultPath('Home')); // B's copy of the folder, as a sync service would make it
  assert.equal(b.psss(['get', 'psss://Bank/password']).stdout, 'start', 'setup: B opens its copy with its own key');

  // apart: neither sees the other's writes
  a.psss(['set', 'psss://Bank/password'], { stdin: 'from-a' });
  a.psss(['set', '--create', 'psss://OnlyA/token'], { stdin: 'a-token' });
  b.psss(['set', 'psss://Bank/password'], { stdin: 'from-b' });
  b.psss(['set', 'psss://Mail/password'], { stdin: 'mail-b' });
  assert.equal(a.psss(['get', 'psss://Bank/password']).stdout, 'from-a', 'apart, A sees its own value');
  assert.equal(b.psss(['get', 'psss://Bank/password']).stdout, 'from-b', 'apart, B sees its own value');
  assert.match(b.psss(['get', 'psss://OnlyA/token']).stderr, /There is no item called "OnlyA"/, 'apart, B does not have A\'s new item');

  // the sync service delivers each side's files to the other
  merge(a.vaultPath('Home'), b.vaultPath('Home'));
  merge(b.vaultPath('Home'), a.vaultPath('Home'));
  const syncA = a.psss(['sync']);
  const syncB = b.psss(['sync']);
  assert.equal(syncA.code, 0, 'A syncs');
  assert.equal(syncB.code, 0, 'B syncs');
  assert.match(syncA.stdout, /This computer: read [1-9]\d* new records?/, `A reports the records it took from the folder: ${syncA.stdout}`);

  for (const [ref, label] of [['psss://Bank/password', 'a field written on both'], ['psss://Mail/password', 'a field written on one'], ['psss://OnlyA/token', 'an item added on one']]) {
    const ra = a.psss(['get', ref]);
    const rb = b.psss(['get', ref]);
    assert.equal(ra.code, 0, `A can read ${label}`);
    assert.equal(ra.stdout, rb.stdout, `both computers agree on ${label}`);
  }
  assert.equal(a.psss(['get', 'psss://Mail/password']).stdout, 'mail-b', 'a write made on one computer reaches the other');
  assert.equal(a.psss(['get', 'psss://OnlyA/token']).stdout, 'a-token', 'an item made on A reaches B');
  assert.equal(a.psss(['verify']).code, 0, 'the merged vault verifies on A');
  assert.equal(b.psss(['verify']).code, 0, 'and on B');
  // a write after the merge continues each device chain
  assert.equal(b.psss(['set', 'psss://Mail/password'], { stdin: 'mail-b2' }).code, 0, 'B can write after the merge');
  assert.equal(b.psss(['verify']).code, 0, 'and its chain continues without a gap');
});

test('a vault password added with setPassword opens the vault through PSSS_PASSWORD_FILE when the key file is gone, and a wrong password exits 4', async (t) => {
  const d = device(t);
  const svc = createVaultService({ cwd: d.cwd, home: d.home, platform: process.platform, configDir: path.join(d.config, 'psss'), stateDir: path.join(d.state, 'psss') });
  const created = await svc.create({ name: 'Home' });
  assert.ok(created.ok, 'setup: create through the service');
  assert.ok((await svc.set({ title: 'Bank' }, 'password', SECRET, { create: true })).ok, 'setup: set through the service');
  const set = await svc.setPassword('correct horse battery staple');
  assert.ok(set.ok, `setPassword adds a password slot from outside the library: ${JSON.stringify(set)}`);

  assert.match(d.psss(['status']).stdout, /^Vault {5}Home[^\n]*\nKey {7}this computer's key file\nWay back {2}a vault password\n/, 'status lists the vault password as a way back');
  renameSync(d.keyFile('Home'), path.join(d.cwd, 'away.key'));
  const good = path.join(d.cwd, 'pw.txt');
  writeFileSync(good, 'correct horse battery staple\n');
  const ok = d.psss(['get', 'psss://Bank/password'], { env: { PSSS_PASSWORD_FILE: good } });
  assert.equal(ok.stdout, SECRET, 'the password file opens the vault, and its final line break is not part of the password');
  const status = d.psss(['status'], { env: { PSSS_PASSWORD_FILE: good } });
  assert.match(status.stdout, /\nKey {7}the vault password\n/, 'status says the vault was opened with the password');
  const bad = path.join(d.cwd, 'bad.txt');
  writeFileSync(bad, 'wrong password\n');
  const wrong = d.psss(['get', 'psss://Bank/password'], { env: { PSSS_PASSWORD_FILE: bad } });
  assert.equal(wrong.code, 4, 'a wrong password exits 4');
  assert.match(wrong.stderr, /^Cannot open the vault "Home"\.\nThe key you gave does not open it\./, 'and does not say more');
  const absent = d.psss(['get', 'psss://Bank/password'], { env: { PSSS_PASSWORD_FILE: path.join(d.cwd, 'missing.txt') } });
  assert.equal(absent.code, 4, 'a missing password file exits 4');
  for (const r of d.log) {
    assert.ok(!`${r.stdout}${r.stderr}`.includes('correct horse') && !`${r.stdout}${r.stderr}`.includes('wrong password'), 'no password is printed');
  }
  assert.equal((await svc.setPassword('another')).ok, false, 'a second password is refused: changing it is not built');
});
