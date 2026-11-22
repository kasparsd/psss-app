// Playwright fixture: real, branded Google Chrome driven by Playwright over CDP, with the
// production Chromium build of the extension (no host permissions) loaded through
// Extensions.loadUnpacked and the native host registered in a throwaway profile.
import { test as base, expect, chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, BUILD, CDP, startSite, until } from '../e2e/lib.mjs';

const BUILD_PY = join(ROOT, 'Extensions/Browser/build.py');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export { expect };

export const test = base.extend({
  site: [async ({}, use) => { const stop = await startSite(); await use(stop); stop(); }, { scope: 'worker' }],

  chrome: [async ({ site }, use, testInfo) => {
    execFileSync('python3', [BUILD_PY, 'package', '--dev', '-t', 'chromium'], { stdio: 'ignore' });
    const profile = mkdtempSync(join(tmpdir(), 'psss-pw-'));
    execFileSync('python3', [BUILD_PY, 'install-host', '--dir', `chromium=${profile}`], { stdio: 'ignore' });
    const headless = process.env.HEADED ? [] : ['--headless=new'];
    const child = spawn(CHROME, [
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
      '--no-first-run', '--no-default-browser-check', ...headless, 'about:blank',
    ], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    const port = await until(() => existsSync(portFile) && readFileSync(portFile, 'utf8').split('\n')[0], 'DevTools port');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const session = await browser.newBrowserCDPSession();
    const { id } = await session.send('Extensions.loadUnpacked', { path: join(BUILD, 'chromium') });
    // Playwright does not expose extension pages over connectOverCDP, so the popup is driven
    // through a raw CDP session on its target. Everything else stays in Playwright.
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const raw = CDP.websocket(webSocketDebuggerUrl);
    await raw.ready;
    const popupHandle = async (targetId) => {
      const { sessionId } = await raw.send('Target.attachToTarget', { targetId, flatten: true });
      const run = async (expression) => {
        const r = await raw.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
        return r.result.value;
      };
      return {
        run,
        text: () => run('document.body.innerText'),
        buttons: () => run('[...document.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>b.innerText.trim())'),
        click: (label) => until(() => run(`(() => { const b=[...document.querySelectorAll("button")].find(b=>b.offsetParent && new RegExp(${JSON.stringify(label.source ?? label)}, ${JSON.stringify(label.flags ?? '')}).test(b.innerText.trim())); if(!b) return false; b.click(); return true; })()`), `popup button ${label}`),
        waitForText: (re) => until(async () => new RegExp(re, 'i').test(await run('document.body.innerText')), `popup text ${re}`),
        screenshot: async (path) => {
          const { data } = await raw.send('Page.captureScreenshot', { format: 'png' }, sessionId);
          writeFileSync(path, Buffer.from(data, 'base64'));
        },
        isOpen: async () => (await raw.send('Target.getTargets')).targetInfos.some((t) => t.targetId === targetId),
      };
    };
    // The real toolbar click: Extensions.triggerAction needs the tab-type target of the page.
    const clickToolbar = async (page) => {
      const { targetInfos } = await session.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      const tab = targetInfos.find((t) => t.url === page.url());
      await session.send('Extensions.triggerAction', { id, targetId: tab.targetId });
      const popup = await until(async () => (await session.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${id}/popup.html`)), 'popup target');
      return popupHandle(popup.targetId);
    };
    await use({ browser, context, id, clickToolbar, profile });
    raw.close();
    await browser.close().catch(() => {});
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }, { scope: 'test' }],
});
