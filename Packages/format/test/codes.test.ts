// Every error code used by a vector or by the source must be in the README table, so codes stay stable and documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const documented = (c: string) => readme.includes(`\`${c}\``);

test('codes in vectors are documented', () => {
  const found = new Set<string>();
  const walk = (o: any) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if (o.error && typeof o.error.code === 'string') found.add(o.error.code);
      if (typeof o.rule === 'string') found.add(o.rule);
      if (typeof o.status === 'string') found.add(o.status);
      if (typeof o.reason === 'string') found.add(o.reason);
      Object.values(o).forEach(walk);
    }
  };
  for (const f of readdirSync(join(root, 'vectors')).filter((x) => x.endsWith('.json'))) for (const v of JSON.parse(readFileSync(join(root, 'vectors', f), 'utf8')).vectors) walk(v.expected);
  assert(found.size > 40);
  for (const c of found) assert(documented(c), `README.md must document ${c}`);
});

test('codes in the source are documented', () => {
  const found = new Set<string>();
  for (const f of readdirSync(join(root, 'src')).filter((x) => x.endsWith('.ts'))) {
    const s = readFileSync(join(root, 'src', f), 'utf8');
    for (const m of s.matchAll(/(?:FormatError|CborError)\('([a-z0-9_]+)'/g)) found.add(m[1]!);
  }
  for (const c of found) assert(documented(c), `README.md must document ${c}`);
});
