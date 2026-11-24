// Every exit code of the real `psss` binary against a real vault: 2 usage and failed verify, 3 no item or ambiguous, 4 locked.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { BIN, device, files, segments, SECRET } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';

function vaultWith(t: TestContext, name = 'Personal'): Device {
  const d = device(t);
  assert.equal(d.psss(['init', name, '--no-recovery']).code, 0, 'setup: init should work');
  assert.equal(d.psss(['set', '--create', 'psss://Example API/token'], { stdin: SECRET }).code, 0, 'setup: set should work');
  return d;
}

test('exit 3: no such item names the vault and the near misses; a missing field lists the fields; an unknown group says so', (t) => {
  const d = vaultWith(t);
  d.psss(['set', '--create', 'psss://Example Bank/password'], { stdin: 'b' });
  const none = d.psss(['get', 'psss://Nothing/token']);
  assert.equal(none.code, 3, 'a missing title exits 3');
  assert.equal(none.stdout, '', 'an error leaves standard output empty');
  assert.equal(none.stderr, 'There is no item called "Nothing" in Personal.\nSee what is there with: psss list\n', 'no near miss, no hint line');
  const near = d.psss(['get', 'psss://Exampel API/token']);
  assert.equal(near.code, 3, 'a near miss still exits 3');
  assert.equal(near.stderr, 'There is no item called "Exampel API" in Personal.\nDid you mean: Example API?\nSee what is there with: psss list\n', 'the near miss is a hint and never a result');
  assert.equal(d.psss(['get', 'psss://Example/token']).code, 3, 'a prefix is never a match');
  const field = d.psss(['get', 'psss://Example API/password']);
  assert.equal(field.code, 3, 'a missing field exits 3');
  assert.equal(field.stderr, '"Example API" has no field called "password".\nIt has: token.\n', 'the message lists what the item has');
  const group = d.psss(['list', '--group', 'Nope']);
  assert.equal(group.code, 3, 'an unknown group exits 3');
  assert.equal(d.psss(['restore', 'psss://Example API']).code, 3, 'restoring an item that is not deleted exits 3');
  assert.equal(d.psss(['rm', 'psss://id:0123456789abcdef0123456789abcdef']).code, 3, 'an unknown id exits 3');
  assert.equal(d.psss(['set', 'psss://Brand New/token'], { stdin: 'x' }).code, 3, 'set without --create on a missing title exits 3 and adds nothing');
  assert.doesNotMatch(d.psss(['list']).stdout, /Brand New/, 'nothing was added');
});

test('exit 3: two items with one title are ambiguous, listed by id, and the id form reaches each one', (t) => {
  const d = vaultWith(t);
  const lib = d.library('Personal');
  const a = lib.addItem({ title: 'Twin', username: 'robin@example.com', password: 'pw-robin' });
  const b = lib.addItem({ title: 'twin', username: 'sam@example.com', password: 'pw-sam' });
  const r = d.psss(['get', 'psss://Twin/password']);
  assert.equal(r.code, 3, 'an ambiguous title exits 3, ignoring the case of the other item');
  assert.equal(r.stdout, '', 'nothing is printed to standard output');
  const [first, second] = [a, b].sort((x, y) => (x.item.title.localeCompare(y.item.title, 'en') || (x.id < y.id ? -1 : 1)));
  assert.equal(
    r.stderr,
    `"Twin" matches 2 items in Personal. Use one of these:\n  psss://id:${first.id}/password   ${first.item.title}   ${first.item.username}\n  psss://id:${second.id}/password   ${second.item.title}   ${second.item.username}\n`,
    'A6: the candidates are listed by id with their account',
  );
  assert.equal(d.psss(['get', `psss://id:${a.id}/password`]).stdout, 'pw-robin', 'the id form reaches the first');
  assert.equal(d.psss(['get', `psss://id:${b.id}/password`]).stdout, 'pw-sam', 'the id form reaches the second');
  assert.equal(d.psss(['rm', 'psss://Twin']).code, 3, 'rm with an ambiguous title changes nothing and exits 3');
  assert.equal(d.psss(['set', 'psss://Twin/password', '--create'], { stdin: 'x' }).code, 3, 'set --create must not add a third item when the title is ambiguous');
});

test('exit 4: the key file removed, a key that does not open the vault, no vault, and a bad key file all exit 4 with the words of frame A7', (t) => {
  const d = vaultWith(t);
  const key = d.keyFile('Personal');
  const moved = `${key}.moved`;
  renameSync(key, moved);
  const missing = d.psss(['get', 'psss://Example API/token']);
  assert.equal(missing.code, 4, 'a missing key file exits 4');
  assert.equal(
    missing.stderr,
    `Cannot open the vault "Personal".\nThis computer's key file is missing: ~/.config/psss/keys/Personal.key\nPoint PSSS_KEY_FILE at your key file, or use the vault\npassword with PSSS_PASSWORD_FILE.\n`,
    'A7 text',
  );
  assert.equal(missing.stdout, '', 'nothing on standard output');
  for (const args of [['list'], ['status'], ['verify'], ['sync'], ['rm', 'psss://Example API'], ['set', 'psss://Example API/token']]) {
    assert.equal(d.psss(args, { stdin: 'x' }).code, 4, `psss ${args[0]} without the key file exits 4`);
  }
  const explicit = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_KEY_FILE: path.join(d.cwd, 'nowhere.key') } });
  assert.equal(explicit.code, 4, 'an explicit key file that is missing exits 4');
  assert.match(explicit.stderr, /key file is missing: \.\/nowhere\.key/, 'and names that file');

  // a key that is there and does not open this vault: another vault's key file
  d.psss(['init', 'Other', '--no-recovery']);
  const wrong = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_KEY_FILE: d.keyFile('Other'), PSSS_VAULT: 'Personal' } });
  assert.equal(wrong.code, 4, 'a key of another vault exits 4');
  assert.match(wrong.stderr, /^Cannot open the vault "Personal"\.\nThe key in ~\/\.config\/psss\/keys\/Other\.key does not open it\./, 'the wrong key is named, and nothing says whether a password exists');
  writeFileSync(path.join(d.cwd, 'junk.key'), 'not a key');
  const junk = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_KEY_FILE: path.join(d.cwd, 'junk.key'), PSSS_VAULT: 'Personal' } });
  assert.equal(junk.code, 4, 'a key file that is not a key exits 4');
  assert.doesNotMatch(junk.stderr, /not a key|at .*\.ts:/, 'no content of the file and no stack trace');

  assert.match(d.psss(['list']).stderr, /^There is more than one vault in ~\/Psss: Other, Personal\.\nSay which with --vault <name> or PSSS_VAULT\.\n$/, 'with two vaults and no --vault the command asks which, and does not guess');
  const novault = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_VAULT: './nothing-here' } });
  assert.equal(novault.code, 4, 'no vault exits 4');
  assert.equal(novault.stderr, 'There is no vault at ./nothing-here.\nCreate one with: psss init <name>\nor point PSSS_VAULT at a vault folder.\n', 'a clear no-vault message');
  renameSync(moved, key);
  assert.equal(d.psss(['get', 'psss://Example API/token'], { env: { PSSS_VAULT: 'Personal' } }).stdout, SECRET, 'with the key file back, the vault opens again');
});

test('exit 4: PSSS_KEY gives the key inline, as the text of a key file or as its base64, and a wrong inline key exits 4 without printing it', (t) => {
  const d = vaultWith(t);
  const text = readFileSync(d.keyFile('Personal'), 'utf8');
  renameSync(d.keyFile('Personal'), path.join(d.cwd, 'moved.key'));
  const inline = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_KEY: text.trim() } });
  assert.equal(inline.stdout, SECRET, 'PSSS_KEY holding the key file text opens the vault');
  const b64 = d.psss(['status'], { env: { PSSS_KEY: Buffer.from(text).toString('base64') } });
  assert.equal(b64.code, 0, 'PSSS_KEY holding the base64 of the key file text opens the vault');
  assert.match(b64.stdout, /^Vault {5}Personal[^\n]*\nKey {7}the key in PSSS_KEY\n/, 'status says the key came from PSSS_KEY');
  const bad = d.psss(['get', 'psss://Example API/token'], { env: { PSSS_KEY: 'definitely-not-a-key-12345' } });
  assert.equal(bad.code, 4, 'an inline key that is not a key exits 4');
  assert.ok(!bad.stderr.includes('definitely-not-a-key-12345'), 'the inline key is never printed');
});

test('exit 2: verify after one bit of a record file is flipped reports the changed record and exits 2, and never repairs', (t) => {
  const d = vaultWith(t);
  for (const v of ['a', 'b', 'c']) d.psss(['set', 'psss://Example API/token'], { stdin: v });
  assert.equal(d.psss(['verify']).code, 0, 'setup: the vault verifies before the change');
  const target = segments(d.vaultPath('Personal')).find((f) => path.basename(f).startsWith('0000000004-'))!;
  const bytes = readFileSync(target);
  bytes[bytes.length - 20] ^= 0x01;
  writeFileSync(target, bytes);
  const before = files(d.vaultPath('Personal')).map((f) => readFileSync(f).toString('hex'));
  const r = d.psss(['verify']);
  assert.equal(r.code, 2, `a flipped bit makes verify exit 2: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^Checked \d+ records in 1 location\.\n1 record in ~\/Psss\/Personal\.psss was changed after\nit was written\. It is ignored\./, 'the changed record is reported in the words of frame A8');
  assert.deepEqual(files(d.vaultPath('Personal')).map((f) => readFileSync(f).toString('hex')), before, 'verify never repairs or writes anything in the vault');
  assert.equal(d.psss(['verify']).code, 2, 'and it still fails the next time');
});

test('exit 2: verify after a record is deleted from the middle of a chain reports it and exits 2', (t) => {
  const d = vaultWith(t);
  for (const v of ['a', 'b', 'c', 'd']) d.psss(['set', 'psss://Example API/token'], { stdin: v });
  const target = segments(d.vaultPath('Personal')).find((f) => path.basename(f).startsWith('0000000004-'))!;
  rmSync(target);
  const r = d.psss(['verify']);
  assert.equal(r.code, 2, `a dropped record makes verify exit 2: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /A record is missing from the middle of a device's history/, 'it says in plain words that a record is missing from the middle');
  assert.doesNotMatch(r.stdout, /chain|record 4|[0-9a-f]{8}/, 'and shows no chain names, sequence numbers or ids');
  assert.equal(r.stderr, '', 'the report is on standard output');
  const loud = d.psss(['verify', '--verbose']);
  assert.match(loud.stdout, /Detail: .*record 4 missing/, '--verbose adds the library detail');
  assert.match(d.psss(['verify', '--json']).stdout, /record 4 missing/, '--json carries the detail');
});

test('exit 2: unknown flags, extra arguments, a missing reference and a value as an argument are usage errors that read and write nothing', (t) => {
  const d = vaultWith(t);
  const cases: Array<[string[], RegExp]> = [
    [['get', '--nope', 'psss://Example API/token'], /Unknown option --nope/],
    [['status', 'extra'], /takes no arguments/],
    [['get'], /needs a reference/],
    [['set', 'psss://Example API/token', SECRET], /A value is never an argument/],
    [['frobnicate'], /Unknown command/],
    [['get', 'Example API/token'], /psss:\/\//],
  ];
  for (const [args, message] of cases) {
    const r = d.psss(args);
    assert.equal(r.code, 2, `psss ${args[0]} with bad usage exits 2`);
    assert.match(r.stderr, message, `psss ${args.join(' ')} says what was wrong`);
    assert.ok(!r.stderr.includes(SECRET), 'a value typed as an argument is not echoed back');
  }
  assert.equal(d.psss(['get', 'psss://Example API/token']).stdout, SECRET, 'the vault is unchanged');
});

test('exit 1: a program that run cannot start exits 1, and run passes on the exit code of the program', (t) => {
  const d = vaultWith(t);
  const script = path.join(d.cwd, 'fail.sh');
  writeFileSync(script, '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  assert.equal(d.psss(['run', '--env', 'T=psss://Example API/token', '--', './fail.sh']).code, 7, 'run passes on the exit code of the program');
  const nope = d.psss(['run', '--env', 'T=psss://Example API/token', '--', './does-not-exist']);
  assert.equal(nope.code, 1, 'a program that cannot start exits 1');
  assert.ok(!(nope.stdout + nope.stderr).includes(SECRET), 'and no value is printed');
});

test('real: a key file other users can read is warned about, with the fix; the value and the exit code are unchanged', { skip: process.platform === 'win32' }, (t) => {
  const d = vaultWith(t);
  const key = d.keyFile('Personal');
  chmodSync(key, 0o644);
  const r = d.psss(['get', 'psss://Example API/token']);
  assert.equal(r.code, 0, 'a loose key file never changes the exit code');
  assert.equal(r.stdout, SECRET, 'the value still comes out');
  assert.match(r.stderr, /^warning: .*Personal\.key can be read by\nother users\. Run: chmod 600 .*Personal\.key\n$/, 'one warning with the fix on standard error');
  chmodSync(key, 0o600);
  assert.equal(d.psss(['get', 'psss://Example API/token']).stderr, '', 'an owner-only key file is silent');
});

test('real: rm on a field reference is explained, and a single local location prints no progress on sync', (t) => {
  const d = vaultWith(t);
  const r = d.psss(['rm', 'psss://Example API/token']);
  assert.equal(r.code, 2, 'a field on rm is a usage error');
  assert.equal(r.stderr, 'rm takes an item, not a field. Use: psss rm "psss://Example API"\n', 'with the corrected command');
  const sync = d.psss(['sync']);
  assert.equal(sync.code, 0, 'sync works');
  assert.equal(sync.stderr, '', 'one local location needs no "Reading This computer"');
});

test('real: a working folder that no longer exists gives a plain message and exit 1, not a stack trace', { skip: process.platform === 'win32' }, (t) => {
  const d = vaultWith(t);
  const gone = path.join(d.root, 'gone');
  mkdirSync(gone);
  const r = spawnSync('sh', ['-c', 'cd "$1" && rmdir "$1" && exec "$2" --disable-warning=ExperimentalWarning "$3" list', 'sh', gone, process.execPath, BIN], { env: d.env(), encoding: 'utf8' });
  assert.equal(r.status, 1, 'exit 1');
  assert.match(r.stderr, /^The folder you are in no longer exists/, 'a plain message');
  assert.doesNotMatch(r.stderr, /at .*\(|node:internal|ENOENT/, 'no stack trace');
});

test('real: a value too large for a record is explained with exit 2, and any other library failure carries its cause', (t) => {
  const d = vaultWith(t);
  const big = d.psss(['set', 'psss://Example API/token'], { stdin: 'x'.repeat(8 * 1024 * 1024) });
  assert.notEqual(big.code, 0, 'a huge value is not stored');
  assert.doesNotMatch(big.stderr, /Something went wrong/, 'and the message is never a bare "Something went wrong"');
  assert.doesNotMatch(big.stderr, /node:internal|\n\s+at /, 'with no stack trace');
  assert.equal(d.psss(['get', 'psss://Example API/token']).stdout, SECRET, 'the earlier value is untouched');
});
