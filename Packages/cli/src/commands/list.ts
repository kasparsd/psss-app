import { ValidationError } from '../errors.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';

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
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          ...(i.username !== undefined ? { username: i.username } : {}),
          ...(i.url !== undefined ? { url: i.url } : {}),
          group: i.group,
          fields: i.fields,
        })),
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
    // Items that share a title cannot be told apart by name, so they show an id that works in a reference.
    const key = (t: string) => t.normalize('NFC').toLowerCase();
    const seen = new Map<string, number>();
    for (const i of items) seen.set(key(i.title), (seen.get(key(i.title)) ?? 0) + 1);
    const shared = (i: { title: string }) => (seen.get(key(i.title)) ?? 0) > 1;
    const anyShared = items.some(shared);
    const titleW = Math.max(...items.map((i) => i.title.length)) + 3;
    const userW = Math.max(...items.map((i) => (i.username ?? '').length));
    const idW = anyShared ? 'id:'.length + Math.max(...items.filter(shared).map((i) => i.id.slice(0, 8).length)) + 3 : 0;
    let text = '';
    for (const i of items) {
      const user = userW > 0 ? (i.username ?? '').padEnd(userW + 4) : '';
      const id = anyShared ? (shared(i) ? `id:${i.id.slice(0, 8)}` : '').padEnd(idW) : '';
      text += `${i.title.padEnd(titleW)}${user}${id}${i.fields.join(', ')}`.trimEnd() + '\n';
    }
    ctx.out(text);
    return 0;
  },
};

export default list;
