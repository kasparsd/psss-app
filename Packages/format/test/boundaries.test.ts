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
  { name: 'Field name of at most 64 bytes (schema 1)', spec: 'schema 1', limit: 'nameBytes', mutations: [
    { limit: 'nameBytes', delta: 1, flips: ['schema/name/fixed-65-bytes', 'schema/name/repeated-65-bytes', 'schema/build/field-name-65-bytes-refused'] },
    { limit: 'nameBytes', delta: -1, flips: ['schema/name/fixed-64-bytes', 'schema/name/repeated-64-bytes', 'schema/build/field-name-64-bytes-accepted'] }] },
  { name: 'Text value of at most 65,536 bytes (schema 1, writer)', spec: 'schema 1', limit: 'textBytes', mutations: [
    { limit: 'textBytes', delta: 1, flips: ['schema/build/title-65537-bytes-refused'] },
    { limit: 'textBytes', delta: -1, flips: ['schema/build/title-65536-bytes-accepted'] }] },
  { name: 'Notes of at most 262,144 bytes (schema 1, writer)', spec: 'schema 1', limit: 'notesBytes', mutations: [
    { limit: 'notesBytes', delta: 1, flips: ['schema/build/notes-262145-bytes-refused'] },
    { limit: 'notesBytes', delta: -1, flips: ['schema/build/notes-262144-bytes-accepted'] }] },
  { name: 'At most 64 websites (schema 1, writer)', spec: 'schema 1', limit: 'websites', mutations: [
    { limit: 'websites', delta: 1, flips: ['schema/build/websites-one-over-refused'] },
    { limit: 'websites', delta: -1, flips: ['schema/build/websites-last-allowed-accepted'] }] },
  { name: 'At most 128 custom fields (schema 1, writer)', spec: 'schema 1', limit: 'customFields', mutations: [
    { limit: 'customFields', delta: 1, flips: ['schema/build/custom-fields-one-over-refused'] },
    { limit: 'customFields', delta: -1, flips: ['schema/build/custom-fields-last-allowed-accepted'] }] },
  { name: 'At most 64 attachments (schema 1, writer)', spec: 'schema 1', limit: 'attachments', mutations: [
    { limit: 'attachments', delta: 1, flips: ['schema/build/attachments-one-over-refused'] },
    { limit: 'attachments', delta: -1, flips: ['schema/build/attachments-last-allowed-accepted'] }] },
  { name: 'At most 64 tags (schema 1, writer)', spec: 'schema 1', limit: 'tags', mutations: [
    { limit: 'tags', delta: 1, flips: ['schema/build/tags-one-over-refused'] },
    { limit: 'tags', delta: -1, flips: ['schema/build/tags-last-allowed-accepted'] }] },
  { name: 'A checkpoint keeps the writes of the first 10 previous passwords (schema 4)', spec: 'schema 4', limit: 'historyKept', mutations: [
    { limit: 'historyKept', delta: 1, flips: ['schema/password/checkpoint-keeps-ten-earlier-writes'] },
    { limit: 'historyKept', delta: -1, flips: ['schema/password/checkpoint-keeps-ten-earlier-writes'] }] },
  { name: 'At most 10 previous passwords shown (schema 4)', spec: 'schema 4', limit: 'historyShown', mutations: [
    { limit: 'historyShown', delta: 1, flips: ['schema/password/twelve-changes-show-ten', 'schema/password/import-history-and-writes-limited-to-ten'] },
    { limit: 'historyShown', delta: -1, flips: ['schema/password/twelve-changes-show-ten', 'schema/password/import-history-and-writes-limited-to-ten'] }] },
  { name: 'Verification code of 4 to 10 digits (schema 2)', spec: 'schema 2', limit: 'otpDigitsMin', mutations: [
    { limit: 'otpDigitsMin', delta: 1, flips: ['schema/shape/otp-digits-4'] },
    { limit: 'otpDigitsMin', delta: -1, flips: ['schema/shape/otp-digits-3'] }] },
  { name: 'Verification code of 4 to 10 digits (schema 2), upper end', spec: 'schema 2', limit: 'otpDigitsMax', mutations: [
    { limit: 'otpDigitsMax', delta: 1, flips: ['schema/shape/otp-digits-11'] },
    { limit: 'otpDigitsMax', delta: -1, flips: ['schema/shape/otp-digits-10'] }] },
  { name: 'Verification code period of 1 to 86,400 seconds (schema 2)', spec: 'schema 2', limit: 'otpPeriodMin', mutations: [
    { limit: 'otpPeriodMin', delta: 1, flips: ['schema/shape/otp-period-1'] },
    { limit: 'otpPeriodMin', delta: -1, flips: ['schema/shape/otp-period-0'] }] },
  { name: 'Verification code period of 1 to 86,400 seconds (schema 2), upper end', spec: 'schema 2', limit: 'otpPeriodMax', mutations: [
    { limit: 'otpPeriodMax', delta: 1, flips: ['schema/shape/otp-period-86401'] },
    { limit: 'otpPeriodMax', delta: -1, flips: ['schema/shape/otp-period-86400'] }] },
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
  { rule: 'setSameAuthor', value: false, spec: '5.3', what: 'parts of a set not required to have one author', flips: ['group/checkpoint-set-parts-by-different-authors'] },
  { rule: 'setSameDevice', value: false, spec: '5.3', what: 'parts of a set not required to have one device', flips: ['group/checkpoint-set-parts-on-different-devices'] },
  { rule: 'setSameParts', value: false, spec: '5.3', what: 'parts of a set not required to agree on `parts`', flips: ['group/checkpoint-set-with-a-record-that-has-another-parts'] },
  { rule: 'setUniquePart', value: false, spec: '5.3', what: 'two different records with one part not refused', flips: ['group/checkpoint-set-with-two-different-part-1-records'] },
  { rule: 'checkpointFieldHasWrite', value: false, spec: '5.3', what: 'a checkpoint field with no writes accepted', flips: ['checkpoint/field-with-no-writes-is-malformed'] },
  { rule: 'newKeyDiffersFromEarlier', value: false, spec: '6.3', what: 'a record that starts an epoch may repeat the key of an epoch before the previous one', flips: ['group/epoch-new-key-equal-to-the-key-two-epochs-back-is-refused', 'group/remove-new-key-equal-to-the-key-two-epochs-back-is-refused', 'group/replace-new-key-equal-to-the-key-two-epochs-back-is-refused'] },
  { rule: 'newKeyDiffers', value: false, spec: '6.3', what: 'a record that starts an epoch may carry the previous key forward as the new one', flips: ['group/epoch-new-key-equal-to-the-previous-one-is-refused', 'group/remove-new-key-equal-to-the-previous-one-is-refused', 'group/replace-new-key-equal-to-the-previous-one-is-refused'] },
  { rule: 'kitTrailingBeforeCheck', value: false, spec: '7.2', what: 'the kit check bytes tested before the trailing bits', flips: ['kit/parse-trailing-bits-and-check-bytes-both-wrong'] },
  { rule: 'answerNeedsPlace', value: false, spec: '5.4', what: 'a purge request answered by a checkpoint that names the item at any place', flips: ['group/purge-request-checkpoint-purges-before'] },
  { rule: 'purgeUpToOwnPlace', value: false, spec: '5.4', what: 'a purge request hides every write of the item, not only those up to its own place', flips: ['group/purge-request-then-a-later-write'] },
  { rule: 'wrongShapeIsCleared', value: false, spec: 'schema 1', what: 'a value of the wrong shape used as it is', flips: ['schema/field/title/wrong-shape-is-cleared-and-kept', 'schema/field/username/wrong-shape-is-cleared-and-kept', 'schema/field/web/wrong-shape-is-cleared-and-kept'] },
  { rule: 'deletedUsesContentOnly', value: false, spec: 'schema 6', what: 'any later field, not only a content field, brings a deleted item back', flips: ['schema/deleted/second-import-sets-source-stays-deleted', 'schema/deleted/history-hidden-later-stays-deleted', 'schema/deleted/unknown-fixed-field-later-stays-deleted'] },
  { rule: 'historyHiddenApplies', value: false, spec: 'schema 4', what: 'history_hidden not applied', flips: ['schema/password/after-clear-previous-passwords', 'schema/password/checkpoint-after-clear-no-longer-carries-hidden-writes'] },
  { rule: 'previousUnique', value: false, spec: 'schema 4', what: 'an earlier write equal to the current password or to a newer entry shown as a previous password', flips: ['schema/password/previous-must-differ', 'schema/password/entry-equal-to-a-newer-entry-is-left-out', 'schema/password/import-entry-equal-to-a-write-is-left-out'] },
  { rule: 'retentionKeepsNeighbours', value: false, spec: 'schema 4', what: 'a checkpoint keeps only the writes of the entries, not the write that dates each nor the one just before the winner', flips: ['schema/password/checkpoint-keeps-the-write-that-dates-an-entry', 'schema/password/sequential-note-through-a-checkpoint-with-a-write-before-the-winner-that-is-no-entry'] },
  { rule: 'importedEditedKept', value: false, spec: 'schema 5', what: 'Edited always the latest content write, never the imported edited date', flips: ['schema/dates/imported-untouched', 'schema/dates/imported-then-source-set-again'] },
  { rule: 'positionTiesByName', value: false, spec: 'schema 1', what: 'equal positions shown in arrival order, not in order of field name', flips: ['schema/web/two-devices-add-offline-same-position', 'schema/web/same-position-three-entries-by-field-name'] },
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
