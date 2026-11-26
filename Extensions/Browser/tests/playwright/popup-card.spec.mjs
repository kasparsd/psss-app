// What the Mac, Chrome and Firefox popup says after filling a card, drawn in headless Chromium and WebKit with a faked browser
// API and host, filling the shared test site's checkout (Packages/test-sites) with the real page-fill.js. No extension and no
// installed browser: scripts/heavy.sh npx playwright test popup-card
import { test, expect, chromium, webkit } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createApp } from '../../../../Packages/test-sites/src/server.ts';

const src = new URL('../../src/', import.meta.url);
const POPUP = 'https://popup.psss.test';
const SHOP = 'https://shop.psss.test';
const fields = { 'cc-name': 'Sam Rivers', 'cc-number': '4929374102684417', 'cc-exp': '2031-08', 'cc-csc': '731' };

let server, local;
test.beforeAll(async () => {
  server = createApp();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  local = `http://localhost:${server.address().port}`;
});
test.afterAll(() => { server.closeAllConnections(); server.close(); });

for (const [engine, type] of Object.entries({ chromium, webkit })) {
  test.describe(engine, () => {
    let browser, context;
    test.beforeAll(async () => { browser = await type.launch(); });
    test.afterAll(() => browser?.close());
    test.afterEach(() => context?.close());

    /** Opens the checkout, then the popup over it, and taps Fill card. */
    async function fill(path) {
      context = await browser.newContext();
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === POPUP) {
          const file = new URL(url.pathname.slice(1), src);
          if (!existsSync(file)) return route.fulfill({ status: 404 });
          const kind = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' }[url.pathname.split('.').pop()];
          return route.fulfill({ body: readFileSync(file), contentType: `${kind}; charset=utf-8` });
        }
        const response = await fetch(local + url.pathname + url.search);
        return route.fulfill({ status: response.status, body: await response.text(), contentType: 'text/html; charset=utf-8' });
      });
      const shop = await context.newPage();
      await shop.goto(SHOP + path);
      const popup = await context.newPage();
      const world = { closed: 0, shop, popup };
      await popup.exposeFunction('psssTab', () => shop.url());
      await popup.exposeFunction('psssClosed', () => { world.closed += 1; });
      await popup.exposeFunction('psssExecute', (source, args) =>
        shop.evaluate(([source, args]) => {
          // The real extension injects one function at a time; both of these are in page-fill.js.
          return (0, eval)(`(${source})`)(...args);
        }, [source, args]));
      await popup.addInitScript((fields) => {
        const vault = { id: 'v1', name: 'Passwords', active: true, state: 'open' };
        window.browser = {
          tabs: { query: async () => [{ id: 1, url: await window.psssTab() }] },
          scripting: { executeScript: async ({ func, args = [] }) => [{ result: await window.psssExecute(func.toString(), args) }] },
          action: { getBadgeText: async () => '', setBadgeText: async () => {} },
          runtime: {
            getManifest: () => ({}),
            sendNativeMessage: async (_, { v, id, type }) => ({ v, id, ok: true, ...({
              vaults: { vaults: [vault] },
              candidates: { candidates: [] },
              search: { results: [], counts: {}, total: 0 },
              'card-candidates': { candidates: [{ ref: 'c1', title: 'Everyday Visa', account: 'Visa 4417' }] },
              card: { fields }
            }[type] ?? {}) })
          }
        };
        window.close = () => window.psssClosed();
      }, fields);
      await popup.goto(`${POPUP}/popup.html`);
      await popup.getByRole('button', { name: /^Fill card/ }).click();
      return world;
    }

    test('a card that stayed as written closes the popup', async () => {
      const world = await fill('/checkout');
      await expect.poll(() => world.closed).toBe(1);
    });

    test('nothing to fill is said as before', async () => {
      const world = await fill('/checkout?number=short');
      await expect(world.popup.locator('#status')).toHaveText('No matching checkout fields found on this page.');
      expect(world.closed).toBe(0);
    });

    for (const path of ['/checkout?format=cardnumber:cut', '/checkout?format=cardnumber:stuck', '/checkout?clear=csc:exp',
      '/checkout?split=cardnumber:keep']) {
      test('a value that did not stay as written is never “nothing found”, and the popup stays: ' + path, async () => {
        const world = await fill(path);
        await expect(world.popup.locator('#noticetitle')).toHaveText('Check the form');
        await expect(world.popup.locator('#noticetitle')).toBeVisible();
        await expect(world.popup.locator('#status')).toHaveText('Psss couldn’t confirm what was filled. Check the fields on this page.');
        await expect(world.popup.locator('#notice')).toHaveAttribute('data-kind', 'warning');
        await world.popup.waitForTimeout(100);
        expect(world.closed).toBe(0);
      });
    }
  });
}
