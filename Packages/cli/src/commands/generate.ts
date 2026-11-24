import { ValidationError } from '../errors.ts';
import { GENERATOR_LIMITS as L } from '../../../vault/src/index.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';
import { generatorOptions, makeOne, readGeneratorOptions, weakNote } from './generator-options.ts';

const generate: Command = {
  name: 'generate',
  summary: "Make a password with the app's generator and print it",
  usage: 'generate [--length <n> | --words <n>] [--symbols] [--no-numbers] [--count <n>] [--json]',
  options: {
    ...generatorOptions,
    count: { type: 'string', valueName: 'n', description: `How many to make, ${L.count[0]} to ${L.count[1]} (default 1), one a line` },
    ...jsonOption,
  },
  args: { min: 0, max: 0 },
  details: [
    'Prints the password and a line break on standard output, and nothing else. It never opens or writes the vault.',
    'With no options it makes the same password the app does: three groups of six letters joined by hyphens, one digit and one capital (about 72 bits).',
    '--length or a class option makes random characters (a capital and a lowercase letter always, a digit unless --no-numbers, a symbol with --symbols,',
    'never I l O o 0 1). --words makes words from the app\'s list. Every draw comes from the system\'s secure random generator.',
    'To make a value and save it without ever seeing it, use: psss set --generate "psss://Example API/token"',
  ],
  async run(ctx) {
    const options = readGeneratorOptions(ctx.values);
    const raw = ctx.values.count;
    let count = 1;
    if (raw !== undefined) {
      const t = String(raw).trim();
      if (/^-\d+$/.test(t)) throw new ValidationError(`--count ${t} is below the smallest allowed: make between ${L.count[0]} and ${L.count[1]}.`);
      count = /^\d+$/.test(t) ? Number(t) : NaN;
      if (!Number.isSafeInteger(count)) throw new ValidationError(`--count needs a whole number, such as --count 5. It got "${t.slice(0, 20)}".`);
      if (count < L.count[0] || count > L.count[1]) throw new ValidationError(`--count ${count} is not sensible: make between ${L.count[0]} and ${L.count[1]}.`);
    }
    const made = Array.from({ length: count }, () => makeOne(options));
    const note = weakNote(made[0]!.bits, made[0]!.kind);
    if (note) ctx.err(note);
    if (hasJson(ctx.values)) {
      ctx.json({ kind: made[0]!.kind, bits: Math.round(made[0]!.bits * 10) / 10, count, values: made.map((m) => m.value) });
      return 0;
    }
    ctx.out(`${made.map((m) => m.value).join('\n')}\n`);
    return 0;
  },
};

export default generate;
