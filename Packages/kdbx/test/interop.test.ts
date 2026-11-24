// Interop with KeePassXC through keepassxc-cli: files this package writes are opened, listed, shown and exported by
// KeePassXC and compared; files KeePassXC edits after us are read back. Skipped with a message when keepassxc-cli is absent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addAttachment, getField, newDatabase, newEntry, newGroup, parseTime, parseXml, readKdbx, walkEntries, writeKdbx,
} from '../src/index.ts';
import type { KdbxDatabase, KdbxKey, WriteOptions, XmlNode } from '../src/index.ts';
import { cli, cliSkip, keyFiles, sampleDatabase, seeded, tempDir } from './support.ts';

const opts = { skip: cliSkip };
const dir = tempDir();

/** keepassxc-cli arguments and stdin that open a database with this key. */
function keyArgs(name: string, key: KdbxKey): { args: string[]; input: string } {
  const args: string[] = [];
  if (key.keyFile) {
    const path = join(dir, `${name}.key`);
    writeFileSync(path, key.keyFile);
    args.push('-k', path);
  }
  if (key.password === undefined) args.push('--no-password');
  return { args, input: key.password !== undefined ? `${key.password}\n` : '' };
}

function show(file: string, key: KdbxKey, entry: string): string {
  const { args, input } = keyArgs('show', key);
  const r = cli(['show', '-q', '-s', '--all', ...args, file, entry], input);
  assert.equal(r.status, 0, `keepassxc-cli show failed: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function exportXml(file: string, key: KdbxKey): XmlNode {
  const { args, input } = keyArgs('export', key);
  const r = cli(['export', '-q', '-f', 'xml', ...args, file], input);
  assert.equal(r.status, 0, `keepassxc-cli export failed: ${r.stderr}`);
  return parseXml(r.stdout, { maxDepth: 128, maxNodes: 1_000_000 });
}

const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
const kids = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
const text = (n: XmlNode | undefined, name: string) => kid(n, name)?.text;

const combos: [string, WriteOptions][] = [
  ['3.1 aes-kdf aes256', { version: '3.1', kdf: { type: 'aes', rounds: 200 } }],
  ['4.0 aes-kdf aes256', { version: '4.0', cipher: 'aes256', kdf: { type: 'aes', rounds: 200 } }],
  ['4.0 argon2d chacha20', { version: '4.0', cipher: 'chacha20', kdf: { type: 'argon2d', memoryKiB: 64, iterations: 2, parallelism: 2 } }],
  ['4.1 argon2id chacha20', { version: '4.1', cipher: 'chacha20', kdf: { type: 'argon2id', memoryKiB: 64, iterations: 2, parallelism: 2 } }],
  ['4.1 argon2id aes256, no compression', { version: '4.1', cipher: 'aes256', compression: 'none', kdf: { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 } }],
  ['4.1 aes-kdf chacha20', { version: '4.1', cipher: 'chacha20', kdf: { type: 'aes', rounds: 200 } }],
];

for (const [name, options] of combos) {
  test(`interop: KeePassXC opens what this package writes as ${name}, lists it, shows every field and exports the attachment`, opts, () => {
    const db = sampleDatabase();
    const key: KdbxKey = { password: 'interop pw' };
    const file = join(dir, `${name.replace(/\W+/g, '-')}.kdbx`);
    writeFileSync(file, writeKdbx(db, key, { ...options, random: seeded(name) }));

    const ls = cli(['ls', '-q', '-R', file], 'interop pw\n');
    assert.equal(ls.status, 0, `ls: ${ls.stderr}`);
    for (const wanted of ['Login', 'Work/', 'Clients/', 'Portal', 'Recycle Bin/', 'Gone']) assert.ok(ls.stdout.includes(wanted), `ls lists ${wanted}:\n${ls.stdout}`);

    const out = show(file, key, 'Login');
    assert.ok(out.includes('UserName: alice@example.com'), out);
    assert.ok(out.includes('Password: p@ss<word>&"1" ü 漢'), 'protected password decrypts in KeePassXC');
    assert.ok(out.includes('URL: https://example.com/login'));
    assert.ok(out.includes('Account: 12345'));
    assert.ok(out.includes('PIN: 9876'), 'protected custom field decrypts in KeePassXC');
    assert.ok(out.includes('line one') && out.includes('line three & <b>bold</b>'), 'notes with markup');
    assert.ok(out.includes('work') && out.includes('email'), 'tags');
    assert.ok(show(file, key, 'Unicode 😀 é').includes('Password: пароль'), 'a protected value after several others still decrypts: the inner stream is aligned');

    const blob = join(dir, 'blob.out');
    const att = cli(['attachment-export', '-q', file, 'Login', 'blob.bin', blob], 'interop pw\n');
    assert.equal(att.status, 0, att.stderr);
    assert.deepEqual(new Uint8Array(readFileSync(blob)), db.root.entries[0]!.attachments[0]!.data, 'attachment bytes');
    const secret = join(dir, 'secret.out');
    assert.equal(cli(['attachment-export', '-q', file, 'Login', 'secret.bin', secret], 'interop pw\n').status, 0);
    assert.deepEqual([...readFileSync(secret)], [0, 1, 2, 255], 'protected attachment bytes');

    // KeePassXC's own export, compared with the model: it saw the history, tags, colours, times and groups we wrote.
    const x = exportXml(file, key);
    const meta = kid(x, 'Meta');
    assert.equal(text(meta, 'DatabaseName'), 'Sample ☕');
    assert.equal(text(meta, 'DefaultUserName'), 'sam');
    const root = kid(kid(x, 'Root'), 'Group')!;
    assert.equal(text(root, 'Name'), 'Root');
    const login = kids(root, 'Entry')[0]!;
    assert.deepEqual(text(login, 'Tags')!.split(/[;,]/).sort(), ['email', 'work'], 'KeePassXC reads our ";" separated tags (and writes them back with ",")');
    assert.equal(text(login, 'ForegroundColor'), '#FF0000');
    assert.equal(text(kid(login, 'Times'), 'Expires'), 'True');
    assert.equal(text(kid(login, 'Times'), 'UsageCount'), '7');
    assert.equal(parseTime(text(kid(login, 'Times'), 'ExpiryTime')!)!.toISOString(), '2030-01-02T03:04:05.000Z');
    assert.equal(parseTime(text(kid(login, 'Times'), 'CreationTime')!)!.toISOString(), '2021-03-04T05:06:07.000Z');
    const history = kids(kid(login, 'History'), 'Entry');
    assert.equal(history.length, 2, 'both history versions');
    const pw = (e: XmlNode) => kids(e, 'String').find((s) => text(s, 'Key') === 'Password')!.children.find((c) => c.name === 'Value')!.text;
    assert.deepEqual(history.map(pw), ['first', 'second']);
    const groups = kids(root, 'Group').map((g) => text(g, 'Name'));
    assert.deepEqual(groups, ['Work', 'Recycle Bin']);
  });
}

for (const [label, key] of [
  ['password', { password: 'pässwörd 日本' }],
  ['key file xml v2', { keyFile: keyFiles.v2 }],
  ['key file xml v1', { keyFile: keyFiles.v1 }],
  ['key file raw 32 bytes', { keyFile: keyFiles.raw32 }],
  ['key file 64 hex digits', { keyFile: keyFiles.hex64 }],
  ['key file any other file', { keyFile: keyFiles.other }],
  ['password and key file', { password: 'both', keyFile: keyFiles.v2 }],
  ['password and a raw key file', { password: 'both', keyFile: keyFiles.raw32 }],
] as [string, KdbxKey][]) {
  for (const [version, kdf] of [['3.1', { type: 'aes', rounds: 100 }], ['4.1', { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 }]] as const) {
    test(`interop: KeePassXC opens a KDBX ${version} file written with ${label}`, opts, () => {
      const db = newDatabase({ name: 'K' });
      db.root.entries.push(newEntry({ title: 'E', username: 'u', password: 'secret-123' }));
      const file = join(dir, `key-${label.replace(/\W+/g, '-')}-${version}.kdbx`);
      writeFileSync(file, writeKdbx(db, key, { version, kdf }));
      assert.ok(show(file, key, 'E').includes('Password: secret-123'));
      const wrong = keyArgs('wrong', { ...key, password: key.password === undefined ? undefined : 'not it' });
      if (key.password !== undefined) assert.notEqual(cli(['show', '-q', '-s', ...wrong.args, file, 'E'], 'not it\n').status, 0, 'KeePassXC refuses a wrong password too');
    });
  }
}

test('interop: KeePassXC edits a file this package wrote (add, edit, attachment, delete) and this package reads the result', opts, () => {
  for (const [name, options] of [combos[0]!, combos[3]!, combos[4]!] as [string, WriteOptions][]) {
    const db = sampleDatabase();
    const file = join(dir, `edited-${name.replace(/\W+/g, '-')}.kdbx`);
    const key = { password: 'edit pw' };
    writeFileSync(file, writeKdbx(db, key, { ...options, random: seeded(name) }));
    assert.equal(cli(['add', '-q', '-u', 'zed', '-p', '--url', 'https://zed.example', file, 'Work/Zed'], 'edit pw\nzed-secret\n').status, 0);
    assert.equal(cli(['edit', '-q', '-p', file, 'Login'], 'edit pw\nlogin-new-password\n').status, 0);
    const payload = join(dir, 'payload.bin');
    writeFileSync(payload, Uint8Array.from({ length: 5000 }, (_, i) => (i * 11) & 0xff));
    assert.equal(cli(['attachment-import', '-q', file, 'Unicode 😀 é', 'payload.bin', payload], 'edit pw\n').status, 0);
    assert.equal(cli(['rm', '-q', file, 'Work/Clients/Portal'], 'edit pw\n').status, 0);

    const back = readKdbx(new Uint8Array(readFileSync(file)), key);
    const by = (title: string) => [...walkEntries(back)].find((v) => getField(v.entry, 'Title') === title);
    const login = by('Login')!.entry;
    assert.equal(getField(login, 'Password'), 'login-new-password', `${name}: edit`);
    assert.equal(login.history.at(-1)!.fields.find((f) => f.name === 'Password')!.value, 'p@ss<word>&"1" ü 漢', `${name}: the old password went into history`);
    assert.equal(login.history.length, 3, `${name}: two of ours and one made by KeePassXC`);
    assert.equal(getField(login, 'PIN'), '9876', `${name}: untouched protected field`);
    assert.equal(login.fields.find((f) => f.name === 'PIN')!.protected, true);
    assert.deepEqual(login.attachments.find((a) => a.name === 'blob.bin')?.data, db.root.entries[0]!.attachments[0]!.data, `${name}: attachment kept`);
    assert.equal(getField(by('Zed')!.entry, 'Password'), 'zed-secret', `${name}: entry added by KeePassXC`);
    assert.equal(by('Zed')!.path.join('/'), 'Work');
    assert.equal(by('Unicode 😀 é')!.entry.attachments.find((a) => a.name === 'payload.bin')!.data.length, 5000, `${name}: attachment added by KeePassXC`);
    assert.equal(by('Portal')!.inRecycleBin, true, `${name}: deleted entry is in the bin`);
    assert.equal(back.root.groups[0]!.name, 'Work');
    assert.equal(back.meta.name, 'Sample ☕', `${name}: metadata`);
    assert.deepEqual(back.meta.customData.find((c) => c.key === 'plain')?.value, 'value', `${name}: database custom data kept by KeePassXC`);
  }
});

test('interop: a database KeePassXC creates from scratch (db-create, add, mkdir, attachment-import) reads here with every field', opts, () => {
  const file = join(dir, 'fromxc.kdbx');
  assert.equal(cli(['db-create', '-q', '-p', '-t', '100', file], 'xc pw\nxc pw\n').status, 0);
  assert.equal(cli(['mkdir', '-q', file, 'Banking'], 'xc pw\n').status, 0);
  assert.equal(cli(['add', '-q', '-u', 'ann', '-p', '--url', 'https://bank.example', '--notes', 'n1\nn2', file, 'Banking/Bank'], 'xc pw\nbank-secret\n').status, 0);
  assert.equal(cli(['add', '-q', '-u', 'root-user', '-p', file, 'Top'], 'xc pw\ntop-secret\n').status, 0);
  const payload = join(dir, 'p2.bin');
  writeFileSync(payload, new Uint8Array([0, 0, 1, 2, 3, 0xff, 0xfe]));
  assert.equal(cli(['attachment-import', '-q', file, 'Banking/Bank', 'p2.bin', payload], 'xc pw\n').status, 0);
  const db = readKdbx(new Uint8Array(readFileSync(file)), { password: 'xc pw' });
  const bank = [...walkEntries(db)].find((v) => getField(v.entry, 'Title') === 'Bank')!;
  assert.equal(bank.path.join('/'), 'Banking');
  assert.equal(getField(bank.entry, 'UserName'), 'ann');
  assert.equal(getField(bank.entry, 'Password'), 'bank-secret');
  assert.equal(getField(bank.entry, 'URL'), 'https://bank.example');
  assert.equal(getField(bank.entry, 'Notes'), 'n1\nn2');
  assert.deepEqual([...bank.entry.attachments[0]!.data], [0, 0, 1, 2, 3, 0xff, 0xfe]);
  assert.equal(getField([...walkEntries(db)].find((v) => getField(v.entry, 'Title') === 'Top')!.entry, 'Password'), 'top-secret');
});

test('interop: an empty group and an entry with only a title round trip through KeePassXC unchanged', opts, () => {
  const db: KdbxDatabase = newDatabase({ name: 'Edge' });
  db.root.groups.push(newGroup('Empty group'));
  db.root.entries.push(newEntry({ title: 'Only a title' }));
  const e = newEntry({ title: 'Big attachment' });
  addAttachment(e, 'a.bin', Uint8Array.from({ length: 1_500_000 }, (_, i) => (i * 7919) >>> 3));
  db.root.entries.push(e);
  const file = join(dir, 'edge.kdbx');
  const key = { password: 'edge' };
  writeFileSync(file, writeKdbx(db, key, { kdf: { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 } }));
  assert.ok(show(file, key, 'Only a title').includes('Title: Only a title'));
  const out = join(dir, 'a.out');
  assert.equal(cli(['attachment-export', '-q', file, 'Big attachment', 'a.bin', out], 'edge\n').status, 0);
  assert.deepEqual(new Uint8Array(readFileSync(out)), e.attachments[0]!.data, 'a 1.5 MB attachment spanning two blocks');
});
