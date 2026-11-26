import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../src/page-fill.js', import.meta.url), 'utf8');
const origin = 'https://example.test';

// A very small DOM: enough tree, style and geometry for the visibility and grouping rules.
class Box {
  constructor(options = {}) {
    const { children = [], style = {}, rect, ...rest } = options;
    Object.assign(this, { tagName: 'DIV', parentElement: null, attributes: {} }, rest);
    this.style = style;
    this.rect = { left: 0, top: 0, width: 100, height: 20, ...rect };
    this.children = children;
    for (const child of children) child.parentElement = this;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() {
    Box.measured = this;
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  get parentNode() { return this.parentElement; }
  // Only the selectors the page fill asks a container for.
  querySelectorAll(selector) {
    const all = [];
    const walk = (node) => node.children.forEach((child) => { all.push(child); walk(child); });
    walk(this);
    return all.filter((node) => selector === 'input[type=password]' ? node.type === 'password' : /^(?:H[1-6]|LEGEND)$/.test(node.tagName));
  }
}

class Input extends Box {
  constructor(options = {}) {
    const { value = '', ...rest } = options;
    super({ tagName: 'INPUT', type: 'text', autocomplete: '', name: '', id: '', labels: [], maxLength: -1, ...rest });
    this.stored = value;
    this.events = [];
  }

  // As browsers do: one-line inputs drop line breaks, number inputs refuse text.
  set value(value) {
    if (this.tagName !== 'INPUT') this.stored = value;
    else if (this.type === 'number' && !/^\d*$/.test(value)) this.stored = '';
    else this.stored = value.replace(/[\r\n]/g, '');
  }
  get value() { return this.stored; }
  matches() { return Boolean(this.disabled); }
  dispatchEvent(event) { this.events.push(event.type); this.onEvent?.(event.type); }
  compareDocumentPosition(other) { return other.order > this.order ? 4 : 0; }
}

const field = (role, options = {}) => new Input({ autocomplete: role, ...options });
const select = (role, options, rest = {}) => field(role, {
  tagName: 'SELECT', options: options.map(([value, text = value]) => ({ value, text })), ...rest
});
const box = (...children) => new Box({ children });
const form = (...children) => {
  const element = new Box({ tagName: 'FORM', children });
  const own = (node) => { if (node instanceof Input) node.form = element; node.children.forEach(own); };
  own(element);
  return element;
};

function page(content, activeElement, pageOrigin = origin, { subframe = false, lang = 'en' } = {}) {
  const body = new Box({ tagName: 'BODY', children: content, rect: { width: 800, height: 600 } });
  const root = new Box({ tagName: 'HTML', children: [body], rect: { width: 800, height: 600 } });
  Object.assign(root, { lang, scrollWidth: 800, scrollHeight: 2000, clientWidth: 800 });
  const all = [];
  const walk = (node) => { all.push(node); node.children.forEach(walk); };
  walk(root);
  all.forEach((node, order) => { node.order = order; node.form ??= null; });
  const querySelectorAll = (selector) => all.filter((node) => {
    if (selector === ':modal') return false;
    if (selector === 'iframe') return node.tagName === 'IFRAME';
    if (selector === 'input[type=password]') return node.type === 'password';
    return node.tagName === 'INPUT' || node.tagName === 'SELECT' || (node.tagName === 'TEXTAREA' && selector.includes('textarea'));
  });
  const window = { innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, scrollBy() {}, scrollTo() {} };
  window.top = subframe ? {} : window;
  const context = {
    window,
    location: { origin: pageOrigin, href: pageOrigin + '/checkout' },
    document: {
      activeElement, querySelectorAll, body, documentElement: root,
      // No layout here: the field just measured is the one on top. What a real page draws is tested in the browser spec.
      elementsFromPoint: () => [Box.measured]
    },
    getComputedStyle: (node) => ({ visibility: 'visible', display: 'block', opacity: '1', ...node.style }),
    Event,
    URL,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 }
  };
  return vm.runInNewContext(script + '\n({ psssFillPage, psssFillPasswords })', context);
}

const card = { 'cc-name': 'Alex Sample', 'cc-number': '4242424242424242', 'cc-exp': '2030-08', 'cc-csc': '987' };
const address = {
  name: 'Alex Sample', organization: 'Sample Works', 'street-address': 'Example Street 12\nFlat 3', 'address-level2': 'Riga',
  'address-level1': 'Vidzeme', 'postal-code': 'LV-1010', country: 'LV', email: 'alex@example.net', tel: '+371 20000000'
};
const fill = (api, mode, fields = mode === 'card' ? card : address) => api.psssFillPage(fields, mode, origin);
// Values made inside the vm context have their own Array: copy before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));
const cardSet = () => ({
  name: field('cc-name'), number: field('cc-number'), expiry: field('cc-exp', { maxLength: 5 }), code: field('cc-csc', { type: 'password' })
});
const addressSet = (section = '') => Object.fromEntries(
  ['name', 'organization', 'address-line1', 'address-level2', 'address-level1', 'postal-code', 'country', 'email', 'tel']
    .map((role) => [role, field((section + ' ' + role).trim())]));
const values = (set) => Object.values(set).map((input) => input.value);

test('a saved login prefers HTML roles and skips new-password inputs', () => {
  const username = new Input({ autocomplete: 'section-signin username webauthn' });
  const email = new Input({ autocomplete: 'section-signin email' });
  const alias = new Input({ type: 'password', name: 'password' });
  const secret = new Input({ type: 'password', autocomplete: 'section-signin current-password webauthn' });
  const replacement = new Input({ type: 'password', autocomplete: 'section-signin new-password' });
  const api = page([form(username, email, alias, secret, replacement)], alias);
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

test('a login still takes an unlabelled email-like field before the password', () => {
  const user = new Input({ name: 'email', type: 'email' });
  const secret = new Input({ type: 'password', name: 'password' });
  page([form(user, secret)]).psssFillPage({ username: 'alex@example.net', 'current-password': 'synthetic-password' }, 'login', origin);
  assert.equal(user.value, 'alex@example.net');
  assert.equal(secret.value, 'synthetic-password');
});

test('a checkout uses one section, derives expiry components and writes a released security code', () => {
  const number = field('section-payment billing cc-number');
  const month = field('section-payment billing cc-exp-month');
  const year = select('section-payment billing cc-exp-year', [['30']]);
  const code = field('section-payment billing cc-csc');
  const otherName = field('section-other billing cc-name');
  const api = page([form(number, month, year, code, otherName)], number);
  assert.equal(api.psssFillPage({}, 'probe-card', origin).checkout, true);
  fill(api, 'card');
  assert.deepEqual([number.value, month.value, year.value, code.value, otherName.value], ['4242424242424242', '08', '30', '987', '']);
});

test('a host that releases no security code leaves its field empty', () => {
  const set = cardSet();
  const { 'cc-csc': omitted, ...sample } = card;
  fill(page([form(...Object.values(set))]), 'card', sample);
  assert.deepEqual(values(set), ['Alex Sample', '4242424242424242', '08/30', '']);
});

test('card fields fill with and without a form', () => {
  for (const wrap of [form, box]) {
    const set = cardSet();
    const result = fill(page([wrap(...Object.values(set))]), 'card');
    assert.deepEqual(values(set), ['Alex Sample', '4242424242424242', '08/30', '987']);
    assert.deepEqual(plain(result), { filled: ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'] });
  }
});

test('checkout aliases stay in one form and navigation or a frame refuses injection', () => {
  const number = new Input({ name: 'card_number' });
  const expiry = new Input({ id: 'valid_thru', placeholder: 'MM / YY' });
  const content = [form(number, expiry)];
  for (const refused of [page(content, number, 'https://other.test'), page(content, number, origin, { subframe: true })]) {
    for (const mode of ['card', 'address', 'login', 'probe', 'probe-card']) {
      assert.deepEqual(plain(refused.psssFillPage(card, mode, origin)), { filled: [] });
    }
  }
  assert.equal(number.value, '');
  fill(page(content, number), 'card');
  assert.equal(expiry.value, '08/30');
});

test('ambiguous checkout fields in separate forms or one container have no target', () => {
  for (const content of [
    [form(new Input({ name: 'card_number' })), form(new Input({ name: 'card_number' }))],
    [box(field('cc-number'), field('cc-number'), field('cc-name'))],
    [box(new Input({ name: 'card_number', id: 'cvv' }))]
  ]) {
    const api = page(content, {});
    assert.equal(api.psssFillPage({}, 'probe-card', origin).checkout, undefined);
    assert.deepEqual(plain(fill(api, 'card')), { filled: [] });
  }
});

test('formless card blocks keep to the focused block', () => {
  const first = cardSet(), second = cardSet();
  const api = page([box(box(...Object.values(first)), box(...Object.values(second)))], second.name);
  fill(api, 'card');
  assert.deepEqual(values(first), ['', '', '', '']);
  assert.deepEqual(values(second), ['Alex Sample', '4242424242424242', '08/30', '987']);
});

test('a field from another formless card block is never borrowed, and duplicates are skipped', () => {
  const number = field('cc-number'), other = field('cc-number'), name = field('cc-name');
  fill(page([box(number), box(other, name)], number), 'card');
  assert.deepEqual([number.value, other.value, name.value], ['4242424242424242', '', '']);
  const set = cardSet(), twin = field('cc-name');
  fill(page([form(...Object.values(set), twin)]), 'card');
  assert.deepEqual([set.name.value, twin.value, set.code.value], ['', '', '987']);
});

// Clipping, covering and scrolling need a real page: see playwright/page-fill.spec.mjs.
const hidden = {
  'display none': () => ({ style: { display: 'none' } }),
  'invisible': () => ({ style: { visibility: 'hidden' } }),
  'transparent': () => ({ style: { opacity: '0' } }),
  'filtered away': () => ({ style: { filter: 'opacity(0%)' } }),
  'masked': () => ({ style: { maskImage: 'linear-gradient(transparent, transparent)' } }),
  'colourless': () => ({ style: { color: 'transparent', backgroundColor: 'rgba(0, 0, 0, 0)' } }),
  'zero size': () => ({ rect: { width: 0, height: 0 } }),
  'tiny': () => ({ rect: { width: 2, height: 2 } }),
  'disabled': () => ({ disabled: true }),
  'read only': () => ({ readOnly: true }),
  'failing checkVisibility': () => ({ checkVisibility: () => false })
};

test('hidden, transparent, tiny, disabled and read-only fields are never written', () => {
  for (const [kind, trap] of Object.entries(hidden)) {
    for (const [mode, role] of [['card', 'cc-number'], ['card', 'cc-csc'], ['address', 'postal-code'], ['address', 'email']]) {
      const set = mode === 'card' ? cardSet() : addressSet();
      const bad = field(role, trap());
      fill(page([form(bad, ...Object.values(set))], bad), mode);
      assert.equal(bad.value, '', kind + ' ' + role);
      assert.ok(Object.values(set).every((input) => input.value), kind + ' ' + role + ' visible set');
    }
  }
});

test('a field the page hides after an earlier write is left alone', () => {
  const set = cardSet();
  set.number.onEvent = () => { set.code.style = { opacity: '0' }; };
  fill(page([form(...Object.values(set))]), 'card');
  assert.deepEqual([set.number.value, set.code.value], ['4242424242424242', '']);
});

test('a field too short for its value is skipped, and a short number field stops the card', () => {
  const set = cardSet();
  set.name.maxLength = 4;
  set.code.maxLength = 2;
  const result = fill(page([form(...Object.values(set))]), 'card');
  assert.deepEqual(values(set), ['', '4242424242424242', '08/30', '']);
  assert.deepEqual(plain(result.filled), ['cc-number', 'cc-exp']);
  const short = cardSet();
  short.number.maxLength = 4;
  assert.deepEqual(plain(fill(page([form(...Object.values(short))]), 'card')), { filled: [] });
  assert.deepEqual(values(short), ['', '', '', '']);
});

test('expiry takes the shape the field asks for', () => {
  for (const [options, expected] of [
    [{ type: 'month' }, '2030-08'], [{ maxLength: 5 }, '08/30'], [{ maxLength: 7 }, '08/2030'], [{ placeholder: 'MM/YYYY' }, '08/2030'],
    [{ labels: [{ textContent: 'Expiry (MM/YY)' }] }, '08/30'], [{}, '08/30'], [{ placeholder: 'Expiry date' }, '08/30'], [{ placeholder: 'YYYY-MM' }, '2030-08'], [{ maxLength: 4 }, '']
  ]) {
    const number = field('cc-number'), expiry = field('cc-exp', options);
    fill(page([form(number, expiry)]), 'card');
    assert.equal(expiry.value, expected, JSON.stringify(options));
  }
  const number = field('cc-number'), month = select('cc-exp-month', [['8', 'August']]), year = field('cc-exp-year', { maxLength: 2 });
  fill(page([form(number, month, year)]), 'card');
  assert.deepEqual([month.value, year.value], ['8', '30']);
});

test('an address fills with and without a form, and never a card field', () => {
  for (const wrap of [form, box]) {
    const set = addressSet('shipping'), cards = cardSet();
    const result = fill(page([wrap(...Object.values(set), ...Object.values(cards))]), 'address', { ...address, ...card, name: 'Alex Sample' });
    assert.deepEqual(values(set), ['Alex Sample', 'Sample Works', 'Example Street 12, Flat 3', 'Riga', 'Vidzeme', 'LV-1010', 'LV',
      'alex@example.net', '+371 20000000']);
    assert.deepEqual(values(cards), ['', '', '', '']);
    assert.equal(result.filled.length, 9);
  }
});

test('card and address on one page fill apart', () => {
  const billing = addressSet('billing'), cards = cardSet();
  const api = page([form(...Object.values(billing), ...Object.values(cards))], cards.number);
  fill(api, 'card', { ...card, ...address, 'cc-name': 'Alex Sample' });
  assert.ok(values(billing).every((value) => value === ''));
  fill(api, 'address');
  assert.ok(values(billing).every(Boolean));
  assert.equal(cards.number.value, '4242424242424242');
});

test('one address section: the focused one, else shipping, else the first', () => {
  const run = (focus, sections = ['billing', 'shipping'], wrap = (sets) => [form(...sets.flat())]) => {
    const sets = sections.map(addressSet);
    fill(page(wrap(sets.map(Object.values)), focus?.(sets)), 'address');
    return sets.map((set) => values(set).filter(Boolean).length);
  };
  assert.deepEqual(run(), [0, 9]);
  assert.deepEqual(run((sets) => sets[0].tel), [9, 0]);
  assert.deepEqual(run(undefined, ['section-a', 'section-b']), [9, 0]);
  const separate = (sets) => sets.map((set) => form(...set));
  assert.deepEqual(run(undefined, ['', ''], separate), [9, 0]);
  assert.deepEqual(run((sets) => sets[1].email, ['', ''], separate), [0, 9]);
  // Without a form the containers keep two blocks apart, wherever the focus is.
  const blocks = (sets) => [box(...sets.map((set) => box(...set)))];
  assert.deepEqual(run(undefined, ['', ''], blocks), [9, 0]);
  assert.deepEqual(run((sets) => sets[1].email, ['', ''], blocks), [0, 9]);
  assert.deepEqual(run((sets) => sets[1]['postal-code'], ['', ''], blocks), [0, 9]);
});

test('duplicates within one address section are skipped unless focused', () => {
  const set = addressSet(), twin = field('tel');
  fill(page([form(...Object.values(set), twin)]), 'address');
  assert.deepEqual([set.tel.value, twin.value, set.email.value], ['', '', 'alex@example.net']);
  fill(page([form(...Object.values(set), twin)], twin), 'address');
  assert.equal(twin.value, address.tel);
});

test('an email or city box without a street or postal code is not an address', () => {
  const email = field('email'), city = new Input({ name: 'city' });
  const api = page([form(email), form(city)], email);
  assert.deepEqual(plain(api.psssFillPage({}, 'probe', origin).address), []);
  fill(api, 'address');
  assert.deepEqual([email.value, city.value], ['', '']);
});

test('address aliases are recognized, conflicting ones are not', () => {
  const named = ['full_name', 'company', 'address1', 'address2', 'town', 'state', 'zip', 'country', 'email', 'phone']
    .map((name) => new Input({ name }));
  const torn = new Input({ name: 'city', id: 'zip' });
  const off = new Input({ name: 'zip', autocomplete: 'off' });
  fill(page([form(...named, torn, off)]), 'address');
  assert.deepEqual(named.map((input) => input.value), ['Alex Sample', 'Sample Works', 'Example Street 12', 'Flat 3', 'Riga', 'Vidzeme',
    'LV-1010', 'Latvia', 'alex@example.net', '+371 20000000']);
  assert.deepEqual([torn.value, off.value], ['', '']);
});

test('a name is split only when it is exactly two words', () => {
  for (const [name, expected] of [['Alex Sample', ['Alex', 'Sample']], ['  Alex   Sample ', ['Alex', 'Sample']], ['Alex', ['', '']],
    ['Alex van Sample', ['', '']], ['', ['', '']]]) {
    const given = field('given-name'), family = field('family-name'), postal = field('postal-code');
    const result = fill(page([form(given, family, postal)]), 'address', { ...address, name });
    assert.deepEqual([given.value, family.value], expected, name);
    assert.equal(result.filled.includes('given-name'), Boolean(expected[0]));
  }
});

test('street lines go into the boxes the page has', () => {
  const area = field('street-address', { tagName: 'TEXTAREA' });
  fill(page([form(area)]), 'address');
  assert.equal(area.value, 'Example Street 12\nFlat 3');
  const single = field('street-address');
  fill(page([form(single)]), 'address');
  assert.equal(single.value, 'Example Street 12, Flat 3');
  const first = field('address-line1'), second = field('address-line2');
  fill(page([form(first, second)]), 'address');
  assert.deepEqual([first.value, second.value], ['Example Street 12', 'Flat 3']);
});

test('country and region lists match by code or by words, and only one way', () => {
  const run = (role, options, fields = address, settings) => {
    const list = select(role, options);
    fill(page([form(field('postal-code'), list)], undefined, origin, settings), 'address', fields);
    return list.value;
  };
  assert.equal(run('country', [['EE', 'Estonia'], ['LV', 'Latvia']]), 'LV');
  assert.equal(run('country', [['lv', 'x']]), 'lv');
  assert.equal(run('country', [['428', 'Latvia']]), '428');
  assert.equal(run('country-name', [['428', 'Latvija']], address, { lang: 'lv' }), '428');
  assert.equal(run('country', [['428', 'Latvia']], { ...address, country: 'Latvia' }), '428');
  assert.equal(run('country', [['1', 'Latvia'], ['2', 'Latvia']]), '');
  assert.equal(run('country', [['EE', 'Estonia']]), '');
  assert.equal(run('address-level1', [['RIX', 'Riga'], ['VID', 'Vidzeme']]), 'VID');
  assert.equal(run('address-level1', [['CA', 'California']], { ...address, 'address-level1': 'ca' }), 'CA');
  assert.equal(run('address-level1', [['QC', 'Québec']], { ...address, 'address-level1': 'Quebec' }), 'QC');
  assert.equal(run('address-level1', [['RIX', 'Riga']]), '');
});

test('hostile and unusable values do no harm', () => {
  const postal = field('postal-code', { type: 'number', value: '55' }), city = field('address-level2'), tel = field('tel', { maxLength: 5 });
  const name = field('name');
  const result = fill(page([form(postal, city, tel, name)]), 'address',
    { ...address, 'address-level2': 'Ri\r\nga', name: { toString: () => 'x' }, password: 'synthetic' });
  assert.deepEqual([postal.value, city.value, tel.value, name.value], ['55', 'Ri, ga', '', '']);
  assert.deepEqual(plain(result.filled), ['address-level2']);
});

test('probes and results name roles only, and write nothing', () => {
  const billing = addressSet('billing'), cards = cardSet();
  const api = page([form(...Object.values(billing), ...Object.values(cards))]);
  const probe = plain(api.psssFillPage({ ...card, ...address }, 'probe', origin));
  assert.deepEqual(probe, {
    filled: [], card: ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'],
    address: ['name', 'organization', 'address-line1', 'address-level2', 'address-level1', 'postal-code', 'country', 'email', 'tel'],
    paymentFrame: false
  });
  assert.ok([...values(billing), ...values(cards)].every((value) => value === ''));
  const results = JSON.stringify([probe, fill(api, 'card'), fill(api, 'address'), fill(api, 'unknown')]);
  for (const secret of [...Object.values(card), ...Object.values(address), 'Example Street', '08/30']) {
    assert.ok(!results.includes(secret), secret);
  }
});

test('a payment frame is reported only when no card field is outside frames, and never entered', () => {
  const frame = (attributes, options = {}) => new Box({ tagName: 'IFRAME', attributes, rect: { height: 300 }, ...options });
  const seen = (...content) => page(content).psssFillPage({}, 'probe', origin).paymentFrame;
  for (const attributes of [
    { src: '//pay.example.test/payment-frame' }, { src: 'https://js.stripe.com/v3/x' }, { title: 'Card details' },
    { name: 'braintree-hosted' }, { src: '/x', allow: 'payment *' }
  ]) assert.equal(seen(frame(attributes)), true, JSON.stringify(attributes));
  assert.equal(seen(frame({ src: 'https://video.example/embed', title: 'Our payload story' })), false);
  assert.equal(seen(frame({ title: 'Card details' }, { style: { opacity: '0' } })), false);
  assert.equal(seen(frame({ src: 'http://[bad' })), false);
  assert.equal(seen(frame({ title: 'Card details' }), field('cc-number')), false);
});
