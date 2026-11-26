// The iPhone and iPad popup's logic (Extensions/SafariIOS/web/popup-logic.js) with a faked browser API and page: every state
// and its words, what is asked of Psss and when, and that no value of a card or an address reaches a view. Run by
// scripts/test-safari-fill.sh. The page fill itself and the drawing are tested in Extensions/Browser/tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const source = ['Extensions/Browser/src/display.js', 'Extensions/Browser/src/origin.js', 'Extensions/SafariIOS/web/popup-logic.js']
  .map(read).join('\n');
const SafariFillPopup = vm.runInNewContext(`${source}\nSafariFillPopup`, { URL, Intl, setTimeout, clearTimeout });
const plain = (value) => JSON.parse(JSON.stringify(value));

const PASSWORDS = '11111111-1111-4111-8111-111111111111';
const WORK = '22222222-2222-4222-8222-222222222222';
const ref = (n, grant = 'a') => `${grant.repeat(32)}.00000000-0000-4000-8000-00000000000${n}`;
const NUMBER = '4929374102684417';
const VALUES = {
  card: { 'cc-name': 'Sam Q Rivers', 'cc-number': NUMBER, 'cc-exp': '2028-08', 'cc-csc': '731' },
  address: {
    name: 'Sam Rivers', 'street-address': '12 Harbour Road', 'address-level2': 'Rigacity', 'postal-code': 'LV-1010',
    email: 'sam@harbor.example', tel: '+37120000000'
  }
};
const SECRETS = [NUMBER, '731', 'Sam Q Rivers', '12 Harbour Road', 'LV-1010', 'sam@harbor.example', '+37120000000'];
const status = (changes = {}) => ({
  v: 1, ok: true,
  vaults: [{ id: PASSWORDS, name: 'Passwords', ready: true }],
  cards: [{ ref: ref(1), title: 'Everyday Visa', brand: 'Visa', lastFour: '4417', expiry: '2028-08', hasCode: true }],
  addresses: [{ ref: ref(2), label: 'Home', fullName: 'Sam Rivers', city: 'Riga' }],
  ...changes
});
const lockedStatus = (vaults = [{ id: PASSWORDS, name: 'Passwords', ready: false }]) => status({ vaults, cards: [], addresses: [] });
const refused = (error) => ({ v: 1, ok: false, error });
const CARD_PAGE = { card: ['cc-name', 'cc-number', 'cc-exp', 'cc-csc'], address: [] };
const ADDRESS_PAGE = { card: [], address: ['name', 'address-line1', 'postal-code', 'address-level2', 'email', 'tel'] };

/**
 * A browser: `tab` and `page` may be changed while the popup is open. `replies.status` and `replies.release` answer the
 * handler (a function, or a value); `written` says what the page fill reports.
 */
function browser({ url = 'https://shop.example/checkout', page = CARD_PAGE, replies = {}, written } = {}) {
  const world = {
    tab: { id: 7, url }, page, written, replies: { status: status(), release: { v: 1, ok: true, fields: VALUES.card }, ...replies },
    asked: [], injected: [], updates: [], views: [], closed: 0, blocked: false, onAsk: () => {},
    // `hang(call)` true leaves that browser call ('query', 'probe', 'write', 'update') unanswered until `release()`.
    // `onWrite` replaces what the browser answers to the write.
    hang: () => false, held: [], onWrite: undefined
  };
  const stall = (call) => world.hang(call) ? new Promise((ok) => world.held.push(ok)) : undefined;
  world.release = () => world.held.splice(0).forEach((ok) => ok());
  const api = {
    tabs: {
      query: async () => { await stall('query'); return world.tab ? [{ ...world.tab }] : []; },
      update: async (id, change) => { await stall('update'); world.updates.push([id, change.url]); }
    },
    scripting: {
      executeScript: async ({ target, args }) => {
        assert.deepEqual(plain(target.frameIds), [0]);
        if (world.blocked) throw new Error('Missing host permission');
        const [fields, mode, origin, options] = plain(args);
        world.injected.push({ fields, mode, origin, options });
        await stall(mode === 'probe' ? 'probe' : 'write');
        if (mode !== 'probe' && world.onWrite) return world.onWrite();
        if (new URL(world.tab.url).origin !== origin) return [{ result: { filled: [] } }];
        if (mode === 'probe') return [{ result: { filled: [], paymentFrame: false, ...world.page } }];
        const roles = world.written ?? world.page[mode].filter((role) => fields[role] ?? fields[{ 'address-line1': 'street-address' }[role]]);
        return [{ result: { filled: roles } }];
      }
    },
    runtime: {
      sendNativeMessage: async (_, message) => {
        const sent = plain(message);
        world.asked.push(sent);
        const reply = world.replies[sent.type];
        const answer = typeof reply === 'function' ? await reply(sent) : reply;
        world.onAsk(sent.type);
        return answer;
      }
    }
  };
  world.popup = SafariFillPopup.create({
    api, pageFill: () => {}, show: (view) => world.views.push(plain(view)), close: () => { world.closed += 1; }, timeout: 50
  });
  world.view = () => world.views.at(-1);
  return world;
}

const open = async (options) => { const world = browser(options); await world.popup.start(); return world; };
const said = (parts) => [parts].flat().map((part) => part?.name ?? part ?? '').join('');
/** Every notice and line of a view as the person reads it. */
const words = (view) => view.parts.map((part) => {
  if (part.type === 'notice') return [said(part.title), said(part.text)].filter(Boolean).join(' | ');
  if (part.type === 'group') return `${part.heading}: ${part.rows.map((row) => `${row.name} (${row.detail})`).join(', ')}`;
  if (part.type === 'text') return part.text;
  assert.equal(part.type, 'open');
  return '[Open Psss]';
});
const opens = (view) => view.parts.map((part) => part.open).filter(Boolean);
const releases = (world) => world.asked.filter((message) => message.type === 'release');
const writes = (world) => world.injected.filter((call) => call.mode !== 'probe');
/** Nothing a person's card or address holds is in anything the popup drew or linked to. */
function secret(world) {
  const shown = JSON.stringify([world.views, world.updates, world.asked]);
  for (const value of SECRETS) assert.ok(!shown.includes(value), `a view, link or request holds ${value}`);
  for (const call of world.injected.filter((c) => c.mode === 'probe')) assert.deepEqual(call.fields, {});
}

test('the two links are defined in one place and carry no more than a vault identifier', () => {
  assert.equal(SafariFillPopup.LINKS.share(PASSWORDS), `psss://safari-fill?vault=${PASSWORDS}`);
  assert.equal(SafariFillPopup.LINKS.share(), 'psss://safari-fill');
  assert.equal(SafariFillPopup.LINKS.share('x&evil=1'), 'psss://safari-fill');
  assert.equal(SafariFillPopup.LINKS.app, 'psss://open');
});

test('only HTTPS pages are filled, loopback included', () => {
  assert.equal(SafariFillPopup.secureOrigin('https://shop.example/a?b=c'), 'https://shop.example');
  assert.equal(SafariFillPopup.secureOrigin('https://localhost:8443/'), 'https://localhost:8443');
  for (const url of ['http://shop.example/', 'http://localhost:8090/checkout', 'http://127.0.0.1/', 'http://[::1]/', 'about:blank',
    'file:///tmp/a.html', 'https://paypal.com@evil.example/', 'data:text/html,x', 'nonsense', '']) {
    assert.equal(SafariFillPopup.secureOrigin(url), null, url);
  }
});

test('an insecure page is told so before Psss or the page is asked anything', async () => {
  for (const url of ['http://shop.example/', 'http://localhost:8090/checkout']) {
    const world = await open({ url });
    assert.deepEqual(words(world.view()), ['This page isn’t secure | Psss fills only pages that use HTTPS. Nothing was filled.']);
    assert.deepEqual([world.asked, world.injected, opens(world.view()), world.view().header], [[], [], [], null]);
  }
});

test('a page Safari does not let Psss read is told so, and Psss is not asked', async () => {
  const noUrl = browser();
  noUrl.tab = { id: 7 };
  const noTab = browser();
  noTab.tab = undefined;
  const refusing = browser();
  refusing.blocked = true;
  for (const world of [noUrl, noTab, refusing]) {
    await world.popup.start();
    assert.deepEqual(words(world.view()),
      ['Safari hasn’t allowed Psss on this page | Nothing was filled. Close this, open Psss again, and allow it if Safari asks.']);
    assert.deepEqual([world.asked, opens(world.view())], [[], []]);
  }
});

test('the first load says it is loading, then lists cards first and addresses, never a full number', async () => {
  const world = await open({ page: { card: CARD_PAGE.card, address: ADDRESS_PAGE.address } });
  assert.deepEqual([words(world.views[0]), world.views[0].header, world.views[0].parts[0].kind],
    [['Loading cards and addresses…'], null, 'progress']);
  assert.deepEqual(words(world.view()),
    ['Cards for This Page: Everyday Visa (Visa •• 4417 · 08/28)', 'Addresses for This Page: Home (Sam Rivers · Riga)']);
  assert.equal(world.view().parts[0].rows[0].label, 'Fill Everyday Visa, Visa ending 4417, expires 08/28');
  assert.deepEqual(world.asked, [{ v: 1, type: 'status', origin: 'https://shop.example' }]);
  assert.deepEqual(world.view().header, { chosen: PASSWORDS, vaults: [{ id: PASSWORDS, name: 'Passwords' }] });
  assert.equal(world.injected[0].options.pageOrder, true);
  secret(world);
});

test('only the groups the page has places for are listed', async () => {
  assert.deepEqual((await open()).view().parts.map((p) => p.kind), ['card']);
  assert.deepEqual((await open({ page: ADDRESS_PAGE })).view().parts.map((p) => p.kind), ['address']);
  const amex = status({ cards: [{ ref: ref(1), title: 'Travel', brand: 'American Express', lastFour: '0005', hasCode: false }] });
  assert.deepEqual(words((await open({ replies: { status: amex } })).view()), ['Cards for This Page: Travel (Amex •• 0005)']);
});

test('a locked vault says so with Open Psss, the same words for every vault', async () => {
  const world = await open({ replies: { status: lockedStatus() } });
  assert.deepEqual(words(world.view()), ['Passwords is locked. Open Psss to unlock it.']);
  assert.deepEqual(opens(world.view()), [`psss://safari-fill?vault=${PASSWORDS}`]);
  await world.popup.fill('card', ref(1));
  assert.equal(releases(world).length, 0);
});

test('the ready vault is shown first; another one is asked about again and shows nothing of the first', async () => {
  const two = (ready) => [{ id: WORK, name: 'Work', ready: ready === WORK }, { id: PASSWORDS, name: 'Passwords', ready: ready === PASSWORDS }];
  const world = await open({ replies: { status: status({ vaults: two(PASSWORDS) }) } });
  assert.equal(world.view().header.chosen, PASSWORDS);
  await world.popup.choose(WORK);
  assert.deepEqual(words(world.view()), ['Work is locked. Open Psss to unlock it.']);
  assert.deepEqual(opens(world.view()), [`psss://safari-fill?vault=${WORK}`]);
  await world.popup.fill('card', ref(1));
  assert.equal(releases(world).length, 0);
  await world.popup.choose(PASSWORDS);
  assert.deepEqual(words(world.view()), ['Cards for This Page: Everyday Visa (Visa •• 4417 · 08/28)']);
  assert.equal(world.asked.length, 3);
  await world.popup.choose('not-a-vault');
  assert.equal(world.asked.length, 3);
});

test('with none ready the first listed vault is chosen', async () => {
  const world = await open({ replies: { status: lockedStatus([{ id: WORK, name: 'Work', ready: false }, { id: PASSWORDS, name: 'Passwords', ready: false }]) } });
  assert.equal(world.view().header.chosen, WORK);
});

test('a card form and a vault without cards', async () => {
  const none = status({ cards: [] });
  const one = await open({ replies: { status: none } });
  assert.deepEqual(words(one.view()), ['No cards in Passwords | Add a card in Psss.']);
  assert.deepEqual(opens(one.view()), [`psss://safari-fill?vault=${PASSWORDS}`]);
  const two = status({ cards: [], vaults: [...none.vaults, { id: WORK, name: 'Work', ready: false }] });
  const both = await open({ replies: { status: two }, page: { card: CARD_PAGE.card, address: ADDRESS_PAGE.address } });
  assert.deepEqual(words(both.view()),
    ['No cards in Passwords | Add a card in Psss. Or choose another vault above.', 'Addresses for This Page: Home (Sam Rivers · Riga)']);
});

const NO_VAULT = ['No vault yet | Open Psss to create or open a vault. Then come back to Safari and try again.'];
const noVaults = () => status({ vaults: [], cards: [], addresses: [] });

test('no vault set up: Open Psss only opens the app', async () => {
  const world = await open({ replies: { status: noVaults() } });
  assert.deepEqual([words(world.view()), opens(world.view()), world.view().header], [NO_VAULT, ['psss://open'], null]);
  await world.popup.open(opens(world.view())[0]);
  assert.deepEqual(plain(world.updates), [[7, 'psss://open']]);
  // The last vault removed between the list and the tap.
  const later = await open({ replies: { release: refused('not-found') } });
  later.replies.status = noVaults();
  await later.popup.fill('card', ref(1));
  assert.deepEqual(words(later.view()), NO_VAULT);
  assert.equal(writes(later).length, 0);
});

test('Psss is waited for 20 seconds', () => {
  assert.match(read('Extensions/SafariIOS/web/popup-logic.js'), /const TIMEOUT = 20000;/);
});

test('an answer after the limit is ignored', async () => {
  for (const type of ['status', 'release']) {
    let late;
    const answered = new Promise((ok) => { late = ok; });
    const world = browser({ replies: { [type]: () => answered } });
    await world.popup.start();
    if (type === 'release') await world.popup.fill('card', ref(1));
    assert.deepEqual(words(world.view()), CANNOT);
    const drawn = world.views.length;
    late(type === 'status' ? status() : { v: 1, ok: true, fields: VALUES.card });
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual([world.views.length, writes(world).length, words(world.view())], [drawn, 0, CANNOT]);
    secret(world);
  }
});

test('an address form and a vault without addresses: Open Psss to add one, as for cards', async () => {
  const none = status({ addresses: [] });
  const one = await open({ page: ADDRESS_PAGE, replies: { status: none } });
  assert.deepEqual(words(one.view()), ['No addresses in Passwords | Open Psss to add one.']);
  assert.deepEqual([one.view().parts[0].kind, opens(one.view())], ['info', [`psss://safari-fill?vault=${PASSWORDS}`]]);
  assert.ok(one.view().header);
  const both = await open({ page: { card: CARD_PAGE.card, address: ADDRESS_PAGE.address }, replies: { status: none } });
  assert.deepEqual(words(both.view()),
    ['Cards for This Page: Everyday Visa (Visa •• 4417 · 08/28)', 'No addresses in Passwords | Open Psss to add one.']);
  const neither = await open({ page: { card: CARD_PAGE.card, address: ADDRESS_PAGE.address }, replies: { status: status({ cards: [], addresses: [] }) } });
  assert.deepEqual(words(neither.view()), ['No cards in Passwords | Add a card in Psss.', 'No addresses in Passwords | Open Psss to add one.']);
});

test('a page with nothing recognized says so, with the vault when Psss answers', async () => {
  const nothing = { card: [], address: [] };
  for (const [reply, header] of [[status(), true], [lockedStatus(), true], [refused('unavailable'), false],
    [status({ vaults: [], cards: [], addresses: [] }), false]]) {
    const world = await open({ page: nothing, replies: { status: reply } });
    assert.deepEqual(words(world.view()), ['Psss found no card or address fields on this page.']);
    assert.deepEqual([Boolean(world.view().header), opens(world.view())], [header, []]);
  }
});

test('card fields in a payment frame: Open Psss only opens the app', async () => {
  const notice = 'Card fields are in a payment frame | This page’s card form belongs to its payment provider, so Psss can’t fill it. Open Psss to copy the number.';
  const only = await open({ page: { card: [], address: [], paymentFrame: true }, replies: { status: lockedStatus() } });
  assert.deepEqual(words(only.view()), [notice, '[Open Psss]']);
  assert.deepEqual(opens(only.view()), ['psss://open']);
  const withAddress = await open({ page: { card: [], address: ADDRESS_PAGE.address, paymentFrame: true } });
  assert.deepEqual(words(withAddress.view()), [notice, '[Open Psss]', 'Addresses for This Page: Home (Sam Rivers · Riga)']);
});

const CANNOT = ['Psss can’t fill right now | Nothing was filled. Open Psss, then try again in Safari.'];

test('anything but a good answer is "can’t fill right now"', async () => {
  const card = status().cards[0];
  const bad = [
    refused('unavailable'), refused('forbidden'), refused('invalid'), refused('unsupported'), refused('locked'), undefined, null, 'ok', [], {},
    { ...status(), v: 2 }, { ...status(), ok: 'yes' }, { ...status(), vaults: undefined },
    status({ vaults: [{ id: 'x', name: 'A', ready: true }] }), status({ vaults: Array(51).fill(status().vaults[0]) }),
    status({ cards: [{ ...card, lastFour: NUMBER }] }), status({ cards: [{ ...card, title: 'x'.repeat(5000) }] }),
    status({ cards: [{ ...card, expiry: '08/28' }] }), status({ cards: [{ ...card, ref: 'x' }] }), status({ cards: Array(101).fill(card) }),
    status({ addresses: [null] }),
    () => { throw new Error(`secret ${NUMBER}`); },
    () => new Promise(() => {})  // never answers
  ];
  for (const reply of bad) {
    const world = await open({ replies: { status: reply } });
    assert.deepEqual(words(world.view()), CANNOT, String(JSON.stringify(reply)).slice(0, 80));
    assert.deepEqual([world.view().header, opens(world.view())], [null, ['psss://safari-fill']]);
    secret(world);
  }
});

test('one tap on Fill asks for what the page has, writes it and says what was written', async () => {
  const world = await open();
  await world.popup.fill('card', ref(1));
  assert.deepEqual(releases(world), [{
    v: 1, type: 'release', origin: 'https://shop.example', vault: PASSWORDS, kind: 'card', ref: ref(1),
    roles: ['cc-number', 'cc-name', 'cc-exp', 'cc-csc']
  }]);
  assert.deepEqual(writes(world).map(({ options, ...call }) => ({ ...call, options: Object.keys(options) })),
    [{ fields: VALUES.card, mode: 'card', origin: 'https://shop.example', options: ['until'] }]);
  assert.deepEqual(words(world.view()),
    ['Filled Everyday Visa | Name on card, card number, expiry and security code are in the form.']);
  assert.equal(world.view().header.chosen, PASSWORDS);
  assert.equal(world.closed, 0);
  secret(world);
});

test('roles are asked by the value they are made from, and a card always asks for its number', () => {
  assert.deepEqual(plain(SafariFillPopup.requestRoles('card', ['cc-exp-month', 'cc-exp-year'])), ['cc-number', 'cc-exp']);
  assert.deepEqual(plain(SafariFillPopup.requestRoles('address',
    ['given-name', 'family-name', 'country-name', 'country', 'address-line1', 'address-line2', 'tel', 'evil', 'toString'])),
    ['name', 'country', 'street-address', 'tel']);
});

test('no saved security code: the page is asked to focus the field, and the person to type it', async () => {
  const noCode = status({ cards: [{ ...status().cards[0], hasCode: false }] });
  const { 'cc-csc': _, ...fields } = VALUES.card;
  const world = await open({ replies: { status: noCode, release: { v: 1, ok: true, fields } } });
  await world.popup.fill('card', ref(1));
  assert.equal(writes(world)[0].options.focusEmptyCode, true);
  assert.deepEqual(words(world.view()), ['Filled Everyday Visa | Name on card, card number and expiry are in the form.',
    'Tap the security code field and enter the code from your card.']);
  // A page without a code field is not told to tap one.
  const without = await open({ page: { card: ['cc-number'], address: [] }, replies: { status: noCode, release: { v: 1, ok: true, fields } } });
  await without.popup.fill('card', ref(1));
  assert.deepEqual(words(without.view()), ['Filled Everyday Visa | Card number is in the form.']);
});

test('part of a card: which fields were not filled', async () => {
  const world = await open({ written: ['cc-number', 'cc-name', 'cc-csc'] });
  await world.popup.fill('card', ref(1));
  assert.deepEqual(words(world.view()), [
    'Partly filled Everyday Visa | Name on card, card number and security code are in the form. Expiry was not filled. Type it on the page.']);
  assert.equal(world.view().parts[0].kind, 'warning');
});

test('an address sentence follows the page order', async () => {
  const world = await open({
    page: ADDRESS_PAGE, replies: { release: { v: 1, ok: true, fields: VALUES.address } },
    written: ['name', 'address-line1', 'address-level2', 'postal-code', 'email']
  });
  await world.popup.fill('address', ref(2));
  assert.deepEqual(words(world.view()), [
    'Partly filled Home | Name, street address, postal code, city and email are in the form. Phone was not filled. Type it on the page.']);
  assert.deepEqual(releases(world)[0].roles, ['name', 'street-address', 'postal-code', 'address-level2', 'email', 'tel']);
  secret(world);
});

test('what was missed: only fields with a saved value and a place on the page', () => {
  const say = (page, fields, written) => plain(SafariFillPopup.summary('address', page,
    (role) => role === 'address-line2' ? /\n/.test(fields['street-address'] ?? '') : Boolean(fields[{ 'given-name': 'name', 'family-name': 'name', 'address-line1': 'street-address' }[role] ?? role]), written));
  assert.deepEqual(say(['name', 'organization', 'email'], { name: 'A', email: 'b' }, ['name', 'email']),
    { partly: false, text: 'Name and email are in the form.' });
  assert.deepEqual(say(['given-name', 'family-name', 'tel'], { name: 'Ann Maria Berg', tel: '1' }, []),
    { partly: true, text: 'Name and phone were not filled. Type them on the page.' });
  assert.deepEqual(say(['address-line1', 'address-line2'], { 'street-address': 'One line' }, ['address-line1']),
    { partly: false, text: 'Street address is in the form.' });
});

test('an address with a one-line street is not reported as partly filled because of the second box', async () => {
  const world = await open({
    page: { card: [], address: ['address-line1', 'address-line2', 'postal-code'] },
    replies: { release: { v: 1, ok: true, fields: { 'street-address': '12 Harbour Road', 'postal-code': 'LV-1010' } } },
    written: ['address-line1', 'postal-code']
  });
  await world.popup.fill('address', ref(2));
  assert.deepEqual(words(world.view()), ['Filled Home | Street address and postal code are in the form.']);
});

const NOTHING = (name) => [`Nothing was filled | This page’s fields didn’t take ${name}. Open Psss to copy the details.`];

test('nothing written, or the fields gone: copy from Psss, which is only opened', async () => {
  const none = await open({ written: [] });
  await none.popup.fill('card', ref(1));
  const gone = await open();
  gone.page = { card: [], address: [] };
  await gone.popup.fill('card', ref(1));
  assert.equal(releases(gone).length, 0);
  const goneLater = await open();
  goneLater.onAsk = (type) => { if (type === 'release') goneLater.written = []; };
  await goneLater.popup.fill('card', ref(1));
  for (const world of [none, gone, goneLater]) {
    assert.deepEqual(words(world.view()), NOTHING('Everyday Visa'));
    assert.deepEqual(opens(world.view()), ['psss://open']);
  }
});

const CHANGED = ['The page changed | Nothing was filled. Close this and open Psss again.'];

test('a changed tab or address is noticed before the values are asked for', async () => {
  for (const change of [(w) => { w.tab = { id: 8, url: w.tab.url }; }, (w) => { w.tab.url = 'https://other.example/'; },
    (w) => { w.tab.url = 'http://shop.example/checkout'; }, (w) => { w.tab = undefined; }]) {
    const world = await open();
    change(world);
    await world.popup.fill('card', ref(1));
    assert.deepEqual(words(world.view()), CHANGED);
    assert.deepEqual([releases(world).length, writes(world).length], [0, 0]);
    assert.ok(world.view().header);
  }
});

test('a changed page is noticed again after the values arrived, and they go nowhere', async () => {
  for (const change of [(w) => { w.tab = { id: 8, url: w.tab.url }; }, (w) => { w.tab.url = 'https://shop.example.evil.test/'; }]) {
    const world = await open();
    world.onAsk = (type) => { if (type === 'release') change(world); };
    await world.popup.fill('card', ref(1));
    assert.deepEqual(words(world.view()), CHANGED);
    assert.deepEqual([releases(world).length, writes(world).length], [1, 0]);
    secret(world);
  }
});

test('permission taken away at Fill, before or after the values', async () => {
  for (const when of ['before', 'after']) {
    const world = await open();
    if (when === 'before') world.blocked = true;
    else world.onAsk = (type) => { if (type === 'release') world.blocked = true; };
    await world.popup.fill('card', ref(1));
    assert.match(words(world.view())[0], /^Safari hasn’t allowed Psss on this page \| Nothing was filled\./);
    assert.deepEqual([releases(world).length, writes(world).length], [when === 'before' ? 0 : 1, 0]);
  }
});

test('locked at the tap: "Nothing was filled." first, and nothing can be filled after', async () => {
  const world = await open({ replies: { release: refused('locked') } });
  await world.popup.fill('card', ref(1));
  assert.deepEqual(words(world.view()), ['Nothing was filled. Passwords is locked. Open Psss to unlock it.']);
  assert.deepEqual(opens(world.view()), [`psss://safari-fill?vault=${PASSWORDS}`]);
  await world.popup.fill('card', ref(1));
  assert.deepEqual([releases(world).length, writes(world).length], [1, 0]);
});

test('an out-of-date list is loaded again, and the next tap fills', async () => {
  const fresh = status({ cards: [{ ...status().cards[0], ref: ref(1, 'b') }] });
  const world = await open({ replies: { release: refused('not-found') } });
  world.replies.status = fresh;
  await world.popup.fill('card', ref(1));
  assert.deepEqual(words(world.view()),
    ['Nothing was filled. Tap Fill again.', 'Cards for This Page: Everyday Visa (Visa •• 4417 · 08/28)']);
  assert.equal(writes(world).length, 0);
  world.replies.release = { v: 1, ok: true, fields: VALUES.card };
  await world.popup.fill('card', ref(1, 'b'));
  assert.equal(releases(world).at(-1).ref, ref(1, 'b'));
  assert.equal(writes(world).length, 1);
});

test('out of date and no longer ready, or no answer', async () => {
  const lockedNow = await open({ replies: { release: refused('not-found') } });
  lockedNow.replies.status = lockedStatus();
  await lockedNow.popup.fill('card', ref(1));
  assert.deepEqual(words(lockedNow.view()), ['Nothing was filled. Passwords is locked. Open Psss to unlock it.']);
  const gone = await open({ replies: { release: refused('not-found') } });
  gone.replies.status = refused('unavailable');
  await gone.popup.fill('card', ref(1));
  assert.deepEqual(words(gone.view()), CANNOT);
});

test('a bad or missing release writes nothing', async () => {
  for (const reply of [refused('unavailable'), refused('invalid'), refused('forbidden'), undefined, { v: 1, ok: true },
    { v: 1, ok: true, fields: [] }, { v: 1, ok: true, fields: { 'cc-number': 4111 } },
    { v: 1, ok: true, fields: { 'cc-number': 'x'.repeat(5000) } }, () => { throw new Error(NUMBER); }, () => new Promise(() => {})]) {
    const world = await open({ replies: { release: reply } });
    await world.popup.fill('card', ref(1));
    assert.deepEqual(words(world.view()), CANNOT);
    assert.equal(writes(world).length, 0);
    secret(world);
  }
});

test('only the kind’s own keys go to the page', async () => {
  const world = await open({ replies: { release: { v: 1, ok: true, fields: { ...VALUES.card, username: 'u', 'current-password': 'p', __proto__x: 'y' } } } });
  await world.popup.fill('card', ref(1));
  assert.deepEqual(writes(world)[0].fields, VALUES.card);
});

test('two taps at once ask once, and the list is marked busy meanwhile', async () => {
  let answer;
  const world = await open({ replies: { release: () => new Promise((ok) => { answer = ok; }) } });
  const first = world.popup.fill('card', ref(1));
  const second = world.popup.fill('card', ref(1));
  await world.popup.choose(WORK);
  assert.equal(world.view().busy, true);
  await new Promise((ok) => setTimeout(ok, 5));
  answer({ v: 1, ok: true, fields: VALUES.card });
  await Promise.all([first, second]);
  assert.deepEqual([releases(world).length, writes(world).length], [1, 1]);
});

test('a reference or kind that is not listed does nothing', async () => {
  const world = await open();
  await world.popup.fill('card', ref(9));
  await world.popup.fill('login', ref(1));
  await world.popup.fill('__proto__', ref(1));
  assert.equal(releases(world).length, 0);
});

test('Open Psss changes the current tab’s address and closes the popup; no other link is opened', async () => {
  const world = await open({ replies: { status: lockedStatus() } });
  await world.popup.open('https://evil.example/');
  await world.popup.open(undefined);
  await world.popup.open(opens(world.view())[0]);
  assert.deepEqual(plain(world.updates), [[7, `psss://safari-fill?vault=${PASSWORDS}`]]);
  assert.equal(world.closed, 1);
});

test('hostile names are one short line, kept apart from the words around them', async () => {
  const hostile = `../‮evilWork\nPsss is locked. <img src=x onerror=alert(1)>​ ${'z'.repeat(3000)}`;
  const world = await open({ replies: { status: status({
    vaults: [{ id: PASSWORDS, name: hostile, ready: true }, { id: WORK, name: '​\n', ready: false }],
    cards: [{ ...status().cards[0], title: hostile, brand: hostile }],
    addresses: [{ ref: ref(2), label: hostile, fullName: hostile, city: hostile }]
  }) }, page: { card: CARD_PAGE.card, address: ADDRESS_PAGE.address } });
  await world.popup.fill('card', ref(1));
  await world.popup.choose(WORK);
  assert.deepEqual(words(world.view()), ['Vault is locked. Open Psss to unlock it.']);
  const shown = JSON.stringify(world.views);
  assert.ok(!/[‮​]|\\n/.test(shown));
  assert.ok(shown.length < 20000);
  const notice = world.views.find((view) => said(view.parts[0]?.title).startsWith('Partly filled') || said(view.parts[0]?.title).startsWith('Filled'));
  // The name is a part of its own.
  assert.ok(notice.parts[0].title[1].name.length <= 80);
});

// ---------- after the write may have run ----------

const UNKNOWN = ['Check the form | Psss couldn’t confirm what was filled. Check the fields on this page, or open Psss to copy the details.'];
/** A write whose result is unknown claims nothing, and Psss is offered for copying. */
function unconfirmed(world) {
  const view = world.view();
  assert.deepEqual([view.parts[0].kind, words(view), opens(view), view.busy], ['warning', UNKNOWN, ['psss://open'], false]);
  assert.ok(!JSON.stringify(view).includes('Nothing was filled'));
  secret(world);
}

test('a write that rejects, or returns no result or an error, claims neither success nor that nothing happened', async () => {
  for (const [what, answer] of Object.entries({
    rejects: () => { throw new Error('Frame was removed ' + NUMBER); }, empty: () => [], nothing: () => undefined,
    error: () => [{ error: { message: NUMBER } }], 'no result': () => [{}], 'null result': () => [{ result: null }],
    'no list': () => [{ result: {} }], 'a left value': () => [{ result: { filled: [], left: ['cc-number'] } }],
    'a left value beside filled ones': () => [{ result: { filled: ['cc-name'], left: ['cc-number'] } }]
  })) {
    const world = await open();
    world.onWrite = answer;
    await world.popup.fill('card', ref(1));
    unconfirmed(world);
    assert.equal(writes(world).length, 1, what);
  }
});

test('permission or the page lost after a write that answered nothing was written', async () => {
  const lost = await open({ written: [] });
  lost.onWrite = () => { lost.blocked = true; return [{ result: { filled: [] } }]; };
  await lost.popup.fill('card', ref(1));
  assert.deepEqual(words(lost.view()), NOTHING('Everyday Visa'));
});

// ---------- split fields ----------

test('a word written in part is named in its own sentence, and in neither of the others', async () => {
  const fields = { 'street-address': '12 Harbour Road\nFlat 3', 'postal-code': 'LV-1010', name: 'Sam Rivers' };
  const part = (word) => `Part of the ${word} was not filled. Check it on the page.`;
  for (const [page, written, text] of [
    [['address-line1', 'address-line2', 'postal-code'], ['address-line1', 'postal-code'], `Postal code is in the form. ${part('street address')}`],
    [['address-line1', 'address-line2', 'postal-code'], ['address-line2'], `Postal code was not filled. Type it on the page. ${part('street address')}`],
    [['given-name', 'family-name', 'postal-code'], ['given-name', 'postal-code'], `Postal code is in the form. ${part('name')}`],
    [['given-name', 'family-name', 'postal-code'], ['family-name', 'postal-code'], `Postal code is in the form. ${part('name')}`],
    [['address-line1', 'address-line2'], ['address-line1'], part('street address')],
    [['given-name', 'family-name', 'address-line1', 'address-line2'], ['given-name', 'address-line2'], `${part('name')} ${part('street address')}`]
  ]) {
    const world = await open({ page: { card: [], address: page }, replies: { release: { v: 1, ok: true, fields } }, written });
    await world.popup.fill('address', ref(2));
    assert.deepEqual(words(world.view()), [`Partly filled Home | ${text}`], written.join());
  }
  for (const written of [['cc-number', 'cc-exp-month'], ['cc-number', 'cc-exp-year']]) {
    const world = await open({ page: { card: ['cc-number', 'cc-exp-month', 'cc-exp-year'], address: [] }, written });
    await world.popup.fill('card', ref(1));
    assert.deepEqual(words(world.view()), [`Partly filled Everyday Visa | Card number is in the form. ${part('expiry')}`], written.join());
  }
});

// ---------- time ----------

/** Waits well past the limit of 50 ms; a popup that never answers fails here instead of hanging the run. */
const inTime = (promise) => Promise.race([promise.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 1000))]);
const nth = (kind, n) => { let seen = 0; return (call) => call === kind && ++seen === n; };

test('a browser call that never answers while loading ends in “can’t fill right now”', async () => {
  for (const call of ['query', 'probe']) {
    const world = browser();
    world.hang = (name) => name === call;
    assert.ok(await inTime(world.popup.start()), call);
    assert.deepEqual(words(world.view()), CANNOT);
    const drawn = world.views.length;
    world.hang = () => false;
    world.release();
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual([world.views.length, world.asked.length], [drawn, 0], call);
  }
});

test('a browser call that never answers before the write: nothing is written, then or later', async () => {
  for (const [what, call, n, asked] of [['tab before', 'query', 1, 0], ['page before', 'probe', 1, 0], ['tab after', 'query', 2, 1], ['page after', 'probe', 2, 1]]) {
    const world = await open();
    world.hang = nth(call, n);
    assert.ok(await inTime(world.popup.fill('card', ref(1))), what);
    assert.deepEqual([words(world.view()), world.view().busy], [CANNOT, false], what);
    world.hang = () => false;
    world.release();
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual([releases(world).length, writes(world).length, words(world.view())], [asked, 0, CANNOT], what);
    secret(world);
  }
});

test('one Fill has one limit, and the page is told when to stop writing', async () => {
  const world = await open();
  const before = Date.now();
  await world.popup.fill('card', ref(1));
  const { until } = writes(world)[0].options;
  assert.ok(until >= before + 50 && until <= Date.now() + 50, String(until - before));
  // Each step takes most of the limit: together they are over it.
  const slow = await open({ replies: { release: () => new Promise((ok) => setTimeout(() => ok({ v: 1, ok: true, fields: VALUES.card }), 35)) } });
  let probes = 0;
  slow.hang = (call) => { if (call === 'probe' && ++probes) setTimeout(() => slow.release(), 20); return call === 'probe'; };
  await slow.popup.fill('card', ref(1));
  assert.deepEqual([words(slow.view()), writes(slow).length], [CANNOT, 0]);
});

test('a write that never answers is unconfirmed, its late answer is ignored', async () => {
  const world = await open();
  world.hang = (call) => call === 'write';
  assert.ok(await inTime(world.popup.fill('card', ref(1))));
  unconfirmed(world);
  assert.ok(writes(world)[0].options.until <= Date.now());
  const drawn = world.views.length;
  world.release();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(world.views.length, drawn);
});

test('Open Psss does not wait for a browser that never answers', async () => {
  const world = await open({ replies: { status: lockedStatus() } });
  world.hang = (call) => call === 'query';
  assert.ok(await inTime(world.popup.open('psss://open')));
  assert.deepEqual([plain(world.updates), world.closed], [[[7, 'psss://open']], 1]);
  world.hang = (call) => call === 'update';
  assert.ok(await inTime(world.popup.open('psss://open')));
  assert.equal(world.closed, 1);
});

test('what a Fill draws is marked as its result, nothing else is', async () => {
  const world = await open();
  await world.popup.fill('card', ref(1));
  assert.deepEqual(world.views.map((view) => Boolean(view.result)), [false, false, false, true]);
});
