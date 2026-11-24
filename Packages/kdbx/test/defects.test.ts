// Regression tests for defects found by an independent validation: silent character loss on write, UUIDs that were not
// validated on write, and key-file / empty-password compatibility with KeePassXC.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addAttachment, compositeKey, findInvalidCharacters, getField, hasInvalidXmlCharacters, keyFileHash, newDatabase, newEntry, newGroup,
  readKdbx, stripInvalidCharacters, stripInvalidXmlCharacters, writeKdbx, xml,
} from '../src/index.ts';
import type { KdbxDatabase, KdbxEntry, WriteOptions } from '../src/index.ts';
import { sha256 } from '../src/ciphers.ts';
import { cli, cliSkip, seeded, tempDir } from './support.ts';

const FAST: WriteOptions = { kdf: { type: 'aes', rounds: 10 } };
const KEY = { password: 'defects' };
const versions: [string, WriteOptions][] = [
  ['3.1', { ...FAST, version: '3.1' }],
  ['4.1 chacha20', { ...FAST, version: '4.1', cipher: 'chacha20' }],
  ['4.0 aes256 uncompressed', { ...FAST, version: '4.0', cipher: 'aes256', compression: 'none' }],
];

function dbWith(entry: KdbxEntry): KdbxDatabase {
  const db = newDatabase({ name: 'Defects', random: seeded('d') });
  db.root.entries.push(entry);
  return db;
}

const code = (f: () => unknown): string => {
  try {
    f();
    return 'no error';
  } catch (e) {
    return (e as { code?: string }).code ?? `raw:${String(e)}`;
  }
};

// ------------------------------------------------------------------ 1. characters

test('characters: an unprotected value with a control character is refused, naming the entry and field but never the value', () => {
  const entry = newEntry({ notes: 'visible\u0001HIDDEN-MARKER', password: 'pw' }, { random: seeded('e') });
  const db = dbWith(entry);
  let message = '';
  try {
    writeKdbx(db, KEY, FAST);
  } catch (e) {
    assert.equal((e as { code?: string }).code, 'InvalidArgument');
    message = (e as Error).message;
  }
  assert.ok(message.includes('Notes'), message);
  assert.ok(message.includes(entry.uuid), message);
  assert.ok(!message.includes('HIDDEN-MARKER') && !message.includes('visible'), 'the value is not echoed');
});

test('characters: every kind of XML-illegal character is refused in an unprotected value', () => {
  for (const bad of ['\u0000', '\u0001', '\u000b', '\u001f', '￾', '￿', '\ud800', '\udfff', 'a\ud83dz', 'x\ude00']) {
    const db = dbWith(newEntry({ notes: `a${bad}b` }));
    assert.equal(code(() => writeKdbx(db, KEY, FAST)), 'InvalidArgument', JSON.stringify(bad));
  }
  // The allowed ones, and astral characters, are fine.
  const ok = dbWith(newEntry({ notes: 'tab\t lf\n cr\r \u{1F600} ퟿  �' }));
  const back = readKdbx(writeKdbx(ok, KEY, FAST), KEY);
  assert.equal(getField(back.root.entries[0]!, 'Notes'), 'tab\t lf\n cr\r \u{1F600} ퟿  �');
});

test('characters: it is refused wherever the value sits (group, custom data, meta, history, attachment name, unknown XML, attribute)', () => {
  const cases: [string, (db: KdbxDatabase) => void][] = [
    ['group name', (db) => { db.root.name = 'a\u0002'; }],
    ['group notes', (db) => { db.root.notes = 'a\u0002'; }],
    ['database name', (db) => { db.meta.name = 'a\u0002'; }],
    ['database custom data', (db) => { db.meta.customData.push({ key: 'k', value: 'v\u0002' }); }],
    ['entry tag', (db) => { db.root.entries[0]!.tags.push('t\u0002'); }],
    ['field name', (db) => { db.root.entries[0]!.fields.push({ name: 'n\u0002', value: '', protected: false }); }],
    ['history entry', (db) => { db.root.entries[0]!.history.push(newEntry({ notes: 'h\u0002' })); }],
    ['attachment name', (db) => { addAttachment(db.root.entries[0]!, 'a\u0002.bin', new Uint8Array(1)); }],
    ['unknown element', (db) => { db.meta.unknown.push(xml('Odd', 'v\u0002')); }],
    ['unknown attribute', (db) => { db.meta.unknown.push(xml('Odd', 'v', [['a', 'x\u0002']])); }],
    ['entry attribute', (db) => { db.root.entries[0]!.attributes.push(['a', 'x\u0002']); }],
  ];
  for (const [name, mutate] of cases) {
    const db = dbWith(newEntry({ title: 'T' }));
    mutate(db);
    assert.equal(code(() => writeKdbx(db, KEY, FAST)), 'InvalidArgument', name);
    assert.ok(findInvalidCharacters(db).length >= 1, `${name}: found`);
  }
});

test('characters: invalidCharacters "strip" drops them from unprotected values, leaves the database object alone, and keeps protected control characters', () => {
  const entry = newEntry({ notes: 'a\u0001b\ud800c', password: 'a\u0001b', fields: [{ name: 'pin', value: 'x\u0002y', protected: true }] });
  const db = dbWith(entry);
  db.root.name = 'r\u0003oot';
  for (const [name, options] of versions) {
    const back = readKdbx(writeKdbx(db, KEY, { ...options, invalidCharacters: 'strip' }), KEY);
    const e = back.root.entries[0]!;
    assert.equal(getField(e, 'Notes'), 'abc', name);
    assert.equal(getField(e, 'Password'), 'a\u0001b', `${name}: a protected value is kept as it is`);
    assert.equal(getField(e, 'pin'), 'x\u0002y', name);
    assert.equal(back.root.name, 'root', name);
  }
  assert.equal(entry.fields.find((f) => f.name === 'Notes')!.value, 'a\u0001b\ud800c', 'the database object is not changed');
});

test('characters: protected values give back exactly the string, controls, U+FFFE/U+FFFF and a leading BOM included', () => {
  const values = ['a\u0001b', '\u0000', '￾￿', '﻿starts with a BOM', 'café \u{1F600}', '\r\n\t'];
  for (const [name, options] of versions) {
    for (const v of values) {
      const db = dbWith(newEntry({ password: v, fields: [{ name: 'p2', value: v, protected: true }] }));
      const back = readKdbx(writeKdbx(db, KEY, options), KEY);
      assert.equal(getField(back.root.entries[0]!, 'Password'), v, `${name}: ${JSON.stringify(v)}`);
      assert.equal(getField(back.root.entries[0]!, 'p2'), v, `${name}: ${JSON.stringify(v)}`);
    }
  }
});

test('characters: a lone surrogate in a protected value is refused by default (UTF-8 cannot hold it) and stripped on request', () => {
  const db = dbWith(newEntry({ password: 'a\ud800b' }));
  const err = (() => { try { writeKdbx(db, KEY, FAST); } catch (e) { return e as Error & { code?: string }; } return undefined; })();
  assert.equal(err?.code, 'InvalidArgument');
  assert.ok(err!.message.includes('Password') && !err!.message.includes('a\ud800b'), err!.message);
  const back = readKdbx(writeKdbx(db, KEY, { ...FAST, invalidCharacters: 'strip' }), KEY);
  assert.equal(getField(back.root.entries[0]!, 'Password'), 'ab');
  assert.equal(code(() => writeKdbx(db, KEY, { ...FAST, invalidCharacters: 'bogus' as never })), 'InvalidArgument');
});

test('characters: findInvalidCharacters reports where and how many without values or changes; stripInvalidCharacters cleans in place', () => {
  const entry = newEntry({ title: 'ok', notes: '\u0001\u0002SECRETX', password: 'PWMARK\ud800', uuid: 'ab'.repeat(16) });
  const db = dbWith(entry);
  db.meta.name = 'n￾';
  const before = JSON.stringify(db);
  const found = findInvalidCharacters(db);
  assert.equal(JSON.stringify(db), before, 'nothing changed');
  const notes = found.find((r) => r.where.includes('"Notes"'))!;
  assert.deepEqual([notes.count, notes.protected], [2, false]);
  assert.ok(notes.where.includes('ab'.repeat(16)));
  const pw = found.find((r) => r.where.includes('"Password"'))!;
  assert.deepEqual([pw.count, pw.protected], [1, true]);
  assert.ok(found.some((r) => r.where === 'database name'));
  assert.equal(found.length, 3);
  assert.ok(!JSON.stringify(found).includes('SECRETX') && !JSON.stringify(found).includes('PWMARK'), 'no value in a report');

  const stripped = stripInvalidCharacters(db);
  assert.equal(stripped.length, 3);
  assert.equal(getField(entry, 'Notes'), 'SECRETX');
  assert.equal(getField(entry, 'Password'), 'PWMARK');
  assert.equal(db.meta.name, 'n');
  assert.deepEqual(findInvalidCharacters(db), []);
  assert.equal(code(() => writeKdbx(db, KEY, FAST)), 'no error');
});

test('characters: the text helpers', () => {
  assert.equal(hasInvalidXmlCharacters('plain \t\r\n \u{1F600}'), false);
  assert.equal(hasInvalidXmlCharacters('a\u0008'), true);
  assert.equal(stripInvalidXmlCharacters('a\u0008b￾c\ud800d\u{1F600}'), 'abcd\u{1F600}');
});

// ------------------------------------------------------------------ 2. uuids

test('uuid: newEntry and newGroup refuse a bad uuid early', () => {
  for (const bad of ['abc', '', 'zz'.repeat(16), 'AB'.repeat(16), 'ab'.repeat(15), 'ab'.repeat(17), ' '.concat('ab'.repeat(15), 'a')]) {
    assert.equal(code(() => newEntry({ uuid: bad })), 'InvalidArgument', JSON.stringify(bad));
    assert.equal(code(() => newGroup('g', { uuid: bad })), 'InvalidArgument', JSON.stringify(bad));
  }
  assert.equal(code(() => newEntry({ uuid: 'ab'.repeat(16) })), 'no error');
  assert.equal(code(() => newGroup('g', { uuid: 'ab'.repeat(16) })), 'no error');
});

test('uuid: writeKdbx refuses a bad uuid anywhere a uuid is written, with InvalidArgument and not a file that cannot be read', () => {
  const cases: [string, (db: KdbxDatabase) => void][] = [
    ['entry uuid', (db) => { db.root.entries[0]!.uuid = 'abc'; }],
    ['entry uuid, uppercase', (db) => { db.root.entries[0]!.uuid = 'AB'.repeat(16); }],
    ['entry custom icon', (db) => { db.root.entries[0]!.customIconUuid = 'nothex'; }],
    ['entry previous parent', (db) => { db.root.entries[0]!.previousParentGroup = 'x'; }],
    ['history entry uuid', (db) => { const h = newEntry({}); h.uuid = 'bad'; db.root.entries[0]!.history.push(h); }],
    ['group uuid', (db) => { db.root.uuid = 'abc'; }],
    ['subgroup uuid', (db) => { const g = newGroup('g'); g.uuid = ''; db.root.groups.push(g); }],
    ['group custom icon', (db) => { db.root.customIconUuid = '12'; }],
    ['group previous parent', (db) => { db.root.previousParentGroup = '12'; }],
    ['deleted object', (db) => { db.deletedObjects.push({ uuid: 'abc' }); }],
    ['recycle bin', (db) => { db.meta.recycleBinUuid = 'abc'; }],
  ];
  for (const [name, mutate] of cases) {
    const db = dbWith(newEntry({ title: 'T' }));
    mutate(db);
    for (const [v, options] of versions) assert.equal(code(() => writeKdbx(db, KEY, options)), 'InvalidArgument', `${name} (${v})`);
  }
  // A valid database with every uuid kind still writes and reads.
  const good = dbWith(newEntry({ uuid: 'ab'.repeat(16) }));
  good.root.entries[0]!.customIconUuid = 'cd'.repeat(16);
  good.deletedObjects.push({ uuid: 'ef'.repeat(16) });
  good.meta.recycleBinUuid = good.root.uuid;
  assert.equal(readKdbx(writeKdbx(good, KEY, FAST), KEY).root.entries[0]!.customIconUuid, 'cd'.repeat(16));
});

// ------------------------------------------------------------------ 4. keys

const xmlKey = (version: string, data: string, hash?: string) => new TextEncoder().encode(
  `<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile><Meta><Version>${version}</Version></Meta><Key><Data${hash ? ` Hash="${hash}"` : ''}>${data}</Data></Key></KeyFile>`);

test('key file v1: data that is not 32 bytes of valid base64 follows KeePassXC (padded, cut, or the whole file hashed)', () => {
  const short = Uint8Array.from({ length: 10 }, (_, i) => i);
  const long = Uint8Array.from({ length: 40 }, (_, i) => i);
  assert.deepEqual([...keyFileHash(xmlKey('1.00', Buffer.from(short).toString('base64')))], [...short, ...new Array(22).fill(0)], 'zero-padded to 32');
  assert.deepEqual([...keyFileHash(xmlKey('1.00', Buffer.from(long).toString('base64')))], [...long.subarray(0, 32)], 'cut to the first 32');
  for (const empty of [xmlKey('1.00', ''), xmlKey('1.00', '  \n '), new TextEncoder().encode('<KeyFile><Meta><Version>1.0</Version></Meta></KeyFile>')]) {
    assert.deepEqual([...keyFileHash(empty)], [...sha256(empty)], 'no data: the whole file is hashed');
  }
  for (const bad of ['not base64 !!', '***', 'AAE', 'AAECAwQ=x']) {
    assert.equal(code(() => keyFileHash(xmlKey('1.00', bad))), 'InvalidKey', `${bad}: KeePassXC refuses it too`);
  }
});

test('key file v2: a wrong length with a matching checksum is padded or cut as KeePassXC does; a failing checksum, bad hex, or no checksum on a wrong length stay InvalidKey', () => {
  const short = Uint8Array.from({ length: 8 }, (_, i) => i + 1);
  const check = Buffer.from(sha256(short)).subarray(0, 4).toString('hex').toUpperCase();
  assert.deepEqual([...keyFileHash(xmlKey('2.0', Buffer.from(short).toString('hex'), check))], [...short, ...new Array(24).fill(0)]);
  assert.equal(code(() => keyFileHash(xmlKey('2.0', Buffer.from(short).toString('hex'), '00000000'))), 'InvalidKey');
  assert.equal(code(() => keyFileHash(xmlKey('2.0', Buffer.from(short).toString('hex')))), 'InvalidKey');
  assert.equal(code(() => keyFileHash(xmlKey('2.0', 'zz'.repeat(8), check))), 'InvalidKey');
});

test('password "" with a key file is the key file alone, on read and on write; "" alone is still the empty password', () => {
  const keyFile = xmlKey('2.0', Buffer.from(sha256(new Uint8Array(1))).toString('hex'));
  assert.deepEqual([...compositeKey({ password: '', keyFile })], [...compositeKey({ keyFile })]);
  assert.notDeepEqual([...compositeKey({ password: '', keyFile })], [...compositeKey({ password: ' ', keyFile })]);
  const db = dbWith(newEntry({ title: 'T' }));
  const fileA = writeKdbx(db, { password: '', keyFile }, FAST);
  assert.equal(readKdbx(fileA, { keyFile }).root.entries.length, 1, 'written with "" + key file, opens with the key file alone');
  const fileB = writeKdbx(db, { keyFile }, FAST);
  assert.equal(readKdbx(fileB, { password: '', keyFile }).root.entries.length, 1, 'written with the key file alone, opens with "" + key file');
  assert.deepEqual([...compositeKey({ password: '' })], [...sha256(sha256(new Uint8Array(0)))], 'the empty password on its own is hashed');
});

test('interop: a KeePassXC database made with a short or long XML v1 key file opens here with the same rule', { skip: cliSkip }, () => {
  const dir = tempDir();
  const cases: [string, Uint8Array][] = [
    ['short', xmlKey('1.00', Buffer.from(Uint8Array.from({ length: 10 }, (_, i) => i)).toString('base64'))],
    ['long', xmlKey('1.00', Buffer.from(Uint8Array.from({ length: 40 }, (_, i) => i + 3)).toString('base64'))],
    ['empty', xmlKey('1.00', '')],
  ];
  for (const [name, keyFile] of cases) {
    const keyPath = join(dir, `${name}.keyx`);
    const dbPath = join(dir, `${name}.kdbx`);
    writeFileSync(keyPath, keyFile);
    const made = cli(['db-create', '-q', '--set-key-file', keyPath, dbPath]);
    assert.equal(made.status, 0, `${name}: db-create: ${made.stderr}`);
    const db = readKdbx(new Uint8Array(readFileSync(dbPath)), { keyFile });
    assert.ok(db.root.name.length > 0, name);
    // and the other way: KeePassXC opens what we write with that key file
    const out = join(dir, `${name}-ours.kdbx`);
    writeFileSync(out, writeKdbx(dbWith(newEntry({ title: 'Ours' })), { keyFile }, { version: '3.1', kdf: { type: 'aes', rounds: 100 } }));
    const listed = cli(['ls', '-q', '-k', keyPath, '--no-password', out]);
    assert.equal(listed.status, 0, `${name}: ls: ${listed.stderr}`);
    assert.ok(listed.stdout.includes('Ours'), `${name}: ${listed.stdout}`);
  }
});
