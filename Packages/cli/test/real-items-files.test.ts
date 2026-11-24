// generate, item and file through the real binary on real vault folders: lifecycle, purge rules, attachments,
// hostile names, a file over the limit, concurrent writers, a put killed part way, and a locked vault.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { BIN, device, files, SECRET } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';

const RLO = '‮';

function vault(t: TestContext): Device {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup: init should work');
  return d;
}
const everything = (d: Device) => d.log.map((r) => r.stdout + r.stderr).join('\n');

test('item: add, show, edit, delete, purge on a real vault; the secret never appears and verify stays clean', (t) => {
  const d = vault(t);
  const add = d.psss(['item', 'add', '--title', 'Example Shop', '--username', 'robin', '--url', 'shop.example', '--tag', 'work', '--password'], { stdin: `${SECRET}\n` });
  assert.equal(add.code, 0, add.stderr);
  assert.equal(add.stdout, 'psss://Example Shop\n');
  assert.equal(d.psss(['get', 'psss://Example Shop/password']).stdout, SECRET, 'the value is stored');
  const show = d.psss(['item', 'show', 'psss://Example Shop']);
  assert.equal(show.code, 0, show.stderr);
  assert.match(show.stdout, /Website {2,}https:\/\/shop\.example/);
  assert.match(show.stdout, /Password {2,}hidden/);
  const edit = d.psss(['item', 'edit', 'psss://Example Shop', '--username', 'sam', '--add-tag', 'family']);
  assert.equal(edit.stdout, 'Changed username, tags of "Example Shop" (Personal).\n');
  const purgeLive = d.psss(['item', 'purge', 'psss://Example Shop', '--yes']);
  assert.equal(purgeLive.code, 1, 'a live item is never purged');
  assert.match(purgeLive.stderr, /is not in Recently Deleted/);
  assert.equal(d.psss(['get', 'psss://Example Shop/password']).code, 0, 'still there');
  assert.equal(d.psss(['rm', 'psss://Example Shop']).code, 0);
  assert.equal(d.psss(['item', 'purge', 'psss://Example Shop']).code, 2, 'without a terminal it needs --yes');
  assert.equal(d.psss(['item', 'show', 'psss://Example Shop']).code, 0, 'a deleted item can still be shown');
  const dry = d.psss(['item', 'purge', 'psss://Example Shop', '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /Nothing was deleted\./);
  const purge = d.psss(['item', 'purge', 'psss://Example Shop', '--yes']);
  assert.equal(purge.code, 0, purge.stderr);
  assert.match(purge.stdout, /^Deleted "Example Shop" for good from Personal\./);
  assert.equal(d.psss(['item', 'show', 'psss://Example Shop']).code, 3, 'gone');
  assert.equal(d.psss(['verify']).code, 0, 'verify is clean after a purge');
  assert.ok(!d.log.filter((r) => r.argv[0] !== 'get').some((r) => (r.stdout + r.stderr).includes(SECRET)), 'only get ever printed it');
});

test('generate and set --generate: a value nobody sees, and a second --force keeps the first in history', (t) => {
  const d = vault(t);
  const g = d.psss(['generate', '--count', '3']);
  assert.equal(g.stdout.trimEnd().split('\n').length, 3);
  const s = d.psss(['set', '--generate', '--create', 'psss://Example API/token']);
  assert.equal(s.code, 0, s.stderr);
  assert.equal(s.stdout, 'psss://Example API/token\n');
  const first = d.psss(['get', 'psss://Example API/token']).stdout.trim();
  assert.match(first, /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/);
  assert.ok(!s.stdout.includes(first) && !s.stderr.includes(first));
  const again = d.psss(['set', '--generate', 'psss://Example API/token']);
  assert.equal(again.code, 1, 'no overwrite without --force');
  assert.equal(d.psss(['get', 'psss://Example API/token']).stdout.trim(), first);
  const forced = d.psss(['set', '--generate', '--force', '--length', '24', 'psss://Example API/token']);
  assert.equal(forced.code, 0, forced.stderr);
  const second = d.psss(['get', 'psss://Example API/token']).stdout.trim();
  assert.equal(second.length, 24);
  const history = d.psss(['history', 'psss://Example API/token']);
  assert.equal(history.code, 0, history.stderr);
  assert.ok(!history.stdout.includes(first) && !history.stdout.includes(second), 'history lists times, never values');
  assert.equal(d.psss(['verify']).code, 0);
});

test('file: put and get round trip across chunks, mode 0600, base name, no overwrite, no escape, nothing inside the vault folder', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API', '--username', 'x']).code, 0);
  const bytes = Buffer.alloc(2.5 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  mkdirSync(path.join(d.cwd, 'in'));
  writeFileSync(path.join(d.cwd, 'in', 'ca.pem'), bytes);
  const put = d.psss(['file', 'put', 'psss://Example API', 'in/ca.pem']);
  assert.equal(put.code, 0, put.stderr);
  assert.equal(put.stdout, 'psss://Example API/ca.pem\n');
  assert.match(d.psss(['file', 'list', 'psss://Example API']).stdout, /^ca\.pem {2,}2\.5 MiB\n$/);
  const dup = d.psss(['file', 'put', 'psss://Example API', 'in/ca.pem']);
  assert.equal(dup.code, 1);
  mkdirSync(path.join(d.cwd, 'out'));
  const get = d.psss(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out']);
  assert.equal(get.code, 0, get.stderr);
  assert.ok(readFileSync(path.join(d.cwd, 'out', 'ca.pem')).equals(bytes), 'the bytes are identical');
  assert.equal(statSync(path.join(d.cwd, 'out', 'ca.pem')).mode & 0o777, 0o600);
  const again = d.psss(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out']);
  assert.equal(again.code, 1, 'no overwrite without --force');
  assert.equal(d.psss(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out', '--force']).code, 0);
  const inside = d.psss(['file', 'get', 'psss://Example API/ca.pem', '--output', path.join(d.vaultPath('Personal'), 'ca.pem')]);
  assert.equal(inside.code, 1, 'a place the vault is shared from is refused');
  assert.ok(!inside.stderr.includes(d.home), 'no absolute home path in the message');
  assert.equal(d.psss(['verify']).code, 0);
});

test('file: a stored name with slashes, a bidi name and an empty-looking name never escape or reach the terminal', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  const lib = d.library('Personal');
  const ref = 'psss://Example API';
  // The library refuses these names; the command must too.
  for (const name of ['../../etc/passwd', 'a/b', '..', '']) {
    const r = d.psss(['file', 'put', ref, 'in.txt', '--name', name]);
    assert.notEqual(r.code, 0, JSON.stringify(name));
  }
  assert.ok(!existsSync(path.join(d.root, 'etc')));
  writeFileSync(path.join(d.cwd, 'in.txt'), 'hello');
  const bidi = d.psss(['file', 'put', ref, 'in.txt', '--name', `inv${RLO}fdp.exe`]);
  assert.equal(bidi.code, 0, bidi.stderr);
  assert.ok(!/‮/.test(bidi.stdout + bidi.stderr), 'the direction mark is escaped');
  const list = d.psss(['file', 'list', ref]);
  assert.ok(!/‮/.test(list.stdout + list.stderr));
  assert.match(list.stdout, /\\u\{202e\}/);
  void lib;
});

test('file put: a 100 MiB file is refused before anything is read or written', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  const big = path.join(d.cwd, 'big.bin');
  writeFileSync(big, '');
  truncateSync(big, 100 * 1024 * 1024);
  const r = d.psss(['file', 'put', 'psss://Example API', 'big.bin']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /larger than the 64 MiB an attached file can be\. Nothing was changed\./);
  assert.equal(r.stdout, '');
  assert.equal(d.psss(['file', 'list', 'psss://Example API']).stdout, '"Example API" has no files.\n');
  assert.equal(d.psss(['verify']).code, 0);
});

test('file put: killed part way leaves a vault that verifies and no file named in the item', async (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  const big = path.join(d.cwd, 'chunky.bin');
  const bytes = Buffer.alloc(40 * 1024 * 1024, 0x5a);
  writeFileSync(big, bytes);
  const blobs = (): string[] => {
    try { return files(path.join(d.vaultPath('Personal'), 'groups')).filter((f) => f.includes(`${path.sep}blobs${path.sep}`)); } catch { return []; } // files appear and go while it is read
  };
  for (const delay of [0, 0, 300]) {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, 'file', 'put', 'psss://Example API', 'chunky.bin', '--force'], { cwd: d.cwd, env: d.env(), stdio: 'ignore' });
    // the promise exists before the kill, so a put that already finished (its 'exit' has fired) cannot leave the test waiting
    const exited = new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
    // kill as soon as the first piece of the file is in the vault (or after the delay when the pieces are not seen), so the stop is part way
    const started = Date.now();
    while (child.exitCode === null && blobs().length === 0 && Date.now() - started < 20_000) await new Promise((r) => setTimeout(r, 5));
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    child.kill('SIGKILL');
    await exited;
    const v = d.psss(['verify']);
    assert.equal(v.code, 0, `verify after a kill: ${v.stderr}`);
    const list = d.psss(['file', 'list', 'psss://Example API']);
    assert.equal(list.code, 0, list.stderr);
    if (/chunky\.bin/.test(list.stdout)) {
      const out = path.join(d.cwd, `out-${delay}`);
      mkdirSync(out);
      assert.equal(d.psss(['file', 'get', 'psss://Example API/chunky.bin', '--output', out]).code, 0, 'if the record landed, every chunk it names is there');
      assert.ok(readFileSync(path.join(out, 'chunky.bin')).equals(bytes));
      break;
    }
  }
});

test('item and file: two writers at once both land, and verify is clean', async (t) => {
  const d = vault(t);
  const run = (args: string[]) => new Promise<number | null>((resolve) => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, ...args], { cwd: d.cwd, env: d.env(), stdio: 'ignore' });
    c.once('exit', resolve);
  });
  writeFileSync(path.join(d.cwd, 'one.txt'), 'one');
  assert.equal(d.psss(['item', 'add', '--title', 'Holder']).code, 0);
  const codes = await Promise.all([
    run(['item', 'add', '--title', 'A One']),
    run(['item', 'add', '--title', 'A Two']),
    run(['file', 'put', 'psss://Holder', 'one.txt']),
    run(['set', '--generate', '--create', 'psss://A Three/token']),
  ]);
  assert.deepEqual(codes, [0, 0, 0, 0]);
  for (const title of ['A One', 'A Two', 'A Three']) assert.equal(d.psss(['item', 'show', `psss://${title}`]).code, 0, title);
  assert.match(d.psss(['file', 'list', 'psss://Holder']).stdout, /^one\.txt/);
  assert.equal(d.psss(['verify']).code, 0);
});

test('locked vault: every new command exits 4 with a plain message and no key path from the home folder', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  renameSync(d.keyFile('Personal'), path.join(d.cwd, 'away.key'));
  writeFileSync(path.join(d.cwd, 'f.txt'), 'x');
  const cases: Array<[string[], string?]> = [
    [['item', 'show', 'psss://Example API']],
    [['item', 'add', '--title', 'X']],
    [['item', 'edit', 'psss://Example API', '--username', 'x']],
    [['item', 'purge', 'psss://Example API', '--yes']],
    [['file', 'list', 'psss://Example API']],
    [['file', 'get', 'psss://Example API/f.txt']],
    [['file', 'put', 'psss://Example API', 'f.txt']],
    [['set', '--generate', '--create', 'psss://X/token']],
  ];
  for (const [args] of cases) {
    const r = d.psss(args);
    assert.equal(r.code, 4, `psss ${args.join(' ')} should exit 4: ${r.stderr}`);
    assert.ok(!r.stderr.includes(d.home), 'no absolute home path');
    assert.equal(r.stdout, '');
  }
  assert.equal(d.psss(['generate']).code, 0, 'generate never needs the vault');
});

// ---------------------------------------------------------------- after the independent validation

test('item show: a short card number, and an extra field called card, never leak digits (real vault)', (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  lib.addItem({ title: 'Short Card', type: 2, card: { number: '12345' } });
  lib.addItem({ title: 'Odd Login', custom: { card: { value: '4111111111114417', concealed: true }, Notes: { value: 'visible words', concealed: false } } });
  lib.addItem({ title: 'Real Card', type: 2, card: { number: '4111111111114417' } });
  const short = d.psss(['item', 'show', 'psss://Short Card']);
  assert.match(short.stdout, /Card number {2,}hidden\n/);
  assert.ok(!/ends in|12345|2345/.test(short.stdout + short.stderr));
  const odd = d.psss(['item', 'show', 'psss://Odd Login']);
  assert.ok(!/ends in|4417/.test(odd.stdout + odd.stderr), 'a custom field called card is only hidden');
  assert.match(odd.stdout, /\n {2}card {2,}hidden\n/, 'and keeps its own name');
  assert.match(odd.stdout, /\n {2}Notes {2,}visible words\n/, 'a visible custom Notes is not the notes of the item');
  assert.match(d.psss(['item', 'show', 'psss://Real Card']).stdout, /Card number {2,}hidden, ends in 4417/);
});

test('item edit --field never makes a hidden field visible (real vault)', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Holder', '--secret', 'Hidden Field'], { stdin: 'hidden-value\n' }).code, 0);
  const r = d.psss(['item', 'edit', 'psss://Holder', '--field', 'Hidden Field=x']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is a hidden field, so its value is not taken as an argument, and it stays hidden\./);
  assert.match(d.psss(['item', 'show', 'psss://Holder']).stdout, /Hidden Field {2,}hidden\n/);
  assert.equal(d.psss(['get', 'psss://Holder/Hidden Field']).stdout, 'hidden-value', 'the value is unchanged');
  assert.equal(d.psss(['item', 'edit', 'psss://Holder', '--secret', 'Hidden Field'], { stdin: 'second\n' }).code, 0);
  assert.match(d.psss(['item', 'show', 'psss://Holder']).stdout, /Hidden Field {2,}hidden\n/, 'still hidden after a change');
  assert.equal(d.psss(['item', 'edit', 'psss://Holder', '--field', 'password=x']).code, 2, 'a second built-in field is refused');
});

test('a missing argument is a usage error, not a crash, through the real binary', (t) => {
  const d = vault(t);
  for (const args of [['file', 'get'], ['file', 'put'], ['file', 'put', 'psss://X'], ['item', 'edit'], ['search'], ['init']]) {
    const r = d.psss(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.ok(!/unexpected error|Cannot read|at .*\.ts:\d+/.test(r.stderr), `${args.join(' ')}: ${r.stderr}`);
  }
});

test('a reader that closes the pipe early is not an error: no stack trace, the exit code the command earned', (t) => {
  const d = vault(t);
  for (let i = 0; i < 40; i++) assert.equal(d.psss(['item', 'add', '--title', `Item number ${i}`, '--username', 'someone@example.com']).code, 0);
  const r = spawnSync('sh', ['-c', `"${process.execPath}" --disable-warning=ExperimentalWarning "${BIN}" list --json | head -c 10`], { env: d.env(), cwd: d.cwd, encoding: 'utf8' });
  assert.equal(r.stdout.length, 10);
  assert.ok(!/EPIPE|at .*\.ts:\d+|Error/.test(r.stderr), `no stack trace: ${r.stderr}`);
});

test('file put into a chunk folder that cannot be written says why in plain words and that nothing changed', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  writeFileSync(path.join(d.cwd, 'f.txt'), 'hello');
  const groups = path.join(d.vaultPath('Personal'), 'groups');
  const gid = readdirSync(groups)[0]!;
  chmodSync(path.join(groups, gid), 0o555);
  t.after(() => { try { chmodSync(path.join(groups, gid), 0o755); } catch { /* the folder is already gone */ } });
  const r = d.psss(['file', 'put', 'psss://Example API', 'f.txt']);
  assert.equal(r.code, 1);
  assert.ok(!/EACCES|EPERM/.test(r.stderr), `no raw code: ${r.stderr}`);
  assert.ok(!r.stderr.includes(d.home), 'no absolute home path');
  assert.match(r.stderr, /\(permission denied\)\. Nothing was changed\./);
  assert.equal(r.stdout, '');
  chmodSync(path.join(groups, gid), 0o755);
  assert.equal(d.psss(['file', 'list', 'psss://Example API']).stdout, '"Example API" has no files.\n');
  assert.equal(d.psss(['verify']).code, 0);
});

test('file names: 255 bytes is stored and read back; 300 is refused; hostile stored names are written under safe ones', (t) => {
  const d = vault(t);
  assert.equal(d.psss(['item', 'add', '--title', 'Example API']).code, 0);
  writeFileSync(path.join(d.cwd, 'f.txt'), 'hello');
  const ok = `${'a'.repeat(251)}.pem`;
  assert.equal(d.psss(['file', 'put', 'psss://Example API', 'f.txt', '--name', ok]).code, 0);
  const refused = d.psss(['file', 'put', 'psss://Example API', 'f.txt', '--name', `${'b'.repeat(300)}.pem`]);
  assert.equal(refused.code, 2);
  assert.ok(refused.stderr.length < 400, 'the message does not print the whole name');
  const lib = d.library('Personal');
  void lib;
  assert.equal(d.psss(['file', 'put', 'psss://Example API', 'f.txt', '--name', 'NUL.txt']).code, 0);
  assert.equal(d.psss(['file', 'put', 'psss://Example API', 'f.txt', '--name', 'a:b?.txt']).code, 0);
  mkdirSync(path.join(d.cwd, 'out'));
  for (const [stored, safe] of [[ok, ok], ['NUL.txt', '_NUL.txt'], ['a:b?.txt', 'a_b_.txt']] as const) {
    const g = d.psss(['file', 'get', `psss://Example API/${encodeURIComponent(stored)}`, '--output', 'out']);
    assert.equal(g.code, 0, `${stored.slice(0, 20)}: ${g.stderr}`);
    assert.equal(readFileSync(path.join(d.cwd, 'out', safe), 'utf8'), 'hello');
  }
});

test('a secret read from a silent, open standard input says that it is waiting', async (t) => {
  const d = vault(t);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', BIN, 'item', 'add', '--title', 'Waiting', '--password'], { cwd: d.cwd, env: d.env(), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  const started = Date.now();
  while (!/Waiting for the value on standard input/.test(err) && Date.now() - started < 15_000) await new Promise((r) => setTimeout(r, 50));
  assert.match(err, /^Waiting for the value on standard input\. End it with Ctrl-D, or pipe it in\.\n/);
  child.stdin.end('late-secret\n');
  await new Promise((r) => child.once('close', r));
  assert.equal(d.psss(['get', 'psss://Waiting/password']).stdout, 'late-secret');
});
