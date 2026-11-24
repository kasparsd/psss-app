import { defineConfig } from '@playwright/test';

// One worker: each spec launches its own real browser against the shared test site (Packages/test-sites) on :8080.
export default defineConfig({
  testDir: './playwright',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: './test-results',
});
