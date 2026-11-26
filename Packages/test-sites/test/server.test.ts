import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator, browser, listen } from './helpers.ts';
import { code, parseOptions } from '../src/totp.ts';
import { seed } from '../src/server.ts';

let stop: () => Promise<void>;
let port = 0;
let web: ReturnType<typeof browser>;
const accounts = 'accounts.example.localhost';
const mail = 'mail.example.localhost';

before(async () => { ({ port, stop } = await listen()); web = browser(port); });
after(async () => { await stop(); });

test('sign-up, change password, sign in again', async () => {
  const signup = await web.form(mail, '/signup', { username: 'kid@example.net', password: 'first password', confirm: 'first password' });
  assert.equal(signup.status, 303);
  assert.equal(signup.headers.location, '/account');
  assert.match((await web.get(mail, '/account')).body, /kid@example\.net/);

  const bad = await web.form(mail, '/account/password', { current: 'wrong', password: 'second password', confirm: 'second password' });
  assert.match(String(bad.headers.location), /not%20right/);
  await web.form(mail, '/account/password', { current: 'first password', password: 'second password', confirm: 'second password' });

  await web.form(mail, '/logout', {});
  assert.equal((await web.get(mail, '/account')).status, 303, 'signed out');
  assert.equal((await web.form(mail, '/login', { username: 'kid@example.net', password: 'first password' })).status, 401);
  assert.equal((await web.form(mail, '/login', { username: 'kid@example.net', password: 'second password' })).headers.location, '/account');
});

test('a duplicate email, a short password and mismatched confirmation are refused', async () => {
  assert.equal((await web.form(mail, '/signup', { username: 'kid@example.net', password: 'another one', confirm: 'another one' })).status, 409);
  assert.equal((await web.form(mail, '/signup', { username: 'x@example.net', password: 'short' })).status, 400);
  assert.equal((await web.form(mail, '/signup', { username: 'x@example.net', password: 'long enough', confirm: 'different' })).status, 400);
});

test('every host is its own site', async () => {
  assert.equal((await web.form(accounts, '/login', { username: 'kid@example.net', password: 'second password' })).status, 401);
  const state = await web.get(accounts, '/api/state');
  assert.deepEqual(state.json.accounts, []);
});

test('password then code: wrong code refused, the right one, one step late, signs in', async () => {
  await web.api(accounts, '/api/accounts', { username: 'alex@example.net', password: 'pw pw pw pw', totp: 'JBSWY3DPEHPK3PXP' });
  assert.equal((await web.get(accounts, '/otp')).headers.location, '/login', 'no code page before the password');
  const login = await web.form(accounts, '/login', { username: 'alex@example.net', password: 'pw pw pw pw' });
  assert.equal(login.headers.location, '/otp');
  assert.equal((await web.get(accounts, '/account')).status, 303, 'password alone is not signed in');
  const page = (await web.get(accounts, '/otp')).body;
  assert.match(page, /autocomplete="one-time-code"/);
  assert.doesNotMatch((await web.get(accounts, '/otp?attr=none')).body, /one-time-code"/);
  assert.equal((await web.form(accounts, '/otp', { code: '000000' })).status, 401);
  const totp = parseOptions({ secret: 'JBSWY3DPEHPK3PXP' });
  const answer = await web.form(accounts, '/otp', { code: code(totp, Date.now(), -1) });
  assert.equal(answer.headers.location, '/account');
  assert.match((await web.get(accounts, '/account')).body, /alex@example\.net/);
});

test('the expected code is available to scripts and every format works', async () => {
  const made = await web.api(mail, '/api/accounts', { username: 'eight@example.net', password: 'x', digits: 8, period: 60, algorithm: 'SHA256' });
  assert.equal(made.status, 201);
  assert.match(made.json.otpauth, /digits=8/);
  const got = await web.get(mail, '/api/code?username=eight@example.net');
  assert.match(got.json.code, /^\d{8}$/);
  await web.form(mail, '/login', { username: 'eight@example.net', password: 'x' });
  assert.equal((await web.form(mail, '/otp', { code: got.json.code })).headers.location, '/account');
});

test('turning on the authenticator needs a code that matches the chosen format', async () => {
  const secret = 'GEZDGNBVGY3TQOJQ';
  const totp = parseOptions({ secret, digits: 7, period: 60, algorithm: 'SHA512' });
  await web.form(mail, '/login', { username: 'kid@example.net', password: 'second password' });
  const refused = await web.form(mail, '/account/otp', { secret, digits: '7', period: '60', algorithm: 'SHA512', code: '0000000' });
  assert.match(String(refused.headers.location), /not%20right/);
  assert.equal((await web.get(mail, '/api/state')).json.accounts.find((a: any) => a.username === 'kid@example.net').totp, null);
  await web.form(mail, '/account/otp', { secret, digits: '7', period: '60', algorithm: 'SHA512', code: code(totp) });
  assert.equal((await web.get(mail, '/api/state')).json.accounts.find((a: any) => a.username === 'kid@example.net').totp.digits, 7);
});

test('a passkey is created and signs in, once per challenge, and only for its own relying party', async () => {
  const host = 'shop.example.localhost';
  const origin = `http://${host}:${port}`;
  const key = authenticator(host, origin);
  const options = (await web.api(host, '/api/webauthn/register/options', { username: 'pk@example.net' })).json;
  assert.equal(options.rp.id, host);
  assert.equal((await web.api(host, '/api/webauthn/register/verify', { challenge: options.challenge, ...key.register(options.challenge) })).status, 200);
  assert.equal((await web.api(host, '/api/webauthn/register/verify', { challenge: options.challenge, ...key.register(options.challenge) })).status, 400, 'a challenge works once');

  const login = (await web.api(host, '/api/webauthn/login/options')).json;
  const refused = await web.api(host, '/api/webauthn/login/verify', { challenge: login.challenge, ...key.assert(login.challenge, { tamper: true }) });
  assert.equal(refused.status, 401);
  const next = (await web.api(host, '/api/webauthn/login/options')).json;
  const ok = await web.api(host, '/api/webauthn/login/verify', { challenge: next.challenge, ...key.assert(next.challenge) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.username, 'pk@example.net');
  assert.match((await web.get(host, '/account')).body, /pk@example\.net/);

  assert.match((await web.api(host, '/api/webauthn/login/options', { rpId: 'other.localhost' })).json.error, /not this host/);
  const state = (await web.get(host, '/api/state')).json;
  assert.equal(state.accounts[0].passkeys.length, 1);
});

test('a passkey for a parent relying party is accepted on a sibling host', async () => {
  const origin = `http://${accounts}:${port}`;
  const key = authenticator('example.localhost', origin);
  const options = (await web.api(accounts, '/api/webauthn/register/options', { username: 'parent@example.net', rpId: 'example.localhost' })).json;
  assert.equal(options.rp.id, 'example.localhost');
  assert.equal((await web.api(accounts, '/api/webauthn/register/verify', { challenge: options.challenge, ...key.register(options.challenge) })).status, 200);
  const login = (await web.api(accounts, '/api/webauthn/login/options', { rpId: 'example.localhost' })).json;
  assert.equal((await web.api(accounts, '/api/webauthn/login/verify', { challenge: login.challenge, ...key.assert(login.challenge) })).status, 200);
});

test('an account with a password cannot get a passkey added by someone who is not signed in', async () => {
  await web.api('other.localhost', '/api/accounts', { username: 'owner@example.net', password: 'secret secret' });
  const attempt = await web.api('other.localhost', '/api/webauthn/register/options', { username: 'owner@example.net' });
  assert.equal(attempt.status, 400);
  assert.match(attempt.json.error, /sign in first/);
});

test('the seed fills the three documented hosts, and reset forgets one host', async () => {
  seed();
  assert.equal((await web.get('localhost', '/api/state')).json.accounts[0].username, 'alex@example.net');
  assert.ok((await web.get('localhost', '/api/state')).json.accounts[0].totp);
  assert.equal((await web.get(mail, '/api/state')).json.accounts.find((a: any) => a.username === 'alex@example.net').totp, null);
  await web.api(mail, '/api/reset');
  assert.deepEqual((await web.get(mail, '/api/state')).json.accounts, []);
  assert.equal((await web.get('localhost', '/api/state')).json.accounts.length, 1);
  assert.equal((await web.get('localhost', '/')).status, 200);
  assert.equal((await web.get('localhost', '/nope')).status, 404);
});

test('checkout, delivery, frame and hostile pages offer the fields they name', async () => {
  const shop = 'shop.example.localhost';
  const card = (await web.get(shop, '/checkout')).body;
  for (const role of ['cc-name', 'cc-number', 'cc-exp', 'cc-csc']) assert.ok(card.includes(`autocomplete="${role}"`), role);
  assert.match(card, /<form /);
  const lists = (await web.get(shop, '/checkout?expiry=select&form=none')).body;
  assert.match(lists, /autocomplete="cc-exp-month"/);
  assert.match(lists, /autocomplete="cc-exp-year"/);
  assert.doesNotMatch(lists, /<form /);
  const delivery = (await web.get(shop, '/delivery')).body;
  for (const role of ['name', 'address-line1', 'address-level2', 'address-level1', 'postal-code', 'country', 'email', 'tel']) {
    assert.ok(delivery.includes(`autocomplete="shipping ${role}"`), role);
  }
  const frame = (await web.get(shop, '/checkout-frame')).body;
  assert.ok(frame.includes(`src="//pay.example.localhost:${port}/payment-frame"`));
  assert.doesNotMatch(frame, /autocomplete="cc-/);
  assert.match((await web.get('pay.example.localhost', '/payment-frame')).body, /autocomplete="cc-number"/);
  assert.equal(((await web.get(shop, '/checkout-hostile')).body.match(/data-trap="[a-z-]+"/g) ?? []).length, 9);
});
