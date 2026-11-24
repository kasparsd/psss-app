import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totp } from '../src/index.ts';

// RFC 6238, Appendix B: 8 digits, 30 seconds.
const seed = (n: number) => new TextEncoder().encode('1234567890'.repeat(7).slice(0, n));
const cases: [number, number, number, string][] = [
  [1, 20, 59, '94287082'], [2, 32, 59, '46119246'], [3, 64, 59, '90693936'],
  [1, 20, 1111111109, '07081804'], [2, 32, 1111111109, '68084774'], [3, 64, 1111111109, '25091201'],
  [1, 20, 2000000000, '69279037'], [2, 32, 2000000000, '90698825'], [3, 64, 2000000000, '38618901'],
];
test('verification codes match the vectors of RFC 6238 for SHA-1, SHA-256 and SHA-512', () => {
  for (const [algorithm, length, time, expected] of cases) {
    assert.equal(totp({ secret: seed(length), digits: 8, period: 30, algorithm }, time * 1000).code, expected, `algorithm ${algorithm} at ${time} s must give ${expected}`);
  }
});
test('a code says how long it is still valid', () => {
  assert.equal(totp({ secret: seed(20), digits: 6, period: 30, algorithm: 1 }, 59_000).expiresInSeconds, 1, 'one second before the next 30 s step');
  assert.equal(totp({ secret: seed(20), digits: 6, period: 30, algorithm: 1 }, 60_000).expiresInSeconds, 30, 'a full period at the start of a step');
});
