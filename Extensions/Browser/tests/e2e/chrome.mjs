// End-to-end test in real Chrome (or any Chromium: pass --browser PATH).
//
//   node Extensions/Browser/tests/e2e/chrome.mjs [--browser PATH] [--keep]
//
// Loads the test variant, a throwaway profile and the sample site, then drives the real popup,
// native host and injection through DevTools. --keep instead opens a persistent dev profile with
// the production dev build (real activeTab path) for trying it by hand.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD, ROOT, SITE, CDP, until, sleep, startSite } from './lib.mjs';
const sleepMs = sleep;

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BROWSER = arg('--browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const KEEP = args.includes('--keep');

const sh = (...a) => execFileSync('python3', [join(ROOT, 'Extensions/Browser/build.py'), ...a], { encoding: 'utf8' });
const devId = sh('dev-key').match(/ID: (\w+)/)[1];

// Branded Chrome 137+ ignores --load-extension, so extensions load through the DevTools protocol
// (Extensions.loadUnpacked), which needs a debugging pipe and --enable-unsafe-extension-debugging.
async function launch({ profile, extensions, headless, url, hostEnv = {} }) {
  // A custom --user-data-dir makes Chrome look for native host manifests inside that directory.
  sh('install-host', '--dir', `chromium=${profile}`);
  const flags = [
    `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check',
    '--host-resolver-rules=MAP insecure.test 127.0.0.1, MAP localhost.evil.test 127.0.0.1',
    ...(headless ? ['--headless=new'] : []), url,
  ];
  const child = spawn(BROWSER, flags, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: { ...process.env, ...hostEnv } });
  const cdp = CDP.pipe(child);
  const ids = [];
  for (const path of extensions) ids.push((await cdp.send('Extensions.loadUnpacked', { path })).id);
  return { child, cdp, ids };
}

if (KEEP) {
  sh('package', '--dev');
  await startSite({ detach: true });
  const profile = join(BUILD, 'profiles/chrome');
  mkdirSync(profile, { recursive: true });
  const { child, ids } = await launch({ profile, extensions: [join(BUILD, 'chromium')], headless: false, url: `${SITE}/login.html` });
  console.log(`Chrome opened with the extension (ID ${ids[0]}). Click its toolbar button or press ⌘⇧P on ${SITE}/login.html.`);
  console.log('Keep this process running: Chrome closes with the debugging pipe. Quit Chrome to finish.');
  await new Promise((done) => child.on('exit', done));
  process.exit(0);
}

sh('package', '--test', '-t', 'chromium');
const ext = join(BUILD, 'chromium-test');
const foreign = join(BUILD, 'chromium-test-foreign'); // same code, different ID: must be refused by the host
rmSync(foreign, { recursive: true, force: true });
cpSync(ext, foreign, { recursive: true });
const m = JSON.parse(readFileSync(join(foreign, 'manifest.json'), 'utf8'));
delete m.key;
writeFileSync(join(foreign, 'manifest.json'), JSON.stringify(m, null, 2));
let stopSite, browser, cdp, profile, foreignId, store, hostAccess = true;
before(async () => {
  stopSite = await startSite();
  profile = mkdtempSync(join(tmpdir(), 'psss-chrome-'));
  store = mkdtempSync(join(tmpdir(), 'psss-store-')); // the host inherits this, so saves stay out of the real prototype directory
  const started = await launch({ profile, extensions: [ext, foreign], headless: true, url: 'about:blank', hostEnv: { PSSS_PROTOTYPE_DIR: store } });
  ({ child: browser, cdp } = started);
  assert.equal(started.ids[0], devId, 'the dev key must give the ID the host allows');
  foreignId = started.ids[1];
  // Some Chromium builds (Chrome for Testing 157) keep the test variant's host permission withheld,
  // so the tab URL is hidden and nothing can be listed. That is a harness limit, not a product result.
  const probe = await cdp.openTab(`${SITE}/login.html`);
  await until(async () => (await probe.eval('document.readyState')) === 'complete', 'probe load');
  const view = await cdp.openTab('about:blank');
  await view.goto(`chrome-extension://${devId}/popup.html`);
  hostAccess = await view.eval(`chrome.tabs.query({ url: 'http://localhost/*' }).then((t) => Boolean(t[0]?.url))`);
  await probe.close(); await view.close();
  if (!hostAccess) console.log('# This browser withholds the test variant\'s host permission: tests that need a tab URL are skipped.');
});
after(async () => {
  cdp?.close(); browser?.kill(); stopSite?.();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

/** Opens a login page and a popup pointed at it, as the production popup would see it. */
async function popupFor(pageUrl, id = devId) {
  const page = await cdp.openTab(pageUrl);
  await until(async () => (await page.eval('document.readyState')) === 'complete', 'page load');
  const target = new URL(pageUrl);
  const popup = await cdp.openTab('about:blank');
  await popup.goto(`chrome-extension://${id}/popup.html#target=${target.protocol}//${target.hostname}/*`); // match patterns have no port
  return { page, popup };
}
/** Runs a test body with a page and its popup, and always closes both (a stale tab would match the next test's URL pattern). */
async function withPopup(pageUrl, body) {
  const { page, popup } = await popupFor(pageUrl);
  try { await body({ page, popup }); }
  finally { await page.close().catch(() => {}); await popup.close().catch(() => {}); }
}
const targetOpen = async (tab) => (await cdp.send('Target.getTargets')).targetInfos.some((t) => t.targetId === tab.targetId);
const settled = (popup) => until(async () =>
  (await popup.eval(`document.querySelectorAll('#logins li').length`)) > 0 || (await popup.eval(`document.getElementById('status').textContent`)), 'popup to settle');

test('the extension loads and its popup renders', async () => {
  const { page, popup } = await popupFor(`${SITE}/login.html`);
  assert.equal(await popup.eval(`document.title`), 'Psss');
  await page.close(); await popup.close();
});

test('the registered host answers a ping from the extension', async () => {
  const popup = await cdp.openTab('about:blank');
  await popup.goto(`chrome-extension://${devId}/popup.html`);
  const reply = await popup.eval(`Host.ping()`);
  assert.deepEqual({ ok: reply.ok, protocol: reply.protocol }, { ok: true, protocol: 1 }, JSON.stringify(reply));
  await popup.close();
});

test('lists the saved login for the page and fills it on click', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  assert.equal(await popup.eval(`document.getElementById('site').textContent`), 'localhost:8080');
  assert.match(await popup.eval(`document.querySelector('#logins li').innerText`), /alex@example\.net/);
  assert.equal(await popup.eval(`document.documentElement.outerHTML.includes('Demo-only')`), false, 'no secret in the list');
  assert.equal(await page.eval(`document.getElementById('p').value`), '', 'nothing is filled before the click');
  await popup.eval(`document.querySelector('#logins button').click()`);
  await until(async () => (await page.eval(`document.getElementById('p').value`)) !== '', 'password to be filled');
  assert.equal(await page.eval(`document.getElementById('u').value`), 'alex@example.net');
  assert.equal(await page.eval(`document.getElementById('p').value.length`), 18);
  await until(async () => !(await targetOpen(popup)), 'popup to close itself after a fill');
}));

test('fills a form that reacts to input events (framework-style listeners)', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await page.eval(`window.__events = []; for (const id of ['u','p']) document.getElementById(id).addEventListener('input', () => __events.push(id));`);
  await settled(popup);
  await popup.eval(`document.querySelector('#logins button').click()`);
  await until(async () => (await page.eval('__events.length')) >= 2, 'input events');
  assert.deepEqual(await page.eval('__events'), ['u', 'p']);
}));

test('127.0.0.1 is a different site: no logins are offered', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://127.0.0.1:8080/login.html', async ({ popup }) => {
  await settled(popup);
  assert.match(await popup.eval(`document.getElementById('status').textContent`), /No saved logins/);
  assert.equal(await popup.eval(`document.querySelectorAll('#logins li').length`), 0);
}));

test('search finds a login saved for another site and asks before filling it', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://127.0.0.1:8080/login.html', async ({ page, popup }) => {
  await settled(popup);
  assert.match(await popup.eval(`document.getElementById('status').textContent`), /Search all logins/);
  const search = async (q) => popup.eval(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  await search('localhost');
  await until(() => popup.eval(`document.querySelectorAll('#results li button').length > 0`), 'search results');
  assert.match(await popup.eval(`document.querySelector('#results li').innerText`), /Saved for localhost/);
  await popup.eval(`document.querySelector('#results li button').click()`);       // Fill…
  assert.match(await popup.eval(`document.querySelector('#results li .warning').innerText`), /not 127\.0\.0\.1/);
  assert.equal(await page.eval(`document.getElementById('p').value`), '', 'nothing is filled before the second click');
  await popup.eval(`document.querySelector('#results li .cancel').click()`);       // Cancel restores the row
  assert.equal(await page.eval(`document.getElementById('p').value`), '');
  await popup.eval(`document.querySelector('#results li button').click()`);
  await popup.eval(`document.querySelector('#results li .confirm-fill').click()`); // Fill anyway
  await until(async () => (await page.eval(`document.getElementById('p').value`)) !== '', 'manual fill');
  assert.equal(await page.eval(`document.getElementById('u').value`), 'alex@example.net');
}));

test('search is empty for a blank query and "Nothing found" for a miss', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await settled(popup);
  const search = async (q) => popup.eval(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  await search('zzz-no-such-login');
  await until(() => popup.eval(`document.querySelector('#results li')?.innerText === 'Nothing found.'`), 'nothing found');
  await search('  ');
  await until(() => popup.eval(`document.querySelectorAll('#results li').length === 0`), 'cleared');
}));

test('the settings page turns the browser save prompt off and back on', async () => {
  const page = await cdp.openTab('about:blank');
  await page.goto(`chrome-extension://${devId}/settings.html`);
  const setting = () => page.eval(`chrome.privacy.services.passwordSavingEnabled.get({}).then((d) => d.value + ' ' + d.levelOfControl)`);
  assert.equal(await setting(), 'true controllable_by_this_extension');
  await until(() => page.eval(`document.getElementById('toggle').textContent === 'Turn off browser password prompts'`), 'off button');
  await page.eval(`document.getElementById('toggle').click()`);
  await until(async () => (await setting()) === 'false controlled_by_this_extension', 'prompt off');
  await until(() => page.eval(`document.getElementById('toggle').textContent === 'Turn browser password prompts back on'`), 'on button');
  assert.match(await page.eval(`document.getElementById('state').textContent`), /off while Psss is installed/);
  await page.eval(`document.getElementById('toggle').click()`);
  await until(async () => (await setting()) === 'true controllable_by_this_extension', 'prompt restored');
  await page.close();
});

test('the production manifest asks for privacy only when requested', () => {
  const m = JSON.parse(readFileSync(join(BUILD, 'chromium/manifest.json'), 'utf8'));
  assert.deepEqual(m.optional_permissions, ['privacy']);
  assert.ok(!m.permissions.includes('privacy'));
});

test('a sign-up form: generates, fills password and confirmation identically, and saves the login', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/signup.html`, async ({ page, popup }) => {
  // The email the person typed is picked up as the username.
  await page.eval(`(() => { const u = document.getElementById('u'); u.value = 'signup.person@example.net'; })()`);
  await popup.eval(`location.reload()`); // a popup reads the page when it opens
  await until(() => popup.eval(`!document.getElementById('create').hidden`), 'create section');
  assert.equal(await popup.eval(`document.getElementById('account').value`), 'signup.person@example.net');
  assert.equal(await page.eval(`document.getElementById('p').value`), '', 'nothing is generated before the click');
  await popup.eval(`document.getElementById('generate').click()`);
  await until(async () => /Saved the login/.test(await popup.eval(`document.getElementById('created').textContent`)), 'saved message');
  const [p, c] = [await page.eval(`document.getElementById('p').value`), await page.eval(`document.getElementById('c').value`)];
  assert.equal(p, c, 'password and confirmation match');
  assert.equal(p.length, 20);
  const saved = JSON.parse(readFileSync(join(store, 'saved-logins.json'), 'utf8')).find((i) => i.account === 'signup.person@example.net');
  assert.equal(saved.secret, p, 'the saved secret is the one in the page');
  assert.equal(saved.website, 'localhost');
  assert.equal(await popup.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(p)})`), false, 'the popup never shows the password');
  // A second run on the same account updates instead of duplicating.
  await popup.eval(`document.getElementById('generate').click()`);
  await until(async () => /Updated the login/.test(await popup.eval(`document.getElementById('created').textContent`)), 'updated message');
}));

test('a sign-up form needs a username before it generates anything', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/signup.html`, async ({ page, popup }) => {
  await until(() => popup.eval(`!document.getElementById('create').hidden`), 'create section');
  await popup.eval(`document.getElementById('generate').click()`);
  assert.match(await popup.eval(`document.getElementById('created').textContent`), /Enter the username/);
  assert.equal(await page.eval(`document.getElementById('p').value`), '');
}));

test('the create section stays hidden on a sign-in form', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await settled(popup);
  await sleepMs(300);
  assert.equal(await popup.eval(`document.getElementById('create').hidden`), true);
}));

test('refuses plain http on a non-local host, including lookalikes of localhost', async () => {
  for (const url of ['http://insecure.test:8080/login.html', 'http://localhost.evil.test:8080/login.html']) {
    await withPopup(url, async ({ popup }) => {
      await settled(popup);
      assert.match(await popup.eval(`document.getElementById('status').textContent`), /secure \(https\)/, url);
      assert.equal(await popup.eval(`document.querySelectorAll('#logins li').length`), 0, url);
    });
  }
});

test('a navigation between listing and filling aborts the fill', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  await page.goto('http://127.0.0.1:8080/login.html');
  await popup.eval(`document.querySelector('#logins button').click()`);
  await until(async () => /page changed/.test(await popup.eval(`document.getElementById('status').textContent`)), 'abort message');
  assert.equal(await page.eval(`document.getElementById('p').value`), '');
}));

test('a different extension ID cannot use the native host', async () => {
  const popup = await cdp.openTab('about:blank');
  await popup.goto(`chrome-extension://${foreignId}/popup.html`);
  const error = await popup.eval(`api.runtime.sendNativeMessage(PROTOCOL.host, {v: 1, id: 'x', type: 'ping'}).then(() => null, (e) => e.message)`);
  assert.match(error, /forbidden/i, 'Chrome must refuse an extension that is not in allowed_origins');
  const reply = await popup.eval(`Host.ping()`);
  assert.equal(reply.ok, false);
  await popup.close();
});
