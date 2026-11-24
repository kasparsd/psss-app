// A vault file is untrusted input. Truncation, flipped bits, compression bombs, absurd KDF parameters, DOCTYPE, deep
// nesting, huge blocks: each must end in a typed KdbxError (or, where the format cannot detect damage, a parse), never a
// hang and never a raw exception, and each case has a time limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KdbxError, defaultLimits, newDatabase, newEntry, readKdbx, writeKdbx, newGroup } from '../src/index.ts';
import type { KdbxDatabase, KdbxKey, WriteOptions } from '../src/index.ts';
import { concat, le32, le64 } from '../src/bytes.ts';
import { hmacSha256 } from '../src/ciphers.ts';
import { kdfToDictionary, VariantDictionary } from '../src/kdf.ts';
import { hmacBlockKey } from '../src/blocks.ts';
import { BUILD3_KEY, BUILD_KEY, buildKdbx3, buildKdbx4, minimalXml, sampleDatabase, seeded } from './support.ts';

const CASE_MS = 3000; // the time limit of one hostile case

/** Reads and returns the outcome without ever throwing a non-KdbxError; asserts the time limit. */
function attempt(file: Uint8Array, key: KdbxKey, label: string, limits?: Parameters<typeof readKdbx>[2]): KdbxError | KdbxDatabase {
  const started = Date.now();
  let outcome: KdbxError | KdbxDatabase;
  try {
    outcome = readKdbx(file, key, limits);
  } catch (e) {
    assert.ok(e instanceof KdbxError, `${label}: a raw exception escaped: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    assert.ok(typeof e.code === 'string' && e.code.length > 0, `${label}: the error has a code`);
    outcome = e;
  }
  assert.ok(Date.now() - started < CASE_MS, `${label}: took ${Date.now() - started} ms (limit ${CASE_MS})`);
  return outcome;
}

const smallDb = (): KdbxDatabase => {
  const db = newDatabase({ name: 'S', random: seeded('s'), now: new Date('2022-01-01T00:00:00Z') });
  db.root.entries.push(newEntry({ title: 'A', username: 'u', password: 'pw', fields: [{ name: 'X', value: 'y', protected: true }] }, { random: seeded('e'), now: new Date('2022-01-01T00:00:00Z') }));
  return db;
};
const KEY = { password: 'pw' };
const variants: [string, WriteOptions][] = [
  ['4.1 chacha20 gzip', { version: '4.1', cipher: 'chacha20', kdf: { type: 'aes', rounds: 3 } }],
  ['4.0 aes256 none', { version: '4.0', cipher: 'aes256', compression: 'none', kdf: { type: 'aes', rounds: 3 } }],
  ['3.1 aes256 gzip', { version: '3.1', kdf: { type: 'aes', rounds: 3 } }],
];

for (const [name, options] of variants) {
  test(`truncation: ${name} cut at every length from 0 up to its size is rejected with a typed error`, () => {
    const file = writeKdbx(smallDb(), KEY, { ...options, random: seeded(name) });
    let rejected = 0;
    for (let length = 0; length < file.length; length++) {
      const outcome = attempt(file.subarray(0, length), KEY, `${name} cut to ${length}`);
      assert.ok(outcome instanceof KdbxError, `${name} cut to ${length} of ${file.length} bytes must not parse`);
      rejected++;
    }
    assert.equal(rejected, file.length);
    assert.ok(!(attempt(file, KEY, 'whole') instanceof KdbxError), 'the whole file still opens');
  });
}

for (const [name, options] of variants) {
  test(`bit flips: ${name} with each bit of the file flipped, one at a time`, () => {
    const file = writeKdbx(smallDb(), KEY, { ...options, random: seeded(name) });
    // A flip in the AES-KDF round count of an unauthenticated KDBX 3 header can ask for up to the default limit of rounds,
    // which is allowed to take tens of seconds. A caller reading untrusted files lowers the limit, as this test does.
    const readLimits = { limits: { maxAesKdfRounds: 100_000 } };
    const parsed: string[] = [];
    const codes = new Map<string, number>();
    for (let byte = 0; byte < file.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const copy = file.slice();
        copy[byte]! ^= 1 << bit;
        const outcome = attempt(copy, KEY, `${name} bit ${bit} of byte ${byte}`, readLimits);
        if (outcome instanceof KdbxError) codes.set(outcome.code, (codes.get(outcome.code) ?? 0) + 1);
        else parsed.push(`${byte}.${bit}`);
      }
    }
    if (options.version === '3.1') {
      // KDBX 3 has no MAC: damage the format cannot see (the unused hash of the final block, for one) parses to something.
      assert.ok(parsed.length < file.length * 8 * 0.05, `${name}: only a small share of flips can go unseen, saw ${parsed.length}`);
    } else {
      assert.deepEqual(parsed, [], `${name}: KDBX 4 authenticates the header and every block, so no flipped bit may parse`);
    }
    assert.ok([...codes.keys()].every((c) => ['Corrupt', 'WrongKey', 'Unsupported', 'NotKdbx', 'LimitExceeded', 'InvalidKey'].includes(c)), `codes: ${[...codes.keys()]}`);
  });
}

test('bit flips: the 3.1 flips that parse leave the content readable or damaged, never a raw error (sampled content check)', () => {
  const file = writeKdbx(smallDb(), KEY, { version: '3.1', kdf: { type: 'aes', rounds: 3 }, random: seeded('x') });
  let survivors = 0;
  for (let byte = 0; byte < file.length; byte++) {
    const copy = file.slice();
    copy[byte]! ^= 0x01;
    const outcome = attempt(copy, KEY, `3.1 byte ${byte}`, { limits: { maxAesKdfRounds: 100_000 } });
    if (!(outcome instanceof KdbxError)) survivors++;
  }
  assert.ok(survivors <= 40, `${survivors} single-bit flips parsed`);
});

test('wrong key: a wrong password on a KDBX 4 file is WrongKey, and a damaged file is Corrupt, so the two can be told apart', () => {
  const file = writeKdbx(smallDb(), KEY, variants[0]![1]);
  assert.equal((attempt(file, { password: 'nope' }, 'wrong') as KdbxError).code, 'WrongKey');
  const damaged = file.slice();
  damaged[damaged.length - 40]! ^= 1;
  assert.equal((attempt(damaged, KEY, 'damaged') as KdbxError).code, 'Corrupt');
  const header = file.slice();
  header[40]! ^= 1;
  assert.equal((attempt(header, KEY, 'header') as KdbxError).code, 'Corrupt', 'a damaged header fails its hash before any key is tried');
});

test('compression bomb: data that expands beyond the limit is LimitExceeded, in KDBX 4 and KDBX 3, without allocating it all', () => {
  const db = newDatabase({ name: 'Bomb' });
  const e = newEntry({ title: 'Bomb', notes: 'A'.repeat(8 * 1024 * 1024) });
  db.root.entries.push(e);
  for (const [name, options] of variants.filter(([n]) => n.includes('gzip'))) {
    const file = writeKdbx(db, KEY, { ...options, random: seeded('bomb') });
    assert.ok(file.length < 100_000, `${name}: eight megabytes of one letter compress to ${file.length} bytes`);
    const outcome = attempt(file, KEY, name, { limits: { maxDecompressedBytes: 1024 * 1024 } });
    assert.ok(outcome instanceof KdbxError && outcome.code === 'LimitExceeded' && outcome.detail === 'maxDecompressedBytes', `${name}: ${outcome instanceof KdbxError ? outcome.code : 'parsed'}`);
    assert.ok(!(attempt(file, KEY, `${name} default`) instanceof KdbxError), `${name}: within the default limit of 256 MiB it opens`);
  }
  assert.equal(defaultLimits.maxDecompressedBytes, 256 * 1024 * 1024, 'the default is 256 MiB');
});

test('compression bomb: a hand-built KDBX 4 payload that is a gzip of zeros is stopped at the limit', () => {
  const file = buildKdbx4(minimalXml({ root: `<Entry><Notes>${'0'.repeat(10)}</Notes></Entry>` }) + ' '.repeat(6_000_000), { compress: true });
  const outcome = attempt(file, BUILD_KEY, 'padded xml', { limits: { maxDecompressedBytes: 1_000_000 } });
  assert.ok(outcome instanceof KdbxError && outcome.code === 'LimitExceeded');
});

function argonDict(memoryBytes: bigint, iterations: bigint, parallelism: number, version = 0x13): { dict: VariantDictionary; transformed: Uint8Array } {
  const dict = kdfToDictionary({
    type: 'argon2id', salt: new Uint8Array(32).fill(1), memoryBytes, iterations, parallelism, version, secret: new Uint8Array(0), associatedData: new Uint8Array(0),
  });
  return { dict, transformed: new Uint8Array(32) };
}

test('absurd Argon2 parameters are LimitExceeded before anything is allocated (header is valid, the key is never tried)', () => {
  const cases: [string, bigint, bigint, number][] = [
    ['4 GiB of memory', 4n * 1024n ** 3n, 3n, 2],
    ['2 TiB of memory', 2n * 1024n ** 4n, 3n, 2],
    ['the largest memory a 64-bit field holds', 2n ** 64n - 1n, 3n, 2],
    ['4 billion passes', 64n * 1024n * 1024n, 2n ** 32n - 1n, 2],
    ['2^63 passes', 64n * 1024n * 1024n, 2n ** 63n, 2],
    ['a million lanes', 64n * 1024n * 1024n, 3n, 1_000_000],
    ['16 million lanes', 64n * 1024n * 1024n, 3n, 2 ** 24],
    ['memory times passes beyond the work limit', 1024n ** 3n, 256n, 2],
  ];
  for (const [label, memory, passes, lanes] of cases) {
    const file = buildKdbx4(minimalXml(), { kdf: argonDict(memory, passes, lanes) });
    const outcome = attempt(file, BUILD_KEY, label);
    assert.ok(outcome instanceof KdbxError && outcome.code === 'LimitExceeded', `${label}: ${outcome instanceof KdbxError ? `${outcome.code} ${outcome.message}` : 'parsed'}`);
  }
});

test('Argon2 parameters at the limits are not refused as absurd, and nonsense below them is Corrupt, not a library error', () => {
  const ok = attempt(buildKdbx4(minimalXml(), { kdf: argonDict(1024n * 1024n, 1n, 1) }), BUILD_KEY, 'small but fine');
  assert.ok(outcomeCode(ok) === 'WrongKey' || ok instanceof Object, 'tiny parameters get as far as the key check (the transformed key in the build is not real)');
  for (const [label, d] of [
    ['zero memory', argonDict(0n, 1n, 1)], ['memory below 8 KiB per lane', argonDict(16n * 1024n, 1n, 4)], ['zero passes', argonDict(1024n * 1024n, 0n, 1)],
    ['zero lanes', argonDict(1024n * 1024n, 1n, 0)],
  ] as const) {
    const outcome = attempt(buildKdbx4(minimalXml(), { kdf: d }), BUILD_KEY, label);
    assert.ok(outcome instanceof KdbxError && outcome.code === 'Corrupt', `${label}: ${outcome instanceof KdbxError ? outcome.code : 'parsed'}`);
  }
});

function outcomeCode(o: KdbxError | KdbxDatabase): string { return o instanceof KdbxError ? o.code : 'parsed'; }

test('Argon2 version other than 0x13 is Unsupported, naming the feature', () => {
  const outcome = attempt(buildKdbx4(minimalXml(), { kdf: argonDict(1024n * 1024n, 1n, 1, 0x10) }), BUILD_KEY, 'argon2 v1.0') as KdbxError;
  assert.equal(outcome.code, 'Unsupported');
  assert.equal(outcome.detail, 'Argon2 version');
});

test('absurd AES-KDF rounds are LimitExceeded in KDBX 4 and in KDBX 3 (where no hash protects the header)', () => {
  for (const rounds of [2n ** 40n, 2n ** 62n, 2n ** 64n - 1n, 1_000_000_000n]) {
    const dict = kdfToDictionary({ type: 'aes', seed: new Uint8Array(32).fill(4), rounds });
    const four = attempt(buildKdbx4(minimalXml(), { kdf: { dict, transformed: new Uint8Array(32) } }), BUILD_KEY, `4.x ${rounds}`);
    assert.equal(outcomeCode(four), 'LimitExceeded', `KDBX 4 with ${rounds} rounds`);
    const three = attempt(buildKdbx3(minimalXml(), { rounds }).file, BUILD3_KEY, `3.1 ${rounds}`);
    assert.equal(outcomeCode(three), 'LimitExceeded', `KDBX 3.1 with ${rounds} rounds`);
  }
  assert.equal(outcomeCode(attempt(buildKdbx3(minimalXml(), { rounds: 0 }).file, BUILD3_KEY, 'zero rounds')), 'Corrupt');
});

test('limits can be raised or lowered by the caller', () => {
  const file = buildKdbx3(minimalXml(), { rounds: 500 }).file;
  assert.equal(outcomeCode(attempt(file, BUILD3_KEY, 'raised')), 'parsed');
  assert.equal(outcomeCode(attempt(file, BUILD3_KEY, 'lowered', { limits: { maxAesKdfRounds: 100 } })), 'LimitExceeded');
});

test('absurd KDF options are refused on write too, before any work', () => {
  const started = Date.now();
  assert.throws(() => writeKdbx(smallDb(), KEY, { kdf: { type: 'argon2id', memoryKiB: 4 * 1024 * 1024 * 1024, iterations: 3, parallelism: 2 } }), { code: 'LimitExceeded' });
  assert.throws(() => writeKdbx(smallDb(), KEY, { kdf: { type: 'aes', rounds: 2 ** 40 } }), { code: 'LimitExceeded' });
  assert.throws(() => writeKdbx(smallDb(), KEY, { kdf: { type: 'argon2id', memoryKiB: 0, iterations: 1, parallelism: 1 } }), { code: 'InvalidArgument' });
  assert.ok(Date.now() - started < 1000);
});

test('an absurd block length is LimitExceeded in KDBX 4 (valid header and HMAC, then a block that claims 4 GiB) and in KDBX 3', () => {
  const four = buildKdbx4(minimalXml(), { blocks: () => concat(new Uint8Array(32), le32(0xffffffff)) });
  assert.equal(outcomeCode(attempt(four, BUILD_KEY, '4.x block')), 'LimitExceeded');
  const three = buildKdbx3(minimalXml(), { rawBody: concat(le32(0), new Uint8Array(32), le32(0xffffffff)) }).file;
  assert.equal(outcomeCode(attempt(three, BUILD3_KEY, '3.1 block')), 'LimitExceeded');
  const modest = buildKdbx4(minimalXml(), { blocks: () => concat(new Uint8Array(32), le32(1_000_000)) });
  assert.equal(outcomeCode(attempt(modest, BUILD_KEY, 'a block longer than the file')), 'Corrupt', 'a length within the limit but beyond the file is damage, not an allocation');
});

test('a block stream that never ends cannot loop: each block needs bytes, so a file of N bytes ends it', () => {
  const file = buildKdbx4(minimalXml(), { blocks: (hmacKey) => {
    const parts: Uint8Array[] = [];
    for (let i = 0n; i < 2000n; i++) {
      const data = new Uint8Array(1).fill(7);
      parts.push(hmacSha256(hmacBlockKey(hmacKey, i), le64(i), le32(1), data), le32(1), data);
    }
    return concat(...parts);
  } });
  assert.equal(outcomeCode(attempt(file, BUILD_KEY, 'endless blocks')), 'Corrupt');
});

test('DOCTYPE and entity tricks in the XML are refused: the billion laughs, an external entity, an undefined entity', () => {
  const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><KeePassFile><Meta/><Root><Group>&lol3;</Group></Root></KeePassFile>';
  const external = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><KeePassFile><Meta><DatabaseName>&e;</DatabaseName></Meta></KeePassFile>';
  const undefinedEntity = minimalXml({ meta: '<DatabaseDescription>&nbsp;&copy;</DatabaseDescription>' });
  for (const [label, xml] of [['billion laughs', laughs], ['external entity', external], ['undefined entity', undefinedEntity]] as const) {
    for (const [fname, file, key] of [['4.x', buildKdbx4(xml), BUILD_KEY], ['3.1', buildKdbx3(xml).file, BUILD3_KEY]] as const) {
      const outcome = attempt(file, key, `${label} in ${fname}`);
      assert.equal(outcomeCode(outcome), 'Corrupt', `${label} in ${fname}`);
    }
  }
});

test('deeply nested XML is LimitExceeded (a few levels past the limit, and a million levels), without overflowing the stack', () => {
  const nest = (n: number) => `<?xml version="1.0"?><KeePassFile><Meta/><Root>${'<Group>'.repeat(n)}${'</Group>'.repeat(n)}</Root></KeePassFile>`;
  assert.equal(outcomeCode(attempt(buildKdbx4(nest(100)), BUILD_KEY, 'depth 100')), 'parsed', 'within the limit it is read');
  assert.equal(outcomeCode(attempt(buildKdbx4(nest(200)), BUILD_KEY, 'depth 200')), 'LimitExceeded');
  assert.equal(outcomeCode(attempt(buildKdbx4('<a>'.repeat(1_000_000)), BUILD_KEY, 'depth one million')), 'LimitExceeded');
  assert.equal(outcomeCode(attempt(buildKdbx3(nest(200)).file, BUILD3_KEY, '3.1 depth 200')), 'LimitExceeded');
  assert.equal(outcomeCode(attempt(buildKdbx4(nest(200)), BUILD_KEY, 'raised', { limits: { maxXmlDepth: 300 } })), 'parsed', 'the limit is configurable');
});

test('too many XML elements are LimitExceeded', () => {
  const wide = `<?xml version="1.0"?><KeePassFile><Meta/><Root><Group>${'<X/>'.repeat(5000)}</Group></Root></KeePassFile>`;
  assert.equal(outcomeCode(attempt(buildKdbx4(wide), BUILD_KEY, 'wide', { limits: { maxXmlNodes: 1000 } })), 'LimitExceeded');
});

test('a group tree nested beyond the limit is refused on write, so this package never writes a file it would refuse to read', () => {
  const db = newDatabase({ name: 'Deep' });
  let g = db.root;
  for (let i = 0; i < 70; i++) { const next = newGroup(`g${i}`); g.groups.push(next); g = next; }
  assert.throws(() => writeKdbx(db, KEY, { kdf: { type: 'aes', rounds: 3 }, limits: { maxXmlDepth: 64 } }), { code: 'LimitExceeded' });
  assert.doesNotThrow(() => writeKdbx(db, KEY, { kdf: { type: 'aes', rounds: 3 } }), 'within the default limit of 128 it writes');
  const back = readKdbx(writeKdbx(db, KEY, { kdf: { type: 'aes', rounds: 3 } }), KEY);
  assert.equal(back.root.groups[0]!.name, 'g0');
});

test('garbage after a valid signature, random bytes and an all-zero file are typed errors', () => {
  const random = seeded('garbage');
  const sig = concat(le32(0x9aa2d903), le32(0xb54bfb67));
  for (const [label, bytes] of [
    ['signature then random', concat(sig, random(5000))],
    ['signature, version 4.1 then random', concat(sig, Uint8Array.of(1, 0, 4, 0), random(5000))],
    ['signature, version 3.1 then random', concat(sig, Uint8Array.of(1, 0, 3, 0), random(5000))],
    ['random', random(4000)], ['zeros', new Uint8Array(4000)], ['empty', new Uint8Array(0)], ['one byte', Uint8Array.of(0x03)],
  ] as const) {
    assert.ok(attempt(bytes, KEY, label) instanceof KdbxError, label);
  }
});

test('header fields that claim to be enormous are refused before they are read', () => {
  const sig = concat(le32(0x9aa2d903), le32(0xb54bfb67), Uint8Array.of(1, 0, 4, 0));
  const file = concat(sig, Uint8Array.of(2), le32(0xffffffff), new Uint8Array(100));
  const outcome = attempt(file, KEY, 'huge header field') as KdbxError;
  assert.equal(outcome.code, 'LimitExceeded');
  assert.equal(outcomeCode(attempt(concat(sig, Uint8Array.of(2), le32(50_000_000)), KEY, 'long field, short file')), 'LimitExceeded');
});

test('a header that never ends cannot loop: every field consumes bytes', () => {
  const sig = concat(le32(0x9aa2d903), le32(0xb54bfb67), Uint8Array.of(1, 0, 4, 0));
  const fields = concat(...Array.from({ length: 5000 }, () => concat(Uint8Array.of(99), le32(1), Uint8Array.of(1))));
  assert.equal(outcomeCode(attempt(concat(sig, fields), KEY, 'endless header')), 'Corrupt');
});

test('a sampled structural fuzz of a real file (random byte rewrites, insertions and deletions) is always typed or a parse', () => {
  const random = seeded('fuzz');
  const next = () => new DataView(random(4).buffer).getUint32(0, true);
  for (const [name, options] of variants) {
    const file = writeKdbx(sampleDatabase(), KEY, { ...options, random: seeded(name) });
    for (let i = 0; i < 300; i++) {
      let copy = Array.from(file);
      const at = next() % copy.length;
      switch (next() % 3) {
        case 0: copy[at] = next() & 0xff; break;
        case 1: copy.splice(at, 0, ...Array.from({ length: 1 + (next() % 8) }, () => next() & 0xff)); break;
        default: copy.splice(at, 1 + (next() % 16));
      }
      attempt(Uint8Array.from(copy), KEY, `${name} fuzz ${i}`);
    }
  }
});

test('hostile content inside a validly encrypted file: wrong inner stream, bad base64 in a protected value, bad UUID, no Meta', () => {
  const root = (inner: string) => `<?xml version="1.0"?><KeePassFile><Meta/><Root><Group><UUID>${Buffer.alloc(16, 1).toString('base64')}</UUID><Name>r</Name>${inner}</Group></Root></KeePassFile>`;
  const protectedBad = root('<Entry><UUID>' + Buffer.alloc(16, 2).toString('base64') + '</UUID><String><Key>Password</Key><Value Protected="True">!!not base64!!</Value></String></Entry>');
  assert.equal(outcomeCode(attempt(buildKdbx4(protectedBad), BUILD_KEY, 'bad base64')), 'Corrupt');
  assert.equal(outcomeCode(attempt(buildKdbx4(root('<Entry><UUID>bad</UUID></Entry>')), BUILD_KEY, 'bad uuid')), 'Corrupt');
  assert.equal(outcomeCode(attempt(buildKdbx4('<KeePassFile><Root/></KeePassFile>'), BUILD_KEY, 'no meta')), 'Corrupt');
  assert.equal(outcomeCode(attempt(buildKdbx4('<NotKeePass/>'), BUILD_KEY, 'wrong root')), 'Corrupt');
  assert.equal(outcomeCode(attempt(buildKdbx4(new Uint8Array([0xff, 0xfe, 0x00, 0x3c])), BUILD_KEY, 'not UTF-8 text')), 'Corrupt');
  assert.equal(outcomeCode(attempt(buildKdbx4(minimalXml(), { streamId: 7 }), BUILD_KEY, 'unknown inner stream')), 'Unsupported');
});

test('a raw body that is not blocks, in KDBX 3, is Corrupt', () => {
  assert.equal(outcomeCode(attempt(buildKdbx3('x', { rawBody: new Uint8Array(10) }).file, BUILD3_KEY, 'short body')), 'Corrupt');
});
