import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVectors, loadMinted, serialize, VECTOR_DIR } from '../scripts/make-vectors.ts';
import { argonStats } from '../src/prims.ts';
import { compute } from './compute.ts';

const onDisk = readdirSync(VECTOR_DIR).filter((n) => n.endsWith('.json')).sort();
const heavy = !!process.env.PSSS_HEAVY;

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
      if (v.heavy && !heavy) continue; // needs more memory than a routine run should use; set PSSS_HEAVY=1
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

const allVectors = () => onDisk.flatMap((n) => JSON.parse(readFileSync(join(VECTOR_DIR, n), 'utf8')).vectors as any[]);

test('the vectors cover the required topics', () => {
  const all = allVectors().map((v) => v.name as string);
  for (const p of ['cbor/reject/', 'cbor/accept/depth-16', 'cbor/reject/depth-17', 'cbor/accept/text-not-nfc', 'person/derive', 'card/verify', 'signature/s-plus-l', 'signature/pk-small-order-1',
    'gid/', 'commit/', 'record/key', 'record/seal-item', 'padding/record-255', 'padding/record-256', 'padding/record-257', 'padding/record-512', 'padding/record-513', 'padding/record-2048',
    'padding/record-2049', 'padding/record-3000', 'padding/record-4094', 'padding/record-4096', 'padding/record-4097', 'record/open/bad-signature', 'record/open/moved-header',
    'record/open/author-small-order', 'record/open/bad-signature-s-not-reduced', 'record/largest-body', 'record/body-one-over', 'clock/order', 'fold/different-fields', 'fold/same-field',
    'fold/clear-after-set', 'fold/edit-after-delete', 'fold/delete-after-edit', 'fold/three-orders-one-state', 'fold/duplicate-record', 'checkpoint/fold-on-top', 'checkpoint/null-versus-cleared',
    'checkpoint/overlapping-both-orders', 'checkpoint/purged', 'group/fork-three-candidates', 'group/fork-1-author-removed-by-another-candidate', 'group/fork-2-least-author',
    'group/fork-1-mutual-removal-keeps-all', 'group/fork-2-same-author-device-decides', 'group/fork-2-same-author-and-device-seq-decides', 'group/fork-2-same-author-device-seq-is-a-chain-fork', 'group/remove-with-cut-unlisted-device', 'group/purge-request-hides-at-once', 'group/purge-request-answered-by-a-managers-checkpoint', 'group/purge-request-by-a-reader-is-ignored', 'folder/overlapping-segments', 'folder/gather-small-segments', 'folder/leftover-tmp-file-is-ignored', 'folder/segment-frame-without-key-between-readable-frames', 'folder/layout-one-new-file-per-write',
    'group/content-mhead-on-losing-branch', 'group/held-back-one-ms-over', 'group/epoch-sealed-under-old-key-with-old-epoch-is-refused', 'group/remove-sealed-under-old-key-with-old-epoch-is-refused', 'group/replace-sealed-under-old-key-with-old-epoch-is-refused', 'group/remove-header-names-new-epoch-but-sealed-under-old-key', 'group/genesis-gid-computed-without-min-reader', 'group/genesis-min-reader-is-not-the-one-in-the-gid', 'membership/genesis-min-reader-0-is-malformed', 'gid/min-reader-2', 'group/checkpoint-set-parts-by-different-authors', 'group/checkpoint-set-parts-on-different-devices', 'group/checkpoint-set-with-a-record-that-has-another-parts', 'group/checkpoint-set-with-two-different-part-1-records', 'group/checkpoint-set-two-parts-same-author-device-parts', 'group/purge-request-then-a-later-write', 'group/removed-person-added-again-writes-at-once', 'kit/parse-trailing-bit-1-set', 'record/open/order-salt-before-signature', 'record/same-body-sealed-twice', 'record/salt-derived', 'record/open/salt-does-not-match-body', 'group/chain-same-body-different-salt-is-rejected', 'group/previous-key-mismatch-epoch', 'group/previous-key-mismatch-remove', 'group/previous-key-mismatch-replace', 'group/genesis-min-reader-2', 'membership/kind-2-with-role-0-is-malformed', 'remember/different-record-at-accepted-seq', 'group/held-back-exactly-10-minutes', 'group/checkpoint-purged', 'group/checkpoint-overlapping-order-1',
    'slot/password-test-params', 'slot/password-default-params', 'slot/argon2-memory-one-above-maximum', 'slot/device-forged-ps', 'slot/device-open-sealed-by-python', 'kit/text',
    'kit/parse-all-confusables-lowercase', 'kit/parse-o-for-zero', 'kit/parse-i-for-one', 'slot/kit', 'slot/device-seal-fixed', 'wrap/seal-fixed', 'wrap/open-ciphertext-bit-flipped',
    'wrap/open-enc-bit-flipped', 'wrap/select-right-among-garbage', 'hpke/open-sealed-by-python-with-aad', 'attachment/size-claimed-too-large', 'attachment/last-chunk-dropped',
    'folder/segment-partial-length', 'folder/frame-length-one-over-largest']) {
    assert(all.some((n) => n.startsWith(p)), `missing vectors: ${p}`);
  }
});

test('every vector that tampers with an input names a tampered input that differs (generation-time assertion, checked again here)', () => {
  const byName = new Map(allVectors().map((v) => [v.name as string, v]));
  const wrapOpen = byName.get('wrap/open')!.input.wrap;
  for (const n of ['wrap/open-ciphertext-bit-flipped', 'wrap/open-tag-bit-flipped', 'wrap/open-enc-bit-flipped-ml-kem-part', 'wrap/open-enc-bit-flipped-x25519-part']) {
    const w = byName.get(n)!.input.wrap as string;
    assert.equal(w.length, wrapOpen.length, n);
    let diff = 0;
    for (let i = 0; i < w.length; i += 2) if (w.slice(i, i + 2) !== wrapOpen.slice(i, i + 2)) diff++;
    assert.equal(diff, 1, `${n} must differ from the original in exactly one byte`);
    assert.notDeepEqual(byName.get(n)!.expected, byName.get('wrap/open')!.expected, `${n} must fail where the original succeeds`);
  }
});

test('the Argon2id default parameters are derived at most once in a run, and a slot that must be refused derives nothing', () => {
  assert.equal(argonStats.byMemory.get(131072), 1, 'default parameters (131,072 KiB) derived once for sealing, opening, regenerating and checking');
  for (const memory of argonStats.byMemory.keys()) assert([16, 64, 65536, 131072].includes(memory) || heavy, `unexpected derivation with ${memory} KiB`);
  const before = argonStats.derivations;
  let refusals = 0;
  for (const v of allVectors()) {
    if (v.type === 'slot.open' && ['argon2_too_weak', 'argon2_too_strong', 'bad_slot'].includes(v.expected?.error?.code)) { compute(v.type, v.input); refusals++; }
  }
  assert(refusals >= 9);
  assert.equal(argonStats.derivations, before, 'a refused slot must not start Argon2id');
});
