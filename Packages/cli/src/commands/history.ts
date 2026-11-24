import { formatReference, shellQuote } from '../reference.ts';
import { ValidationError } from '../errors.ts';
import { printable } from '../text.ts';
import { hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command } from './command.ts';
import { chooseItem } from './choose.ts';
import { jsonName } from './kdbx-report.ts';
import type { ChangeEvent, ItemSelector, ItemSummary } from '../service.ts';

/** `2026-11-20T09:12:00.000Z`, or null for a time no calendar can show (a record can carry any number). */
export function isoOf(ms: number): string | null {
  return Number.isFinite(ms) && ms >= 0 && ms <= 253_402_300_799_999 ? new Date(ms).toISOString() : null;
}

/** `2026-11-20 09:12 UTC`: UTC, so a log, a server and a laptop say the same thing. */
export function whenOf(ms: number): string {
  const iso = isoOf(ms);
  return iso === null ? 'unknown date'.padEnd(20) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function changeText(c: ChangeEvent): string {
  switch (c.kind) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Moved to Recently Deleted';
    case 'restored':
      return 'Restored from Recently Deleted';
    case 'changed':
      return c.fields.length > 0 ? `Changed ${c.fields.map((f) => printable(f)).join(', ')}` : 'Changed';
  }
}

const history: Command = {
  name: 'history',
  summary: "Show an item's changes, or the earlier values of one field, with dates",
  usage: 'history <reference> [--show] [--json]',
  options: {
    show: { type: 'boolean', description: 'Print the earlier values of the field (needs a field)' },
    ...jsonOption,
  },
  args: { min: 0, max: 1 },
  details: [
    'psss history "psss://Example Bank" lists what changed and when, newest first: the fields, never their values.',
    'psss history "psss://Example Bank/password" lists when each earlier value was replaced; --show prints the values too, one per line.',
    'Dates are UTC. An item that was imported is dated by when it was imported; its earlier passwords keep the dates the file gave them.',
    'Only what this computer still holds is listed: a vault that was compacted keeps the current value of each field and the earlier passwords,',
    'so a row may name only some of the fields of a write, and an older write that a later one replaced is gone.',
    'The verification code is made fresh each time and has no earlier values.',
    'An item in Recently Deleted has a history too. A title matches exactly, ignoring case; a name that matches two items lists them and exits 3.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    const show = ctx.values.show === true;
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'history', 'item', true);
    // psss://Item is the whole item; psss://Item/field and psss://Group/Item/field are one field
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, typed.startsWith('psss://') && !typed.slice('psss://'.length).includes('/') ? 'item' : 'field');
    if (show && resolved?.ref.field === undefined) {
      throw new ValidationError('--show prints the earlier values of one field, so name the field, as in: psss history "psss://Example Bank/password" --show');
    }
    const vault = await ctx.open();
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({}));
      const item = await chooseItem(ctx, vault.name, items, `There is nothing in ${vault.name} yet.\nAdd something with: psss set "psss://Example API/token"`);
      selector = { id: item.id };
    } else {
      selector = resolved.selector;
    }
    const field = resolved?.ref.field;
    const outcome = ctx.unwrap(await svc.history(selector, { ...(field !== undefined ? { field } : {}), show }), field !== undefined ? { field } : {});
    const item: ItemSummary = outcome.item;
    const itemJson = { id: item.id, title: jsonName(item.title), group: jsonName(item.group), ...(item.deleted ? { deleted: true } : {}) };
    if (item.deleted && !hasJson(ctx.values)) ctx.err(`"${printable(item.title)}" is in Recently Deleted. Bring it back with: psss restore ${formatReference({ item: { id: item.id } })}\n`);

    if (outcome.mode === 'item') {
      if (hasJson(ctx.values)) {
        ctx.json({ item: itemJson, changes: outcome.changes.map((c) => ({ at: isoOf(c.at), kind: c.kind, fields: c.fields.map(jsonName) })) });
        return 0;
      }
      if (outcome.changes.length === 0) {
        ctx.err(`This computer holds no changes of "${printable(item.title)}".\n`);
        return 0;
      }
      ctx.out(outcome.changes.map((c) => `${whenOf(c.at)}  ${changeText(c)}\n`).join(''));
      return 0;
    }

    if (hasJson(ctx.values)) {
      ctx.json({ item: itemJson, field: jsonName(outcome.field), earlier: outcome.earlier.map((e) => ({ replaced: isoOf(e.replaced), ...(show && e.value !== undefined ? { value: e.value } : {}) })) });
      return 0;
    }
    if (outcome.computed) {
      ctx.err('The verification code is made fresh each time; it has no earlier values.\n');
      return 0;
    }
    if (outcome.earlier.length === 0) {
      ctx.err(`"${printable(item.title)}" has no earlier value of "${printable(outcome.field)}".\n`);
      return 0;
    }
    // A value is shown on one line: a line break or a direction character in it is written as \u{a}, never sent to the terminal (--json has it exactly).
    // a date that cannot be shown is padded to the width of a real one, which only lines up a value that follows it: a line with no value has no trailing spaces
    ctx.out(outcome.earlier.map((e) => (show && e.value !== undefined ? `Replaced ${whenOf(e.replaced)}  ${printable(e.value, Infinity)}` : `Replaced ${whenOf(e.replaced).trimEnd()}`) + '\n').join(''));
    if (!show && ctx.io.isTTY.stdout) ctx.err(`The values are hidden. Print them with: psss history ${shellQuote(typed ?? '')} --show\n`);
    return 0;
  },
};

export default history;
