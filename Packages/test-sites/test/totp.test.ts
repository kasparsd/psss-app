import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, code, otpauthURI, parseOptions, verify } from '../src/totp.ts';

// RFC 6238 appendix B: the same ASCII key, repeated to each hash's block length, at the listed times.
const sha1 = base32Encode(Buffer.from('12345678901234567890'));
const sha256 = base32Encode(Buffer.from('12345678901234567890123456789012'));
const sha512 = base32Encode(Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'));
const vectors: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

test('RFC 6238 vectors for SHA1, SHA256 and SHA512 with eight digits', () => {
  for (const [time, a, b, c] of vectors) {
    assert.equal(code({ secret: sha1, digits: 8, period: 30, algorithm: 'SHA1' }, time * 1000), a, `SHA1 at ${time}`);
    assert.equal(code({ secret: sha256, digits: 8, period: 30, algorithm: 'SHA256' }, time * 1000), b, `SHA256 at ${time}`);
    assert.equal(code({ secret: sha512, digits: 8, period: 30, algorithm: 'SHA512' }, time * 1000), c, `SHA512 at ${time}`);
  }
});

test('base32 round trip and the common test secret', () => {
  assert.equal(base32Decode('JBSWY3DPEHPK3PXP').toString('hex'), '48656c6c6f21deadbeef');
  const bytes = Buffer.from([1, 2, 3, 250, 251, 252, 253]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.deepEqual(base32Decode('jbsw y3dp-ehpk 3pxp='), base32Decode('JBSWY3DPEHPK3PXP'));
});

test('a typed code is accepted one step either side and not two', () => {
  const totp = parseOptions({ secret: 'JBSWY3DPEHPK3PXP' });
  const now = 1_700_000_000_000;
  assert.ok(verify(totp, code(totp, now), now));
  assert.ok(verify(totp, code(totp, now, -1), now));
  assert.ok(verify(totp, code(totp, now, 1), now));
  assert.ok(!verify(totp, code(totp, now, 2), now));
  assert.ok(verify(totp, code(totp, now).replace(/^(...)/, '$1 '), now), 'spaces are ignored');
});

test('options are checked and the URI carries them', () => {
  assert.throws(() => parseOptions({ algorithm: 'MD5' }));
  assert.throws(() => parseOptions({ digits: 9 }));
  assert.throws(() => parseOptions({ secret: 'not base32!' }));
  const totp = parseOptions({ secret: 'JBSWY3DPEHPK3PXP', digits: 8, period: 60, algorithm: 'sha256' });
  const uri = new URL(otpauthURI(totp, 'accounts.example.localhost', 'alex@example.net'));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.searchParams.get('digits'), '8');
  assert.equal(uri.searchParams.get('period'), '60');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA256');
  assert.equal(parseOptions({}).secret.length, 32, 'a generated secret is 160 bits');
});
