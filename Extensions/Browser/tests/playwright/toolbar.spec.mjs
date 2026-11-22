import { test, expect } from './fixtures.mjs';

// Production-manifest build: no host permissions, no content script. The toolbar click is the
// user gesture that grants activeTab, so a filled form proves the real permission path.
test('toolbar click fills a login through activeTab', async ({ chrome }, testInfo) => {
  const page = await chrome.context.newPage();
  await page.goto('http://localhost:8080/login.html');
  const popup = await chrome.clickToolbar(page);
  await popup.waitForText('alex@example.net');
  await popup.screenshot(testInfo.outputPath('popup.png'));
  await popup.click(/fill/i);
  await expect(page.locator('input[type=password]')).not.toHaveValue('', { timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath('filled.png') });
});
