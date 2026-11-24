import { ValidationError } from '../errors.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';
import { itemJson, itemLines } from './item-lines.ts';
import { jsonName } from './kdbx-report.ts';

const list: Command = {
  name: 'list',
  summary: 'List item names, accounts and field names, never values',
  usage: 'list [group] [--deleted] [--json]',
  options: {
    deleted: { type: 'boolean', description: 'List Recently Deleted instead' },
    ...jsonOption,
  },
  args: { min: 0, max: 1 },
  async run(ctx) {
    const positional = ctx.positionals[0];
    const flag = ctx.settings.group;
    if (positional !== undefined && flag !== undefined && positional.toLowerCase() !== flag.toLowerCase()) {
      throw new ValidationError(`The group "${positional}" and --group (or PSSS_GROUP) "${flag}" disagree. Use one of them.`);
    }
    const vault = await ctx.open();
    const svc = await ctx.service();
    const deleted = ctx.values.deleted === true;
    const items = ctx.unwrap(await svc.list({ group: positional ?? flag, deleted }));
    items.sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));

    if (hasJson(ctx.values)) {
      ctx.json({
        items: items.map((i) => itemJson(i, jsonName)),
      });
      return 0;
    }
    if (items.length === 0) {
      ctx.out(
        deleted
          ? `Recently Deleted in ${vault.name} is empty.\n`
          : `There is nothing in ${vault.name} yet.\nAdd something with: psss set "psss://Example API/token"\n`,
      );
      return 0;
    }
    ctx.out(itemLines(items));
    return 0;
  },
};

export default list;
