import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The build has to open straight from disk (file://). Browsers refuse
// module scripts and CORS-mode stylesheets there, so the build is one
// classic script and one stylesheet, with `type="module"` and
// `crossorigin` removed from index.html.
function openFromDisk(): Plugin {
  return {
    name: 'open-from-disk',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      const scripts: string[] = [];
      let out = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>\s*/g, (_m, src: string) => {
        scripts.push(`<script defer src="${src}"></script>`);
        return '';
      });
      out = out.replace(/ crossorigin(="[^"]*")?/g, '');
      return out.replace('</body>', `${scripts.join('\n')}\n</body>`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), openFromDisk()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
