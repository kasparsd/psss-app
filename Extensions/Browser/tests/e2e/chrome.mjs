// End-to-end test in real Chrome (or any Chromium: pass --browser PATH).
//
//   node Extensions/Browser/tests/e2e/chrome.mjs [--browser PATH] [--keep]
//
// Loads the test variant, a throwaway profile and the test site, then drives the real popup,
// native host and injection through DevTools. --keep instead opens a persistent dev profile with
// the production dev build (real activeTab path) for trying it by hand.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BUILD, ROOT, SITE, CDP, until, sleep, startSite, startStandIn } from './lib.mjs';
const sleepMs = sleep;

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BROWSER = arg('--browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const KEEP = args.includes('--keep');

const sh = (...a) => execFileSync('python3', [join(ROOT, 'Extensions/Browser/build.py'), ...a], { encoding: 'utf8' });
const devId = sh('dev-key').match(/ID: (\w+)/)[1];
// The host is a relay client. The suites run the test host (`build.py host --testing`) against the stand-in relay (the app's real
// relay server over the prototype's vaults), so nothing here needs a signed app. See docs/browser-extension.md, "Testing".
for (const [binary, command] of [['host-test/psss-native-host', ['host', '--testing']], ['relay-standin/psss-relay-standin', ['standin']]]) {
  if (!existsSync(join(BUILD, binary))) sh(...command);
}

// Branded Chrome 137+ ignores --load-extension, so extensions load through the DevTools protocol
// (Extensions.loadUnpacked), which needs a debugging pipe and --enable-unsafe-extension-debugging.
async function launch({ profile, extensions, headless, url, hostEnv = {} }) {
  // A custom --user-data-dir makes Chrome look for native host manifests inside that directory.
  sh('install-host', '--testing', '--dir', `chromium=${profile}`);
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
  const keepStore = join(BUILD, 'profiles/chrome-store');
  mkdirSync(keepStore, { recursive: true });
  const keepRelay = await startStandIn(keepStore); // the prototype's vaults, in build/browser/profiles/chrome-store
  const { child, ids } = await launch({ profile, extensions: [join(BUILD, 'chromium')], headless: false, url: `${SITE}/login.html`, hostEnv: { PSSS_RELAY_SOCKET: keepRelay.socket } });
  console.log(`Chrome opened with the extension (ID ${ids[0]}). Click its toolbar button or press ⌘⇧P on ${SITE}/login.html.`);
  console.log('Keep this process running: Chrome closes with the debugging pipe. Quit Chrome to finish.');
  await new Promise((done) => child.on('exit', done));
  keepRelay.stop();
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
let stopSite, browser, cdp, profile, foreignId, store, relay, hostAccess = true;
before(async () => {
  stopSite = await startSite();
  profile = mkdtempSync(join(tmpdir(), 'psss-chrome-'));
  store = mkdtempSync(join(tmpdir(), 'psss-store-')); // the host inherits this, so saves stay out of the real prototype directory
  relay = await startStandIn(store); // the relay keeps the vaults (in `store`); the host only talks to it
  const started = await launch({ profile, extensions: [ext, foreign], headless: true, url: 'about:blank', hostEnv: { PSSS_RELAY_SOCKET: relay.socket } });
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
  cdp?.close(); browser?.kill(); stopSite?.(); relay?.stop();
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
  (await popup.eval(`document.querySelectorAll('#logins li').length`)) > 0 || (await popup.eval(`document.getElementById('status').textContent`))
  || (await popup.eval(`!document.getElementById('sitenote').hidden`)), 'popup to settle');
// The prototype host keeps its vaults in vaults.json next to the prototype file. A test writes its own list (or none: the defaults).
const setVaults = (object) => object ? writeFileSync(join(store, 'vaults.json'), JSON.stringify(object)) : rmSync(join(store, 'vaults.json'), { force: true });
const text = (popup, id) => popup.eval(`document.getElementById(${JSON.stringify(id)}).textContent`);
const visible = (popup, id) => popup.eval(`!document.getElementById(${JSON.stringify(id)}).hidden`);

// Regression: author CSS (display: flex) once beat the [hidden] attribute, so empty notices and unlabeled pills drew. These look at
// what is rendered, not at the `hidden` property.
const assertNoEmptyBoxes = async (popup, where) => {
  const bad = await popup.eval(`[...document.querySelectorAll('.notice, .pills, .pill, .card, #results, #sitegroup, #search, #create')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .filter((e) => e.textContent.trim() === '' && !e.querySelector('input'))
    .map((e) => e.id || e.className)`);
  assert.deepEqual(bad, [], `${where}: no visible empty box`);
  assert.equal(await popup.eval(`[...document.querySelectorAll('.pill')].filter((e) => e.getBoundingClientRect().height > 0).every((e) => e.textContent.trim() !== '')`), true, `${where}: shown pills have text`);
  assert.equal(await popup.eval(`document.querySelector('header').innerText.includes('Psss')`), false, `${where}: the header shows the logo only`);
  assert.equal(await popup.eval(`document.querySelector('header .logo').getAttribute('aria-label')`), 'Psss', `${where}: the logo keeps its name`);
};
const noSiteNoticeShown = (popup) => popup.eval(`document.getElementById('sitenote').getBoundingClientRect().height > 0`);

test('the extension loads and its popup renders', async () => {
  const { page, popup } = await popupFor(`${SITE}/login.html`);
  assert.equal(await popup.eval(`document.title`), 'Psss');
  await page.close(); await popup.close();
});

test('the registered host answers a ping from the extension', async () => {
  const popup = await cdp.openTab('about:blank');
  await popup.goto(`chrome-extension://${devId}/popup.html`);
  const reply = await popup.eval(`Host.ping()`);
  assert.deepEqual({ ok: reply.ok, protocol: reply.protocol }, { ok: true, protocol: 5 }, JSON.stringify(reply));
  await popup.close();
});

test('lists the saved login for the page and fills it on click', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  assert.equal(await popup.eval(`document.getElementById('site')`), null, 'the popup does not repeat the page’s site');
  assert.equal(await text(popup, 'forsite'), 'For This Site');
  await assertNoEmptyBoxes(popup, 'a match');
  assert.equal(await noSiteNoticeShown(popup), false, 'no no-logins notice when a login matches');
  assert.equal(await popup.eval(`document.getElementById('pills').getBoundingClientRect().height`), 0, 'no pills before a search');
  assert.equal(await popup.eval(`document.body.innerText.includes('localhost:8080')`), false, 'no host anywhere in the popup');
  assert.equal(await popup.eval(`!document.getElementById('settings').parentElement.hidden`), true, 'the footer ends the popup');
  assert.equal(await popup.eval(`document.getElementById('settings').textContent`), 'Settings');
  assert.equal(await popup.eval(`document.activeElement.id`), 'q', 'the search field has the focus when the popup opens');
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
  assert.equal(await text(popup, 'sitenotebody'), 'Passwords has none for this site. Search all logins above, or choose another vault.');
  assert.equal(await popup.eval(`document.querySelector('#sitenote strong').textContent`), 'No logins for this site');
  assert.equal(await text(popup, 'forsite'), 'For This Site');
  assert.equal(await visible(popup, 'sitenote'), true);
  assert.equal(await noSiteNoticeShown(popup), true);
  assert.match(await popup.eval(`document.getElementById('sitenote').innerText`), /No logins for this site\n+Passwords has none for this site/);
  await assertNoEmptyBoxes(popup, 'no match');
  assert.equal(await popup.eval(`document.querySelector('#sitenote button')`), null, 'the notice has no button');
  assert.equal(await popup.eval(`document.querySelectorAll('#logins li').length`), 0);
}));

test('with one vault the empty line is short and no vault button is drawn', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://127.0.0.1:8080/login.html', async ({ popup }) => {
  setVaults({ vaults: [{ id: 'passwords', name: 'Only' }] });
  try {
    await popup.eval(`location.reload()`);
    await until(() => visible(popup, 'sitenote'), 'the empty notice');
    assert.equal(await text(popup, 'sitenotebody'), 'Only has none for this site. Search all logins above.');
    await assertNoEmptyBoxes(popup, 'one vault, no match');
    assert.equal(await visible(popup, 'vaultbar'), false);
    assert.equal(await visible(popup, 'unlock'), false);
  } finally { setVaults(null); }
}));

test('search groups the results and fills a login saved for another site with one click', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://127.0.0.1:8080/login.html', async ({ page, popup }) => {
  await settled(popup);
  assert.equal(await popup.eval(`document.activeElement.id`), 'q');
  const search = async (q) => popup.eval(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  await search('localhost');
  await until(() => popup.eval(`document.querySelectorAll('#results li button').length > 0`), 'search results');
  assert.equal(await popup.eval(`[...document.querySelectorAll('#results h2')].map((h) => h.textContent).join('|')`), 'Other Matches', 'an empty group is left out');
  assert.match(await popup.eval(`document.querySelector('#results li').innerText`), /Saved for localhost/);
  assert.equal(await popup.eval(`document.querySelector('#results li button').textContent`), 'Fill', 'one Fill everywhere');
  assert.equal(await page.eval(`document.getElementById('p').value`), '', 'nothing is filled before the click');
  await popup.eval(`document.querySelector('#results li button').click()`);       // no second question
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

test('search shows the pills with counts and the matched part in bold', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await settled(popup);
  assert.equal(await popup.eval(`document.getElementById('pills').hidden`), true, 'no pills before a search');
  await popup.eval(`(() => { const i = document.getElementById('q'); i.value = 'alex@studio'; i.dispatchEvent(new Event('input')); })()`);
  await until(() => popup.eval(`document.querySelectorAll('#results li button').length > 0`), 'search results');
  assert.equal(await popup.eval(`[...document.querySelectorAll('#pills button')].map((b) => b.getAttribute('aria-label') + (b.disabled ? ' off' : '')).join('|')`), 'Name, 0 off|Website, 0 off|Username, 1');
  await assertNoEmptyBoxes(popup, 'search results');
  assert.equal(await popup.eval(`[...document.querySelectorAll('#pills button')].map((b) => b.textContent.trim()).join('|')`), 'Name 0|Website 0|Username 1');
  assert.equal(await popup.eval(`document.querySelector('#results .hit').textContent`), 'alex@studio');
  assert.equal(await popup.eval(`document.getElementById('sitegroup').hidden`), true, 'results replace the site list while searching');
  await popup.eval(`document.querySelector('#pills [data-field=username]').click()`);  // choosing a field narrows the search to it
  await until(() => popup.eval(`document.querySelector('#pills [data-field=username]').getAttribute('aria-pressed') === 'true'`), 'pill pressed');
  assert.equal(await popup.eval(`document.querySelectorAll('#results li button').length`), 1);
}));

const pickList = (popup) => popup.eval(`[...document.querySelectorAll('#vaultselect option')].map((o) => o.textContent + (o.selected ? '*' : '')).join('|')`);
const chooseVault = async (popup, name) => {
  await popup.eval(`(() => { const s = document.getElementById('vaultselect'); s.value = [...s.options].find((o) => o.textContent === ${JSON.stringify(name)}).value; s.dispatchEvent(new Event('change')); })()`);
  await until(() => popup.eval(`document.getElementById('vaultselect').selectedOptions[0].textContent === ${JSON.stringify(name)} && !document.getElementById('vaultselect').disabled`), `${name} to be the current vault`);
};

test('with several vaults the header has the vault glyph and a plain pick list in the app’s order', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await settled(popup);
  assert.equal(await visible(popup, 'vaultbar'), true);
  assert.equal(await popup.eval(`document.getElementById('vaultselect').tagName`), 'SELECT');
  assert.equal(await popup.eval(`document.getElementById('vaultselect').getAttribute('aria-label')`), 'Vault');
  assert.equal(await popup.eval(`document.querySelectorAll('#vaultselect svg').length + document.querySelectorAll('#vaultbar > svg[aria-hidden=true]').length`), 1, 'the glyph is outside the pick list, at its left');
  assert.equal(await popup.eval(`document.getElementById('vaultbar').firstElementChild.tagName`), 'svg');
  assert.equal(await pickList(popup), 'Passwords*|Work|Archive|Family|Travel|Taxes|Old', 'the order the app reports, the current vault not moved first');
  assert.equal(await visible(popup, 'unlock'), false, 'no Unlock while the current vault is open');
}));

test('choosing a locked vault shows Unlock beside the vault button; Touch ID opens it and lists its logins', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  await settled(popup);
  try {
    await chooseVault(popup, 'Work');
    assert.equal(await text(popup, 'status'), 'Work is locked. Choose Unlock to use Touch ID.');
    assert.equal(await pickList(popup), 'Passwords|Work*|Archive|Family|Travel|Taxes|Old', 'the current vault stays where it is in the list');
    assert.equal(await visible(popup, 'unlock'), true);
    assert.equal(await popup.eval(`document.getElementById('unlock').textContent`), 'Unlock');
    assert.equal(await visible(popup, 'noticeunlock'), false, 'with several vaults Unlock sits beside the vault button, not in the notice');
    assert.equal(await visible(popup, 'search'), false, 'nothing to search while locked');
    await assertNoEmptyBoxes(popup, 'locked, several vaults');
    assert.equal(await visible(popup, 'sitegroup'), false);
    await popup.eval(`document.getElementById('unlock').click()`);
    await until(() => visible(popup, 'sitegroup'), 'Work to list');
    assert.equal(await text(popup, 'sitenotebody'), 'Work has none for this site. Search all logins above, or choose another vault.');
    assert.equal(await visible(popup, 'unlock'), false);
    assert.equal(await popup.eval(`document.getElementById('notice').hidden`), true);
    assert.equal(await popup.eval(`new Promise((ok) => chrome.action.getBadgeText({}, ok))`), '', 'the popup that is still open clears the check');
  } finally { setVaults(null); }
}));

test('the unlock goes through the background, which leaves a check on the toolbar button for the next click', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  await settled(popup);
  const badge = () => popup.eval(`new Promise((ok) => chrome.action.getBadgeText({}, ok))`);
  try {
    await popup.eval(`Host.switchVault('work')`);
    // The popup is not waiting for this answer, as when the Touch ID prompt closes it.
    await popup.eval(`chrome.runtime.sendMessage({ psss: 'unlock-vault', vault: 'work' }).then(() => null)`);
    assert.equal(await badge(), '✓');
    await popup.eval(`location.reload()`);   // the next click: lists Work with no second prompt, and clears the check
    await until(() => visible(popup, 'sitegroup'), 'Work to list at once');
    assert.equal(await text(popup, 'sitenotebody'), 'Work has none for this site. Search all logins above, or choose another vault.');
    assert.equal(await badge(), '');
    assert.equal(await popup.eval(`chrome.runtime.sendMessage({ psss: 'unlock-vault', vault: 'x'.repeat(65) })`).then((r) => r.error), 'not-found');
    assert.equal(await badge(), '');
  } finally { setVaults(null); await popup.eval(`chrome.action.setBadgeText({ text: '' })`); }
}));

test('Touch ID cancelled: an orange notice, Unlock asks again, and the next popup says so too', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  await settled(popup);
  try {
    await chooseVault(popup, 'Archive');
    await popup.eval(`document.getElementById('unlock').click()`);
    await until(async () => (await text(popup, 'status')) === 'Touch ID was cancelled. Choose Unlock to try again.', 'the cancelled notice');
    assert.equal(await popup.eval(`document.getElementById('notice').dataset.kind`), 'warning');
    assert.equal(await visible(popup, 'unlock'), true);
    assert.equal(await popup.eval(`document.getElementById('unlock').disabled`), false, 'Unlock asks again');
    assert.equal(await visible(popup, 'search'), false);
    await popup.eval(`chrome.runtime.sendMessage({ psss: 'unlock-vault', vault: 'archive' })`);   // what a closed popup left behind
    assert.equal(await popup.eval(`new Promise((ok) => chrome.action.getBadgeText({}, ok))`), '!');
    await popup.eval(`location.reload()`);
    await until(async () => (await text(popup, 'status')) === 'Touch ID was cancelled. Choose Unlock to try again.', 'the next popup to say so');
    assert.equal(await popup.eval(`new Promise((ok) => chrome.action.getBadgeText({}, ok))`), '', 'said once');
  } finally { setVaults(null); }
}));

test('a vault that needs its password: Unlock asks Psss, and without an app the notice says to open it', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  await settled(popup);
  try {
    await chooseVault(popup, 'Family');
    assert.equal(await text(popup, 'status'), 'Touch ID is off for Family. Unlock with the vault password.');
    await popup.eval(`document.getElementById('unlock').click()`);
    await until(async () => (await text(popup, 'status')) === 'Open Psss to unlock Family.', 'the needs-app notice');
    await assertNoEmptyBoxes(popup, 'needs password');
    assert.equal(await visible(popup, 'unlock'), false, 'nothing more Unlock can do from here');
    assert.equal(await popup.eval(`new Promise((ok) => chrome.action.getBadgeText({}, ok))`), '');
  } finally { setVaults(null); }
}));

test('a vault that is not available has no Unlock, and the vault button stays', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  await settled(popup);
  try {
    for (const [name, words] of [
      ['Old', 'Old was not found. Psss lists nothing from it here. Open Psss to locate it, or choose another vault.'],
      ['Travel', 'Travel isn’t downloaded yet. Psss lists nothing from it here. Open Psss to download it, or choose another vault.'],
      ['Taxes', 'Taxes can’t be read. Psss lists nothing from it here. Open Psss for details, or choose another vault.']]) {
      await chooseVault(popup, name);
      assert.equal(await text(popup, 'status'), words);
      assert.equal(await popup.eval(`document.getElementById('notice').dataset.kind`), 'warning');
      assert.equal(await visible(popup, 'unlock'), false, name);
      assert.equal(await visible(popup, 'vaultbar'), true, name);
      assert.equal(await visible(popup, 'search'), false, name);
    }
    await chooseVault(popup, 'Passwords');
    await popup.eval(`document.getElementById('unlock').click()`);
    await until(() => visible(popup, 'sitegroup'), 'Passwords to list again');
    assert.match(await popup.eval(`document.querySelector('#logins li').innerText`), /alex@example\.net/);
  } finally { setVaults(null); }
}));

test('with one vault the notice carries Unlock', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  setVaults({ active: 'passwords', open: [], vaults: [{ id: 'passwords', name: 'Only' }] });
  try {
    await popup.eval(`location.reload()`);
    await until(async () => (await text(popup, 'status')) !== '', 'the notice');
    assert.equal(await text(popup, 'status'), 'Only is locked. Choose Unlock to use Touch ID.');
    await assertNoEmptyBoxes(popup, 'locked, one vault');
    assert.equal(await visible(popup, 'vaultbar'), false);
    assert.equal(await visible(popup, 'unlock'), false);
    assert.equal(await visible(popup, 'noticeunlock'), true);
    await popup.eval(`document.getElementById('noticeunlock').click()`);
    await until(() => visible(popup, 'sitegroup'), 'the vault to list');
    assert.match(await popup.eval(`document.querySelector('#logins li').innerText`), /alex@example\.net/);
  } finally { setVaults(null); }
}));

test('the host refuses a save into a vault that is not open or not known', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  const save = (vault) => popup.eval(`Host.save('http://localhost:8080', ${JSON.stringify(vault)}, 'refused@example.net', 'Never-saved-1').then((r) => r.error ?? r.result)`);
  assert.equal(await save('work'), 'locked');
  assert.equal(await save('nope'), 'not-found');
  assert.equal(await popup.eval(`Host.save('http://localhost:8080', 'passwords', 'refused@example.net', 'Never-saved-1').then((r) => r.result)`), 'created', 'an open vault is written');
}));

test('hostile vault names are shown as one short line, as text', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup('http://localhost:8080/login.html', async ({ popup }) => {
  const names = [`Work${String.fromCharCode(0x202e)}gpj.exe`, '<img src=x onerror="window.__pwned=1">', 'Line one\nLine two', 'y'.repeat(4000)];
  setVaults({ vaults: names.map((name, i) => ({ id: `h${i}`, name, location: name })) });
  try {
    await popup.eval(`location.reload()`);
    await until(() => popup.eval(`document.getElementById('vaultselect').options.length > 0`), 'the pick list');
    const rows = await popup.eval(`[...document.querySelectorAll('#vaultselect option')].map((o) => o.textContent)`);
    assert.equal(rows[0], 'Workgpj.exe');
    assert.equal(rows[1], '<img src=x onerror="window.__pwned=1">', 'shown literally');
    assert.equal(rows[2], 'Line one Line two');
    assert.ok(rows[3].length <= 40 && rows[3].endsWith('…'));
    assert.equal(await popup.eval(`document.querySelectorAll('#vaultbar img').length + (window.__pwned ?? 0)`), 0, 'no markup from a name');
    assert.equal(await popup.eval(`/[\\u0000-\\u0008\\u000b-\\u001f\\u202a-\\u202e\\u2066-\\u2069]/.test(document.body.innerText)`), false);
    await chooseVault(popup, 'Line one Line two');
    const notice = await popup.eval(`document.getElementById('status').textContent`);
    assert.ok(!notice.includes('\n'), 'one line in the notice');
  } finally { setVaults(null); }
}));

/** The work vault, open, with exactly one login for localhost, so "exactly one match" does not depend on what other tests saved. */
async function withSoloWork(popup, body) {
  setVaults({ active: 'work', open: ['work'] });
  const solo = join(store, 'saved-logins-work.json');
  try {
    assert.equal(await popup.eval(`Host.save('http://localhost:8080', 'work', 'solo@example.net', 'Solo-secret-1').then((r) => r.result)`), 'created');
    await popup.eval(`location.reload()`);
    await until(() => popup.eval(`document.querySelectorAll('#logins li.row').length === 1`), 'one login for this site');
    await body();
  } finally { setVaults(null); rmSync(solo, { force: true }); }
}
const typeQuery = (popup, q) => popup.eval(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.focus(); })()`);
const pressEnter = (popup) => popup.eval(`document.getElementById('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);

test('Return in the search field with several matches picks nothing, and with one login for another site it fills that one', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  await typeQuery(popup, 'a');           // several logins have an "a"
  await pressEnter(popup);
  await until(() => popup.eval(`document.querySelectorAll('#results li.row').length > 1`), 'several results');
  assert.equal(await page.eval(`document.getElementById('p').value`), '', 'two or more matches: Return picks nothing');
  await typeQuery(popup, 'alex@studio'); // exactly one, saved for another site: the same Fill
  await pressEnter(popup);
  await until(async () => (await page.eval(`document.getElementById('p').value`)) !== '', 'the one result to be filled');
}));

test('Return fills the only search result for this site', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  await withSoloWork(popup, async () => {
    await typeQuery(popup, 'solo@');
    await pressEnter(popup);
    await until(async () => (await page.eval(`document.getElementById('p').value`)) !== '', 'the one result to be filled');
    assert.equal(await page.eval(`document.getElementById('u').value`), 'solo@example.net');
  });
}));

test('Return in an empty search fills the only login for this site', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ page, popup }) => {
  await settled(popup);
  await withSoloWork(popup, async () => {
    await typeQuery(popup, '');
    await pressEnter(popup);
    await until(async () => (await page.eval(`document.getElementById('p').value`)) !== '', 'the one login to be filled');
    assert.equal(await page.eval(`document.getElementById('u').value`), 'solo@example.net');
    assert.equal(await page.eval(`document.getElementById('p').value`), 'Solo-secret-1');
  });
}));

test('creating a login names the vault, and the button says Update when the site and username exist', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/signup.html`, async ({ page, popup }) => {
  await until(() => visible(popup, 'create'), 'create section');
  assert.equal(await text(popup, 'generate'), 'Generate, Fill and Save');
  assert.equal(await text(popup, 'createtitle'), 'Create a login');
  // The sample vault has alex@example.net for localhost: typing it turns Create into Update, which changes only the password.
  await popup.eval(`(() => { const a = document.getElementById('account'); a.value = 'alex@example.net'; a.dispatchEvent(new Event('input')); })()`);
  assert.equal(await text(popup, 'createtitle'), 'Update a login');
  assert.equal(await text(popup, 'accountlabel'), 'Passwords already has alex@example.net for this site.');
  assert.match(await text(popup, 'generate'), /^Update .+ \(alex@example\.net\)$/);
  assert.equal(await popup.eval(`document.getElementById('account').getAttribute('aria-label')`), 'Username or email', 'the field keeps its name');
  await popup.eval(`document.getElementById('account').value = 'someone.new@example.net'; document.getElementById('account').dispatchEvent(new Event('input'))`);
  assert.equal(await text(popup, 'generate'), 'Generate, Fill and Save');
  // With one vault nothing names a vault.
  setVaults({ vaults: [{ id: 'passwords', name: 'Only' }] });
  try {
    await popup.eval(`location.reload()`);
    await until(() => visible(popup, 'create'), 'create section');
    assert.equal(await text(popup, 'generate'), 'Generate, Fill and Save');
    await popup.eval(`(() => { const a = document.getElementById('account'); a.value = 'alex@example.net'; a.dispatchEvent(new Event('input')); })()`);
    assert.equal(await text(popup, 'accountlabel'), 'alex@example.net is already saved for this site.');
  } finally { setVaults(null); }
}));

test('the create section is not offered while the current vault is locked, and returns when it opens', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/signup.html`, async ({ popup }) => {
  await until(() => visible(popup, 'create'), 'create section');
  try {
    await chooseVault(popup, 'Work');
    assert.equal(await visible(popup, 'create'), false);
    await popup.eval(`document.getElementById('unlock').click()`);
    await until(() => visible(popup, 'create'), 'create section to return');
    assert.equal(await text(popup, 'generate'), 'Generate, Fill and Save');
  } finally { setVaults(null); }
}));

test('without the app the popup says Psss is not open, and it works again once the app is back', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await relay.kill(); // the app is gone with no goodbye: its socket file is left behind
  try {
    await popup.eval(`location.reload()`);
    await until(async () => (await text(popup, 'status')) === 'Psss is not open.', 'the not-open notice');
    assert.equal(await visible(popup, 'search'), false, 'nothing to search without the app');
    assert.equal(await popup.eval(`Host.ping().then((r) => r.error)`), 'not-running');
  } finally {
    relay = await startStandIn(store, [], relay.root); // the next app run takes the lock and replaces the old socket
  }
  assert.equal(await popup.eval(`Host.ping().then((r) => r.ok && r.app)`), true);
}));

test('a different extension ID cannot use the native host', async () => {
  const popup = await cdp.openTab('about:blank');
  await popup.goto(`chrome-extension://${foreignId}/popup.html`);
  const error = await popup.eval(`api.runtime.sendNativeMessage(PROTOCOL.host, {v: 5, id: 'x', type: 'ping'}).then(() => null, (e) => e.message)`);
  assert.match(error, /forbidden/i, 'Chrome must refuse an extension that is not in allowed_origins');
  const reply = await popup.eval(`Host.ping()`);
  assert.equal(reply.ok, false);
  await popup.close();
});

// Last on purpose: it saves two more logins into the sample vault, which would change the "one login for this site" tests.
test('a search lists This Site first and Other Matches after, each other-site row naming where it is saved', { skip: false }, (t) => !hostAccess ? t.skip('host permission withheld in this browser') : withPopup(`${SITE}/login.html`, async ({ popup }) => {
  await settled(popup);
  assert.equal(await popup.eval(`Host.save('http://localhost:8080', 'passwords', 'zzgroup-own@example.net', 'Group-secret-1').then((r) => r.result)`), 'created');
  assert.equal(await popup.eval(`Host.save('http://127.0.0.1:8080', 'passwords', 'zzgroup-other@example.net', 'Group-secret-2').then((r) => r.result)`), 'created');
  await popup.eval(`(() => { const i = document.getElementById('q'); i.value = 'zzgroup'; i.dispatchEvent(new Event('input')); })()`);
  await until(() => popup.eval(`document.querySelectorAll('#results h2').length === 2`), 'both groups');
  assert.equal(await popup.eval(`[...document.querySelectorAll('#results h2')].map((h) => h.textContent).join('|')`), 'For This Site|Other Matches');
  const [own, others] = await popup.eval(`[...document.querySelectorAll('#results .group')].map((g) => g.querySelector('ul').innerText)`);
  assert.match(own, /zzgroup-own@example\.net/);
  assert.doesNotMatch(own, /Saved for/);
  assert.match(others, /zzgroup-other@example\.net[\s\S]*Saved for 127\.0\.0\.1/);
  assert.equal(await popup.eval(`[...document.querySelectorAll('#results button')].every((b) => b.textContent === 'Fill')`), true);
}));
