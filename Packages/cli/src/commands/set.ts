import { readSecret } from '../input.ts';
import { printable } from '../text.ts';
import { formatReference, shellQuote } from '../reference.ts';
import { CliError, EXIT_FAILED, EXIT_NOT_FOUND } from '../errors.ts';
import type { GeneratorOptions } from '../../../vault/src/index.ts';
import type { Reference } from '../reference.ts';
import type { ItemSelector } from '../service.ts';
import { checkDelivery, deliveryJson } from './delivery.ts';
import { jsonName } from './kdbx-report.ts';
import { failureError, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command, CommandContext } from './command.ts';
import { ValidationError } from '../errors.ts';
import { generatorOptions, makeOne, readGeneratorOptions, usesGenerator, weakNote } from './generator-options.ts';

const set: Command = {
  name: 'set',
  summary: 'Save one value, read from standard input or typed without echo',
  usage: 'set [--create] [--generate [--force]] <reference> [--json]',
  options: {
    create: { type: 'boolean', description: 'Add the item when no item has that title' },
    generate: { type: 'boolean', description: "Make the value inside psss with the app's generator; prints only the reference, never the value" },
    force: { type: 'boolean', description: 'With --generate: replace a value the field already has (the earlier one is kept)' },
    ...generatorOptions,
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  ownMissingMessage: true,
  details: [
    'The value is never an argument and there is no --value flag: arguments show in process lists and shell history.',
    'Not a terminal: all of standard input, with one trailing line break removed.',
    'A terminal: asked without echo.',
    'A title that does not exist is an error (exit 3) unless --create is given, so a typo does not add a stray item.',
    'The earlier value of a field is kept under previous values. Setting the value a field already holds changes nothing: it says so and writes no record.',
    '--generate makes the value instead of reading one: it is made and saved inside psss, and standard output carries only the reference, such as psss://Example API/token.',
    'A field that already has a value is not replaced unless --force is given; the earlier value is then kept under previous values, and standard error says so.',
    'The generator options are those of psss generate (--length, --words, --symbols and so on). With --generate nothing is read from standard input: whatever is piped in is ignored.',
  ],
  async run(ctx) {
    if (ctx.positionals.length === 0) throw missingReferenceError(ctx, 'set', 'field', false);
    const { ref, selector } = resolveReference(ctx, ctx.positionals[0], 'field');
    const generating = ctx.values.generate === true;
    if (!generating && (usesGenerator(ctx.values) || ctx.values.force === true)) {
      throw new ValidationError('--length, --words, --symbols, --force and the other generator options only work with --generate.');
    }
    const generatorChoice = generating ? readGeneratorOptions(ctx.values) : undefined;
    if (ref.field === undefined) throw new ValidationError('A reference for set names a field, such as "psss://Example API/token".');
    const vault = await ctx.open({ changes: true });
    const svc = await ctx.service();
    const create = ctx.values.create === true;
    if (!create) {
      const found = await svc.find(selector);
      if (!found.ok && found.kind === 'notFound' && found.what === 'item' && found.by !== 'id') {
        const did = found.hints && found.hints.length > 0 ? `\nDid you mean: ${found.hints.map((h) => printable(h)).join(', ')}?` : '';
        const again = `psss set --create ${shellQuote(formatReference(ref))}`;
        throw new CliError(`There is no item called "${printable(found.name)}" in ${vault.name}.${did}\nTo add it as a new item, run: ${again}`, EXIT_NOT_FOUND);
      }
      if (!found.ok) throw failureError(ctx.io, found);
    }
    if (generatorChoice !== undefined) return generateInto(ctx, vault.name, selector, ref, generatorChoice, create);
    const value = await readSecret(ctx.io, 'Value (not shown): ');
    const done = ctx.unwrap(await svc.set(selector, ref.field, value, { create }));
    if (done.unchanged === true) {
      // nothing was written: no record, no history row, nothing to deliver
      if (hasJson(ctx.values)) {
        ctx.json({ item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) }, field: jsonName(done.field), itemCreated: false, previousKept: false, unchanged: true, delivery: deliveryJson(await checkDelivery(ctx)) });
        return 0;
      }
      ctx.out('Nothing changed.\n');
      await checkDelivery(ctx);
      return 0;
    }
    const delivery = await checkDelivery(ctx);
    if (hasJson(ctx.values)) {
      ctx.json({
        item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) },
        field: jsonName(done.field),
        itemCreated: done.itemCreated,
        previousKept: done.previousKept,
        delivery: deliveryJson(delivery),
      });
      return 0;
    }
    let text = `Saved "${printable(done.field)}" in ${printable(done.item.title)} (${vault.name}).\n`;
    if (done.itemCreated) text += `There was no item with that title, so it was added (--create).\n`;
    if (done.previousKept) text += 'The earlier value is kept under previous values.\n';
    ctx.out(text);
    return 0;
  },
};

/** `set --generate`: the value is made here, saved, and never printed. Standard output is the reference and nothing else. */
async function generateInto(ctx: CommandContext, vaultName: string, selector: ItemSelector, ref: Reference, choice: GeneratorOptions, create: boolean): Promise<number> {
  const svc = await ctx.service();
  const made = makeOne(choice);
  const done = ctx.unwrap(await svc.set(selector, ref.field!, made.value, { create, onlyIfEmpty: ctx.values.force !== true }));
  if (done.refusedExisting === true) {
    throw new CliError(
      `"${printable(done.item.title)}" already has a value for "${printable(done.field)}". Nothing was changed.\nTo replace it with a new one, add --force. The earlier value is kept under previous values.`,
      EXIT_FAILED,
    );
  }
  const delivery = await checkDelivery(ctx);
  const named: Reference = {
    ...(ref.group !== undefined ? { group: ref.group } : {}),
    item: 'id' in ref.item || done.item.title === '' ? { id: done.item.id } : { title: done.item.title },
    field: done.field,
  };
  const reference = formatReference(named);
  const weak = weakNote(made.bits, made.kind);
  if (weak) ctx.err(weak);
  if (done.previousKept) ctx.err('The earlier value is kept under previous values.\n');
  if (hasJson(ctx.values)) {
    ctx.json({
      reference,
      item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) },
      field: jsonName(done.field),
      generated: true,
      bits: Math.round(made.bits * 10) / 10,
      itemCreated: done.itemCreated,
      previousKept: done.previousKept,
      delivery: deliveryJson(delivery),
    });
    return 0;
  }
  if (ctx.io.isTTY.stderr === true) ctx.err(`Made a new "${printable(done.field)}" for ${printable(done.item.title || 'the item')} in ${vaultName} (about ${Math.floor(made.bits)} bits).\n`);
  ctx.out(`${reference}\n`);
  return 0;
}

export default set;
