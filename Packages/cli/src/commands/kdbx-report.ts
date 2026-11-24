// Plain words for what an import or export did and did not do. Names of things, never values.

import type { ImportIssue } from '../service.ts';
import type { CommandContext } from './command.ts';

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export { printable, jsonName } from '../text.ts';
import { printable } from '../text.ts';

function list(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const text = shown.map((n) => `"${printable(n)}"`).join(', ');
  return more > 0 ? `${text} and ${more} more` : text;
}

/** One warning on standard error for each kind of finding and part of an item: the sentence that is true of all of them, and which items it was about. */
export function warnIssues(ctx: CommandContext, issues: ImportIssue[]): void {
  const groups = new Map<string, ImportIssue[]>();
  for (const i of issues) {
    const key = `${i.kind}\u0000${i.field ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  }
  for (const group of groups.values()) {
    const names = [...new Set(group.flatMap((i) => (i.item === undefined ? [] : [i.item])))];
    const text = printable(group[0]!.detail, 300);
    ctx.err(`warning: ${text}${names.length > 0 ? ` (${group.length > 1 || names.length > 1 ? `${plural(names.length, 'item')}: ` : ''}${list(names)})` : ''}\n`);
  }
}
