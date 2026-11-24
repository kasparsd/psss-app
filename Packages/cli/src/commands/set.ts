import { readSecret } from '../input.ts';
import { printable } from '../text.ts';
import { formatReference, shellQuote } from '../reference.ts';
import { CliError, EXIT_NOT_FOUND } from '../errors.ts';
import { checkDelivery, deliveryJson } from './delivery.ts';
import { jsonName } from './kdbx-report.ts';
import { failureError, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import { ValidationError } from '../errors.ts';

const set: Command = {
  name: 'set',
  summary: 'Save one value, read from standard input or typed without echo',
  usage: 'set [--create] <reference> [--json]',
  options: {
    create: { type: 'boolean', description: 'Add the item when no item has that title' },
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'The value is never an argument and there is no --value flag: arguments show in process lists and shell history.',
    'Not a terminal: all of standard input, with one trailing line break removed.',
    'A terminal: asked without echo.',
    'A title that does not exist is an error (exit 3) unless --create is given, so a typo does not add a stray item.',
    'The earlier value of a field is kept under previous values.',
  ],
  async run(ctx) {
    if (ctx.positionals.length === 0) throw missingReferenceError(ctx, 'set', 'field', false);
    const { ref, selector } = resolveReference(ctx, ctx.positionals[0], 'field');
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
    const value = await readSecret(ctx.io, 'Value (not shown): ');
    const done = ctx.unwrap(await svc.set(selector, ref.field, value, { create }));
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

export default set;
