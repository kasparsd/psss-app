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
  // Two blocks inside one form: the nearest to the focused field too, whichever of its fields that is.
  const together = (sets) => [form(...sets.map((set) => box(...set)))];
  assert.deepEqual(run(undefined, ['', ''], together), [9, 0]);
  for (const role of ['name', 'address-level2', 'postal-code', 'email', 'tel']) {
    assert.deepEqual(run((sets) => sets[1][role], ['', ''], together), [0, 9], role);
    assert.deepEqual(run((sets) => sets[0][role], ['', ''], together), [9, 0], role);
  }
});

test('the number box relabelled or masked by its own handler does not end the fill', () => {
  const changes = {
    label: (input) => { input.attributes['aria-label'] = 'Accepted'; },
    password: (input) => { input.type = 'password'; },
    telephone: (input) => { input.type = 'tel'; }
  };
  for (const [kind, change] of Object.entries(changes)) {
    for (const options of [{ autocomplete: 'cc-number' }, { attributes: { 'aria-label': 'Card number' } }]) {
      for (const wrap of [form, box]) {
        const set = cardSet(), number = new Input({ ...options, attributes: { ...options.attributes } });
        // The guessed box is found by its label, which the handler takes away.
        number.getAttribute = (name) => number.attributes[name] ?? null;
        number.onEvent = () => change(number);
        const result = fill(page([wrap(number, set.name, set.expiry, set.code)]), 'card');
        assert.deepEqual(plain(result), { filled: ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'] }, kind);
        assert.deepEqual([number.value, set.code.value], ['4242424242424242', '987'], kind);
      }
    }
  }
  // Another box the handler relabels or retypes is left alone, and the fill goes on past it.
  for (const change of [(input) => { input.attributes['aria-label'] = 'Coupon'; }, (input) => { input.type = 'password'; }]) {
    const set = cardSet();
    set.number.onEvent = () => change(set.name);
    assert.deepEqual(plain(fill(page([form(...Object.values(set))]), 'card')), { filled: ['cc-number', 'cc-exp', 'cc-csc'] });
    assert.equal(set.name.value, '');
  }
  // Another name, autocomplete or a type no number box has: it is not that box any more, and the number is taken back.
  for (const change of [(input) => { input.type = 'search'; }, (input) => { input.attributes.name = 'coupon'; },
    (input) => { input.attributes.autocomplete = 'off'; }]) {
    const set = cardSet();
    set.number.onEvent = () => change(set.number);
    assert.deepEqual(plain(fill(page([form(...Object.values(set))]), 'card')), { filled: [], left: ['cc-number'] });
    assert.deepEqual(values(set), ['', '', '', '']);
  }
});

test('a number whose handler runs past the time limit is still reported', () => {
  const set = cardSet();
  set.number.onEvent = () => { for (const until = Date.now() + 2100; Date.now() < until;); set.number.onEvent = undefined; };
  assert.deepEqual(plain(fill(page([form(...Object.values(set))]), 'card')), { filled: [], left: ['cc-number'] });
  assert.deepEqual(values(set), ['', '', '', '']);
});

// A page handler on the security code, once everything is written, that does `act`.
const lastly = (act) => {
  const set = cardSet();
  set.code.onEvent = () => { set.code.onEvent = undefined; act(set); };
  const result = plain(fill(page([form(...Object.values(set))]), 'card'));
  return { set, result };
};

test('a card number or code the page puts into another written field is taken back', () => {
  const NUMBER = card['cc-number'];
  const shapes = {
    whole: NUMBER, spaced: NUMBER.replace(/(.{4})(?!$)/g, '$1 '), cut: NUMBER.slice(0, 12), tail: NUMBER.slice(-8),
    wide: [...NUMBER].map((digit) => String.fromCodePoint(0xff10 + Number(digit))).join(''),
    hidden: [...NUMBER].join('​'), hostile: '‮../\n' + NUMBER + '\u0000', huge: 'x'.repeat(5_000_000) + NUMBER
  };
  for (const [shape, text] of Object.entries(shapes)) {
    for (const role of ['name', 'expiry']) {
      for (const move of [true, false]) {
        const started = Date.now();
        const { set, result } = lastly((fields) => { fields[role].stored = text; if (move) fields.number.stored = ''; });
        const written = role === 'name' ? 'cc-name' : 'cc-exp';
        assert.deepEqual(result.left, move ? ['cc-number', written].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : [written], shape);
        assert.equal(set[role].value, '', shape + ' ' + role);
        // Results name roles only.
        assert.doesNotMatch(JSON.stringify(result), /\d{3}/, shape);
        assert.ok(Date.now() - started < 2000, shape);
      }
    }
  }
  // Added after what was written, and the code moved or added.
  for (const text of [`Alex Sample ${NUMBER}`, '987', 'Alex Sample 987']) {
    const { set, result } = lastly((fields) => { fields.name.stored = text; });
    assert.deepEqual([set.name.value, result.left], ['', ['cc-name']], text);
  }
});

test('other rewrites stay, as do digits in a field the fill did not write', () => {
  for (const text of ['ALEX S.', 'Alex Sample •••• 4242', '424242******4242', '+371 29870000', 'Alex Sample (ref 19870)']) {
    const { set, result } = lastly((fields) => { fields.name.stored = text; });
    assert.deepEqual([set.name.value, result.left], [text, ['cc-name']], text);
  }
  const stray = new Input({ name: 'coupon' });
  const set = cardSet();
  set.code.onEvent = () => { set.code.onEvent = undefined; stray.stored = set.number.value; set.number.stored = ''; };
  fill(page([form(...Object.values(set), stray)]), 'card');
  assert.equal(stray.value, card['cc-number']);
});

test('a copy the page makes again is removed without asking the page again', () => {
  // On every change of the name box the number is copied back into it.
  const set = cardSet();
  set.name.onEvent = () => { if (set.number.value) set.name.stored = set.number.value; };
  const result = plain(fill(page([form(...Object.values(set))]), 'card'));
  assert.deepEqual([set.name.value, result.left], ['', ['cc-name']]);
  // Taking the number back hands it to a field already dealt with.
  const other = cardSet();
  other.code.onEvent = () => { other.code.onEvent = undefined; other.name.stored = card['cc-number']; other.number.stored = '1'; };
  other.number.onEvent = () => { if (other.number.value === '') other.name.stored = card['cc-number']; };
  fill(page([form(...Object.values(other))]), 'card');
  assert.deepEqual([other.number.value, other.name.value], ['', '']);
});
const ORDER = ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'];

test('a code the page hands back to its own box while another is taken back goes too', () => {
  const set = cardSet();
  set.code.onEvent = () => { set.code.onEvent = undefined; set.name.stored = '987'; set.code.stored = ''; };
  set.name.onEvent = () => { if (set.name.value === '' && set.code.value === '') set.code.stored = '987'; };
  const result = plain(fill(page([form(...Object.values(set))]), 'card'));
  assert.deepEqual([set.name.value, set.code.value, result.left], ['', '', ['cc-name', 'cc-csc']]);
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

// Field names made of several words, other languages and folding (the extended step of describe).
// The target is the only field whose name is not exact; the others give the address (or card) its anchor.
const guess = (role, options) => {
  const target = new Input(options);
  const base = [];
  if (role !== 'postal-code') base.push(new Input({ name: 'zip' }));
  if (role !== 'address-line1' && role !== 'street-address') base.push(new Input({ name: 'address' }));
  const result = fill(page([form(...base, target)]), 'address');
  return { value: target.value, filled: plain(result.filled) };
};
const guessed = (role, options) => {
  const found = guess(role, options);
  assert.ok(found.value && found.filled.includes(role), role + ' ' + JSON.stringify(options));
};
const refused = (options) => {
  const street = new Input({ name: 'address' }), zip = new Input({ name: 'zip' }), target = new Input(options);
  fill(page([form(street, zip, target)]), 'address');
  assert.ok(street.value && zip.value, 'the rest of the address is filled ' + JSON.stringify(options).slice(0, 80));
  assert.equal(target.value, '', JSON.stringify(options).slice(0, 80));
};
const labelled = (text) => ({ labels: [{ textContent: text }] });
const cardNumber = (options) => {
  const target = new Input(options);
  fill(page([form(target)]), 'card');
  return target.value;
};
const withNumber = (options) => {
  const target = new Input(options);
  fill(page([form(new Input({ name: 'cardnumber' }), target)]), 'card');
  return target.value;
};

test('names made of several words give a role when every extra word is only context', () => {
  guessed('postal-code', { name: 'billing_address_postcode' });
  guessed('postal-code', { name: 'checkout[shipping_address][zip]' });
  guessed('address-level2', { name: 'ctl00$Main$txtCity' });
  guessed('postal-code', labelled('Postcode (required)'));
  guessed('postal-code', labelled('ZIP / Postal code'));
  guessed('address-level2', labelled('Town / City'));
  guessed('address-level1', labelled('State / Province'));
  guessed('postal-code', { placeholder: 'Postal code' });
  guessed('address-level2', { placeholder: 'City *' });
  guessed('postal-code', { id: 'billingPostalCode' });
  guessed('address-line1', { name: 'shippingAddress1' });
  guessed('address-level2', { attributes: { 'aria-label': 'Your city' } });
  guessed('tel', labelled('Mobile phone'));
  assert.equal(cardNumber(labelled('Card number * (16 digits)')), '4242424242424242');
  assert.equal(cardNumber({ placeholder: 'Credit card number' }), '4242424242424242');
  assert.equal(cardNumber({ name: 'payment_card_number' }), '4242424242424242');
  assert.equal(withNumber({ labels: [{ textContent: 'Expiry date MM/YY' }] }), '08/30');
  assert.equal(withNumber({ placeholder: 'Card verification code' }), '987');
  assert.equal(withNumber({ name: 'ctl00_txtCardExpiry' }), '08/30');
});

test('names with a word that makes them something else give no role', () => {
  for (const name of ['gift_card_number', 'loyalty_card_number', 'user_name', 'ip_address', 'house_number', 'order_state']) {
    refused({ name });
    refused({ placeholder: name.replace(/_/g, ' ') });
  }
  assert.equal(cardNumber({ name: 'gift_card_number' }), '');
  assert.equal(cardNumber({ labels: [{ textContent: 'Loyalty card number' }] }), '');
  assert.equal(cardNumber({ name: 'user_card_number' }), '');
  // A name that holds no alias at the end, or only noise.
  refused({ name: 'billing_notes' });
  refused({ name: 'billing' });
  refused({ placeholder: 'required' });
  refused({ placeholder: 'MM / YY' });
  refused({ name: 'zipper' });
});

test('trailing noise words and the first bracket or star are ignored', () => {
  for (const text of ['Postcode required', 'Postcode optional', 'Postcode field', 'Postcode input value', 'Postcode * required', 'Postcode (e.g. LV-1010)',
    'Postcode*', 'txtPostcode', 'Postcode mandatory']) {
    guessed('postal-code', labelled(text));
  }
  // Only the text before the first bracket counts.
  refused({ placeholder: '(Postcode)' });
  refused({ placeholder: '*Postcode' });
  guessed('postal-code', labelled('Postcode (not your city)'));
});

test('a source of more than six words says nothing, and a prefix must be context or the same role', () => {
  guessed('postal-code', { name: 'billing_shipping_delivery_mailing_checkout_zip' });
  refused({ name: 'billing_shipping_delivery_mailing_payment_customer_zip' });
  guessed('postal-code', labelled('Please type in the postal code'.split(' ').slice(-2).join(' ')));
  refused(labelled('Please type in your zip code of residence'));
  refused(labelled('Enter the zip code'));
  guessed('address-level1', labelled('Province / State'));
  refused(labelled('Zip / City'));
});

test('sources that name different roles give none, and those that agree give one', () => {
  refused({ name: 'billing_zip', id: 'shipping_city' });
  refused({ name: 'billing_zip', placeholder: 'City' });
  refused({ name: 'billing_zip', labels: [{ textContent: 'Billing town' }] });
  guessed('postal-code', { name: 'billing_zip', placeholder: 'Postal code', labels: [{ textContent: 'ZIP' }] });
  guessed('postal-code', { name: 'foo', placeholder: 'Postal code' });
  refused({ name: 'foo', placeholder: 'Postal code', labels: [{ textContent: 'Billing town' }] });
});

test('a guessed field loses to a declared one, never overrides autocomplete and is skipped when off', () => {
  const declared = field('postal-code'), street = field('address-line1'), maybe = new Input({ name: 'billing_zip' });
  const unnamed = new Input({ name: 'billing_city' });
  fill(page([form(street, declared, maybe, unnamed)]), 'address');
  assert.deepEqual([street.value, declared.value, maybe.value, unnamed.value], ['Example Street 12, Flat 3', 'LV-1010', '', '']);
  const off = new Input({ name: 'billing_zip', autocomplete: 'off' }), zip = new Input({ name: 'zip' }), road = new Input({ name: 'address' });
  fill(page([form(road, zip, off)]), 'address');
  assert.equal(off.value, '');
  // An autocomplete role the page declares is never replaced by the name.
  const code = field('postal-code', { name: 'city' }), line = field('address-line1');
  fill(page([form(line, code)]), 'address');
  assert.equal(code.value, 'LV-1010');
});

test('card names in other languages and with extra words give the card roles, and guesses are undeclared', () => {
  const set = {
    number: new Input({ name: 'billing[card_number]' }), name: new Input({ placeholder: 'Name on card (as printed)' }),
    expiry: new Input({ labels: [{ textContent: 'Card expiry date' }], maxLength: 5 }), code: new Input({ name: 'card_cvv_code' })
  };
  fill(page([form(...Object.values(set))]), 'card');
  assert.deepEqual(values(set), ['4242424242424242', 'Alex Sample', '08/30', '987']);
  // A declared rival of the same role wins over a guessed one.
  const first = new Input({ name: 'billing_card_number' }), second = field('cc-number');
  fill(page([form(first, second)]), 'card');
  assert.deepEqual([first.value, second.value], ['', '4242424242424242']);
});

test('every language names a card field and an address field', () => {
  const cards = {
    de: ['Kartennummer', 'Karteninhaber', 'Gültig bis', 'Sicherheitscode'], fr: ['Numéro de carte', 'Titulaire de la carte', 'Date d’expiration', 'Cryptogramme'],
    es: ['Número de tarjeta', 'Titular de la tarjeta', 'Fecha de caducidad', 'Código de seguridad'],
    it: ['Numero di carta', 'Intestatario della carta', 'Data di scadenza', 'Codice di sicurezza'],
    nl: ['Kaartnummer', 'Kaarthouder', 'Vervaldatum', 'Beveiligingscode'], pl: ['Numer karty', 'Właściciel karty', 'Data ważności', 'Kod CVV'],
    pt: ['Número do cartão', 'Titular do cartão', 'Data de validade', 'Código de segurança'],
    lv: ['Kartes numurs', 'Vārds uz kartes', 'Derīgs līdz', 'Drošības kods']
  };
  const roles = ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'];
  for (const [language, labels] of Object.entries(cards)) {
    const set = labels.map((text) => new Input({ labels: [{ textContent: text }] }));
    const result = plain(fill(page([form(...set)]), 'card').filled);
    // The security code goes only beside the number, in a group of nothing but the card.
    assert.deepEqual(result, roles, language);
    assert.equal(set[0].value, '4242424242424242', language);
    // A hint after the words does not change them.
    assert.equal(cardNumber({ placeholder: labels[0] + ' (16)' }), '4242424242424242', language);
  }
  const addresses = {
    de: ['Postleitzahl', 'address-level2', 'Ort', 'Straße', 'E-Mail-Adresse'], fr: ['Code postal', 'address-level2', 'Ville', 'Adresse', 'Adresse e-mail'],
    es: ['Código postal', 'address-level2', 'Ciudad', 'Dirección', 'Correo electrónico'],
    it: ['Codice postale', 'address-level2', 'Città', 'Indirizzo', 'Indirizzo email'],
    nl: ['Postcode', 'address-level2', 'Woonplaats', 'Straat', 'E-mailadres'], pl: ['Kod pocztowy', 'address-level2', 'Miasto', 'Ulica', 'Adres e-mail'],
    pt: ['Código postal', 'address-level2', 'Cidade', 'Endereço', 'Correio eletrónico'],
    lv: ['Pasta indekss', 'address-level2', 'Pilsēta', 'Iela', 'E-pasts']
  };
  for (const [language, [postal, , city, street, email]] of Object.entries(addresses)) {
    const set = [street, postal, city, email].map((text) => new Input({ labels: [{ textContent: text }] }));
    const result = plain(fill(page([form(...set)]), 'address').filled).sort();
    assert.deepEqual(result, ['address-level2', 'address-line1', 'email', 'postal-code'], language);
    assert.equal(set[1].value, 'LV-1010', language);
    // And with an extra word and a bracketed hint, so the word step reads it.
    const hinted = [street, postal, city].map((text) => new Input({ placeholder: 'Billing ' + text + ' (required)' }));
    assert.deepEqual(plain(fill(page([form(...hinted)]), 'address').filled).sort(), ['address-level2', 'address-line1', 'postal-code'], language);
  }
});

test('names fold accents and letters like ß, ł, ø, æ and œ, and what folds to nothing never matches', () => {
  guessed('address-level2', { attributes: { 'aria-label': 'Città' }, name: '' });
  guessed('address-line1', { name: 'Straße' });
  guessed('address-line1', { name: 'STRASSE' });
  guessed('address-level2', { id: 'PILSĒTA' });
  guessed('postal-code', { name: 'Kod pocztowy'.toUpperCase() });
  guessed('address-level1', { name: 'Wojewodztwo' });
  guessed('address-level1', { labels: [{ textContent: 'Województwo' }] });
  guessed('postal-code', { labels: [{ textContent: 'ＺＩＰ' }] });
  guessed('postal-code', { name: 'Code postaĺ'.replace('́', '') });
  // Folding itself: ß is ss, ł is l, ø is o, æ is ae and œ is oe.
  assert.equal(cardNumber({ name: 'Numéro de carte' }), '4242424242424242');
  assert.equal(cardNumber({ name: 'Numéro de carte' }), '4242424242424242');
  for (const name of ['郵便番号', '住所', 'Почтовый индекс', 'Ταχυδρομικός Κώδικας', '', '___']) {
    refused({ name });
    refused({ labels: [{ textContent: name }] });
  }
});

test('login mode is not extended: a placeholder or a long name gives no role', () => {
  const run = (...before) => {
    const secret = new Input({ type: 'password', name: 'password' });
    page([form(...before, secret)]).psssFillPage({ username: 'alex@example.net', 'current-password': 'synthetic-password' }, 'login', origin);
    return [...before.map((input) => input.value), secret.value];
  };
  // As before: a box with only a placeholder is the account when it is the only one.
  assert.deepEqual(run(new Input({ placeholder: 'Email' })), ['alex@example.net', 'synthetic-password']);
  // user_name is the login's own alias.
  assert.deepEqual(run(new Input({ name: 'user_name' })), ['alex@example.net', 'synthetic-password']);
  // A name only the word step would call a postcode is still unnamed, so two unnamed boxes leave the account unknown.
  assert.deepEqual(run(new Input({ placeholder: 'Email' }), new Input({ name: 'billing_address_postcode' })), ['', '', 'synthetic-password']);
  assert.deepEqual(run(new Input({ name: 'ctl00$txtCity' }), new Input({ name: 'gift_card_number' })), ['', '', 'synthetic-password']);
  assert.deepEqual(run(new Input({ name: 'Straße' }), new Input({ placeholder: 'Account' })), ['', '', 'synthetic-password']);
});

test('foreign security code words are held to the generic rule in both steps', () => {
  const words = ['Security code', 'Sicherheitscode', 'Código de seguridad', 'Code de sécurité', 'Codice di sicurezza', 'Beveiligingscode', 'Kod bezpieczeństwa',
    'Drošības kods'];
  for (const word of [...words, ...words.map((text) => 'Your ' + text.toLowerCase())]) {
    // Close to the number and inside a group of nothing but the card: filled.
    const near = new Input({ labels: [{ textContent: word }] }), number = field('cc-number');
    fill(page([form(number, near)]), 'card');
    assert.equal(near.value, '987', word);
    // A heading between them makes it another form's box.
    const code = new Input({ labels: [{ textContent: word }] }), top = field('cc-number');
    const heading = new Box({ tagName: 'H2' });
    fill(page([form(top, heading, code)]), 'card');
    assert.equal(top.value, '4242424242424242', word);
    assert.equal(code.value, '', word);
  }
  // A word that names the card is not generic: it stays filled beside the number.
  for (const word of ['Card security code', 'CVV', 'Kartenprüfnummer', 'Cryptogramme', 'Kod CVV', 'Controlegetal']) {
    const code = new Input({ labels: [{ textContent: word }] }), top = field('cc-number');
    fill(page([form(top, new Box({ tagName: 'H2' }), code)]), 'card');
    assert.equal(code.value, '987', word);
  }
});

test('a hostile label gives no role and no error, within the deadline', () => {
  const texts = [
    '‮' + 'A'.repeat(100000) + '‬', 'x'.repeat(100000), 'zip '.repeat(25000), '../../../etc/passwd', 'x\n\u0085../\n..\\y',
    '‮edoc latsop‬', 'a(' + 'b'.repeat(100000), '*'.repeat(100000), ('billing ').repeat(20000) + 'zip', '(zip)'.repeat(30000),
    '𐀀'.repeat(60000), 'Ｚ'.repeat(100000), 'ǅ'.repeat(50000) + 'zip'
  ];
  for (const text of texts) {
    const started = Date.now();
    const content = [form(new Input({ name: 'address' }), new Input({ name: 'zip' }), new Input({ name: text.slice(0, 5000), id: text, placeholder: text,
      labels: [{ textContent: text }], attributes: { 'aria-label': text } }))];
    assert.doesNotThrow(() => fill(page(content), 'address'));
    assert.doesNotThrow(() => fill(page(content), 'card'));
    assert.ok(Date.now() - started < 2000, text.slice(0, 10));
    refused({ name: text.slice(0, 200), labels: [{ textContent: text }], placeholder: text });
  }
  // A label ending in zip after a long run of context words is still too long to trust.
  refused(labelled('billing '.repeat(20000) + 'zip'));
  // A path and a newline in a name are only words.
  refused({ name: '../zip' + '\n'.repeat(3) + 'billing' });
});

test('"Card name" is the cardholder, never the address name', () => {
  for (const options of [labelled('Card name'), { name: 'card_name' }]) {
    const named = new Input(options), set = addressSet();
    fill(page([form(named, ...Object.values(set))]), 'address');
    assert.equal(named.value, '', JSON.stringify(options));
    assert.equal(set.name.value, 'Alex Sample');
    const holder = new Input(options);
    fill(page([form(new Input({ name: 'cardnumber' }), holder)]), 'card');
    assert.equal(holder.value, 'Alex Sample', JSON.stringify(options));
  }
});

test('a person-name box takes only person context words, never layout words', () => {
  for (const name of ['street_name', 'address_name', 'home_name', 'work_name', 'new_name', 'default_name', 'postal_name', 'line_name',
    'field_name', 'form_name', 'input_name', 'data_name', 'details_name', 'street_first_name', 'address_last_name']) {
    refused({ name });
  }
  for (const text of ['Street name', 'Address name', 'Home name', 'Details name']) refused(labelled(text));
  guessed('name', { name: 'shipping_name' });
  guessed('name', labelled('Your name'));
  guessed('given-name', { name: 'billing_first_name' });
  guessed('given-name', { name: 'txtFirstName' });
  guessed('family-name', { name: 'ctl00$Main$txtLastName' });
});

test('words that mean something else in another language give no role', () => {
  for (const text of ['firma', 'departement', 'portable', 'correo', 'Firma', 'Département', 'Portable', 'Correo']) {
    refused(labelled(text));
    refused({ name: text });
  }
  guessed('email', labelled('Correo electrónico'));
  guessed('organization', labelled('Firmenname'));
});

test('a card number whose hint says it is partial is not the card number', () => {
  for (const text of ['Card number (last 4 digits)', 'Card number (masked)', 'Kartennummer (letzte 4 Ziffern)', 'Card number (ending in 1234)',
    'Numéro de carte (derniers chiffres)']) {
    assert.equal(cardNumber(labelled(text)), '', text);
    assert.equal(cardNumber({ placeholder: text }), '', text);
  }
  assert.notEqual(cardNumber(labelled('Card number (Visa, Mastercard)')), '');
  // Other roles keep their hints.
  const code = new Input(labelled('Security code (3 digits)'));
  fill(page([form(new Input({ name: 'cardnumber' }), code)]), 'card');
  assert.equal(code.value, '987');
  guessed('postal-code', labelled('Postcode (required)'));
});

test('card words are context for card roles and not for address roles', () => {
  for (const name of ['card_company', 'payment_name', 'credit_name', 'card_first_name', 'card_last_name', 'card_recipient_name', 'card_address', 'card_zip']) {
    refused({ name });
  }
  for (const name of ['card_holder_name', 'payment_card_number', 'credit_card_expiry']) assert.ok(withName(name), name);
  const holder = new Input({ name: 'card_name' });
  fill(page([form(new Input({ name: 'cardnumber' }), holder)]), 'card');
  assert.equal(holder.value, 'Alex Sample');
});
const withName = (name) => cardNumber({ name }) || (() => {
  const target = new Input({ name });
  fill(page([form(new Input({ name: 'cardnumber' }), target)]), 'card');
  return target.value;
})();

test('ASP.NET placeholder names are read without the placeholder', () => {
  guessed('given-name', { name: 'ctl00_ContentPlaceHolder1_txtFirstName' });
  guessed('postal-code', { name: 'ctl00$ContentPlaceHolder1$txtPostalCode' });
  guessed('address-level2', { name: 'ctl00_MainContent_txtCity' });
  guessed('postal-code', { name: 'ctl00_contentplaceholder_txtPostalCode' });
});

test('a phone country-code box is not the country', () => {
  const set = (target) => [new Input({ name: 'address' }), new Input({ name: 'zip' }), new Input({ name: 'city' }), target];
  for (const options of [{ type: 'tel', name: 'country_code' }, { name: 'country_code', placeholder: '+371' }, { type: 'number', name: 'country' },
    { name: 'country', placeholder: ' +1' }, { type: 'tel', name: 'countryname' }]) {
    const target = new Input(options);
    fill(page([form(...set(target))]), 'address');
    assert.equal(target.value, '', JSON.stringify(options));
  }
  const text = new Input({ name: 'country' });
  fill(page([form(...set(text))]), 'address');
  assert.ok(text.value);
  const only = select(undefined, [['LV', 'Latvia'], ['US', 'United States']], { name: 'country_code', autocomplete: '' });
  fill(page([form(new Input({ name: 'address' }), new Input({ name: 'zip' }), only)]), 'address');
  assert.ok(only.value);
});
