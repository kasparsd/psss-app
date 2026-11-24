// The generator mirrors the app's (App/Core): these tests read the Swift source and fail when a constant here drifts from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appleBits, generate, wordList } from '../src/index.ts';
import { CONSONANTS, DIGIT_SLOTS, GROUP_LENGTH, LOOKALIKES, SYMBOLS, VOWELS } from '../src/generator.ts';

const swift = (name: string) => readFileSync(new URL(`../../../App/Core/${name}`, import.meta.url), 'utf8');

test('the word list is the app\'s file, byte for byte, and reads as the app reads it', () => {
  const app = readFileSync(new URL('../../../App/Core/EFFLongWordList.txt', import.meta.url));
  const copy = readFileSync(new URL('../src/wordlist.txt', import.meta.url));
  assert.ok(app.equals(copy), 'Packages/vault/src/wordlist.txt must equal App/Core/EFFLongWordList.txt: copy the file again');
  assert.equal(wordList().length, 7772, 'the app counts 7,772 words');
  assert.ok(wordList().every((w) => /^[a-z]{2,12}$/.test(w)));
});

test('the constants equal the ones in the Swift source', () => {
  const style = swift('AppleStyle.swift'), gen = swift('PasswordGenerator.swift'), set = swift('GeneratorSettings.swift');
  assert.equal(/static let consonants = Array\("([a-z]+)"\)/.exec(style)?.[1], CONSONANTS, 'consonants');
  assert.equal(/static let vowels = Array\("([a-z]+)"\)/.exec(style)?.[1], VOWELS, 'vowels');
  assert.deepEqual(JSON.parse(/static let digitSlots = (\[[^\]]+\])/.exec(style)![1]!), DIGIT_SLOTS, 'digit slots');
  assert.equal(Number(/static let groupLength = (\d+)/.exec(style)![1]), GROUP_LENGTH, 'group length');
  const looks = /lookalikes: Set<Character> = \[([^\]]+)\]/.exec(gen)![1]!.match(/"(.)"/g)!.map((s) => s[1]).sort().join('');
  assert.equal([...LOOKALIKES].sort().join(''), looks, 'look-alikes');
  assert.equal(/fixedSymbols = Set\("([^"]+)"\)/.exec(gen)![1], SYMBOLS, 'symbols');
  assert.match(set, /var words = 6/); assert.match(set, /var length = 20/);
  assert.match(set, /var includeNumber = true/); assert.match(set, /var includeSymbol = false/);
  assert.match(set, /var separator = Separator\.hyphen/); assert.match(set, /var capitalize = true/);
  assert.ok(Math.abs(appleBits() - 71.97) < 0.01, 'the default carries 71.97 bits');
});

test('the default is the app\'s Safari-like password: three groups of six, two hyphens, one digit, one capital', () => {
  for (let i = 0; i < 500; i++) {
    const g = generate();
    assert.equal(g.kind, 'apple');
    assert.match(g.value, /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/);
    assert.equal(g.value.replace(/[^0-9]/g, '').length, 1, 'exactly one digit');
    assert.equal(g.value.replace(/[^A-Z]/g, '').length, 1, 'exactly one capital');
    const slot = g.value.replaceAll('-', '').search(/[0-9]/);
    assert.ok(DIGIT_SLOTS.includes(slot), `the digit sits in one of the five slots, not ${slot}`);
  }
});

test('random characters keep every class they promise, and never use a look-alike', () => {
  for (let i = 0; i < 400; i++) {
    const g = generate({ kind: 'characters', symbols: true, length: 12 + (i % 20) });
    assert.match(g.value, /[a-z]/); assert.match(g.value, /[A-Z]/); assert.match(g.value, /[0-9]/); assert.match(g.value, /[!@#$%&*?]/);
    assert.ok(![...g.value].some((c) => LOOKALIKES.includes(c)), 'no I l O o 0 1');
  }
  const noDigits = generate({ kind: 'characters', numbers: false, length: 30 }).value;
  assert.doesNotMatch(noDigits, /[0-9]|[^A-Za-z]/);
  assert.match(generate({ kind: 'characters', uppercase: false, numbers: false, length: 30 }).value, /^[a-z]+$/);
  assert.equal(generate({ kind: 'characters', length: 128 }).value.length, 128);
});

test('words: the count, the separator, capitals and a digit', () => {
  const g = generate({ kind: 'words', words: 5 });
  assert.match(g.value, /^([A-Z][a-z]+[0-9]?-){4}[A-Z][a-z]+[0-9]?$/);
  assert.equal(g.value.replace(/[^0-9]/g, '').length, 1);
  assert.match(generate({ kind: 'words', words: 4, separator: 'space', capitalize: false, numbers: false }).value, /^[a-z]+( [a-z]+){3}$/);
  assert.match(generate({ kind: 'words', words: 4, separator: 'none', numbers: false }).value, /^([A-Z][a-z]+){4}$/);
  assert.ok(Math.abs(generate({ kind: 'words', words: 6, numbers: false }).bits - 6 * Math.log2(7772)) < 1e-9);
});

test('silly sizes are refused', () => {
  for (const o of [{ length: 7 }, { length: 129 }, { length: 12.5 }, { length: NaN }] as const) assert.throws(() => generate({ kind: 'characters', ...o }), RangeError);
  for (const w of [3, 17, 2.5]) assert.throws(() => generate({ kind: 'words', words: w }), RangeError);
  assert.throws(() => generate({ kind: 'characters', uppercase: false, lowercase: false, numbers: false }), RangeError, 'no class at all');
});

test('every draw goes through the injected pick with an exact bound: no modulo, no Math.random', () => {
  const bounds = new Set<number>();
  generate({ kind: 'characters', symbols: true }, (b) => { bounds.add(b); return b - 1; });
  generate({}, (b) => { bounds.add(b); return 0; });
  generate({ kind: 'words' }, (b) => { bounds.add(b); return 0; });
  assert.ok(bounds.has(7772) && bounds.has(19) && bounds.has(6) && bounds.has(24) && bounds.has(8));
  for (const f of ['generator.ts']) assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /Math\.random/);
});

test('the system draw is uniform: a chi-square check over the characters and over every position of the Safari-like digit', () => {
  const N = 120_000;
  const counts = new Map<string, number>();
  const slots = new Map<number, number>();
  for (let i = 0; i < N / 20; i++) {
    for (const c of generate({ kind: 'characters', length: 20, numbers: false }).value) counts.set(c, (counts.get(c) ?? 0) + 1);
    const a = generate().value.replaceAll('-', '');
    slots.set(a.search(/[0-9]/), (slots.get(a.search(/[0-9]/)) ?? 0) + 1);
  }
  // letters only: 24 lower and 24 upper, minus the two guaranteed placements per password (which draw from 24 each): a letter's expected share is near 1/48
  assert.equal(counts.size, 48);
  const total = [...counts.values()].reduce((a, b) => a + b, 0), expect = total / 48;
  const chi = [...counts.values()].reduce((s, c) => s + (c - expect) ** 2 / expect, 0);
  assert.ok(chi < 47 * 3, `chi-square ${chi.toFixed(1)} over 47 degrees of freedom suggests a bias`);
  assert.equal(slots.size, 5);
  const n = [...slots.values()].reduce((a, b) => a + b, 0);
  for (const [slot, c] of slots) assert.ok(Math.abs(c / n - 0.2) < 0.02, `digit slot ${slot} came up ${(c / n * 100).toFixed(1)}% of the time`);
});

test('the offensive-terms list is the app\'s file, and a draft holding a term is refused the way the app refuses it', async () => {
  const app = readFileSync(new URL('../../../App/Core/OffensiveTerms.txt', import.meta.url));
  const copy = readFileSync(new URL('../src/offensive-terms.txt', import.meta.url));
  assert.ok(app.equals(copy), 'Packages/vault/src/offensive-terms.txt must equal App/Core/OffensiveTerms.txt: copy the file again');
  const { rejects, offensiveTerms } = await import('../src/generator.ts');
  assert.deepEqual(offensiveTerms(), [], 'the app\'s list is empty today, so nothing is rejected');
  // the rule of OffensiveFilter.swift, with a list of our own: found across a hyphen and in any case, broken by a digit, terms under 3 characters ignored
  assert.equal(rejects('xxBa-Mzz', ['bam']), true);
  assert.equal(rejects('xxBa7mzz', ['bam']), false);
  assert.equal(rejects('anything', []), false);
  assert.equal(generate({}, (n) => n - 1 < 0 ? 0 : (n * 7 + 3) % n).kind, 'apple');
});
