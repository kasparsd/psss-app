// The iPhone and iPad Safari popup (Extensions/SafariIOS/web) drawn in headless Chromium and WebKit, with a faked browser API
// and Psss handler, filling real pages of the shared test site (Packages/test-sites) with the real page-fill.js. Safari, the
// extension and the app are not involved. Run by scripts/test-safari-fill.sh. Screenshots go to build/safari-fill-popup/.
import { test, expect, chromium, webkit } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createApp } from '../../../../Packages/test-sites/src/server.ts';

const root = new URL('../../../../', import.meta.url);
const POPUP = 'https://popup.psss.test';
const SHOP = 'https://shop.psss.test';
const shots = new URL('build/safari-fill-popup/', root).pathname;

const PASSWORDS = '11111111-1111-4111-8111-111111111111';
const WORK = '22222222-2222-4222-8222-222222222222';
const ref = (n) => `${'a'.repeat(32)}.00000000-0000-4000-8000-00000000000${n}`;
const VALUES = {
  card: { 'cc-name': 'Sam Rivers', 'cc-number': '4929374102684417', 'cc-exp': '2031-08', 'cc-csc': '731' },
  address: {
    name: 'Sam Rivers', organization: 'Harbor SIA', 'street-address': '12 Harbour Road', 'address-level2': 'Rigacity',
    'address-level1': 'Vidzeme', 'postal-code': 'LV-1010', country: 'LV', email: 'sam@harbor.example', tel: '+37120000000'
  }
};
const SECRETS = ['4929374102684417', '4929 3741', '731', '12 Harbour Road', 'LV-1010', 'sam@harbor.example', '+37120000000'];
const SHARE = (vault) => `psss://safari-fill?vault=${vault}`;

/** What the handler would answer, from a few settings. */
function psss(options = {}) {
  const state = {
    ready: PASSWORDS, vaults: [{ id: PASSWORDS, name: 'Passwords' }], values: structuredClone(VALUES), release: undefined, silent: false,
    cards: undefined, ...options
  };
  const card = () => ({ ref: ref(1), title: 'Everyday Visa', brand: 'Visa', lastFour: state.values.card['cc-number'].slice(-4),
    expiry: state.values.card['cc-exp'], hasCode: Boolean(state.values.card['cc-csc']) });
  state.reply = (message) => {
    if (state.error) return { v: 1, ok: false, error: state.error };
    if (message.type === 'status') {
      const ready = state.vaults.some((v) => v.id === state.ready);
      return {
        v: 1, ok: true, vaults: state.vaults.map((v) => ({ ...v, ready: v.id === state.ready })),
        cards: ready ? state.cards ?? [card()] : [],
        addresses: ready ? [{ ref: ref(2), label: 'Home', fullName: 'Sam Rivers', city: 'Riga' }] : []
      };
    }
    if (state.release) return { v: 1, ok: false, error: state.release };
    const source = { 'cc-exp-month': 'cc-exp', 'cc-exp-year': 'cc-exp' };
    const fields = Object.fromEntries(message.roles.map((role) => source[role] ?? role)
      .map((key) => [key, state.values[message.kind][key]]).filter(([, value]) => value));
    return { v: 1, ok: true, fields };
  };
  return state;
}

let server, local;
test.beforeAll(async () => {
  server = createApp();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  local = `http://localhost:${server.address().port}`;
});
test.afterAll(() => { server.closeAllConnections(); server.close(); });

for (const [engine, type] of Object.entries({ chromium, webkit })) {
  test.describe(engine, () => {
    let browser, context, shop, popup, errors;
    test.beforeAll(async () => { browser = await type.launch(); });
    test.afterAll(() => browser?.close());
    test.afterEach(() => context?.close());

    /** Opens the shop page, then the popup over it. */
    async function open(path, state = psss(), { width = 390, scheme = 'light', blocked = false, clock = false } = {}) {
      context = await browser.newContext({ viewport: { width: 390, height: 700 }, colorScheme: scheme });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === POPUP) {
          const name = url.pathname.slice(1);
          // The built extension holds both folders flat.
          const file = [`Extensions/SafariIOS/web/${name}`, `Extensions/Browser/src/${name}`].map((p) => new URL(p, root)).find((p) => existsSync(p));
          if (!file) return route.fulfill({ status: 404 });
          const kind = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' }[name.split('.').pop()];
          return route.fulfill({ body: readFileSync(file), contentType: `${kind}; charset=utf-8`,
            // The policy Safari gives an extension's pages.
            headers: { 'content-security-policy': "script-src 'self'; object-src 'self'" } });
        }
        if (url.hostname.endsWith('psss.test')) {
          const response = await fetch(local + url.pathname + url.search);
          return route.fulfill({ status: response.status, body: await response.text(), contentType: 'text/html; charset=utf-8' });
        }
        return route.fulfill({ status: 404 });
      });
      shop = await context.newPage();
      await shop.goto(path.startsWith('http') ? path : SHOP + path).catch(() => {});
      popup = await context.newPage();
      await popup.setViewportSize({ width, height: 700 });
      const world = { updates: [], closed: 0, asked: [], blocked, tab: 1, state };
      errors = [];
      popup.on('pageerror', (error) => errors.push(error.message));
      popup.on('console', (message) => errors.push(message.text()));
      await popup.exposeFunction('psssTabs', () => [{ id: world.tab, url: shop.url() }]);
      await popup.exposeFunction('psssUpdate', (id, change) => { world.updates.push([id, change.url]); });
      await popup.exposeFunction('psssClosed', () => { world.closed += 1; });
      await popup.exposeFunction('psssExecute', async (source, args) => {
        if (world.blocked) throw new Error('blocked');
        return shop.evaluate(([source, args]) => (0, eval)(`(${source})`)(...args), [source, args]);
      });
      await popup.exposeFunction('psssNative', async (message) => {
        world.asked.push(message);
        if (state.silent) return new Promise((answer) => { world.answer = answer; });
        const reply = state.reply(message);
        await world.after?.(message);
        return reply;
      });
      await popup.addInitScript(() => {
        window.browser = {
          tabs: { query: () => window.psssTabs(), update: (id, change) => window.psssUpdate(id, change) },
          scripting: { executeScript: async ({ func, args }) => [{ result: await window.psssExecute(func.toString(), args) }] },
          runtime: { sendNativeMessage: (_, message) => window.psssNative(message) }
        };
        window.close = () => window.psssClosed();
      });
      if (clock) await popup.clock.install();
      await popup.goto(`${POPUP}/popup.html`);
      return world;
    }

    const main = () => popup.locator('main');
    const button = (name) => popup.getByRole('button', { name });
    const values = () => shop.evaluate(() => Object.fromEntries([...document.querySelectorAll('input, select, textarea')]
      .filter((e) => e.id && e.id !== 'note').map((e) => [e.id, e.value])));

    /** Checked on every state: nothing secret or from HTML in the popup, nothing stored or logged, one type size, no sideways scroll. */
    async function clean(name) {
      const seen = await popup.evaluate((webkit) => ({
        html: document.documentElement.outerHTML,
        text: document.body.innerText,
        stored: localStorage.length + sessionStorage.length + document.cookie.length,
        sizes: [...new Set([...document.querySelectorAll('body *')].filter((e) => !e.closest('svg') &&
          [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((e) => getComputedStyle(e).fontSize))],
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // Desktop WebKit draws its own menu and ignores the height; iOS follows it.
        small: [...document.querySelectorAll(webkit ? 'button' : 'button, select')]
          .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43).length
      }), engine === 'webkit');
      for (const secret of SECRETS) expect(seen.html + seen.text, `${name}: ${secret}`).not.toContain(secret);
      expect(seen.stored, name).toBe(0);
      expect(seen.sizes.length, `${name}: ${seen.sizes}`).toBeLessThanOrEqual(2);
      expect(seen.wide, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
      expect(seen.small, `${name} has a small control`).toBe(0);
      expect(errors, name).toEqual([]);
      if (name) await popup.screenshot({ path: `${shots}${engine}-${name}.png`, fullPage: true });
    }

    test('a card is listed and filled with one tap', async () => {
      const world = await open('/checkout');
      await expect(main()).toContainText('Cards for This Page');
      await expect(main()).toContainText('Visa •• 4417 · 08/31');
      await expect(popup.locator('select')).toBeHidden();
      await clean('list-card');
      expect(Object.values(await values()).join('')).toBe('');
      await button('Fill Everyday Visa, Visa ending 4417, expires 08/31').click();
      await expect(main()).toContainText('Filled Everyday Visa');
      await expect(main()).toContainText('Name on card, card number, expiry and security code are in the form.');
      expect(await values()).toEqual({ cardholder: 'Sam Rivers', cardnumber: '4929374102684417', exp: '08/31', csc: '731' });
      await expect(button('Done')).toHaveCount(0);
      expect(world.closed).toBe(0);
      await clean('filled-card');
    });

    test('without a saved code the page’s code field is focused', async () => {
      const state = psss();
      delete state.values.card['cc-csc'];
      await open('/checkout', state);
      await button(/^Fill Everyday Visa/).click();
      await expect(main()).toContainText('Name on card, card number and expiry are in the form.');
      await expect(main()).toContainText('Tap the security code field and enter the code from your card.');
      expect(await shop.evaluate(() => document.activeElement.id)).toBe('csc');
      await clean('filled-no-code');
    });

    test('part of a card: an expiry list without the year', async () => {
      const state = psss();
      state.values.card['cc-exp'] = '2099-08';
      await open('/checkout?expiry=select', state);
      await button(/^Fill Everyday Visa/).click();
      await expect(main()).toContainText('Partly filled Everyday Visa');
      // The month was filled and the year was not.
      await expect(main()).toContainText('Name on card, card number and security code are in the form. Part of the expiry was not filled. Check it on the page.');
      await clean('partly-card');
    });

    test('an address, whole and in part', async () => {
      await open('/delivery');
      await expect(main()).toContainText('Addresses for This Page');
      await clean('list-address');
      await button('Fill Home, Sam Rivers · Riga').click();
      await expect(main()).toContainText('Filled Home');
      await expect(main()).toContainText('Name, company, street address, city, region, postal code, country, email and phone are in the form.');
      expect(await values()).toMatchObject({ fullname: 'Sam Rivers', street: '12 Harbour Road', region: 'VID', country: 'LV', tel: '+37120000000' });
      await clean('filled-address');
      await context.close();
      await open('/delivery?tel=short&name=split&street=lines');
      await button(/^Fill Home/).click();
      await expect(main()).toContainText('Partly filled Home');
      await expect(main()).toContainText('Phone was not filled. Type it on the page.');
      expect((await values()).tel).toBe('');
      await clean('partly-address');
    });

    test('a page with a card and an address lists both, cards first', async () => {
      await open('/checkout?address=billing');
      await expect(popup.locator('h2')).toHaveText(['Cards for This Page', 'Addresses for This Page']);
      await clean('list-both');
    });

    test('nothing filled offers Psss for copying only', async () => {
      const world = await open('/checkout?number=short');
      await button(/^Fill Everyday Visa/).click();
      await expect(main()).toContainText('Nothing was filled');
      await expect(main()).toContainText('This page’s fields didn’t take Everyday Visa. Open Psss to copy the details.');
      expect(Object.values(await values()).join('')).toBe('');
      await clean('nothing');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, 'psss://open']]);
      await expect.poll(() => world.closed).toBe(1);
    });

    test('hidden traps stay empty', async () => {
      await open('/checkout-hostile');
      await button(/^Fill Everyday Visa/).click();
      await expect(main()).toContainText('Filled Everyday Visa');
      expect(await shop.evaluate(() => [...document.querySelectorAll('[data-trap]')].filter((e) => e.value).length)).toBe(0);
    });

    test('nothing recognized, and a payment frame', async () => {
      const world = await open('/login');
      await expect(main()).toContainText('Psss found no card or address fields on this page.');
      await expect(button('Open Psss')).toHaveCount(0);
      await clean('no-fields');
      await context.close();
      const frame = await open('/checkout-frame');
      await expect(main()).toContainText('Card fields are in a payment frame');
      await clean('payment-frame');
      await button('Open Psss').click();
      await expect.poll(() => frame.updates).toEqual([[1, 'psss://open']]);
    });

    test('locked, and choosing between two vaults', async () => {
      const state = psss({ vaults: [{ id: PASSWORDS, name: 'Passwords' }, { id: WORK, name: 'Work' }] });
      const world = await open('/checkout', state);
      await expect(popup.getByRole('combobox', { name: 'Vault' })).toHaveValue(PASSWORDS);
      await clean('list-two-vaults');
      await popup.locator('select').selectOption(WORK);
      await expect(main()).toContainText('Work is locked. Open Psss to unlock it.');
      await expect(button(/^Fill/)).toHaveCount(0);
      await clean('locked');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, SHARE(WORK)]]);
      await expect.poll(() => world.closed).toBe(1);
    });

    test('no cards', async () => {
      await open('/checkout', psss({ cards: [] }));
      await expect(main()).toContainText('No cards in Passwords');
      await expect(main()).toContainText('Add a card in Psss.');
      await clean('no-cards');
    });

    test('an insecure page and a page Safari does not allow', async () => {
      const insecure = await open(`${local}/checkout`);
      await expect(main()).toContainText('This page isn’t secure');
      await expect(main()).toContainText('Psss fills only pages that use HTTPS. Nothing was filled.');
      expect(insecure.asked).toEqual([]);
      await clean('insecure');
      await context.close();
      const refused = await open('/checkout', psss(), { blocked: true });
      await expect(main()).toContainText('Safari hasn’t allowed Psss on this page');
      expect(refused.asked).toEqual([]);
      await clean('not-allowed');
    });

    test('the page changes before the values are written', async () => {
      const world = await open('/checkout');
      await expect(button(/^Fill/)).toHaveCount(1);
      world.after = async (message) => { if (message.type === 'release') await shop.goto('https://other.psss.test/checkout'); };
      await button(/^Fill/).click();
      await expect(main()).toContainText('The page changed');
      expect(Object.values(await values()).join('')).toBe('');
      await clean('changed');
    });

    test('locked or out of date at the tap', async () => {
      const state = psss({ release: 'locked' });
      await open('/checkout', state);
      await button(/^Fill/).click();
      await expect(main()).toContainText('Nothing was filled. Passwords is locked. Open Psss to unlock it.');
      await clean('locked-at-fill');
      await context.close();
      const stale = psss({ release: 'not-found' });
      await open('/checkout', stale);
      await button(/^Fill/).click();
      await expect(main()).toContainText('Nothing was filled. Tap Fill again.');
      await clean('out-of-date');
      stale.release = undefined;
      await button(/^Fill/).click();
      await expect(main()).toContainText('Filled Everyday Visa');
    });

    test('Psss can’t answer', async () => {
      const world = await open('/checkout', psss({ error: 'unavailable' }));
      await expect(main()).toContainText('Psss can’t fill right now');
      await expect(main()).toContainText('Nothing was filled. Open Psss, then try again in Safari.');
      await clean('cannot');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, 'psss://safari-fill']]);
    });

    test('the first load says so, and no vault set up', async () => {
      await open('/checkout', psss({ silent: true }));
      await expect(main()).toHaveText('Loading cards and addresses…');
      await expect(popup.locator('.spinner')).toBeVisible();
      await expect(popup.getByRole('button')).toHaveCount(0);
      await clean('loading');
      await context.close();
      const world = await open('/checkout', psss({ vaults: [] }));
      await expect(main()).toContainText('No vault yet');
      await expect(main()).toContainText('Open Psss to create or open a vault. Then come back to Safari and try again.');
      await clean('no-vault');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, 'psss://open']]);
    });

    test('after 20 seconds without an answer, and a late answer is ignored', async () => {
      const state = psss({ silent: true });
      const world = await open('/checkout', state, { clock: true });
      await expect(main()).toContainText('Loading cards and addresses…');
      await expect.poll(() => world.asked.length).toBe(1);
      await popup.clock.runFor(19000);
      await expect(main()).toContainText('Loading cards and addresses…');
      await popup.clock.runFor(1500);
      await expect(main()).toContainText('Psss can’t fill right now');
      world.answer(state.reply({ type: 'status' }));
      await popup.waitForTimeout(200);
      await expect(main()).toContainText('Psss can’t fill right now');
      await expect(button(/^Fill/)).toHaveCount(0);
    });

    test('hostile names stay text, and long ones wrap at a narrow width with large text, light and dark', async () => {
      const name = `<img src=x onerror=alert(1)> ‮gnp.exe\n../${'Longnamewithoutanyspace'.repeat(8)}`;
      for (const scheme of ['light', 'dark']) {
        const state = psss({ vaults: [{ id: PASSWORDS, name }, { id: WORK, name: 'עבודה' }] });
        state.cards = [{ ref: ref(1), title: name, brand: name, lastFour: '4417', hasCode: true }];
        await open('/checkout', state, { width: 320, scheme });
        await expect(button(/^Fill/)).toBeVisible();
        expect(await popup.locator('img').count()).toBe(0);
        expect(await popup.evaluate(() => document.body.innerText)).not.toMatch(/‮/);
        await clean(`hostile-${scheme}`);
        // As the largest text sizes would make it.
        await popup.addStyleTag({ content: 'html { font-size: 40px !important }' });
        await clean(`hostile-large-${scheme}`);
        await popup.locator('select').selectOption(WORK);
        await expect(main()).toContainText('עבודה is locked.');
        await clean(`locked-large-${scheme}`);
        await context.close();
      }
    });

    const UNKNOWN = 'Psss couldn’t confirm what was filled. Check the fields on this page, or open Psss to copy the details.';

    test('a value that did not stay as written: check the form, whatever else filled', async () => {
      for (const path of ['/checkout?clear=csc:exp,cardholder', '/checkout?replace=csc:exp', '/checkout?format=cardnumber:cut',
        '/checkout?format=cardnumber:stuck', '/checkout?split=cardnumber:drop', '/checkout?strip=cardnumber:cardnumber',
        '/checkout?second=hidden&show=csc:second&hide=csc:first', '/delivery?clear=tel:tel', '/delivery?second=1&remove=fullname:first',
        '/delivery?format=postal:noprefix', '/checkout?carry=csc:cardnumber,cardholder', '/checkout?copy=csc:cardnumber,exp',
        '/checkout?stall=cardnumber:cardnumber']) {
        await open(path);
        await button(/^Fill/).click();
        // A stalled page keeps the popup waiting, here for some seconds (the popup itself gives up after 20).
        await expect(popup.locator('h1'), path).toHaveText('Check the form', { timeout: 15_000 });
        await expect(main(), path).toContainText(UNKNOWN);
        await expect(main(), path).not.toContainText(/not filled|nothing was filled|are in the form/i);
        await context.close();
      }
    });

    test('the unknown result takes nothing more than the number and code, and offers Psss for copying', async () => {
      const world = await open('/checkout?format=cardnumber:stuck');
      await button(/^Fill/).click();
      await expect(main()).toContainText(UNKNOWN);
      expect((await values()).cardnumber).toBe('492937410268');
      await clean('unconfirmed');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, 'psss://open']]);
    });

    test('the page’s own formatting still counts as filled', async () => {
      for (const path of ['/checkout?format=cardnumber:dots', '/checkout?rerender=csc:exp,cardnumber',
        '/checkout?retype=cardnumber:cardnumber', '/checkout?relabel=cardnumber:cardnumber']) {
        await open(path);
        await button(/^Fill/).click();
        await expect(popup.locator('h1'), path).toContainText('Filled Everyday Visa');
        await expect(main(), path).toContainText('Name on card, card number, expiry and security code are in the form.');
        await context.close();
      }
    });

    test('part of one field: it is named in its own sentence', async () => {
      const state = psss();
      state.values.address['street-address'] = '12 Harbour Road\nFlat 3';
      await open('/delivery?street=lines&street2=short', state);
      await button(/^Fill Home/).click();
      await expect(popup.locator('h1')).toContainText('Partly filled Home');
      await expect(main()).toContainText('postal code, country, email and phone are in the form. Part of the street address was not filled. Check it on the page.');
      await clean('part-of-field');
    });

    test('an address form and a vault without addresses', async () => {
      const state = psss();
      const reply = state.reply;
      state.reply = (message) => { const answer = reply(message); return message.type === 'status' ? { ...answer, addresses: [] } : answer; };
      const world = await open('/delivery', state);
      await expect(popup.locator('h1')).toHaveText('No addresses in Passwords');
      await expect(main()).toContainText('Open Psss to add one.');
      await clean('no-addresses');
      await button('Open Psss').click();
      await expect.poll(() => world.updates).toEqual([[1, SHARE(PASSWORDS)]]);
    });

    test('after Fill the focus is on what happened, which is announced', async () => {
      for (const [path, state, role, text] of [
        ['/checkout', psss(), 'status', 'Filled Everyday Visa'],
        ['/checkout?number=short', psss(), 'alert', 'Nothing was filled'],
        ['/checkout', psss({ release: 'locked' }), 'status', 'Passwords is locked'],
        ['/checkout', psss({ release: 'not-found' }), 'alert', 'Tap Fill again'],
        ['/checkout', psss({ release: 'unavailable' }), 'alert', 'Psss can’t fill right now']
      ]) {
        await open(path, state);
        await expect(button(/^Fill/)).toHaveCount(1);
        expect(await popup.evaluate(() => document.activeElement.tagName), 'the list takes no focus').toBe('BODY');
        await button(/^Fill/).focus();
        await popup.keyboard.press('Enter');
        await expect(popup.getByRole(role).filter({ hasText: text }), text).toBeFocused();
        await context.close();
      }
    });

    test('a changed vault keeps the focus on the vault list', async () => {
      await open('/checkout', psss({ vaults: [{ id: PASSWORDS, name: 'Passwords' }, { id: WORK, name: 'Work' }] }));
      await expect(button(/^Fill/)).toHaveCount(1);
      await popup.locator('select').focus();
      await popup.locator('select').selectOption(WORK);
      await expect(main()).toContainText('Work is locked.');
      await expect(popup.locator('select')).toBeFocused();
    });

    test('a row’s letter is whole at every text size', async () => {
      for (const size of [17, 28, 40, 53]) {
        const state = psss();
        state.cards = ['Wide', 'ﬄ', 'Ǆ', '漢'].map((title, i) => ({ ref: ref(i + 3), title, brand: 'Visa', lastFour: '4417', hasCode: true }));
        await open('/checkout', state, { width: 320 });
        await expect(button(/^Fill/)).toHaveCount(4);
        await popup.addStyleTag({ content: `html { font-size: ${size}px !important }` });
        const cut = await popup.evaluate(() => [...document.querySelectorAll('.tile')].filter((tile) => {
          const range = document.createRange();
          range.selectNodeContents(tile);
          const letter = range.getBoundingClientRect(), box = tile.getBoundingClientRect();
          return letter.left < box.left - 0.5 || letter.right > box.right + 0.5 || letter.top < box.top - 0.5 || letter.bottom > box.bottom + 0.5;
        }).map((tile) => tile.textContent));
        expect(cut, `at ${size}px`).toEqual([]);
        await clean(size === 53 ? 'letters-largest' : undefined);
        await context.close();
      }
    });

    test('an untrusted click fills nothing', async () => {
      const world = await open('/checkout');
      await expect(button(/^Fill/)).toHaveCount(1);
      await popup.evaluate(() => document.querySelector('main button').click());
      await popup.waitForTimeout(200);
      expect(world.asked.map((m) => m.type)).toEqual(['status']);
    });
  });
}
