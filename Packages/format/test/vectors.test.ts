import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVectors, loadMinted, serialize, VECTOR_DIR } from '../scripts/make-vectors.ts';
import { compute } from './compute.ts';

const onDisk = readdirSync(VECTOR_DIR).filter((n) => n.endsWith('.json')).sort();

test('regenerating the vectors gives the committed files byte for byte', () => {
  const built = buildVectors(loadMinted());
  assert.deepEqual(Object.keys(built).sort(), onDisk, 'set of vector files');
  for (const [name, f] of Object.entries(built)) {
    assert.equal(serialize(f), readFileSync(join(VECTOR_DIR, name), 'utf8'), name);
  }
});

for (const name of onDisk) {
  const file = JSON.parse(readFileSync(join(VECTOR_DIR, name), 'utf8'));
  test(`${name}: every vector checks against the library (${file.vectors.length})`, () => {
    const names = new Set<string>();
    for (const v of file.vectors) {
      assert(typeof v.name === 'string' && typeof v.description === 'string' && v.description.length > 0 && typeof v.type === 'string', `shape of ${v.name}`);
      assert(!names.has(v.name), `duplicate ${v.name}`);
      names.add(v.name);
      assert.deepEqual(compute(v.type, v.input), v.expected, v.name);
    }
  });
}

test('every hex string in the vectors is lowercase hex of even length', () => {
  const bad: string[] = [];
  const walk = (x: unknown, path: string) => {
    if (typeof x === 'string') {
      if (/^(?:[0-9a-f]{2})*$/.test(x)) return;
      if (/^[0-9A-Fa-f]+$/.test(x) && x.length > 8) bad.push(path);
    } else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, `${path}.${k}`);
  };
  for (const name of onDisk) walk(JSON.parse(readFileSync(join(VECTOR_DIR, name), 'utf8')), name);
  assert.deepEqual(bad, []);
});

test('the vectors cover the required topics', () => {
  const all = onDisk.flatMap((n) => JSON.parse(readFileSync(join(VECTOR_DIR, n), 'utf8')).vectors.map((v: any) => v.name as string));
  for (const p of ['cbor/reject/', 'person/derive', 'card/verify', 'gid/', 'commit/', 'record/key', 'record/seal-item', 'padding/record-255', 'padding/record-256',
    'padding/record-257', 'padding/record-4096', 'padding/record-4097', 'record/open/bad-signature', 'record/open/moved-header', 'clock/order', 'fold/different-fields',
    'fold/same-field', 'fold/clear-after-set', 'fold/edit-after-delete', 'fold/delete-after-edit', 'fold/three-orders-one-state', 'fold/duplicate-record',
    'checkpoint/fold-on-top', 'group/remove-with-cut', 'group/fork-removal-beats-smaller-id', 'group/fork-smaller-id', 'group/fork-mutual-removal',
    'slot/password-test-params', 'slot/password-default-params', 'kit/text', 'slot/kit', 'slot/device-seal-fixed', 'slot/device-open', 'wrap/seal-fixed', 'wrap/open',
    'folder/segment-partial-length']) {
    assert(all.some((n) => n.startsWith(p)), `missing vectors: ${p}`);
  }
});
