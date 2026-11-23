import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAddress } from '../src/broker.ts';
import { HIDDEN, maskAll, masker } from '../src/mask.ts';
import { formatRef, parseRef } from '../src/protocol.ts';
import { totp } from '../src/totp.ts';

test('references', () => {
  assert.deepEqual(parseRef('psss://Example API/token'), { item: 'Example API', field: 'token' });
  assert.deepEqual(parseRef('psss://a/b/c'), { item: 'a/b', field: 'c' });
  assert.deepEqual(parseRef('psss://100%25/password'), { item: '100%', field: 'password' });
  for (const bad of ['', 'psss://', 'psss://item', 'psss://item/', 'psss:///field', 'op://a/b', 'psss://%zz/x']) assert.equal(parseRef(bad), null, bad);
  for (const [item, field] of [['Example API', 'token'], ['a/b', 'c'], ['100%', 'pass word'], ['Ünï/ço?de#', 'x']]) {
    assert.deepEqual(parseRef(formatRef(item, field)), { item, field });
  }
});

test('masking finds a secret split at every possible place', () => {
  const secret = 'psss-fictional-token-7f3a9c2e51b84d06';
  const text = Buffer.from(`start ${secret} middle ${secret}${secret} end`);
  const expected = `start ${HIDDEN} middle ${HIDDEN}${HIDDEN} end`;
  assert.equal(maskAll(text, [secret]).toString(), expected);
  for (let cut = 0; cut <= text.length; cut++) {
    const m = masker([secret]);
    const out = Buffer.concat([m.push(text.subarray(0, cut)), m.push(text.subarray(cut)), m.end()]).toString();
    assert.equal(out, expected, `split at ${cut}`);
  }
  // One byte at a time.
  const m = masker([secret]);
  const parts: Buffer[] = [];
  for (const byte of text) parts.push(m.push(Buffer.from([byte])));
  parts.push(m.end());
  assert.equal(Buffer.concat(parts).toString(), expected);
});

test('masking: several secrets, one inside another, short ones left alone, other bytes untouched', () => {
  assert.equal(maskAll(Buffer.from('x abcdefgh y abcdef z'), ['abcdef', 'abcdefgh']).toString(), `x ${HIDDEN} y ${HIDDEN} z`);
  assert.equal(maskAll(Buffer.from('pin 1234 pin'), ['1234']).toString(), 'pin 1234 pin');
  const binary = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x0a]);
  assert.deepEqual(maskAll(binary, ['secret-value']), binary);
  assert.equal(maskAll(Buffer.from('nothing here'), []).toString(), 'nothing here');
});

test('verification codes match RFC 6238', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59_000, 8), '94287082');
  assert.equal(totp(secret, 1111111109_000, 8), '07081804');
  assert.equal(totp(secret, 1234567890_000, 8), '89005924');
  assert.equal(totp(secret, 20000000000_000, 8), '65353130');
});

test('addresses: https, or http for the name localhost only', () => {
  assert.ok(checkAddress('https://api.example.com/v1') instanceof URL);
  assert.ok(checkAddress('http://localhost:8080/') instanceof URL);
  for (const bad of ['http://api.example.com/', 'http://127.0.0.1/', 'http://localhost.example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'https://user:pass@example.com/', 'not an address', '']) {
    assert.equal(typeof checkAddress(bad), 'string', bad);
  }
});

