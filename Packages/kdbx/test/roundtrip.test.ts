// Round trips over every combination of version, KDF, outer cipher and key kind.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { readKdbx, readKdbxFormat, writeKdbx, newDatabase, newEntry, getField, setField } from '../src/index.ts';
import type { KdbxVersion, WriteOptions } from '../src/index.ts';
import { keyKinds, normalize, sampleDatabase, seeded } from './support.ts';

interface Combo {
  name: string;
  options: WriteOptions;
}

const argon = (type: 'argon2d' | 'argon2id') => ({ type, memoryKiB: 64, iterations: 2, parallelism: 2 }) as const;
const combos: Combo[] = [{ name: '3.1 aes-kdf aes256', options: { version: '3.1', cipher: 'aes256', kdf: { type: 'aes', rounds: 500 } } }];
for (const version of ['4.0', '4.1'] as KdbxVersion[]) {
  for (const cipher of ['aes256', 'chacha20'] as const) {
    for (const kdf of [{ type: 'aes', rounds: 500 }, argon('argon2d'), argon('argon2id')] as const) {
      combos.push({ name: `${version} ${kdf.type} ${cipher}`, options: { version, cipher, kdf } });
    }
  }
}

test('round trip: every version x KDF x cipher x key kind reads back exactly what was written', () => {
  const db = sampleDatabase();
  const expected = (version: string) => normalize(db, { publicCustomData: version !== '3.1' });
  let count = 0;
  for (const combo of combos) {
    for (const kind of keyKinds) {
      const compression = count % 2 === 0 ? 'gzip' : 'none';
      const bytes = writeKdbx(db, kind.key, { ...combo.options, compression, random: seeded(`${combo.name}/${kind.name}`) });
      const back = readKdbx(bytes, kind.key);
      const label = `${combo.name} with ${kind.name} (${compression})`;
      assert.deepEqual(normalize(back, { publicCustomData: combo.options.version !== '3.1' }), expected(combo.options.version!), label);
      assert.equal(back.format?.version, combo.options.version, `${label}: version`);
      assert.equal(back.format?.cipher, combo.options.cipher, `${label}: cipher`);
      assert.equal(back.format?.compression, compression, `${label}: compression`);
      assert.equal(back.format?.kdf.type, combo.options.kdf!.type, `${label}: kdf`);
      count++;
    }
  }
  assert.equal(count, combos.length * keyKinds.length);
});

test('round trip: the settings read from a file are the defaults of the next write, so re-saving keeps the format', () => {
  for (const combo of combos) {
    const first = writeKdbx(sampleDatabase(), { password: 'x' }, { ...combo.options, random: seeded('a') });
    const db = readKdbx(first, { password: 'x' });
    const second = writeKdbx(db, { password: 'x' }, { version: combo.options.version!, random: seeded('b') });
    const fmt = readKdbxFormat(second);
    assert.equal(fmt.cipher, combo.options.cipher, `${combo.name}: cipher kept`);
    assert.equal(fmt.kdf.type, combo.options.kdf!.type, `${combo.name}: KDF kept`);
    assert.deepEqual(fmt.kdf, readKdbxFormat(first).kdf, `${combo.name}: KDF parameters kept`);
  }
});

test('writing: the default is KDBX 4.1 with ChaCha20, gzip and Argon2id 64 MiB, 3 passes, 2 lanes', () => {
  const db = newDatabase({ name: 'Defaults' });
  const bytes = writeKdbx(db, { password: 'p' });
  assert.deepEqual(readKdbxFormat(bytes), {
    version: '4.1', cipher: 'chacha20', compression: 'gzip', kdf: { type: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 2 },
  });
});

test('writing: converting between versions keeps the content (3.1 to 4.1 and back)', () => {
  const db = sampleDatabase();
  const v31 = readKdbx(writeKdbx(db, { password: 'p' }, { version: '3.1', kdf: { type: 'aes', rounds: 100 } }), { password: 'p' });
  const v41 = readKdbx(writeKdbx(v31, { password: 'p' }, { version: '4.1', kdf: argon('argon2id') }), { password: 'p' });
  const v31again = readKdbx(writeKdbx(v41, { password: 'p' }, { version: '3.1' }), { password: 'p' });
  assert.deepEqual(normalize(v41, { publicCustomData: false }), normalize(db, { publicCustomData: false }));
  assert.deepEqual(normalize(v31again, { publicCustomData: false }), normalize(db, { publicCustomData: false }));
  assert.equal(v31again.format?.kdf.type, 'aes', '3.1 forces AES-KDF even when the source file used Argon2');
});

test('writing: the same inputs and the same random source give the same bytes; another source gives other bytes', () => {
  const db = sampleDatabase();
  const o = { version: '4.1', kdf: argon('argon2id') } as const;
  const a = writeKdbx(db, { password: 'p' }, { ...o, random: seeded('one') });
  const b = writeKdbx(db, { password: 'p' }, { ...o, random: seeded('one') });
  const c = writeKdbx(db, { password: 'p' }, { ...o, random: seeded('two') });
  assert.deepEqual(a, b, 'deterministic for a deterministic random source');
  assert.notDeepEqual(a, c, 'a different random source changes seeds, IV and keys');
  for (const version of ['3.1', '4.1'] as const) {
    const kdf = version === '3.1' ? { type: 'aes', rounds: 10 } as const : argon('argon2id');
    const x = writeKdbx(db, { password: 'p' }, { version, kdf });
    const y = writeKdbx(db, { password: 'p' }, { version, kdf });
    assert.notDeepEqual(x, y, `${version}: with the system random source two writes never repeat a seed, IV or stream key`);
  }
});

test('writing: protected values are encrypted in the XML (the inner stream is fresh), and plain fields are not', () => {
  // Build with compression off and AES outer so a copy of the payload could be found; then peel the outer layer by hand.
  const db = newDatabase({ name: 'Secrets' });
  db.root.entries.push(newEntry({ title: 'VisibleTitle', password: 'SuperSecretPassword123', fields: [{ name: 'Tok', value: 'TokenValue456', protected: true }] }));
  for (const version of ['3.1', '4.1'] as const) {
    const kdf = { type: 'aes', rounds: 10 } as const;
    const bytes = writeKdbx(db, { password: 'p' }, { version, kdf, compression: 'none', cipher: 'aes256' });
    const text = peelXml(bytes, 'p', version);
    assert.ok(text.includes('VisibleTitle'), `${version}: ordinary values are readable XML`);
    assert.ok(!text.includes('SuperSecretPassword123'), `${version}: the password is not in the XML`);
    assert.ok(!text.includes('TokenValue456'), `${version}: a protected custom field is not in the XML`);
    assert.ok(text.includes('Protected="True"'), `${version}: protected values are marked`);
    assert.equal(Buffer.from(bytes).includes('SuperSecretPassword123'), false, `${version}: nor anywhere in the file`);
  }
});

test('round trip: an empty database, and one with a very large attachment spanning several blocks', () => {
  const empty = newDatabase({ name: '', now: new Date('2023-01-02T03:04:05Z') });
  assert.deepEqual(normalize(readKdbx(writeKdbx(empty, { password: 'p' }, { kdf: { type: 'aes', rounds: 5 } }), { password: 'p' })), normalize(empty));
  const big = newDatabase({ name: 'Big' });
  const e = newEntry({ title: 'Big' });
  e.attachments.push({ name: 'big.bin', data: Uint8Array.from({ length: 2_500_000 }, (_, i) => (i * 2654435761) >>> 24), protected: false });
  big.root.entries.push(e);
  for (const version of ['3.1', '4.1'] as const) {
    const back = readKdbx(writeKdbx(big, { password: 'p' }, { version, kdf: { type: 'aes', rounds: 5 }, compression: 'none' }), { password: 'p' });
    assert.deepEqual(back.root.entries[0]!.attachments[0]!.data, e.attachments[0]!.data, `${version}: 2.5 MB attachment`);
  }
});

test('writing: attachments with the same bytes share one pool entry (the pool is built from what entries refer to)', () => {
  const db = sampleDatabase();
  const bytes = writeKdbx(db, { password: 'p' }, { version: '4.1', kdf: { type: 'aes', rounds: 5 }, compression: 'none', cipher: 'aes256' });
  const inner = peelInner(bytes, 'p');
  assert.equal(inner.binaryCount, 3, 'blob.bin (shared by two entries and the history), the 4-byte protected one and the empty one');
});

test('model: fields keep their order and protection through a write, and setField on a read database round trips', () => {
  const db = readKdbx(writeKdbx(sampleDatabase(), { password: 'p' }, { kdf: { type: 'aes', rounds: 5 } }), { password: 'p' });
  const login = db.root.entries[0]!;
  assert.deepEqual(login.fields.map((f) => f.name), ['Title', 'UserName', 'Password', 'URL', 'Notes', 'Account', 'PIN', 'Empty protected']);
  setField(login, 'Account', 'changed');
  setField(login, 'New secret', 's', { protected: true });
  const again = readKdbx(writeKdbx(db, { password: 'p' }, { kdf: { type: 'aes', rounds: 5 } }), { password: 'p' });
  const l2 = again.root.entries[0]!;
  assert.equal(getField(l2, 'Account'), 'changed');
  assert.equal(l2.fields.find((f) => f.name === 'New secret')?.protected, true);
  assert.equal(l2.fields.find((f) => f.name === 'PIN')?.protected, true);
});

// ---- helpers: peel the outer layers by hand (independent of the reader) ----
import { createDecipheriv } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Reader } from '../src/bytes.ts';
import { chacha20, sha256, sha512 } from '../src/ciphers.ts';
import { readHashedBlocks, readHmacBlocks } from '../src/blocks.ts';
import { compositeKey } from '../src/key.ts';
import { defaultLimits } from '../src/limits.ts';
import { kdfFromDictionary, transformKey, VariantDictionary } from '../src/kdf.ts';

function peelInner(file: Uint8Array, password: string): { binaryCount: number; xml: string } {
  const r = new Reader(file, 12);
  const fields = new Map<number, Uint8Array>();
  for (;;) { const id = r.u8(); const n = r.u32(); const v = r.bytes(n); if (id === 0) break; fields.set(id, v); }
  r.bytes(64);
  const transformed = transformKey(compositeKey({ password }), kdfFromDictionary(VariantDictionary.parse(fields.get(11)!)), defaultLimits);
  const enc = readHmacBlocks(r, sha512(fields.get(4)!, transformed, Uint8Array.of(1)), defaultLimits);
  const key = sha256(fields.get(4)!, transformed);
  const cipher = Buffer.from(fields.get(2)!).toString('hex').startsWith('31c1') ? 'aes' : 'chacha';
  let plain: Uint8Array;
  if (cipher === 'aes') { const d = createDecipheriv('aes-256-cbc', key, fields.get(7)!); plain = Buffer.concat([d.update(enc), d.final()]); }
  else plain = chacha20(key, fields.get(7)!).process(enc);
  if (Buffer.from(fields.get(3)!).readUInt32LE(0) === 1) plain = gunzipSync(plain);
  const ir = new Reader(plain);
  let binaryCount = 0;
  for (;;) { const id = ir.u8(); const n = ir.u32(); ir.bytes(n); if (id === 0) break; if (id === 3) binaryCount++; }
  return { binaryCount, xml: new TextDecoder().decode(ir.rest()) };
}

function peelXml(file: Uint8Array, password: string, version: string): string {
  if (version !== '3.1') return peelInner(file, password).xml;
  const r = new Reader(file, 12);
  const f = new Map<number, Uint8Array>();
  for (;;) { const id = r.u8(); const n = r.u16(); const v = r.bytes(n); if (id === 0) break; f.set(id, v); }
  const seed = f.get(5)!;
  const rounds = Buffer.from(f.get(6)!).readBigUInt64LE(0);
  const transformed = transformKey(compositeKey({ password }), { type: 'aes', seed, rounds }, defaultLimits);
  const d = createDecipheriv('aes-256-cbc', sha256(f.get(4)!, transformed), f.get(7)!);
  const plain = Buffer.concat([d.update(r.rest()), d.final()]);
  let payload = readHashedBlocks(new Reader(plain, 32), defaultLimits);
  if (Buffer.from(f.get(3)!).readUInt32LE(0) === 1) payload = gunzipSync(payload);
  return new TextDecoder().decode(payload);
}

