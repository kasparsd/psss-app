// Real files made by KeePassXC 2.8 (see scripts/make-fixtures.ts and the README for how each was made). The tests read the
// committed files and check every field the seed XML (fixtures/seed.xml) and the command-line steps put in them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findEntry, getField, orderedHistory, readKdbx, readKdbxFormat, walkEntries, walkGroups, writeKdbx } from '../src/index.ts';
import type { KdbxDatabase, KdbxEntry, KdbxKey } from '../src/index.ts';
import { fixture, fixtureDir, normalize, seeded } from './support.ts';

const PASSWORD = 'fixture-password';
const key: KdbxKey = { password: PASSWORD };
const open = (name: string, k: KdbxKey = key): KdbxDatabase => readKdbx(fixture(name), k);
const byTitle = (db: KdbxDatabase, title: string): KdbxEntry => {
  const v = [...walkEntries(db)].find((x) => getField(x.entry, 'Title') === title);
  assert.ok(v, `an entry titled ${title}`);
  return v.entry;
};
const field = (e: KdbxEntry, name: string) => e.fields.find((f) => f.name === name);
const names = (e: KdbxEntry) => e.fields.map((f) => f.name).sort();
const iso = (d: Date | undefined) => d?.toISOString();

/** What every fixture made from seed.xml holds. */
function checkSeed(db: KdbxDatabase, label: string) {
  assert.equal(db.meta.name, 'Fixture', `${label}: database name`);
  assert.equal(db.meta.description, 'Made by make-fixtures.ts', `${label}: description`);
  assert.equal(db.meta.defaultUserName, 'fixture-user', `${label}: default user name`);
  assert.equal(db.meta.historyMaxItems, 10, `${label}: history max items`);
  assert.equal(db.meta.historyMaxSize, 6_291_456, `${label}: history max size`);
  assert.equal(db.meta.recycleBinEnabled, true, `${label}: recycle bin on`);
  assert.equal(db.meta.maintenanceHistoryDays, 365, `${label}: maintenance days`);
  assert.equal(db.meta.customData.find((c) => c.key === 'fixture-key')?.value, 'fixture-value', `${label}: database custom data`);
  assert.ok(db.meta.unknown.some((n) => n.name === 'MemoryProtection'), `${label}: memory protection kept as unknown XML`);

  assert.equal(db.root.name, 'Root', `${label}: root group`);
  assert.equal(db.root.uuid, '01'.repeat(16), `${label}: root group uuid`);
  assert.equal(db.root.notes, 'Root notes', `${label}: root group notes`);
  const work = db.root.groups.find((g) => g.name === 'Work')!;
  assert.equal(work.uuid, '02'.repeat(16), `${label}: Work uuid`);
  assert.equal(work.iconId, 5, `${label}: Work icon`);
  assert.equal(work.notes, 'Work notes', `${label}: Work notes`);
  const clients = work.groups.find((g) => g.name === 'Clients')!;
  assert.equal(clients.uuid, '03'.repeat(16), `${label}: Clients uuid`);
  assert.deepEqual(db.root.groups.find((g) => g.name === 'Empty')?.entries, [], `${label}: Empty group`);
  assert.deepEqual(clients.groups, [], `${label}: Clients has no subgroups`);

  const login = byTitle(db, 'Example Login');
  assert.equal(login.uuid, '11'.repeat(16), `${label}: login uuid`);
  assert.equal(getField(login, 'URL'), 'https://example.com/login');
  assert.equal(getField(login, 'Notes'), 'line one\nline two & <tags> "quotes"', `${label}: notes with markup`);
  assert.equal(getField(login, 'Account Number'), '12345');
  assert.equal(getField(login, 'PIN'), '9876');
  assert.equal(getField(login, 'Recovery Codes'), 'a1b2-c3d4 e5f6');
  assert.equal(field(login, 'Account Number')?.protected, false, `${label}: plain custom field`);
  assert.equal(field(login, 'PIN')?.protected, true, `${label}: protected custom field`);
  assert.equal(field(login, 'Recovery Codes')?.protected, true, `${label}: protected custom field`);
  assert.equal(field(login, 'Password')?.protected, true, `${label}: password protected`);
  assert.equal(field(login, 'Title')?.protected, false, `${label}: title plain`);
  assert.deepEqual(names(login), ['Account Number', 'Notes', 'PIN', 'Password', 'Recovery Codes', 'Title', 'URL', 'UserName'], `${label}: field names`);
  assert.deepEqual([...login.tags].sort(), ['email', 'work'], `${label}: tags`);
  assert.equal(login.foregroundColor, '#FF0000');
  assert.equal(login.backgroundColor, '#00FF00');
  assert.equal(login.times.expires, true);
  assert.equal(iso(login.times.expiry), '2030-01-02T03:04:05.000Z');
  assert.equal(iso(login.times.creation), '2021-03-04T05:06:07.000Z');
  assert.equal(login.times.usageCount, 7);
  assert.equal(login.autoType?.name, 'AutoType', `${label}: auto-type kept as opaque XML`);

  const uni = byTitle(db, 'Unicode ☕ title');
  assert.equal(getField(uni, 'Emoji'), '😀 four-byte', `${label}: four-byte characters`);

  const vpn = byTitle(db, 'Work VPN');
  assert.equal(getField(vpn, 'UserName'), 'bob');
  assert.equal(getField(vpn, 'Password'), 'vpn-secret');
  assert.equal(getField(vpn, 'URL'), 'https://vpn.example');
  assert.deepEqual(vpn.tags, ['vpn']);
  assert.ok(work.entries.includes(vpn), `${label}: VPN is in Work`);

  const cli = byTitle(db, 'Added by CLI');
  assert.equal(getField(cli, 'UserName'), 'dave');
  assert.equal(getField(cli, 'Password'), 'cli-secret');
  assert.equal(getField(cli, 'URL'), 'https://cli.example');
  assert.equal(getField(cli, 'Notes'), 'added by keepassxc-cli');
  assert.ok(work.entries.includes(cli), `${label}: the entry added by the CLI is in Work`);

  assert.equal(getField(byTitle(db, 'Client Notes'), 'Notes'), 'kept');
  assert.ok(clients.entries.some((e) => getField(e, 'Title') === 'Client Notes'));
  return { login, uni, clients };
}

test('fixture kx31-password: KeePassXC KDBX 3.1 with password, AES-KDF, custom and protected fields, history, nested groups', () => {
  const fmt = readKdbxFormat(fixture('kx31-password.kdbx'));
  assert.deepEqual(fmt, { version: '3.1', cipher: 'aes256', compression: 'gzip', kdf: { type: 'aes', rounds: 1_000_000 } });
  const db = open('kx31-password.kdbx');
  const { login, clients } = checkSeed(db, 'kx31');
  assert.equal(getField(login, 'UserName'), 'alice@example.net', 'changed by keepassxc-cli edit');
  assert.equal(getField(login, 'Password'), 'third-password');
  assert.deepEqual(login.history.map((h) => getField(h, 'Password')), ['hunter2-ünï', 'second-password'], 'history made by two edits, original first');
  assert.deepEqual(login.history.map((h) => getField(h, 'UserName')), ['alice@example.com', 'alice@example.net']);
  assert.equal(iso(login.history[0]!.times.lastModification), '2021-03-04T05:06:07.000Z', 'the first history item has the original time');
  assert.equal(orderedHistory(login).at(-1)!.times.lastModification!.getTime() >= login.history[0]!.times.lastModification!.getTime(), true);
  assert.ok(field(login.history[0]!, 'Password')?.protected, 'protection is kept in history');
  assert.equal(login.attachments.length, 0);
  assert.ok(clients.entries.some((e) => getField(e, 'Title') === 'Client Portal'), 'not yet deleted in this file');
  assert.deepEqual(db.deletedObjects, []);
  assert.equal(db.meta.recycleBinUuid, undefined, 'no bin was made yet');
  assert.equal([...walkGroups(db)].length, 4, 'root, Work, Clients and Empty; no bin yet');
});

test('fixture kx41-recycled-attachment: KeePassXC KDBX 4.1 (AES-KDF), an attachment and an entry in the Recycle Bin', () => {
  assert.deepEqual(readKdbxFormat(fixture('kx41-recycled-attachment.kdbx')), { version: '4.1', cipher: 'aes256', compression: 'gzip', kdf: { type: 'aes', rounds: 1_000_000 } });
  const db = open('kx41-recycled-attachment.kdbx');
  const { login } = checkSeed(db, 'kx41');
  assert.equal(login.attachments.length, 1);
  const att = login.attachments[0]!;
  assert.equal(att.name, 'report.bin');
  assert.deepEqual([...att.data], Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff), 'attachment bytes, including values that are not UTF-8');
  assert.equal(login.history.length, 3, 'two edits and the attachment import each leave a version');
  assert.deepEqual(login.history.map((h) => getField(h, 'Password')), ['hunter2-ünï', 'second-password', 'third-password']);
  const bin = db.root.groups.find((g) => g.name === 'Recycle Bin')!;
  assert.equal(db.meta.recycleBinUuid, bin.uuid, 'metadata names the bin');
  assert.equal(bin.iconId, 43);
  const portal = bin.entries.find((e) => getField(e, 'Title') === 'Client Portal')!;
  assert.ok(portal, 'the deleted entry is in the bin');
  assert.equal(portal.previousParentGroup, '03'.repeat(16), 'KDBX 4.1 remembers the group it came from');
  assert.equal(getField(portal, 'Password'), 'portal-secret');
  assert.equal(findEntry(db, portal.uuid)!.inRecycleBin, true);
  assert.equal([...walkEntries(db, { includeRecycleBin: false })].some((v) => v.entry === portal), false);
});

test('fixture kx41-argon2id-chacha: KeePassXC re-saved a KDBX 4.1 file with Argon2id and ChaCha20', () => {
  assert.deepEqual(readKdbxFormat(fixture('kx41-argon2id-chacha.kdbx')), {
    version: '4.1', cipher: 'chacha20', compression: 'gzip', kdf: { type: 'argon2id', memoryKiB: 16384, iterations: 2, parallelism: 2 } });
  const db = open('kx41-argon2id-chacha.kdbx');
  const { uni } = checkSeed(db, 'argon2id-chacha');
  assert.equal(getField(uni, 'Password'), 'unicode-new-password', 'changed by keepassxc-cli edit after our write');
  assert.deepEqual(uni.history.map((h) => getField(h, 'Password')), ['pässwörd-日本語'], 'the version before it is in history');
  assert.equal(byTitle(db, 'Example Login').attachments[0]!.name, 'report.bin');
  assert.equal(db.root.groups.find((g) => g.name === 'Recycle Bin')!.entries.length, 1);
});

test('fixture kx41-argon2d-aes: KeePassXC re-saved a KDBX 4.1 file with Argon2d, AES-256 and no compression', () => {
  assert.deepEqual(readKdbxFormat(fixture('kx41-argon2d-aes.kdbx')), {
    version: '4.1', cipher: 'aes256', compression: 'none', kdf: { type: 'argon2d', memoryKiB: 8192, iterations: 3, parallelism: 1 } });
  const db = open('kx41-argon2d-aes.kdbx');
  const { uni } = checkSeed(db, 'argon2d-aes');
  assert.equal(getField(uni, 'UserName'), 'renamed-user');
  assert.deepEqual(uni.history.map((h) => getField(h, 'UserName')), ['ünïcödé']);
  assert.equal(getField(uni, 'Password'), 'pässwörd-日本語');
});

const small = { title: 'Key file', user: 'key-user', password: 'key-secret' };
const keyFiles = (name: string) => new Uint8Array(readFileSync(join(fixtureDir, 'keys', name)));
for (const [file, label, k] of [
  ['kx31-keyfile-v2.kdbx', 'key file only, XML version 2', { keyFile: keyFiles('v2.keyx') }],
  ['kx31-password-keyfile.kdbx', 'password and a key file (XML version 2)', { password: PASSWORD, keyFile: keyFiles('v2.keyx') }],
  ['kx31-keyfile-v1.kdbx', 'key file only, XML version 1 (base64)', { keyFile: keyFiles('v1.keyx') }],
  ['kx31-keyfile-raw32.kdbx', 'key file only, 32 raw bytes', { keyFile: keyFiles('raw32.key') }],
  ['kx31-keyfile-hex64.kdbx', 'key file only, 64 hex digits', { keyFile: keyFiles('hex64.key') }],
  ['kx31-keyfile-other.kdbx', 'key file only, any other file (hashed whole)', { keyFile: keyFiles('other.txt') }],
] as [string, string, KdbxKey][]) {
  test(`fixture ${file}: KeePassXC KDBX 3.1 with ${label}`, () => {
    const db = open(file, k);
    assert.equal(db.format?.version, '3.1');
    const e = db.root.entries[0]!;
    assert.equal(getField(e, 'Title')?.startsWith('Key file') || getField(e, 'Title')?.startsWith('Password and'), true, getField(e, 'Title'));
    assert.equal(getField(e, 'UserName'), small.user);
    assert.equal(getField(e, 'Password'), small.password);
    assert.equal(field(e, 'Password')?.protected, true);
    assert.throws(() => readKdbx(fixture(file), { password: 'wrong' }), { code: 'WrongKey' }, 'a wrong password is WrongKey');
    if (k.password === undefined) {
      assert.throws(() => readKdbx(fixture(file), { keyFile: keyFiles('other.txt'), ...(file.includes('other') ? { password: 'x' } : {}) }), { code: 'WrongKey' },
        'the wrong key file (or a password the file does not use) is WrongKey');
    } else {
      assert.throws(() => readKdbx(fixture(file), { keyFile: k.keyFile! }), { code: 'WrongKey' }, 'the key file without the password is WrongKey');
      assert.throws(() => readKdbx(fixture(file), { password: k.password! }), { code: 'WrongKey' }, 'the password without the key file is WrongKey');
    }
  });
}

test('fixtures: a wrong password is WrongKey for every real file, and an empty key is InvalidKey', () => {
  for (const f of ['kx31-password.kdbx', 'kx41-recycled-attachment.kdbx', 'kx41-argon2id-chacha.kdbx', 'kx41-argon2d-aes.kdbx']) {
    assert.throws(() => readKdbx(fixture(f), { password: 'not-the-password' }), { code: 'WrongKey' }, f);
    assert.throws(() => readKdbx(fixture(f), {}), { code: 'InvalidKey' }, f);
  }
});

test('fixtures: real files read, written by this package in every version and read again, keep every field (KeePassXC\'s content survives our writer)', () => {
  for (const f of ['kx31-password.kdbx', 'kx41-recycled-attachment.kdbx', 'kx41-argon2id-chacha.kdbx', 'kx41-argon2d-aes.kdbx']) {
    const db = open(f);
    for (const [version, kdf] of [['3.1', { type: 'aes', rounds: 50 }], ['4.0', { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 }], ['4.1', { type: 'aes', rounds: 50 }]] as const) {
      const back = readKdbx(writeKdbx(db, key, { version, kdf, random: seeded(f) }), key);
      assert.deepEqual(normalize(back, { publicCustomData: false }), normalize(db, { publicCustomData: false }), `${f} written as ${version}`);
    }
  }
});

test('fixtures: seed.xml is committed with the files that were made from it', () => {
  const seed = readFileSync(join(fixtureDir, 'seed.xml'), 'utf8');
  assert.ok(seed.includes('Example Login') && seed.includes('ProtectInMemory="True"'));
  assert.equal(Buffer.from(keyFiles('raw32.key')).length, 32);
  assert.equal(Buffer.from(keyFiles('hex64.key')).length, 64);
});
