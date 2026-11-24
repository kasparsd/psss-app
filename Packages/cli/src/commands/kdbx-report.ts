// Plain words for what an import or export did and did not do. Names of things, never values.

import type { ImportIssue } from '../service.ts';
import type { CommandContext } from './command.ts';

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The longest name of an item that a line carries. */
const NAME_CHARACTERS = 60;

/**
 * Text from a file made safe to put on a line: cut to `max` characters with an ellipsis, and every control character, line break, direction
 * mark (such as a right-to-left override), zero-width character and lone surrogate written as `\u{202e}` instead of being sent to the terminal.
 * A title in a file cannot forge a line of ours, move the cursor or reorder the text around it.
 */
export function printable(text: string, max = NAME_CHARACTERS): string {
  const chars = [...text];
  const cut = chars.length > max ? [...chars.slice(0, max - 1), '\u2026'] : chars;
  return cut.map((c) => (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c)).join('');
}

/** A name for a `--json` string: control, direction and zero-width characters written as `\u{202e}`, as in a warning, and no cutting. Not for values. */
export const jsonName = (text: string): string => printable(text, Infinity);

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
