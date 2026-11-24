// The terminal-only menu for a missing reference: a small numbered list, never more than nine items.
// Not offered with no terminal or with CI set (the command fails with frame A10 instead).

import { Cancelled, choose } from '../input.ts';
import { CliError, EXIT_NOT_FOUND } from '../errors.ts';
import type { ItemSummary } from '../service.ts';
import type { CommandContext } from './command.ts';

const MENU_SIZE = 9;

export async function chooseItem(ctx: CommandContext, vault: string, items: ItemSummary[], emptyMessage: string): Promise<ItemSummary> {
  if (items.length === 0) throw new CliError(emptyMessage, EXIT_NOT_FOUND);
  const shown = items.slice(0, MENU_SIZE);
  const more = items.length > shown.length ? ` (the first ${shown.length} of ${items.length}; name one to narrow it down)` : '';
  const labels = shown.map((i) => (i.username ? `${i.title}  ${i.username}` : i.title));
  const index = await choose(ctx.io, `Which item in ${vault}?${more}`, labels, `Choose 1-${shown.length}, or press Enter to cancel: `);
  if (index === null) throw new Cancelled('Nothing was chosen.');
  return shown[index];
}

export async function chooseField(ctx: CommandContext, item: ItemSummary): Promise<string> {
  const names = [...item.fields];
  if (item.username !== undefined) names.push('username');
  if (item.url !== undefined) names.push('url');
  if (names.length === 0) throw new CliError(`"${item.title}" has no fields to read.`, EXIT_NOT_FOUND);
  if (names.length === 1) return names[0];
  const index = await choose(ctx.io, `Which field of "${item.title}"?`, names, `Choose 1-${names.length}, or press Enter to cancel: `);
  if (index === null) throw new Cancelled('Nothing was chosen.');
  return names[index];
}
