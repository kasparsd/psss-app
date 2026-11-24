import { CliError, EXIT_NOT_FOUND, ValidationError } from '../errors.ts';
import { formatReference } from '../reference.ts';
import { printable } from '../text.ts';
import { chooseItem } from './choose.ts';
import { failureError, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import { jsonName } from './kdbx-report.ts';
import type { ItemSelector } from '../service.ts';

const code: Command = {
  name: 'code',
  summary: 'Print the current verification code of an item',
  usage: 'code <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  details: [
    'Prints the six-digit (or longer) code and a line break on standard output, and nothing else. The setup key behind it is never printed.',
    'In a terminal, standard error says how many seconds the code is still valid. --json gives { code, period, remaining } and the item.',
    'Takes the item, "psss://Example Bank", or its code field, "psss://Example Bank/code".',
    'An item with no verification code exits 3; a stored field that is only called "code" is not one. A title matches exactly, ignoring case; a name that matches two items lists them and exits 3.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'code', 'item', true);
    const kind = typed !== undefined && typed.startsWith('psss://') && typed.slice('psss://'.length).includes('/') ? 'field' : 'item';
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, kind);
    if (resolved?.ref.field !== undefined && resolved.ref.field.toLowerCase() !== 'code') {
      throw new ValidationError('code makes the verification code of an item. Use: psss code "psss://Example Bank"\nA group goes in --group, not in the reference.');
    }
    const vault = await ctx.open();
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({})).filter((i) => i.hasCode === true);
      const item = await chooseItem(ctx, vault.name, items, `No item in ${vault.name} has a verification code.`);
      selector = { id: item.id };
    } else {
      selector = resolved.selector;
    }
    const got = await svc.code(selector);
    if (!got.ok && got.kind === 'notFound' && got.what === 'field') {
      const has = got.fields && got.fields.length > 0 ? `\nIt has: ${got.fields.map((f) => printable(f)).join(', ')}.` : '';
      const name = got.item === undefined ? 'That item' : printable(got.item);
      // a stored field called "code" is a value; there is no command that turns it into a code, the app adds a setup key
      const plain = (got.fields ?? []).some((f) => f.toLowerCase() === 'code')
        ? `\nIts field called "code" is a stored value, not a verification code, and the item has no setup key. To make one, add a verification code to the item in the Psss app.`
        : '';
      throw new CliError(`"${name}" has no verification code.${plain}${has}`, EXIT_NOT_FOUND);
    }
    if (!got.ok) throw failureError(ctx.io, got, { field: 'code' });
    const { item, code: value, period, remaining } = got.value;
    if (hasJson(ctx.values)) {
      ctx.json({
        reference: formatReference({ item: { id: item.id }, field: 'code' }),
        item: { id: item.id, title: jsonName(item.title), group: jsonName(item.group) },
        code: value,
        period,
        remaining,
      });
      return 0;
    }
    ctx.out(`${value}\n`);
    if (ctx.io.isTTY.stderr === true) ctx.err(`Valid for ${remaining} more ${remaining === 1 ? 'second' : 'seconds'}.\n`);
    return 0;
  },
};

export default code;
