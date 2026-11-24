import { CliError, EXIT_NOT_FOUND, ValidationError } from '../errors.ts';
import { printable } from '../text.ts';
import { hasJson, jsonOption } from './command.ts';
import type { Command } from './command.ts';
import { itemJson, itemLines } from './item-lines.ts';
import { jsonName } from './kdbx-report.ts';

const search: Command = {
  name: 'search',
  summary: 'Find items by name, account or website, never by value',
  usage: 'search <text> [--deleted] [--json]',
  options: {
    deleted: { type: 'boolean', description: 'Search Recently Deleted instead' },
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'Finds the items whose name, username or website holds the text, ignoring case and accents, as the apps do.',
    'Notes, tags, custom fields and every secret are never searched. Put text with spaces in quotes.',
    'Prints one line per item as list does, by name, with an id when two items share a name.',
    'Nothing found exits 3, with a "Did you mean" line when a name is close. --group (or PSSS_GROUP) narrows it to one group.',
  ],
  async run(ctx) {
    const text = ctx.positionals[0]?.trim() ?? '';
    if (text === '') {
      throw new ValidationError('psss search needs some text to look for, such as: psss search example\nPut text with spaces in quotes, as in: psss search "example api"');
    }
    await ctx.open();
    const svc = await ctx.service();
    const deleted = ctx.values.deleted === true;
    const found = ctx.unwrap(await svc.search({ text, deleted }));
    if (found.items.length === 0) {
      const where = deleted ? ' in Recently Deleted' : '';
      const did = found.hints.length > 0 ? `\nDid you mean: ${found.hints.map((h) => printable(h)).join(', ')}?` : '';
      throw new CliError(`No items${where} match "${printable(text)}".${did}`, EXIT_NOT_FOUND);
    }
    if (hasJson(ctx.values)) {
      ctx.json({ items: found.items.map((i) => itemJson(i, jsonName)) });
      return 0;
    }
    ctx.out(itemLines(found.items));
    return 0;
  },
};

export default search;
