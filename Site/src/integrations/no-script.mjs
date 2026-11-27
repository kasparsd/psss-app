// The site ships no script and loads nothing from elsewhere (docs/brand.md, "Landing page").
// Astro's React integration still writes React's browser runtime, which no page asks for: this removes it,
// then fails the build if the output holds any script or asks another origin for a file.
import { readdir, readFile, rm } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function noScript() {
  return {
    name: 'psss-no-script',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter((f) => f.isFile())
          .map((f) => join(f.parentPath, f.name));
        const scripts = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));
        const problems = [];
        for (const file of files.filter((f) => ['.html', '.css'].includes(extname(f)))) {
          const text = await readFile(file, 'utf8');
          const name = relative(root, file);
          if (/<script[\s>]/i.test(text)) problems.push(`${name} has a script element`);
          if (/<[a-z][^<>]*\son[a-z]+=["']/i.test(text)) problems.push(`${name} has an event handler attribute`);
          for (const s of scripts) {
            if (text.includes(relative(root, s))) problems.push(`${name} refers to ${relative(root, s)}`);
          }
          // What a browser fetches by itself: src, srcset, url(), @import, and <link> other than the canonical address.
          const fetched = /(?:\ssrc(?:set)?=["']?|url\(\s*["']?|@import\s+["'])(?:https?:)?\/\/|<link\b(?![^>]*rel=["']canonical["'])[^>]*href=["'](?:https?:)?\/\//i;
          if (fetched.test(text)) problems.push(`${name} loads a file from another origin`);
        }
        if (problems.length) throw new Error(`The site must have no script and no outside files:\n${problems.join('\n')}`);
        await Promise.all(scripts.map((s) => rm(s)));
        logger.info(`no script in the output (removed ${scripts.length} unused)`);
      },
    },
  };
}
