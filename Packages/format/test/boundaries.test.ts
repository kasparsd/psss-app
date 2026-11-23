// Mutation test for the numeric boundaries of the specification. For each boundary the table below moves one limit by one step
// in each direction and checks that the vectors named for that side stop passing. A boundary no vector notices is a boundary an
// implementation can get wrong without anyone seeing it. README.md ("Numeric boundaries") lists the same table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limits, defaults } from '../src/limits.ts';
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
  { name: 'Hold back more than 24 hours ahead', spec: '4.5', limit: 'holdBackMs', mutations: [
    { limit: 'holdBackMs', delta: 1, flips: ['clock/held-back/one-ms-over', 'group/held-back-one-ms-over'] },
    { limit: 'holdBackMs', delta: -1, flips: ['clock/held-back/exactly-24h', 'group/held-back-exactly-24h'] }] },
  { name: 'CBOR nesting of 16 levels', spec: '2', limit: 'maxDepth', mutations: [
    { limit: 'maxDepth', delta: 1, flips: ['cbor/reject/depth-17-arrays', 'cbor/reject/depth-17-maps'] },
    { limit: 'maxDepth', delta: -1, flips: ['cbor/accept/depth-16-arrays', 'cbor/accept/depth-16-maps'] }] },
  { name: 'Argon2id at least 65,536 KiB', spec: '7.2', limit: 'argonMinMemory', mutations: [
    { limit: 'argonMinMemory', delta: 1, flips: ['slot/argon2-at-minimum'] },
    { limit: 'argonMinMemory', delta: -1, flips: ['slot/argon2-memory-one-below-minimum'] }] },
  { name: 'Argon2id at least 2 passes', spec: '7.2', limit: 'argonMinPasses', mutations: [
    { limit: 'argonMinPasses', delta: 1, flips: ['slot/argon2-at-minimum'] },
    { limit: 'argonMinPasses', delta: -1, flips: ['slot/argon2-passes-one-below-minimum'] }] },
  { name: 'Argon2id at most 1,048,576 KiB', spec: '7.2', limit: 'argonMaxMemory', mutations: [
    { limit: 'argonMaxMemory', delta: 1, flips: ['slot/argon2-memory-one-above-maximum', 'slot/argon2-test-switch-keeps-upper-limits'] },
    { limit: 'argonMaxMemory', delta: -1, flips: ['slot/argon2-at-maximum-memory'] }] },
  { name: 'Argon2id at most 16 passes', spec: '7.2', limit: 'argonMaxPasses', mutations: [
    { limit: 'argonMaxPasses', delta: 1, flips: ['slot/argon2-passes-one-above-maximum'] },
    { limit: 'argonMaxPasses', delta: -1, flips: ['slot/argon2-at-maximum-passes'] }] },
  { name: 'Argon2id at most 16 lanes', spec: '7.2', limit: 'argonMaxLanes', mutations: [
    { limit: 'argonMaxLanes', delta: 1, flips: ['slot/argon2-lanes-one-above-maximum'] },
    { limit: 'argonMaxLanes', delta: -1, flips: ['slot/argon2-at-maximum-lanes'] }] },
  { name: 'Segment rotation at 65,536 bytes', spec: '8.1', limit: 'segmentLimit', mutations: [
    { limit: 'segmentLimit', delta: 1, flips: ['folder/rotate-after-65536-bytes'] },
    { limit: 'segmentLimit', delta: -1, flips: ['folder/rotate-after-65535-bytes'] }] },
  { name: 'Attachment chunk of 1,048,576 bytes', spec: '5.2', limit: 'chunkSize', mutations: [
    { limit: 'chunkSize', delta: 1, flips: ['attachment/one-chunk-and-a-byte', 'attachment/last-chunk-too-long'] },
    { limit: 'chunkSize', delta: -1, flips: ['attachment/exactly-one-chunk', 'attachment/two-full-chunks'] }] },
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
