import { formatReference } from '../reference.ts';
import { findItem, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import type { ItemSelector } from '../service.ts';
import { chooseItem } from './choose.ts';

const rm: Command = {
  name: 'rm',
  summary: 'Move an item to Recently Deleted (restore brings it back)',
  usage: 'rm <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  details: [
    'Nothing is destroyed and nothing is asked: the item waits in Recently Deleted, and restore undoes it.',
    'The title must match exactly; a name that matches two items lists them and exits 3. --yes is accepted and does nothing here.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'rm', 'item', true);
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, 'item').selector;
    const vault = await ctx.open();
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({}));
      const item = await chooseItem(ctx, vault.name, items, `There is nothing in ${vault.name} to remove.`);
      selector = { id: item.id };
    } else {
      selector = resolved;
    }
    const item = await findItem(ctx, svc, 'rm', selector, false);
    ctx.unwrap(await svc.delete({ id: item.id }));
    if (hasJson(ctx.values)) {
      ctx.json({ item: { id: item.id, title: item.title, group: item.group }, deleted: true });
      return 0;
    }
    ctx.out(`Moved "${item.title}" to Recently Deleted.\nBring it back with: psss restore ${formatReference({ item: { id: item.id } })}\n`);
    return 0;
  },
};

export default rm;
