import { checkDelivery, deliveryJson } from './delivery.ts';
import { jsonName } from './kdbx-report.ts';
import { findItem, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import type { ItemSelector } from '../service.ts';
import { chooseItem } from './choose.ts';

const restore: Command = {
  name: 'restore',
  summary: 'Bring an item back from Recently Deleted',
  usage: 'restore <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'restore', 'item', true);
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, 'item').selector;
    const vault = await ctx.open({ changes: true });
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({ deleted: true }));
      const item = await chooseItem(ctx, vault.name, items, `Recently Deleted in ${vault.name} is empty.`);
      selector = { id: item.id };
    } else {
      selector = resolved;
    }
    const found = await findItem(ctx, svc, 'restore', selector, true);
    const item = ctx.unwrap(await svc.restore({ id: found.id }), { deleted: true });
    const delivery = await checkDelivery(ctx);
    if (hasJson(ctx.values)) {
      ctx.json({ item: { id: item.id, title: jsonName(item.title), group: jsonName(item.group) }, restored: true, delivery: deliveryJson(delivery) });
      return 0;
    }
    ctx.out(`Restored "${item.title}" from Recently Deleted.\n`);
    return 0;
  },
};

export default restore;
