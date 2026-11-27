// Photographs the site's share-image page (Site/src/pages/og.astro) into Site/public/og.png, 1200 by 630.
// Run it after a change to the lead picture, the icon or the headline, then commit the PNG.
// Usage: cd Site && npm run build && cd .. && node scripts/build-og-image.mjs
// Needs Playwright with Chromium, installed in Extensions/Browser/tests (npm install there).
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'Site/dist');
const require = createRequire(join(root, 'Extensions/Browser/tests/package.json'));
const { chromium } = require('playwright');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  let path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(dist, path));
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const reply = await page.goto(`http://127.0.0.1:${server.address().port}/og/`);
  if (!reply.ok()) throw new Error('No /og/ page: build the site first (cd Site && npm run build).');
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ animations: 'disabled' });
  await writeFile(join(root, 'Site/public/og.png'), png);
  console.log(`Wrote Site/public/og.png (${Math.round(png.length / 1024)} KB)`);
  if (png.length > 300 * 1024) throw new Error('Site/public/og.png is over 300 KB.');
} finally {
  await browser?.close();
  server.close();
}
