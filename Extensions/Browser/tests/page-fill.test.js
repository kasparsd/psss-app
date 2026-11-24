import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../src/page-fill.js', import.meta.url), 'utf8');
const origin = 'https://example.test';

class Input {
  constructor(options) {
    Object.assign(this, { tagName: 'INPUT', type: 'text', autocomplete: '', name: '', id: '', value: '', labels: [] }, options);
    this.events = [];
  }

  set value(value) { this.stored = value; }
  get value() { return this.stored; }
  matches() { return this.disabled; }
  getAttribute() { return null; }
  getBoundingClientRect() { return { width: 100, height: 20 }; }
  dispatchEvent(event) { this.events.push(event.type); }
  compareDocumentPosition(other) { return other.order > this.order ? 4 : 0; }
}

function page(inputs, activeElement, pageOrigin = origin) {
  inputs.forEach((input, order) => { input.order = order; });
  const context = {
    location: { origin: pageOrigin },
    document: { activeElement, querySelectorAll: () => inputs },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    Event,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 }
  };
  return vm.runInNewContext(script + '\n({ psssFillPage, psssFillPasswords })', context);
}

test('a saved login prefers HTML roles and skips new-password inputs', () => {
  const form = {};
  const username = new Input({ autocomplete: 'section-signin username webauthn', form });
  const email = new Input({ autocomplete: 'section-signin email', form });
  const alias = new Input({ type: 'password', name: 'password', form });
  const secret = new Input({ type: 'password', autocomplete: 'section-signin current-password webauthn', form });
  const replacement = new Input({ type: 'password', autocomplete: 'section-signin new-password', form });
  const api = page([username, email, alias, secret, replacement], alias);
  api.psssFillPage({ username: 'sample', 'current-password': 'synthetic-password' }, 'login', origin);
  assert.equal(username.value, 'sample');
  assert.equal(secret.value, 'synthetic-password');
  assert.equal(email.value, '');
  assert.equal(alias.value, '');
  assert.equal(replacement.value, '');
  assert.deepEqual(secret.events, ['input', 'change']);

  api.psssFillPasswords('temporary-password');
  assert.equal(secret.value, 'synthetic-password');
  assert.equal(replacement.value, 'temporary-password');
});

test('a checkout uses one section and derives expiry components without a security-code fill', () => {
  const form = {};
  const number = new Input({ autocomplete: 'section-payment billing cc-number', form });
  const month = new Input({ autocomplete: 'section-payment billing cc-exp-month', form });
  const year = new Input({ autocomplete: 'section-payment billing cc-exp-year', tagName: 'SELECT', options: [{ value: '30' }], form });
  const code = new Input({ autocomplete: 'section-payment billing cc-csc', form });
  const otherName = new Input({ autocomplete: 'section-other billing cc-name', form });
  const inputs = [number, month, year, code, otherName];
  const api = page(inputs, number);
  assert.equal(api.psssFillPage({}, 'probe-card', origin).checkout, true);
  api.psssFillPage({ 'cc-number': '4242424242424242', 'cc-exp': '2030-08', 'cc-csc': '123', 'cc-name': 'Sample' }, 'card', origin);
  assert.equal(number.value, '4242424242424242');
  assert.equal(month.value, '08');
  assert.equal(year.value, '30');
  assert.equal(code.value, '');
  assert.equal(otherName.value, '');
});

test('checkout aliases stay in one form and navigation refuses injection', () => {
  const form = {};
  const number = new Input({ name: 'card_number', form });
  const expiry = new Input({ id: 'valid_thru', placeholder: 'MM/YY', form });
  const host = page([number, expiry], number, 'https://other.test');
  const values = { 'cc-number': '4242424242424242', 'cc-exp': '2030-08' };
  assert.equal(host.psssFillPage(values, 'card', origin).filled.length, 0);
  assert.equal(number.value, '');
  page([number, expiry], number).psssFillPage(values, 'card', origin);
  assert.equal(expiry.value, '08/30');
});

test('ambiguous checkout fields in separate forms have no target', () => {
  const left = new Input({ name: 'card_number', form: {} });
  const right = new Input({ name: 'card_number', form: {} });
  assert.equal(page([left, right], {}).psssFillPage({}, 'probe-card', origin).checkout, undefined);
});
