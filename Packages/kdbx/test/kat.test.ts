// Known-answer tests for the primitives. Each vector's source is named; where the answer is only pinned (no outside
// source), the comment says so.
import assert from 'node:assert/strict';
import { argon2Sync, createCipheriv } from 'node:crypto';
import { test } from 'node:test';
import { concat, fromHex, hex, le32, le64, Reader } from '../src/bytes.ts';
import { chacha20, hmacSha256, salsa20, sha256, sha512 } from '../src/ciphers.ts';
import {
  BLOCK_SIZE, hmacBlockKey, readHashedBlocks, readHmacBlocks, writeHashedBlocks, writeHmacBlocks,
} from '../src/blocks.ts';
import { defaultLimits } from '../src/limits.ts';
import { kdfFromDictionary, kdfToDictionary, transformKey, VariantDictionary } from '../src/kdf.ts';
import type { KdfParams } from '../src/kdf.ts';

test('Salsa20: ECRYPT set 1 vector 0 (256-bit key 80 00.., zero IV) gives the published first 64 keystream bytes', () => {
  const key = new Uint8Array(32);
  key[0] = 0x80;
  const stream = salsa20(key, new Uint8Array(8)).process(new Uint8Array(64));
  assert.equal(hex(stream),
    'e3be8fdd8beca2e3ea8ef9475b29a6e7003951e1097a5c38d23b7a5fad9f6844b22c97559e2723c7cbbd3fe4fc8d9a0744652a83e72a9c461876af4d7ef1a117');
});

test('Salsa20: processing in odd chunks equals processing at once, across block and counter boundaries', () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i * 3 + 1);
  const iv = Uint8Array.from({ length: 8 }, (_, i) => i + 9);
  const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 0xff);
  const whole = salsa20(key, iv).process(data);
  const s = salsa20(key, iv);
  const parts = [s.process(data.subarray(0, 1)), s.process(data.subarray(1, 64)), s.process(data.subarray(64, 65)), s.process(data.subarray(65, 700)), s.process(data.subarray(700))];
  assert.equal(hex(concat(...parts)), hex(whole), 'chunked output must equal one-shot output');
  assert.notEqual(hex(whole.subarray(0, 64)), hex(whole.subarray(64, 128)), 'the keystream must move on from block to block');
});

test('Salsa20: decrypting is the same operation, so applying it twice gives back the data', () => {
  const key = new Uint8Array(32).fill(5), iv = new Uint8Array(8).fill(6);
  const data = new TextEncoder().encode('protected value ünï');
  assert.deepEqual(salsa20(key, iv).process(salsa20(key, iv).process(data)), data);
});

test('ChaCha20: RFC 8439 2.3.2 block function (counter 1) keystream begins 10f1e7e4d13b5915500fdd1fa32071c4', () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const nonce = fromHex('000000090000004a00000000');
  assert.equal(hex(chacha20(key, nonce, 1).process(new Uint8Array(16))), '10f1e7e4d13b5915500fdd1fa32071c4');
});

test('ChaCha20: RFC 8439 2.4.2 encrypts the sunscreen text to the published ciphertext', () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const nonce = fromHex('000000000000004a00000000');
  const text = "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
  const out = chacha20(key, nonce, 1).process(new TextEncoder().encode(text));
  assert.equal(hex(out),
    '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d');
});

test('ChaCha20: a stream split into several process calls continues, as the inner stream needs', () => {
  const key = new Uint8Array(32).fill(1), nonce = new Uint8Array(12).fill(2);
  const data = new Uint8Array(200).fill(9);
  const whole = chacha20(key, nonce).process(data);
  const s = chacha20(key, nonce);
  assert.equal(hex(concat(s.process(data.subarray(0, 13)), s.process(data.subarray(13)))), hex(whole));
});

const rfc9106 = (variant: 'argon2d' | 'argon2id'): KdfParams => ({
  type: variant, salt: new Uint8Array(16).fill(2), memoryBytes: 32n * 1024n, iterations: 3n, parallelism: 4, version: 0x13,
  secret: new Uint8Array(8).fill(3), associatedData: new Uint8Array(12).fill(4),
});

for (const [variant, tag] of [
  ['argon2d', '512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb'],
  ['argon2id', '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659'],
] as const) {
  test(`${variant}: RFC 9106 section 5 test vector (32 KiB, 3 passes, 4 lanes, secret and associated data) through transformKey`, () => {
    assert.equal(hex(transformKey(new Uint8Array(32).fill(1), rfc9106(variant), defaultLimits)), tag);
  });
}

test('argon2i: RFC 9106 test vector through node:crypto (KDBX does not use Argon2i, this checks Node itself)', () => {
  const tag = argon2Sync('argon2i', {
    message: new Uint8Array(32).fill(1), nonce: new Uint8Array(16).fill(2), parallelism: 4, tagLength: 32, memory: 32, passes: 3,
    secret: new Uint8Array(8).fill(3), associatedData: new Uint8Array(12).fill(4),
  });
  assert.equal(hex(new Uint8Array(tag)), 'c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8');
});

test('AES-KDF: the transform equals an independent computation (each 16-byte half through AES-256-ECB, rounds times, then SHA-256)', () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const rounds = 1000;
  const ecb = () => { const c = createCipheriv('aes-256-ecb', seed, null); c.setAutoPadding(false); return c; };
  let lo: Uint8Array = key.slice(0, 16), hi: Uint8Array = key.slice(16);
  const a = ecb(), b = ecb();
  for (let i = 0; i < rounds; i++) { lo = a.update(lo); hi = b.update(hi); }
  const expected = sha256(concat(lo, hi));
  const got = transformKey(key, { type: 'aes', seed, rounds: BigInt(rounds) }, defaultLimits);
  assert.equal(hex(got), hex(expected));
  // Pinned (no outside source): KeePassXC 2.8 opens files made with this transform, see interop.test.ts and fixtures.test.ts.
  assert.equal(hex(got).length, 64);
});

test('VariantDictionary: encodes to the documented bytes and parses them back, with every type kept', () => {
  const d = new VariantDictionary();
  d.setU32('a', 1);
  d.setU64('b', 2n);
  d.setBytes('c', Uint8Array.of(9));
  assert.equal(hex(d.encode()), '0001' + '04' + '01000000' + '61' + '04000000' + '01000000' + '05' + '01000000' + '62' + '08000000' + '0200000000000000'
    + '42' + '01000000' + '63' + '01000000' + '09' + '00');
  const back = VariantDictionary.parse(d.encode());
  assert.equal(back.getU32('a'), 1);
  assert.equal(back.getU64('b'), 2n);
  assert.deepEqual(back.getBytes('c'), Uint8Array.of(9));
  // A type this package does not model (string, 0x18) is kept byte for byte.
  const withString = concat(Uint8Array.of(0, 1), Uint8Array.of(0x18), le32(1), Uint8Array.of(0x73), le32(2), Uint8Array.of(0x68, 0x69), Uint8Array.of(0));
  assert.equal(hex(VariantDictionary.parse(withString).encode()), hex(withString));
});

test('KDF parameters: Argon2 and AES-KDF dictionaries survive parse and encode with their values', () => {
  const p = rfc9106('argon2id');
  const back = kdfFromDictionary(VariantDictionary.parse(kdfToDictionary(p).encode()));
  assert.deepEqual(back, p);
  const aes: KdfParams = { type: 'aes', seed: new Uint8Array(32).fill(8), rounds: 12345n };
  assert.deepEqual(kdfFromDictionary(VariantDictionary.parse(kdfToDictionary(aes).encode())), aes);
});

test('HMAC block stream: bytes equal the specification built by hand (key sha512(index || hmacKey), data = index || length || block)', () => {
  const hmacKey = sha512(new TextEncoder().encode('hmac key'));
  const data = new TextEncoder().encode('hello block stream');
  const expectedMac = (index: bigint, block: Uint8Array) =>
    hmacSha256(sha512(le64(index), hmacKey), concat(le64(index), le32(block.length), block));
  const expected = concat(expectedMac(0n, data), le32(data.length), data, expectedMac(1n, new Uint8Array(0)), le32(0));
  assert.equal(hex(writeHmacBlocks(data, hmacKey)), hex(expected));
  assert.equal(hex(hmacBlockKey(hmacKey, 5n)), hex(sha512(le64(5n), hmacKey)));
});

test('HMAC block stream: reads back what it wrote, across several blocks and for an empty payload', () => {
  const hmacKey = new Uint8Array(64).fill(3);
  for (const size of [0, 1, BLOCK_SIZE - 1, BLOCK_SIZE, BLOCK_SIZE + 5, 2 * BLOCK_SIZE + 1]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 13) & 0xff);
    const bytes = writeHmacBlocks(data, hmacKey);
    const back = readHmacBlocks(new Reader(bytes), hmacKey, defaultLimits);
    assert.equal(back.length, size, `size ${size}`);
    assert.ok(back.every((v, i) => v === data[i]), `content of size ${size}`);
  }
});

test('hashed block stream: bytes equal the specification built by hand (index, SHA-256 of block, length, block; a final empty block with a zero hash)', () => {
  const data = new TextEncoder().encode('hello hashed blocks');
  const expected = concat(le32(0), sha256(data), le32(data.length), data, le32(1), new Uint8Array(32), le32(0));
  assert.equal(hex(writeHashedBlocks(data)), hex(expected));
});

test('hashed block stream: reads back what it wrote, across several blocks, and refuses blocks out of order', () => {
  for (const size of [0, 1, BLOCK_SIZE, BLOCK_SIZE + 1]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 5) & 0xff);
    const back = readHashedBlocks(new Reader(writeHashedBlocks(data)), defaultLimits);
    assert.equal(back.length, size);
    assert.ok(back.every((v, i) => v === data[i]));
  }
  const two = writeHashedBlocks(new Uint8Array(BLOCK_SIZE + 1));
  const swapped = two.slice();
  swapped[0] = 1; // first block now claims to be block 1
  assert.throws(() => readHashedBlocks(new Reader(swapped), defaultLimits), { code: 'Corrupt' });
});
