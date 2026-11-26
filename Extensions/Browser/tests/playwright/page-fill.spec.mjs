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
