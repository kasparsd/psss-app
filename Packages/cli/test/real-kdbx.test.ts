// import and export through the real binary on a real vault: the fixtures of @psss/kdbx, keepassxc-cli, and files that are wrong in every way.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readKdbx } from '../../kdbx/src/index.ts';
import { device, SECRET } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'kdbx', 'fixtures');
const PW = 'fixture-password';
const XC = '/opt/homebrew/bin/keepassxc-cli';

/** Everything below the vault folder and the state folder, with sizes: a dry run and a refused file must leave it as it was. */
function snapshot(d: Device, name = 'Personal'): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir).sort()) {
      const p = path.join(dir, n);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push(`${p} ${s.size} ${s.mtimeMs}`);
    }
  };
  walk(d.vaultPath(name));
  walk(d.stateDir(name));
  return out;
}

function ready(t: TestContext): { d: Device; env: Record<string, string>; fixture: string } {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup: init should work');
  const fixture = path.join(d.cwd, 'Family.kdbx');
  copyFileSync(path.join(FIXTURES, 'kx41-recycled-attachment.kdbx'), fixture);
  const pwFile = path.join(d.root, 'kdbx-password.txt');
  writeFileSync(pwFile, `${PW}\n`, { mode: 0o600 });
  return { d, env: { PSSS_KDBX_PASSWORD_FILE: pwFile }, fixture };
}

test('import: a dry run changes nothing at all, the import adds, and the same file again adds nothing', (t) => {
  const { d, env, fixture } = ready(t);
  const before = snapshot(d);
  const dry = d.psss(['import', fixture, '--dry-run'], { env });
  assert.equal(dry.code, 0, `a dry run should work: ${dry.stderr}`);
  assert.match(dry.stdout, /^Would add 5 items and 1 attachment to Only Me\.\n/, 'the dry run says what it would do');
  assert.match(dry.stdout, /Nothing was changed\.\n$/, 'and that it changed nothing');
  assert.deepEqual(snapshot(d), before, 'no file of the vault or of the device state changed, not even what the device remembers');
  const real = d.psss(['import', fixture], { env });
  assert.equal(real.code, 0, `the import should work: ${real.stderr}`);
  assert.match(real.stdout, /^Added 5 items and 1 attachment to Only Me\.\n/, 'the import says what it did');
  const list = d.psss(['list']);
  for (const title of ['Example Login', 'Work VPN', 'Client Notes']) assert.match(list.stdout, new RegExp(title), `${title} is in the vault`);
  const got = d.psss(['get', 'psss://Example Login/username']);
  assert.equal(got.stdout, 'alice@example.net', 'a field came through');
  const after = snapshot(d);
  const second = d.psss(['import', fixture], { env });
  assert.equal(second.code, 0, 'a second run works');
  assert.match(second.stdout, /^Nothing new to add to Only Me\.\n5 items are already here, unchanged\.\n/, 'the second run reports unchanged');
  assert.deepEqual(snapshot(d), after, 'and wrote nothing');
  assert.equal(d.psss(['verify']).code, 0, 'the vault still verifies');
  const json = JSON.parse(d.psss(['import', fixture, '--json'], { env }).stdout) as { added: number; unchanged: number; items: unknown[] };
  assert.equal(json.added, 0, 'JSON: nothing added');
  assert.equal(json.unchanged, 5, 'JSON: five unchanged');
  assert.equal(json.items.length, 5, 'JSON: one line per entry');
});

test('import: a wrong password, a damaged file, a file that is not KeePass, one that is too large and one that is not there all change nothing', (t) => {
  const { d, env, fixture } = ready(t);
  const before = snapshot(d);
  const wrong = d.psss(['import', fixture], { stdin: 'not-the-password\n' });
  assert.equal(wrong.code, 4, 'a wrong password exits 4');
  assert.equal(wrong.stderr, 'The password or key file does not open ./Family.kdbx. Nothing was changed.\nA damaged file looks the same.\n', 'and says so without saying more');
  assert.ok(!wrong.stderr.includes('not-the-password'), 'the password is not repeated');
  const damaged = path.join(d.cwd, 'damaged.kdbx');
  copyFileSync(fixture, damaged);
  truncateSync(damaged, 2000);
  const cut = d.psss(['import', damaged], { env });
  assert.equal(cut.code, 1, 'a truncated file exits 1');
  assert.match(cut.stderr, /damaged\.kdbx is damaged, so none of it was read\. Nothing was changed\.\n$/, 'and says it is damaged');
  const flipped = path.join(d.cwd, 'flipped.kdbx');
  const bytes = readFileSync(fixture);
  bytes[bytes.length - 40] ^= 0xff;
  writeFileSync(flipped, bytes);
  const bad = d.psss(['import', flipped], { env });
  assert.notEqual(bad.code, 0, 'a file with a flipped byte is refused');
  assert.equal(statSync(flipped).size, bytes.length, 'and left alone');
  const text = path.join(d.cwd, 'notes.txt');
  writeFileSync(text, 'just some text\n');
  const notKdbx = d.psss(['import', text], { env });
  assert.equal(notKdbx.code, 1, 'a text file exits 1');
  assert.equal(notKdbx.stderr, './notes.txt is not a KeePass file (KDBX 3 or 4). Nothing was changed.\n', 'and says what it is not');
  const huge = path.join(d.cwd, 'huge.kdbx');
  writeFileSync(huge, '');
  truncateSync(huge, 600 * 1024 * 1024);
  const big = d.psss(['import', huge], { env });
  assert.equal(big.code, 1, 'a file over 512 MiB exits 1');
  assert.match(big.stderr, /^\.\/huge\.kdbx is larger than Psss will read \(512 MiB\)\./, 'without reading it');
  const gone = d.psss(['import', path.join(d.cwd, 'nothing.kdbx')], { env });
  assert.equal(gone.code, 1, 'a missing file exits 1');
  assert.equal(snapshot(d).join('\n'), before.join('\n'), 'none of this changed the vault or the device state');
});

test('export: writes a KeePass file that opens with the password, is private, is never replaced without --force, and says what it leaves out', (t) => {
  const { d, env, fixture } = ready(t);
  d.psss(['import', fixture], { env });
  d.psss(['set', '--create', 'psss://Example API/token'], { stdin: SECRET });
  const out = path.join(d.cwd, 'Personal.kdbx');
  const wrote = d.psss(['export', '--format', 'kdbx', out], { stdin: 'export-pw\n' });
  assert.equal(wrote.code, 0, `the export should work: ${wrote.stderr}`);
  assert.equal(wrote.stdout, 'Wrote ./Personal.kdbx with 6 items.\n', 'the export says what it wrote');
  assert.equal(statSync(out).mode & 0o077, 0, 'the file is readable by its owner only');
  const db = readKdbx(new Uint8Array(readFileSync(out)), { password: 'export-pw' });
  const titles = db.root.groups.flatMap((g) => g.entries).map((e) => e.fields.find((f) => f.name === 'Title')?.value);
  assert.ok(titles.includes('Example API') && titles.includes('Example Login'), 'every item is in the file');
  const token = db.root.groups.flatMap((g) => g.entries).find((e) => e.fields.find((f) => f.name === 'Title')?.value === 'Example API');
  assert.ok(token, 'the item made with set is there');
  const refused = d.psss(['export', '--format', 'kdbx', out], { stdin: 'other\n' });
  assert.equal(refused.code, 1, 'a file that is there is not replaced');
  assert.equal(readKdbx(new Uint8Array(readFileSync(out)), { password: 'export-pw' }).root.groups.length > 0, true, 'and is as it was');
  const forced = d.psss(['export', '--format', 'kdbx', out, '--force'], { stdin: 'second-pw\n' });
  assert.equal(forced.code, 0, '--force replaces it');
  assert.doesNotThrow(() => readKdbx(new Uint8Array(readFileSync(out)), { password: 'second-pw' }), 'with the new password');
  const dry = d.psss(['export', '--format', 'kdbx', path.join(d.cwd, 'never.kdbx'), '--dry-run']);
  assert.equal(dry.stdout, 'Would write ./never.kdbx with 6 items.\nNothing was written.\n', 'a dry run writes nothing');
  assert.equal(existsSync(path.join(d.cwd, 'never.kdbx')), false, 'and no file');
  const everything = d.log.map((r) => r.stdout + r.stderr).join('\n');
  for (const secret of ['export-pw', 'second-pw', PW, SECRET]) assert.ok(!everything.includes(secret), `${secret.slice(0, 6)}... appears in no output`);
});

test('keepassxc-cli opens what export wrote, and export then import brings the same items back into a second vault', { skip: !existsSync(XC) }, (t) => {
  const { d, env, fixture } = ready(t);
  d.psss(['import', fixture], { env });
  const out = path.join(d.cwd, 'Personal.kdbx');
  assert.equal(d.psss(['export', '--format', 'kdbx', out], { stdin: 'export-pw\n' }).code, 0, 'export works');
  const ls = spawnSync(XC, ['ls', '-R', '-f', out], { input: 'export-pw\n', encoding: 'utf8' });
  assert.equal(ls.status, 0, ls.stderr);
  assert.match(ls.stdout, /Example Login/, 'keepassxc-cli lists the items');
  const shown = spawnSync(XC, ['show', '-s', '-a', 'UserName', out, 'Only Me/Example Login'], { input: 'export-pw\n', encoding: 'utf8' });
  assert.equal(shown.stdout.trim(), 'alice@example.net', 'and reads a field');
  const attachment = path.join(d.cwd, 'report.bin');
  const att = spawnSync(XC, ['attachment-export', out, 'Only Me/Example Login', 'report.bin', attachment], { input: 'export-pw\n', encoding: 'utf8' });
  assert.equal(att.status, 0, att.stderr);
  const all = (g: ReturnType<typeof readKdbx>['root']): Array<(typeof g.entries)[number]> => [...g.entries, ...g.groups.flatMap(all)];
  const original = all(readKdbx(new Uint8Array(readFileSync(fixture)), { password: PW }).root).find((e) => e.attachments.length > 0)!;
  assert.deepEqual(new Uint8Array(readFileSync(attachment)), original.attachments[0]!.data, 'the attachment comes out byte for byte');
  const second = device(t, 'psss-real-b-');
  assert.equal(second.psss(['init', 'Second', '--no-recovery']).code, 0, 'a second vault');
  const pwFile = path.join(second.root, 'pw.txt');
  writeFileSync(pwFile, 'export-pw\n');
  const imported = second.psss(['import', out], { env: { PSSS_KDBX_PASSWORD_FILE: pwFile } });
  assert.equal(imported.code, 0, imported.stderr);
  assert.match(imported.stdout, /^Added 5 items and 1 attachment to Only Me\./, 'the same five items come back');
});

test('a database made by keepassxc-cli imports through the command', { skip: !existsSync(XC) }, (t) => {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup');
  const file = path.join(d.cwd, 'made.kdbx');
  const run = (args: string[], input: string) => {
    const r = spawnSync(XC, args, { input, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`);
  };
  run(['db-create', '-p', file], 'kp-pw\nkp-pw\n');
  run(['add', '-u', 'ada', '--url', 'https://login.example.com', '-p', file, 'Site'], 'kp-pw\nsite-secret\n');
  const attach = path.join(d.cwd, 'in.txt');
  writeFileSync(attach, 'attached bytes');
  run(['attachment-import', file, 'Site', 'in.txt', attach], 'kp-pw\n');
  const pwFile = path.join(d.root, 'pw.txt');
  writeFileSync(pwFile, 'kp-pw\n');
  const r = d.psss(['import', file], { env: { PSSS_KDBX_PASSWORD_FILE: pwFile } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Added 1 item and 1 attachment to Only Me\.\n/, 'one item with its attachment');
  assert.equal(d.psss(['get', 'psss://Site/password']).stdout, 'site-secret', 'the password came through');
  assert.equal(d.psss(['get', 'psss://Site/url']).stdout, 'https://login.example.com', 'and the address');
  assert.ok(!d.log.map((x) => x.stdout + x.stderr).join('').includes('kp-pw'), 'the file password appears in no output');
});
