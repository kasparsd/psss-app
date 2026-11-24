// The generator's options, shared by `generate` and `set --generate`, and what they mean. The defaults and the kinds are the app's
// (App/Core/PasswordGenerator.swift): no option makes the password like Safari makes it; --length or a class option makes random
// characters; --words makes words.

import { generate, GENERATOR_LIMITS as L, RECOMMENDED_BITS } from '../../../vault/src/index.ts';
import type { Generated, GeneratorOptions, Separator } from '../../../vault/src/index.ts';
import { ValidationError } from '../errors.ts';
import type { ParsedValues } from '../config.ts';
import type { OptionSpec } from './command.ts';

export const generatorOptions: Record<string, OptionSpec> = {
  length: { type: 'string', valueName: 'n', description: `Random characters, ${L.length[0]} to ${L.length[1]} of them (default 20)` },
  symbols: { type: 'boolean', description: 'Include at least one symbol of !@#$%&*?' },
  'no-numbers': { type: 'boolean', description: 'Leave digits out' },
  'no-uppercase': { type: 'boolean', description: 'Leave capital letters out (random characters)' },
  'no-lowercase': { type: 'boolean', description: 'Leave lowercase letters out (random characters)' },
  words: { type: 'string', valueName: 'n', description: `Words from the app's word list, ${L.words[0]} to ${L.words[1]} of them (default 6 when --words is given)` },
  separator: { type: 'string', valueName: 'name', description: 'Between words: hyphen (default), space, period or none' },
  'no-capitalize': { type: 'boolean', description: 'Words in lowercase (with --words)' },
};

export const GENERATOR_FLAGS = Object.keys(generatorOptions);

export function usesGenerator(values: ParsedValues): boolean {
  return GENERATOR_FLAGS.some((f) => values[f] !== undefined && values[f] !== false);
}

function whole(name: string, text: unknown, [lo, hi]: readonly [number, number], what: string): number {
  const t = String(text).trim();
  if (/^-\d+$/.test(t)) throw new ValidationError(`--${name} ${t} is below the smallest allowed: ${what} between ${lo} and ${hi}.`);
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isSafeInteger(n)) throw new ValidationError(`--${name} needs a whole number, such as --${name} ${lo}. It got "${t.slice(0, 20)}".`);
  if (n < lo || n > hi) throw new ValidationError(`--${name} ${n} is not sensible: ${what} between ${lo} and ${hi}.`);
  return n;
}

const SEPARATORS: Record<string, Separator> = { hyphen: 'hyphen', '-': 'hyphen', space: 'space', ' ': 'space', period: 'period', '.': 'period', none: 'none', '': 'none' };

/** The generator's options from the flags. Contradictions are usage errors (exit 2) before anything is made. */
export function readGeneratorOptions(values: ParsedValues): GeneratorOptions {
  const words = values.words !== undefined;
  const characters = ['length', 'no-uppercase', 'no-lowercase'].some((f) => values[f] !== undefined && values[f] !== false);
  if (words && characters) throw new ValidationError('--words makes a passphrase, and --length, --no-uppercase and --no-lowercase are for random characters. Use one kind.');
  if (!words && values.separator !== undefined) throw new ValidationError('--separator goes between words, so it needs --words.');
  if (!words && values['no-capitalize'] === true) throw new ValidationError('--no-capitalize is for words, so it needs --words.');
  const numbers = values['no-numbers'] === true ? false : undefined;
  const symbols = values.symbols === true ? true : undefined;
  const out: GeneratorOptions = {};
  if (numbers !== undefined) out.numbers = numbers;
  if (symbols !== undefined) out.symbols = symbols;
  if (words) {
    out.kind = 'words';
    out.words = whole('words', values.words, L.words, 'a passphrase has');
    if (values.separator !== undefined) {
      const s = SEPARATORS[String(values.separator).toLowerCase()];
      if (s === undefined) throw new ValidationError(`--separator "${String(values.separator).slice(0, 20)}" is not one of: hyphen, space, period, none.`);
      out.separator = s;
    }
    if (values['no-capitalize'] === true) out.capitalize = false;
    return out;
  }
  if (characters || numbers !== undefined || symbols !== undefined) {
    out.kind = 'characters';
    if (values.length !== undefined) out.length = whole('length', values.length, L.length, 'random characters are');
    if (values['no-uppercase'] === true) out.uppercase = false;
    if (values['no-lowercase'] === true) out.lowercase = false;
    if (out.uppercase === false && out.lowercase === false && out.numbers === false && out.symbols !== true) {
      throw new ValidationError('Nothing is left to choose from: --no-uppercase, --no-lowercase and --no-numbers leave no characters. Allow one of them, or add --symbols.');
    }
  }
  return out;
}

export function makeOne(options: GeneratorOptions): Generated {
  try {
    return generate(options);
  } catch (e) {
    if (e instanceof RangeError) throw new ValidationError('That combination of options cannot make a password. Make it longer, or allow more kinds of characters.');
    throw e;
  }
}

/** The stderr line when a password is weaker than the app's recommended one, or ''. */
export function weakNote(bits: number, kind: Generated['kind'] = 'characters'): string {
  const advice = kind === 'words' ? 'Use more words.' : kind === 'characters' ? 'Make it longer, or use --words.' : 'Use the default, or --words.';
  return bits < RECOMMENDED_BITS ? `warning: that is weaker than the recommended password (about ${Math.floor(bits)} bits against ${RECOMMENDED_BITS}). ${advice}\n` : '';
}
