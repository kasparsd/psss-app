// What a command that writes says when the change did not reach every place the vault is kept (frame A11, docs/cli.md "A write that was not delivered").
// The change is stored on this computer before anything is delivered, so the write itself succeeded: the command says so on standard error,
// names the places and the fix, and exits as it would have. `--json` carries the same fact in a `delivery` field.

import { displayPath } from '../io.ts';
import type { CliIo } from '../io.ts';
import type { Delivery } from '../service.ts';
import type { CommandContext } from './command.ts';
import { plural } from './kdbx-report.ts';

/** Wraps a line at word boundaries so that a warning reads like the ones in frame A11. */
function wrap(text: string, width = 60): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  return `${[...lines, line].join('\n')}\n`;
}

/** The warning: how many changes are kept here only, which locations could not be written and why, and how to deliver them. */
export function deliveryWarning(io: CliIo, d: Delivery): string {
  const n = d.undelivered;
  const where =
    d.locations.length === 0
      ? 'it has not reached every location'
      : d.locations.map((l) => `${displayPath(io, l.path)} could not be written (${l.reason})`).join(' and ');
  return wrap(`warning: ${plural(n, 'change')} ${n === 1 ? 'is' : 'are'} kept on this computer only; ${where}. Run psss sync to deliver ${n === 1 ? 'it' : 'them'}.`);
}

/** The `delivery` field of a `--json` result: how many changes are kept here only, and the locations that could not be written. */
export function deliveryJson(d: Delivery): { undelivered: number; locations: Array<{ label: string; path: string; reason: string }> } {
  return { undelivered: d.undelivered, locations: d.locations.map((l) => ({ label: l.label, path: l.path, reason: l.reason })) };
}

/**
 * Asks what the writes of this run left undelivered, warns on standard error when anything is, and returns the answer for `--json`.
 * Called after a command has written. Never changes the exit code: the change is stored, only its delivery is late.
 */
export async function checkDelivery(ctx: CommandContext): Promise<Delivery> {
  const svc = await ctx.service();
  const found = await svc.delivery();
  const d: Delivery = found.ok ? found.value : { undelivered: 0, locations: [] };
  if (d.undelivered > 0) ctx.err(deliveryWarning(ctx.io, d));
  return d;
}
