import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from './helpers.ts';
import { verifyAssertion, verifyRegistration, fromB64url } from '../src/webauthn.ts';

const origin = 'http://accounts.example.localhost:8080';
const rpId = 'accounts.example.localhost';
const challenge = 'Y2hhbGxlbmdl';

function registered() {
  const key = authenticator(rpId, origin);
  const result = verifyRegistration({ ...key.register(challenge), challenge, origin, rpId });
  return { key, result };
}

test('a registration is accepted and keeps the public key', () => {
  const { key, result } = registered();
  assert.equal(result.id, key.credentialId);
  assert.deepEqual(result.publicKey, Buffer.from(key.publicKey));
});

test('a registration is refused for a wrong challenge, origin, relying party or credential ID', () => {
  const key = authenticator(rpId, origin);
  assert.throws(() => verifyRegistration({ ...key.register(challenge), challenge: 'other', origin, rpId }), /challenge/);
  assert.throws(() => verifyRegistration({ ...key.register(challenge, { origin: 'http://evil.localhost:8080' }), challenge, origin, rpId }), /origin/);
  assert.throws(() => verifyRegistration({ ...key.register(challenge, { rpId: 'example.localhost' }), challenge, origin, rpId }), /rpIdHash/);
  assert.throws(() => verifyRegistration({ ...key.register(challenge), id: 'AAAA', challenge, origin, rpId }), /credential ID/);
});

test('an assertion with a valid signature is accepted, with and without a counter', () => {
  const { key, result } = registered();
  const base = { challenge, origin, rpId, publicKey: result.publicKey };
  assert.deepEqual(verifyAssertion({ ...key.assert(challenge), ...base, storedSignCount: 0 }), { signCount: 0 });
  assert.deepEqual(verifyAssertion({ ...key.assert(challenge, { count: 5 }), ...base, storedSignCount: 4 }), { signCount: 5 });
});

test('an assertion is refused when anything it covers is wrong', () => {
  const { key, result } = registered();
  const base = { challenge, origin, rpId, publicKey: result.publicKey, storedSignCount: 0 };
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { tamper: true }), ...base }), /signature/);
  assert.throws(() => verifyAssertion({ ...key.assert('other'), ...base }), /challenge/);
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { origin: 'http://evil.localhost:8080' }), ...base }), /origin/);
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { rpId: 'example.localhost' }), ...base }), /rpIdHash/);
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { flags: 0 }), ...base }), /presence/);
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { type: 'webauthn.create' }), ...base }), /type/);
  assert.throws(() => verifyAssertion({ ...key.assert(challenge, { count: 3 }), ...base, storedSignCount: 3 }), /did not increase/);
  assert.equal(fromB64url('AAEC').length, 3);
});
