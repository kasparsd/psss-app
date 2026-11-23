// Mutation test for the numeric boundaries of the specification. For each boundary the table below moves one limit by one step
// in each direction and checks that the vectors named for that side stop passing. A boundary no vector notices is a boundary an
// implementation can get wrong without anyone seeing it. README.md ("Numeric boundaries") lists the same table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limits, defaults, rules, defaultRules } from '../src/limits.ts';
import { argonStats, rememberArgon2 } from '../src/prims.ts';
import { compute } from './compute.ts';

const here = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(here, '..', 'vectors');
const vectors = new Map<string, any>();
for (const n of readdirSync(VECTORS).filter((x) => x.endsWith('.json'))) for (const v of JSON.parse(readFileSync(join(VECTORS, n), 'utf8')).vectors) vectors.set(v.name, v);

export interface Mutation { limit: keyof typeof limits; delta: number; flips: string[] }
export interface Boundary { name: string; spec: string; limit: keyof typeof limits; mutations: Mutation[] }

export const BOUNDARIES: Boundary[] = [
  { name: 'Padding: 256-byte steps up to', spec: '4.2', limit: 'paddingThreshold', mutations: [
    { limit: 'paddingThreshold', delta: 256, flips: ['padding/length-4097', 'padding/record-4097'] },
    { limit: 'paddingThreshold', delta: -512, flips: ['padding/length-3840', 'padding/record-3840'] }] },
  { name: 'Padding: step of 256', spec: '4.2', limit: 'paddingStep', mutations: [
    { limit: 'paddingStep', delta: 1, flips: ['padding/length-1', 'padding/record-255'] },
    { limit: 'paddingStep', delta: -1, flips: ['padding/length-1', 'padding/record-256'] }] },
  { name: 'Padding: step of 4096 beyond that', spec: '4.2', limit: 'paddingBigStep', mutations: [
    { limit: 'paddingBigStep', delta: 1, flips: ['padding/length-8192', 'padding/record-8192'] },
    { limit: 'paddingBigStep', delta: -1, flips: ['padding/length-8192', 'padding/record-8193'] }] },
  { name: 'Largest body, 1,048,576 bytes', spec: '4.2', limit: 'maxBody', mutations: [
    { limit: 'maxBody', delta: 1, flips: ['record/body-one-over', 'record/open/body-over-1mib'] },
    { limit: 'maxBody', delta: -1, flips: ['record/largest-body'] }] },
  { name: 'Largest sealed record, 1,052,760 bytes (also the frame limit of 8.1)', spec: '4.1, 8.1', limit: 'maxSealed', mutations: [
    { limit: 'maxSealed', delta: 1, flips: ['record/sealed-longer-than-largest', 'folder/frame-length-one-over-largest'] },
    { limit: 'maxSealed', delta: -1, flips: ['record/largest-body', 'record/sealed-exactly-largest-bad-body', 'folder/frame-length-exactly-largest-incomplete'] }] },
  { name: 'Hold back more than 10 minutes ahead', spec: '4.5', limit: 'holdBackMs', mutations: [
    { limit: 'holdBackMs', delta: 1, flips: ['clock/held-back/one-ms-over', 'group/held-back-one-ms-over'] },
    { limit: 'holdBackMs', delta: -1, flips: ['clock/held-back/exactly-10-minutes', 'group/held-back-exactly-10-minutes'] }] },
  { name: 'Extension keys from 128 up (body and payload)', spec: '2', limit: 'extensionKey', mutations: [
    { limit: 'extensionKey', delta: 1, flips: ['record/open/extension-key-128-in-body', 'record/open/extension-key-128-in-payload'] },
    { limit: 'extensionKey', delta: -1, flips: ['record/open/extension-key-127-in-body', 'record/open/extension-key-127-in-payload'] }] },
  { name: 'CBOR nesting of 16 levels', spec: '2', limit: 'maxDepth', mutations: [
    { limit: 'maxDepth', delta: 1, flips: ['cbor/reject/depth-17-arrays', 'cbor/reject/depth-17-maps'] },
    { limit: 'maxDepth', delta: -1, flips: ['cbor/accept/depth-16-arrays', 'cbor/accept/depth-16-maps'] }] },
  { name: 'Argon2id at least 65,536 KiB', spec: '7.2', limit: 'argonMinMemory', mutations: [
    { limit: 'argonMinMemory', delta: 1, flips: ['slot/argon2-at-minimum'] },
    { limit: 'argonMinMemory', delta: -1, flips: ['slot/argon2-memory-one-below-minimum'] }] },
  { name: 'Argon2id at least 2 passes', spec: '7.2', limit: 'argonMinPasses', mutations: [
    { limit: 'argonMinPasses', delta: 1, flips: ['slot/argon2-at-minimum'] },
    { limit: 'argonMinPasses', delta: -1, flips: ['slot/argon2-passes-one-below-minimum'] }] },
  { name: 'Argon2id at least 1 lane', spec: '7.2', limit: 'argonMinLanes', mutations: [
    { limit: 'argonMinLanes', delta: 1, flips: ['slot/argon2-at-minimum'] },
    { limit: 'argonMinLanes', delta: -1, flips: ['slot/argon2-lanes-zero'] }] },
  { name: 'Argon2id at least 8 KiB of memory per lane', spec: '7.2', limit: 'argonMinMemoryPerLane', mutations: [
    { limit: 'argonMinMemoryPerLane', delta: 1, flips: ['slot/argon2-memory-per-lane-at-minimum'] },
    { limit: 'argonMinMemoryPerLane', delta: -1, flips: ['slot/argon2-memory-below-eight-per-lane'] }] },
  { name: 'Argon2id at most 1,048,576 KiB', spec: '7.2', limit: 'argonMaxMemory', mutations: [
    { limit: 'argonMaxMemory', delta: 1, flips: ['slot/argon2-memory-one-above-maximum', 'slot/argon2-test-switch-keeps-upper-limits'] },
    { limit: 'argonMaxMemory', delta: -1, flips: ['slot/argon2-at-maximum-memory'] }] },
  { name: 'Argon2id at most 16 passes', spec: '7.2', limit: 'argonMaxPasses', mutations: [
    { limit: 'argonMaxPasses', delta: 1, flips: ['slot/argon2-passes-one-above-maximum'] },
    { limit: 'argonMaxPasses', delta: -1, flips: ['slot/argon2-at-maximum-passes'] }] },
  { name: 'Argon2id at most 16 lanes', spec: '7.2', limit: 'argonMaxLanes', mutations: [
    { limit: 'argonMaxLanes', delta: 1, flips: ['slot/argon2-lanes-one-above-maximum'] },
    { limit: 'argonMaxLanes', delta: -1, flips: ['slot/argon2-at-maximum-lanes'] }] },
  { name: 'Attachment chunk of 1,048,576 bytes', spec: '5.2', limit: 'chunkSize', mutations: [
    { limit: 'chunkSize', delta: 1, flips: ['attachment/one-chunk-and-a-byte', 'attachment/last-chunk-too-long'] },
    { limit: 'chunkSize', delta: -1, flips: ['attachment/exactly-one-chunk', 'attachment/two-full-chunks'] }] },
  { name: 'Purge a deleted item after 30 days on the purging device\'s clock', spec: '5.1', limit: 'purgeAfterMs', mutations: [
    { limit: 'purgeAfterMs', delta: 1, flips: ['clock/purge-due/exactly-30-days'] },
    { limit: 'purgeAfterMs', delta: -1, flips: ['clock/purge-due/one-ms-short'] }] },
];

/** True when the vector still passes. A heavy vector is run too: its Argon2id work is skipped (dry run), which does not change what it tests. */
function passes(name: string): boolean {
  const v = vectors.get(name);
  assert(v, `no vector named ${name}`);
  try { assert.deepEqual(compute(v.type, v.input), v.expected); return true; } catch (e) { if ((e as Error).name === 'AssertionError') return false; throw e; }
}

test('every limit has a boundary entry, and every covering vector exists and passes unmutated', () => {
  assert.deepEqual(BOUNDARIES.map((b) => b.limit).sort(), Object.keys(defaults).sort());
  // the Argon2id cache is filled by the unmutated run, so that a mutated run only does fresh work for slots it would now accept
  rememberArgon2(true);
  for (const b of BOUNDARIES) for (const m of b.mutations) for (const n of m.flips) assert(passes(n), `${n} must pass with the specified limits`);
  argonStats.dryRun = true;
  for (const b of BOUNDARIES) for (const m of b.mutations) for (const n of m.flips) assert(passes(n), `${n} must pass with the specified limits (dry run)`);
});

for (const b of BOUNDARIES) {
  for (const m of b.mutations) {
    test(`mutation: ${String(m.limit)} ${m.delta > 0 ? '+' : ''}${m.delta} (${b.name}, section ${b.spec}) is noticed by ${m.flips.length} vector(s)`, () => {
      argonStats.dryRun = true;
      const before = limits[m.limit];
      limits[m.limit] = before + m.delta;
      try {
        for (const n of m.flips) assert(!passes(n), `${n} still passes with ${String(m.limit)} ${m.delta > 0 ? '+' : ''}${m.delta}: the boundary is not covered on this side`);
      } finally { limits[m.limit] = before; }
      assert.deepEqual({ ...limits }, { ...defaults });
    });
  }
}

test('the boundaries are listed in README.md with the vectors that cover them', () => {
  const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
  for (const b of BOUNDARIES) for (const m of b.mutations) for (const n of m.flips) assert(readme.includes(`\`${n}\``), `README.md must name ${n}`);
});

// ---- rules that are not numbers: each switch in `rules` flipped, with the vectors that must notice.
export interface RuleMutation { rule: keyof typeof rules; value: boolean | string; spec: string; what: string; flips: string[] }
export const RULE_MUTATIONS: RuleMutation[] = [
  { rule: 'deletedStrict', value: false, spec: '5.1', what: '"strictly later" read as "later or equal" for the deleted rule', flips: ['fold/delete-in-same-record-as-edit'] },
  { rule: 'tieBreak', value: 'device,author,seq', spec: '6.5', what: 'device compared before author', flips: ['group/fork-2-author-before-device'] },
  { rule: 'tieBreak', value: 'author,-device,seq', spec: '6.5', what: 'device order reversed', flips: ['group/fork-2-same-author-device-decides'] },
  { rule: 'tieBreak', value: '-author,device,seq', spec: '6.5', what: 'author order reversed', flips: ['group/fork-2-least-author'] },
  { rule: 'tieBreak', value: 'author,device,-seq', spec: '6.5', what: 'seq order reversed', flips: ['group/fork-2-same-author-and-device-seq-decides'] },
  { rule: 'keepAllWhenAllDropped', value: false, spec: '6.5', what: 'step 1 that drops every candidate keeps none', flips: ['group/fork-1-mutual-removal-keeps-all', 'group/fork-three-candidates-cycle'] },
  { rule: 'checkPreviousKey', value: false, spec: '6.3, 6.4', what: 'K_(e-1) not checked against commit(e-1)', flips: ['group/previous-key-mismatch-epoch', 'group/previous-key-mismatch-remove', 'group/previous-key-mismatch-replace'] },
  { rule: 'checkSalt', value: false, spec: '4.1, 9', what: 'salt not recomputed by the reader', flips: ['record/open/salt-does-not-match-body', 'record/open/moved-header-new-salt', 'group/chain-same-body-different-salt-is-rejected'] },
  { rule: 'checkScalarLessThanL', value: false, spec: '1.2', what: 'S not required to be less than the group order', flips: ['signature/s-plus-l', 'signature/s-equals-l', 'signature/s-top-bit-set'] },
  { rule: 'checkKitCheckBytes', value: false, spec: '7.2', what: 'kit check bytes not tested', flips: ['kit/parse-check-bytes-wrong-one-data-character', 'kit/parse-check-bytes-wrong-one-check-character'] },
  { rule: 'checkKitTrailingBits', value: false, spec: '7.2', what: 'the last four bits of the kit text not tested', flips: ['kit/parse-trailing-bit-1-set', 'kit/parse-trailing-bit-2-set', 'kit/parse-trailing-bit-4-set', 'kit/parse-trailing-bit-8-set', 'kit/parse-trailing-bits-all-set'] },
  { rule: 'checkHeaderEpoch', value: false, spec: '6.4', what: 'the header of a record of kind 3, 4 or 5 not required to name the epoch it starts', flips: ['group/epoch-sealed-under-old-key-with-old-epoch-is-refused', 'group/remove-sealed-under-old-key-with-old-epoch-is-refused', 'group/replace-sealed-under-old-key-with-old-epoch-is-refused'] },
  { rule: 'saltBeforeSignature', value: false, spec: '4.1, 9', what: 'the salt checked after the author and the signature', flips: ['record/open/order-salt-before-signature', 'record/open/order-salt-before-author', 'record/open/moved-header-new-salt'] },
  { rule: 'cutEndsBeforeNewEpoch', value: false, spec: '6.4', what: 'the cut of a remove or replace record reaches the epoch it starts too', flips: ['group/removed-person-added-again-writes-at-once'] },
  { rule: 'strictSets', value: false, spec: '5.3', what: 'parts of a set not required to share author, device and parts, or to be unique', flips: ['group/checkpoint-set-parts-by-different-authors', 'group/checkpoint-set-parts-on-different-devices', 'group/checkpoint-set-with-a-record-that-has-another-parts', 'group/checkpoint-set-with-two-different-part-1-records'] },
  { rule: 'purgeUpToOwnPlace', value: false, spec: '5.4', what: 'a purge request hides every write of the item, not only those up to its own place', flips: ['group/purge-request-then-a-later-write'] },
];

test('every rule switch has a mutation, and its covering vectors pass unmutated', () => {
  assert.deepEqual([...new Set(RULE_MUTATIONS.map((m) => m.rule))].sort(), Object.keys(defaultRules).sort());
  for (const m of RULE_MUTATIONS) for (const n of m.flips) assert(passes(n), `${n} must pass with the specified rules`);
});

for (const m of RULE_MUTATIONS) {
  test(`mutation: rule ${m.rule} = ${JSON.stringify(m.value)} (${m.what}, section ${m.spec}) is noticed by ${m.flips.length} vector(s)`, () => {
    argonStats.dryRun = true;
    const before = rules[m.rule];
    (rules as Record<string, unknown>)[m.rule] = m.value;
    try {
      for (const n of m.flips) assert(!passes(n), `${n} still passes with ${m.rule} = ${JSON.stringify(m.value)}: the rule is not covered`);
    } finally { (rules as Record<string, unknown>)[m.rule] = before; }
    assert.deepEqual({ ...rules }, { ...defaultRules });
  });
}

test('the rules are listed in README.md with the vectors that cover them', () => {
  const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
  for (const m of RULE_MUTATIONS) for (const n of m.flips) assert(readme.includes(`\`${n}\``), `README.md must name ${n}`);
});
