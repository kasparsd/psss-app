// Keys, key files, wrong keys, unsupported features and the shape of the errors.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Corrupt, InvalidArgument, InvalidKey, KdbxError, LimitExceeded, NotKdbx, Unsupported, WrongKey, compositeKey, keyFileHash, newDatabase, newEntry,
  readKdbx, readKdbxFormat, writeKdbx,
} from '../src/index.ts';
import type { KdbxKey, WriteOptions } from '../src/index.ts';
import { concat, hex, le32 } from '../src/bytes.ts';
import { sha256 } from '../src/ciphers.ts';
import { VariantDictionary } from '../src/kdf.ts';
import { BUILD3_KEY, BUILD_KEY, buildKdbx3, buildKdbx4, keyFiles, keyKinds, minimalXml, sampleDatabase, seeded } from './support.ts';

const code = (f: () => unknown): string => {
  try { f(); } catch (e) { return e instanceof KdbxError ? `${e.code}${e.detail ? `:${e.detail}` : ''}` : `RAW ${e}`; }
  return 'no error';
};

test('key files: XML 1 and 2, 32 raw bytes and 64 hex digits that hold the same key give the same composite key; any other file is hashed whole', () => {
  const keyOf = (k: Uint8Array) => hex(keyFileHash(k));
  assert.equal(keyOf(keyFiles.v2), keyOf(keyFiles.raw32));
  assert.equal(keyOf(keyFiles.v1), keyOf(keyFiles.raw32));
  assert.equal(keyOf(keyFiles.hex64), keyOf(keyFiles.raw32));
  assert.equal(keyOf(keyFiles.raw32), hex(keyFiles.raw32), '32 raw bytes are the key');
  assert.equal(keyOf(keyFiles.other), hex(sha256(keyFiles.other)), 'anything else is SHA-256 of the file');
  assert.equal(hex(compositeKey({ keyFile: keyFiles.v2 })), hex(sha256(keyFiles.raw32)), 'a key file alone: SHA-256 of its key');
});

test('composite key: password only is SHA-256 of SHA-256 of the UTF-8 password; password and key file hash both', () => {
  const pw = 'pässwörd';
  assert.equal(hex(compositeKey({ password: pw })), hex(sha256(sha256(new TextEncoder().encode(pw)))));
  assert.equal(hex(compositeKey({ password: pw, keyFile: keyFiles.raw32 })), hex(sha256(concat(sha256(new TextEncoder().encode(pw)), keyFiles.raw32))));
  assert.notEqual(hex(compositeKey({ password: '' })), hex(compositeKey({ password: ' ' })));
});

test('key files: a bad XML key file is InvalidKey (a checksum that fails, bad hex, bad base64, version 2 not 32 bytes without a checksum), an empty one too', () => {
  const v2 = (data: string, hash = '') => new TextEncoder().encode(`<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data${hash}>${data}</Data></Key></KeyFile>`);
  const v1 = (data: string) => new TextEncoder().encode(`<KeyFile><Meta><Version>1.0</Version></Meta><Key><Data>${data}</Data></Key></KeyFile>`);
  const hexKey = Buffer.from(sha256(new Uint8Array(1))).toString('hex');
  assert.equal(code(() => keyFileHash(v2(hexKey, ' Hash="00000000"'))), 'InvalidKey', 'checksum fails');
  assert.equal(code(() => keyFileHash(v2('zz'.repeat(32)))), 'InvalidKey', 'bad hex');
  assert.equal(code(() => keyFileHash(v2('ab'.repeat(16)))), 'InvalidKey', 'not 32 bytes');
  assert.equal(code(() => keyFileHash(v1('***'))), 'InvalidKey', 'bad base64');
  assert.equal(code(() => keyFileHash(v1('AAE'))), 'InvalidKey', 'base64 of a bad length');
  assert.equal(code(() => keyFileHash(new Uint8Array(0))), 'InvalidKey', 'empty');
  assert.doesNotThrow(() => keyFileHash(v2(hexKey)), 'a version 2 file with no checksum is accepted');
});

test('key files: a file that merely looks like XML but is not a key file, or holds a DOCTYPE, is hashed whole, never parsed with entities', () => {
  const html = new TextEncoder().encode('<html><body>hello</body></html>');
  assert.equal(hex(keyFileHash(html)), hex(sha256(html)));
  const doctype = new TextEncoder().encode('<!DOCTYPE KeyFile [<!ENTITY a "b">]><KeyFile><Key><Data>&a;</Data></Key></KeyFile>');
  assert.equal(hex(keyFileHash(doctype)), hex(sha256(doctype)));
  const binary = Uint8Array.from({ length: 100 }, (_, i) => (i * 37) & 0xff);
  assert.equal(hex(keyFileHash(binary)), hex(sha256(binary)));
});

test('no key at all is InvalidKey, and a challenge-response key is Unsupported naming the feature', () => {
  assert.equal(code(() => compositeKey({})), 'InvalidKey');
  assert.equal(code(() => compositeKey({ challengeResponse: { slot: 2 } })), 'Unsupported:challenge-response key');
  assert.equal(code(() => writeKdbx(newDatabase({ name: 'x' }), { password: 'p', challengeResponse: true }, { kdf: { type: 'aes', rounds: 1 } })), 'Unsupported:challenge-response key');
  assert.equal(code(() => readKdbx(writeKdbx(newDatabase({ name: 'x' }), { password: 'p' }, { kdf: { type: 'aes', rounds: 1 } }), { password: 'p', challengeResponse: 1 })), 'Unsupported:challenge-response key');
});

const formats: [string, WriteOptions][] = [
  ['3.1', { version: '3.1', kdf: { type: 'aes', rounds: 5 } }],
  ['4.0 aes', { version: '4.0', cipher: 'aes256', kdf: { type: 'aes', rounds: 5 } }],
  ['4.1 argon2id chacha', { version: '4.1', cipher: 'chacha20', kdf: { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 } }],
  ['4.1 argon2d aes', { version: '4.1', cipher: 'aes256', kdf: { type: 'argon2d', memoryKiB: 64, iterations: 1, parallelism: 1 } }],
];

test('wrong key: every wrong credential on every format is WrongKey, for each key kind (and a damaged file is not mistaken for it in KDBX 4)', () => {
  for (const [name, options] of formats) {
    for (const kind of keyKinds) {
      const file = writeKdbx(sampleDatabase(), kind.key, { ...options, random: seeded(`${name}${kind.name}`) });
      const wrong: KdbxKey[] = [
        { password: 'definitely wrong' },
        { keyFile: new TextEncoder().encode('another key file') },
        { password: kind.key.password ?? 'x', keyFile: new TextEncoder().encode('another key file') },
      ].filter((k) => !(k.password === kind.key.password && k.keyFile === kind.key.keyFile));
      if (kind.key.password !== undefined) wrong.push(kind.key.keyFile ? { password: kind.key.password } : { password: `${kind.key.password}!` });
      if (kind.key.keyFile !== undefined) wrong.push(kind.key.password !== undefined ? { keyFile: kind.key.keyFile } : { password: 'x', keyFile: kind.key.keyFile });
      for (const w of wrong) assert.equal(code(() => readKdbx(file, w)), 'WrongKey', `${name} / ${kind.name} / ${JSON.stringify(w.password ?? null)}`);
      assert.equal(readKdbx(file, kind.key).meta.name, 'Sample ☕');
    }
  }
});

test('wrong key: a password with a different Unicode form is a different password (no normalization)', () => {
  const composed = 'é';
  const decomposed = 'é';
  const file = writeKdbx(newDatabase({ name: 'u' }), { password: composed }, { kdf: { type: 'aes', rounds: 3 } });
  assert.equal(code(() => readKdbx(file, { password: decomposed })), 'WrongKey');
  assert.doesNotThrow(() => readKdbx(file, { password: composed }));
});

test('not a KDBX: wrong signature, text, empty and short files are NotKdbx', () => {
  for (const bytes of [new Uint8Array(0), Uint8Array.of(1, 2, 3), new TextEncoder().encode('just some text, not a database at all'), new Uint8Array(100)]) {
    assert.equal(code(() => readKdbx(bytes, BUILD_KEY)), 'NotKdbx');
    assert.equal(code(() => readKdbxFormat(bytes)), 'NotKdbx');
  }
  const wrongSecond = concat(le32(0x9aa2d903), le32(0x11111111), new Uint8Array(40));
  assert.equal(code(() => readKdbx(wrongSecond, BUILD_KEY)), 'NotKdbx');
});

test('unsupported: KeePass 1.x (KDB) files and KDBX of another major version say so', () => {
  assert.equal(code(() => readKdbx(concat(le32(0x9aa2d903), le32(0xb54bfb65), new Uint8Array(100)), BUILD_KEY)), 'Unsupported:KeePass 1.x (KDB) database');
  for (const major of [1, 2, 5, 9]) {
    const bytes = concat(le32(0x9aa2d903), le32(0xb54bfb67), Uint8Array.of(0, 0, major, 0), new Uint8Array(100));
    assert.equal(code(() => readKdbx(bytes, BUILD_KEY)), `Unsupported:KDBX ${major}.0`, `major ${major}`);
  }
});

test('unsupported: the Twofish outer cipher is Unsupported naming Twofish (the header is intact, so it is not damage)', () => {
  const twofish = Uint8Array.from(Buffer.from('ad68f29f576f4bb9a36ad47af965346c', 'hex'));
  assert.equal(code(() => readKdbx(buildKdbx4(minimalXml(), { cipherId: twofish }), BUILD_KEY)), 'Unsupported:Twofish cipher');
  const unknown = new Uint8Array(16).fill(0x42);
  assert.equal(code(() => readKdbx(buildKdbx4(minimalXml(), { cipherId: unknown }), BUILD_KEY)), 'Unsupported:outer cipher');
  assert.equal(code(() => readKdbxFormat(buildKdbx4(minimalXml(), { cipherId: twofish }))), 'Unsupported:Twofish cipher', 'readKdbxFormat tells without a key');
});

test('unsupported: the ArcFour, none and unknown inner streams are Unsupported', () => {
  assert.equal(code(() => readKdbx(buildKdbx4(minimalXml(), { streamId: 1 }), BUILD_KEY)), 'Unsupported:ArcFour inner stream');
  assert.equal(code(() => readKdbx(buildKdbx4(minimalXml(), { streamId: 0 }), BUILD_KEY)), 'Unsupported:inner stream 0');
  assert.equal(code(() => readKdbx(buildKdbx3(minimalXml(), { streamId: 1 }).file, BUILD3_KEY)), 'Unsupported:ArcFour inner stream');
});

function kdfDictionary(): VariantDictionary {
  const d = new VariantDictionary();
  d.setBytes('$UUID', new Uint8Array(16).fill(0x99));
  d.setBytes('S', new Uint8Array(32));
  return d;
}

test('unsupported: a key derivation function this package does not know is Unsupported', () => {
  const file = buildKdbx4(minimalXml(), { kdf: { dict: kdfDictionary(), transformed: new Uint8Array(32) } });
  assert.equal(code(() => readKdbx(file, BUILD_KEY)), 'Unsupported:key derivation function');
});

test('unsupported when writing: KDBX 3.1 with ChaCha20 or Argon2 is InvalidArgument, and an unknown version too', () => {
  const db = newDatabase({ name: 'x' });
  assert.equal(code(() => writeKdbx(db, BUILD_KEY, { version: '3.1', cipher: 'chacha20' })), 'InvalidArgument');
  assert.equal(code(() => writeKdbx(db, BUILD_KEY, { version: '3.1', kdf: { type: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 } })), 'InvalidArgument');
  assert.equal(code(() => writeKdbx(db, BUILD_KEY, { version: '5.0' as never })), 'InvalidArgument');
  assert.equal(code(() => writeKdbx(db, {})), 'InvalidKey');
});

test('errors: every error is a KdbxError with a stable code, a name, a message that says what happened, and no secret in it', () => {
  const samples: [KdbxError, string][] = [
    [new NotKdbx(), 'NotKdbx'], [new Unsupported('thing'), 'Unsupported'], [new WrongKey(), 'WrongKey'], [new Corrupt('truncated block'), 'Corrupt'],
    [new LimitExceeded('maxXmlDepth', 'deep'), 'LimitExceeded'], [new InvalidKey('no key given'), 'InvalidKey'], [new InvalidArgument('bad option'), 'InvalidArgument'],
  ];
  for (const [e, c] of samples) {
    assert.ok(e instanceof Error && e instanceof KdbxError);
    assert.equal(e.code, c);
    assert.equal(e.name, c);
    assert.ok(e.message.length > 5);
  }
  const secret = 'S3cretPassw0rd-that-must-not-leak';
  const file = writeKdbx(newDatabase({ name: 'x' }), { password: secret }, { kdf: { type: 'aes', rounds: 3 } });
  try { readKdbx(file, { password: 'other' }); } catch (e) { assert.ok(!(e as Error).message.includes(secret)); assert.ok(!(e as Error).message.includes('other')); }
});

test('errors: nothing but KdbxError escapes, even for arguments of the wrong type', () => {
  for (const bad of [undefined, null, 'text', 42, {}, []] as unknown[]) {
    assert.equal(code(() => readKdbx(bad as Uint8Array, BUILD_KEY)).startsWith('RAW'), false, String(bad));
  }
  assert.equal(code(() => writeKdbx(undefined as never, BUILD_KEY)).startsWith('RAW'), false);
  assert.equal(code(() => writeKdbx({ meta: {} } as never, BUILD_KEY, { kdf: { type: 'aes', rounds: 1 } })).startsWith('RAW'), false);
});

test('format: readKdbxFormat reports version, cipher, compression and KDF of a file without a key', () => {
  const db = newDatabase({ name: 'f' });
  db.root.entries.push(newEntry({ title: 't' }));
  for (const [name, options] of formats) {
    const f = readKdbxFormat(writeKdbx(db, { password: 'p' }, options));
    assert.equal(f.version, options.version, name);
    assert.equal(f.kdf.type, options.kdf!.type, name);
    assert.equal(f.compression, 'gzip');
  }
});
