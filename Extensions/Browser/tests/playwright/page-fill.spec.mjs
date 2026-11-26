// The page fill against real layout, in headless Chromium and WebKit: what counts as visible, which field is chosen and what
// is written. The pages are the fill cases of the shared test site (Packages/test-sites/src/fill-cases.ts). No extension and no
// installed browser: scripts/heavy.sh npx playwright test page-fill
import { test, expect, chromium, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createApp } from '../../../../Packages/test-sites/src/server.ts';
import { fillCases } from '../../../../Packages/test-sites/src/fill-cases.ts';

const script = readFileSync(new URL('../../src/page-fill.js', import.meta.url), 'utf8');
const fields = {
  card: { 'cc-name': 'Jane Q Doe', 'cc-number': '4111111111111111', 'cc-exp': '2031-05', 'cc-csc': '987' },
  address: {
    name: 'Jane Doe', organization: 'Acme SIA', 'street-address': 'Brivibas 1\nApt 2', 'address-level2': 'Rigacity',
    'address-level1': 'Vidzeme', 'postal-code': 'LV-1010', country: 'LV', email: 'jane@secret.test', tel: '+37120000000'
  }
};
let server, base;
test.beforeAll(async () => {
  server = createApp();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://localhost:${server.address().port}`;
});
test.afterAll(() => { server.closeAllConnections(); server.close(); });

// Everything a scroll could have left behind.
const scrolls = () => [window.scrollX, window.scrollY, ...[...Document.prototype.querySelectorAll.call(document, 'div')].flatMap((e) => [e.scrollLeft, e.scrollTop])];

for (const [engine, type] of Object.entries({ chromium, webkit })) {
  test.describe(engine, () => {
    let browser, page;
    test.beforeAll(async () => {
      browser = await type.launch();
      page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    });
    test.afterAll(() => browser?.close());

    for (const item of fillCases) {
      test(item.name, async () => {
        await page.goto(`${base}/fill-case?name=${item.name}`);
        await page.addScriptTag({ content: script });
        if (item.focus) await page.focus('#' + item.focus);
        const before = await page.evaluate(scrolls);
        const probe = await page.evaluate(() => psssFillPage({}, 'probe', location.origin));
        const result = await page.evaluate(([values, mode]) => psssFillPage(values, mode, location.origin), [fields[item.mode], item.mode]);
        expect(await page.evaluate(scrolls)).toEqual(before);
        const written = await page.evaluate(() => Object.fromEntries([...Document.prototype.querySelectorAll.call(document, 'input:not([type=hidden]):not([type=checkbox]), select, textarea')]
          .filter((e) => e.value).map((e) => [e.id, e.value])));
        expect(written).toEqual(item.values);
        if (item.filled) expect(result.filled).toEqual(item.filled);
        for (const value of Object.values(fields[item.mode])) {
          if (value.length > 2) expect(JSON.stringify([probe, result])).not.toContain(value);
        }
      });
    }

    test('a page built to be slow is given up on within the budget, and an honest one still fills', async () => {
      await page.goto(`${base}/fill-case?name=plain`);
      await page.evaluate(() => {
        const field = (autocomplete) => `<label>x <input autocomplete="${autocomplete}"></label>`;
        document.body.innerHTML = ['cc-number', 'cc-name', 'cc-exp', 'cc-csc', 'postal-code', 'address-line1'].map(field).join('') +
          `<div>${'<label>y <input></label>'.repeat(2000)}${'<span></span>'.repeat(100000)}</div>`;
      });
      await page.addScriptTag({ content: script });
      for (const mode of ['probe', 'card', 'address']) {
        const took = await page.evaluate(([values, mode]) => {
          const start = performance.now();
          psssFillPage(values, mode, location.origin);
          return performance.now() - start;
        }, [fields[mode] ?? {}, mode]);
        // The budget is 2 s; one slow step of the engine may run over it.
        expect(took, mode).toBeLessThan(5000);
      }
    });

    // Page scripts that react to a filled field. `filled` is what may be reported as filled: only what stayed as written.
    // `left` names every other role that was written. `values` is everything the page's fields hold afterwards: only the card
    // number and security code are ever taken back, and no element is changed that the fill did not write.
    const CARD = ['cc-number', 'cc-name', 'cc-exp', 'cc-csc'];
    const ADDRESS = ['name', 'organization', 'address-line1', 'address-level2', 'address-level1', 'postal-code', 'country', 'email', 'tel'];
    const NUMBER = '4111111111111111';
    const card = { cardholder: 'Jane Q Doe', cardnumber: NUMBER, exp: '05/31', csc: '987' };
    const home = { fullname: 'Jane Doe', organization: 'Acme SIA', street: 'Brivibas 1, Apt 2', city: 'Rigacity', region: 'VID',
      postal: 'LV-1010', country: 'LV', email: 'jane@secret.test', tel: '+37120000000' };
    const without = (set, ...ids) => Object.fromEntries(Object.entries(set).filter(([id]) => !ids.includes(id)));
    const all = (list, ...roles) => list.filter((role) => !roles.includes(role));
    const boxes = (parts) => Object.fromEntries(parts.map((part, index) => ['bare' + index, part]));
    for (const [path, filled, left, values, other] of [
      ['/checkout?clear=csc:exp,cardholder', ['cc-number', 'cc-csc'], ['cc-name', 'cc-exp'], without(card, 'exp', 'cardholder')],
      ['/checkout?clear=csc:exp', all(CARD, 'cc-exp'), ['cc-exp'], without(card, 'exp')],
      ['/checkout?clear=exp:cardholder', all(CARD, 'cc-name'), ['cc-name'], without(card, 'cardholder')],
      ['/checkout?clear=csc:csc', all(CARD, 'cc-csc'), ['cc-csc'], without(card, 'csc')],
      ['/checkout?remove=csc:exp', all(CARD, 'cc-exp'), ['cc-exp'], without(card, 'exp')],
      ['/checkout?replace=csc:exp,cardholder', ['cc-number', 'cc-csc'], ['cc-name', 'cc-exp'], without(card, 'exp', 'cardholder')],
      ['/checkout?rerender=csc:exp,cardholder', CARD, [], card],
      ['/checkout?rerender=csc:cardnumber', CARD, [], card],
      ['/checkout?format=cardnumber:dots', CARD, [], { ...card, cardnumber: '4111.1111.1111.1111' }],
      // The card number: nothing more goes to a page that did not keep it, and what it did not keep is taken back.
      ['/checkout?format=cardnumber:cut', [], ['cc-number'], {}],
      ['/checkout?format=cardnumber:short', [], ['cc-number'], {}],
      ['/checkout?format=cardnumber:stuck', [], ['cc-number'], { cardnumber: NUMBER.slice(0, 12) }],
      ['/checkout?format=csc:cut&clear=csc:cardnumber', all(CARD, 'cc-number'), ['cc-number'], without(card, 'cardnumber')],
      ['/checkout?move=csc:cardnumber', all(CARD, 'cc-number'), ['cc-number'], without(card, 'cardnumber')],
      ['/checkout?move=csc:csc', all(CARD, 'cc-csc'), ['cc-csc'], without(card, 'csc')],
      // Digits the page put somewhere else are not the fill's to change, and nothing is claimed.
      ['/checkout?split=cardnumber:drop', [], ['cc-number'], boxes(['4111', '1111', '1111', '1111'])],
      ['/checkout?split=cardnumber:keep', [], ['cc-number'], boxes(['4111', '1111', '1111', '1111'])],
      ['/checkout?strip=cardnumber:cardnumber', [], ['cc-number'], boxes([NUMBER])],
      ['/checkout?strip=csc:cardnumber', all(CARD, 'cc-number'), ['cc-number'], { ...without(card, 'cardnumber'), bare0: NUMBER }],
      ['/checkout?strip=csc:cardholder', all(CARD, 'cc-name'), ['cc-name'], { ...without(card, 'cardholder'), bare0: 'Jane Q Doe' }],
      // A second card form is never touched, whatever happens to the first.
      ['/checkout?second=hidden', CARD, [], card],
      ['/checkout?second=hidden&show=cardnumber:second&hide=cardnumber:first', [], ['cc-number'], {}],
      ['/checkout?second=hidden&show=cardnumber:second&remove=cardnumber:first', [], ['cc-number'], {}],
      ['/checkout?second=hidden&show=csc:second&hide=csc:first', [], CARD, without(card, 'cardnumber', 'csc')],
      ['/checkout?second=hidden&show=csc:second&remove=csc:first', [], CARD, {}],
      // Nor a second address form: what the page does with an address is left as it is.
      ['/delivery?second=1', ADDRESS, [], home],
      ['/delivery?second=1&hide=fullname:first', [], ['name'], { fullname: 'Jane Doe' }],
      ['/delivery?second=1&remove=fullname:first', [], ['name'], {}],
      ['/delivery?second=1&hide=tel:first', [], ADDRESS, home],
      ['/delivery?second=1&remove=tel:first', [], ADDRESS, {}],
      ['/delivery?clear=tel:tel', all(ADDRESS, 'tel'), ['tel'], without(home, 'tel')],
      ['/delivery?clear=postal:city', all(ADDRESS, 'address-level2'), ['address-level2'], without(home, 'city')],
      ['/delivery?clear=tel:fullname,region', all(ADDRESS, 'name', 'address-level1'), ['name', 'address-level1'], without(home, 'fullname', 'region')],
      ['/delivery?remove=tel:email', all(ADDRESS, 'email'), ['email'], without(home, 'email')],
      ['/delivery?replace=tel:street', all(ADDRESS, 'address-line1'), ['address-line1'], without(home, 'street')],
      // Rewrites stay as the page left them.
      ['/delivery?format=fullname:plain', all(ADDRESS, 'name'), ['name'], { ...home, fullname: 'Janis Berzins' }, { name: 'J\u0101nis B\u0113rzi\u0146\u0161' }],
      ['/delivery?format=tel:national', all(ADDRESS, 'tel'), ['tel'], { ...home, tel: '20 000 000' }],
      ['/delivery?format=tel:prefix', all(ADDRESS, 'tel'), ['tel'], { ...home, tel: '+1 +37120000000' }],
      ['/delivery?format=postal:noprefix', all(ADDRESS, 'postal-code'), ['postal-code'], { ...home, postal: '1010' }],
      ['/delivery?set=postal:city', all(ADDRESS, 'address-level2'), ['address-level2'], { ...home, city: 'C\u0113sis' }],
      ['/delivery?format=street:expand', all(ADDRESS, 'address-line1'), ['address-line1'], { ...home, street: 'Brivibas street 1, Apt 2' }],
      ['/delivery?format=street:cut&format=email:cut', all(ADDRESS, 'address-line1', 'email'), ['address-line1', 'email'],
        { ...home, street: 'Brivibas 1, ', email: 'jane@secret.' }],
      ['/delivery?format=tel:dots', ADDRESS, [], { ...home, tel: '+371.2000.0000' }]
    ]) {
      test('only what stayed is reported: ' + path, async () => {
        const mode = path.startsWith('/delivery') ? 'address' : 'card';
        await page.goto(base + path);
        await page.addScriptTag({ content: script });
        const result = await page.evaluate(([values, mode]) => psssFillPage(values, mode, location.origin), [{ ...fields[mode], ...other }, mode]);
        expect(result.filled).toEqual(filled);
        expect(result.left ?? []).toEqual(left);
        const held = await page.evaluate(() => {
          let bare = 0;
          return Object.fromEntries([...document.querySelectorAll('input, select, textarea')]
            .filter((e) => e.id !== 'note' && !e.id.endsWith('load')).map((e) => [e.id || 'bare' + bare++, e.value]).filter(([, value]) => value));
        });
        expect(held).toEqual(values);
      });
    }

    test('nothing is written after the time the caller gave', async () => {
      for (const until of [0, Date.now() - 1, NaN]) {
        await page.goto(base + '/checkout');
        await page.addScriptTag({ content: script });
        const result = await page.evaluate(([values, until]) => psssFillPage(values, 'card', location.origin, { until }), [fields.card, until]);
        expect(result.filled).toEqual([]);
        expect(await page.evaluate(() => [...document.querySelectorAll('input:not(#note)')].filter((e) => e.value).length)).toBe(0);
      }
      const later = await page.evaluate(([values]) => psssFillPage(values, 'card', location.origin, { until: Date.now() + 60000 }), [fields.card]);
      expect(later.filled).toEqual(CARD);
    });

    test('the test site checkout pages fill, and the hostile traps stay empty', async () => {
      for (const path of ['/checkout', '/checkout?expiry=select&form=none', '/checkout?address=billing&form=none', '/checkout-hostile',
        '/delivery?billing=1&name=split&street=lines', '/delivery?form=none&street=box']) {
        const mode = path.startsWith('/delivery') ? 'address' : 'card';
        await page.goto(base + path);
        await page.addScriptTag({ content: script });
        const probe = await page.evaluate(() => psssFillPage({}, 'probe', location.origin));
        const result = await page.evaluate(([values, mode]) => psssFillPage(values, mode, location.origin), [fields[mode], mode]);
        expect(result.filled, path).toEqual(probe[mode]);
        expect(result.filled.length, path).toBeGreaterThan(3);
        expect(await page.evaluate(() => [...Document.prototype.querySelectorAll.call(document, '[data-trap]')].filter((e) => e.value).length), path).toBe(0);
      }
    });
  });
}
