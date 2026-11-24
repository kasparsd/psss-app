// The password generator of the command line. It mirrors the app's (App/Core/PasswordGenerator.swift, AppleStyle.swift, GeneratorSettings.swift,
// WordList.swift); test/generator.test.ts reads those Swift files and fails when a constant here drifts from them.
//
// The only randomness is `pick(bound)`, which defaults to `crypto.randomInt` (rejection sampling, no modulo bias). Nothing here prints or stores a value.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type Pick = (bound: number) => number;
export const systemPick: Pick = (bound) => randomInt(bound);

export type GeneratorKind = 'apple' | 'characters' | 'words';
export type Separator = 'hyphen' | 'space' | 'period' | 'none';

export interface GeneratorOptions {
  /** `apple` (the default: like Safari makes), random `characters`, or `words` */
  kind?: GeneratorKind;
  /** characters: the length, default 20 */
  length?: number;
  /** words: how many, default 6 */
  words?: number;
  /** characters and words: at least one digit (default true) */
  numbers?: boolean;
  /** characters and words: at least one symbol of `!@#$%&*?` (default false) */
  symbols?: boolean;
  /** characters: at least one capital letter and lowercase letter (default true each) */
  uppercase?: boolean;
  lowercase?: boolean;
  separator?: Separator;
  capitalize?: boolean;
}

export interface Generated { value: string; kind: GeneratorKind; bits: number }

/** What the app allows is 12 to 64 characters and 4 to 7 words; the command line allows more, since a site or an API can ask for it. */
export const LIMITS = { length: [8, 128], words: [4, 16], count: [1, 1000] } as const;
export const APP_DEFAULTS = { length: 20, words: 6, numbers: true, symbols: false, separator: 'hyphen' as Separator, capitalize: true };
export const RECOMMENDED_BITS = 71;

export const CONSONANTS = 'bcdfghjkmnpqrstvwxz';
export const VOWELS = 'aeiouy';
export const DIGIT_SLOTS = [5, 6, 11, 12, 17];
export const GROUP_LENGTH = 6;
export const LOOKALIKES = 'IlO01o';
export const SYMBOLS = '!@#$%&*?';
const LOWER = 'abcdefghijklmnopqrstuvwxyz', UPPER = LOWER.toUpperCase(), DIGITS = '0123456789';
const without = (s: string, drop: string) => [...s].filter((c) => !drop.includes(c)).sort();

let words: string[] | undefined;
/** The EFF long list the app bundles (`src/wordlist.txt` is a copy of App/Core/EFFLongWordList.txt, kept equal by a test). */
export function wordList(): string[] {
  if (words) return words;
  const seen = new Set<string>();
  for (const line of readFileSync(new URL('./wordlist.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
    const w = line.trim();
    if (w === '' || w.startsWith('#')) continue;
    if (!/^[a-z]{2,12}$/.test(w)) throw new Error('the word list is damaged');
    seen.add(w);
  }
  if (seen.size < 7000) throw new Error('the word list is damaged');
  return (words = [...seen]);
}

const at = <T>(list: ArrayLike<T>, pick: Pick): T => list[pick(list.length)]!;
const log2 = Math.log2;

/** Bits of the draw alone for three groups: 71.97, as AppleStyle.bits(groups: 3). */
export function appleBits(groups = 3): number {
  const syllable = log2(CONSONANTS.length * VOWELS.length * CONSONANTS.length);
  return 2 * groups * syllable - log2(CONSONANTS.length) + log2(10) + log2(DIGIT_SLOTS.length) + log2(groups * GROUP_LENGTH - 1);
}

let terms: string[] | undefined;
const normalized = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The terms an Apple-style password must not hold (`src/offensive-terms.txt` is a copy of App/Core/OffensiveTerms.txt, kept equal by a test; as in
 *  App/Core/OffensiveFilter.swift, a line starting with # is a comment, a term under three characters is ignored, and the list may be empty). */
export function offensiveTerms(): string[] {
  if (terms) return terms;
  const seen = new Set<string>();
  for (const line of readFileSync(new URL('./offensive-terms.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith('#')) continue;
    const n = normalized(l);
    if (n.length >= 3) seen.add(n);
  }
  return (terms = [...seen]);
}
/** True when the text, with everything but letters and digits dropped, holds a term: across a hyphen, never across a digit. */
export const rejects = (candidate: string, list: readonly string[] = offensiveTerms()): boolean => {
  if (list.length === 0) return false;
  const t = normalized(candidate);
  return list.some((x) => t.includes(x));
};

/** SplitMix64 as the app's `FixedRandomSource`: a fixed source for the estimate below, never used to make a password. */
function splitMix(seed: bigint): Pick {
  let state = seed;
  const M = (1n << 64n) - 1n;
  const next = () => {
    state = (state + 0x9e3779b97f4a7c15n) & M;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
    return z ^ (z >> 31n);
  };
  return (bound) => Number(next() % BigInt(bound));
}
let rate: number | undefined;
/** The share of drafts the list lets through (1 for an empty list). Redrawing the rest costs log2 of it in bits. Estimated once from a fixed sample. */
function acceptanceRate(): number {
  if (rate !== undefined) return rate;
  const list = offensiveTerms();
  if (list.length === 0) return (rate = 1);
  const fixed = splitMix(0xa11cen);
  let accepted = 0;
  for (let i = 0; i < 10_000; i++) if (!rejects(draft(fixed), list)) accepted++;
  return (rate = Math.max(accepted, 1) / 10_000);
}

function draft(pick: Pick): string {
  const count = 3 * GROUP_LENGTH;
  const c: string[] = [];
  for (let i = 0; i < count; i++) c.push(i % 3 === 1 ? at(VOWELS, pick) : at(CONSONANTS, pick));
  const slot = at(DIGIT_SLOTS, pick);
  c[slot] = String(pick(10));
  const choice = pick(count - 1);
  const up = choice < slot ? choice : choice + 1;
  c[up] = c[up]!.toUpperCase();
  return [0, 1, 2].map((g) => c.slice(g * GROUP_LENGTH, (g + 1) * GROUP_LENGTH).join('')).join('-');
}

function apple(pick: Pick): Generated {
  let value = draft(pick);
  while (rejects(value)) value = draft(pick); // like the app: a draft that spells something offensive is drawn again
  return { value, kind: 'apple', bits: appleBits() + log2(acceptanceRate()) };
}

function characters(o: Required<Pick2<GeneratorOptions, 'length' | 'numbers' | 'symbols' | 'uppercase' | 'lowercase'>>, pick: Pick): Generated {
  const lower = without(LOWER, LOOKALIKES), upper = without(UPPER, LOOKALIKES);
  let base = [...(o.lowercase ? lower : []), ...(o.uppercase ? upper : [])];
  if (base.length === 0) base = o.numbers ? without(DIGITS, LOOKALIKES) : o.symbols ? [...SYMBOLS].sort() : [];
  if (base.length === 0) throw new RangeError('nothing to choose from');
  const placements: string[][] = [];
  if (o.lowercase) placements.push(lower);
  if (o.uppercase) placements.push(upper);
  if (o.numbers) placements.push(without(DIGITS, LOOKALIKES));
  if (o.symbols) placements.push([...SYMBOLS].sort());
  const fixed = placements.length;
  if (fixed > o.length) throw new RangeError('too short');
  const out: string[] = new Array(o.length);
  const positions = Array.from({ length: o.length }, (_, i) => i);
  for (let i = 0; i < fixed; i++) { const j = i + pick(o.length - i); [positions[i], positions[j]] = [positions[j]!, positions[i]!]; }
  const taken = new Set<number>();
  placements.forEach((set, i) => { taken.add(positions[i]!); out[positions[i]!] = at(set, pick); });
  for (let i = 0; i < o.length; i++) if (!taken.has(i)) out[i] = at(base, pick);
  const bits = placements.reduce((s, p) => s + log2(p.length), 0) + (o.length - fixed) * log2(base.length);
  return { value: out.join(''), kind: 'characters', bits };
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

const SEPARATORS: Record<Separator, string> = { hyphen: '-', space: ' ', period: '.', none: '' };

function passphrase(o: { words: number; numbers: boolean; symbols: boolean; separator: Separator; capitalize: boolean }, pick: Pick): Generated {
  const list = wordList();
  const chosen: string[] = [];
  for (let i = 0; i < o.words; i++) chosen.push(at(list, pick));
  const tails = new Array<string>(o.words).fill('');
  let bits = o.words * log2(list.length);
  const attach = (sets: string[][]) => {
    let block = '';
    for (const s of sets) { block += at(s, pick); bits += log2(s.length); }
    tails[pick(o.words)] += block; bits += log2(o.words);
  };
  if (o.numbers) attach([without(DIGITS, LOOKALIKES)]);
  if (o.symbols) attach([[...SYMBOLS].sort()]);
  const value = chosen.map((w, i) => (o.capitalize ? w[0]!.toUpperCase() + w.slice(1) : w) + tails[i]).join(SEPARATORS[o.separator]);
  return { value, kind: 'words', bits };
}

/** One password. Throws a RangeError for a length, word count or set of classes that cannot make one. */
export function generate(options: GeneratorOptions = {}, pick: Pick = systemPick): Generated {
  const kind = options.kind ?? 'apple';
  const numbers = options.numbers ?? APP_DEFAULTS.numbers, symbols = options.symbols ?? APP_DEFAULTS.symbols;
  if (kind === 'apple') return apple(pick);
  if (kind === 'words') {
    const n = options.words ?? APP_DEFAULTS.words;
    if (!Number.isInteger(n) || n < LIMITS.words[0] || n > LIMITS.words[1]) throw new RangeError('words');
    return passphrase({ words: n, numbers, symbols, separator: options.separator ?? APP_DEFAULTS.separator, capitalize: options.capitalize ?? APP_DEFAULTS.capitalize }, pick);
  }
  const length = options.length ?? APP_DEFAULTS.length;
  if (!Number.isInteger(length) || length < LIMITS.length[0] || length > LIMITS.length[1]) throw new RangeError('length');
  return characters({ length, numbers, symbols, uppercase: options.uppercase ?? true, lowercase: options.lowercase ?? true }, pick);
}
