import { formatReference } from '../reference.ts';
import { hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import { chooseField, chooseItem } from './choose.ts';
import { ValidationError } from '../errors.ts';
import type { ItemSelector } from '../service.ts';

const get: Command = {
  name: 'get',
  summary: 'Print one value, bare, so it can fill a variable or a file',
  usage: 'get <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  details: [
    'Prints the value and nothing else. In a terminal it ends with a line break; into a pipe or a file it does not,',
    'so the file holds exactly the value. --json is the only output that carries a value in a structure.',
    'With no reference, a terminal offers a short list. With no terminal, or with CI set, it fails with exit 2.',
    'A title matches exactly, ignoring case. A name that matches two items lists them by id and exits 3; a near miss exits 3 with hints.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'get', 'field', true);
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, 'field');
    if (resolved && resolved.ref.field === undefined) {
      throw new ValidationError('A reference for get names a field, such as "psss://Example API/token".');
    }
    const vault = await ctx.open();
    const svc = await ctx.service();
    let selector: ItemSelector;
    let field: string;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({}));
      const item = await chooseItem(ctx, vault.name, items, `There is nothing in ${vault.name} yet.\nAdd something with: psss set "psss://Example API/token"`);
      field = await chooseField(ctx, item);
      selector = { id: item.id };
    } else {
      field = resolved.ref.field!;
      selector = resolved.selector;
    }
    const found = ctx.unwrap(await svc.get(selector, field), { field });
    if (hasJson(ctx.values)) {
      ctx.json({
        reference: formatReference({ item: { id: found.item.id }, field: found.field }),
        item: { id: found.item.id, title: found.item.title, group: found.item.group },
        field: found.field,
        value: found.value,
      });
    } else {
      ctx.out(ctx.io.isTTY.stdout ? `${found.value}\n` : found.value);
    }
    return 0;
  },
};

export default get;
