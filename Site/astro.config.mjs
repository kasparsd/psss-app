import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import noScript from './src/integrations/no-script.mjs';

// The landing page is built from the mock component library, so a change to a
// screen's mock changes the page. See docs/brand.md, "Landing page".
const mocks = fileURLToPath(new URL('../Design/Mocks/app/src', import.meta.url));

export default defineConfig({
  site: 'https://psss.app',
  output: 'static',
  integrations: [react(), noScript()],
  // One request for the whole page: the stylesheet travels inside the HTML.
  build: { inlineStylesheets: 'always' },
  vite: {
    resolve: {
      alias: { '@mocks': mocks },
      // The mock library has its own node_modules; one copy of React only.
      dedupe: ['react', 'react-dom'],
    },
    server: { fs: { allow: ['..'] } },
  },
});
