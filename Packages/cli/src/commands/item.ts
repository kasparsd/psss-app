// `psss item show | add | edit | purge`: whole items. Docs: docs/cli.md, "Items and files". Frames A17.
//
// Rules that hold for all four: a value is never an argument (secrets are asked for or piped in, see item-input.ts); nothing protected is ever
// printed (`item show` says a field is hidden, `psss get` reads it); names are escaped and cut by text.ts; a title matches exactly, ignoring case.

import { formatReference, shellQuote } from '../reference.ts';
import { confirm } from '../input.ts';
import { CliError, EXIT_FAILED, ValidationError } from '../errors.ts';
import { nearTitles } from '../near.ts';
import { printable } from '../text.ts';
import { checkDelivery, deliveryJson } from './delivery.ts';
import { chooseItem } from './choose.ts';
import { findItem, hasJson, jsonOption, missingReferenceError, resolveReference } from './command.ts';
import type { Command, CommandContext } from './command.ts';
import { isoOf, whenOf } from './history.ts';
import { cardDigits, CARD_ONLY, itemFieldOptions, LOGIN_ONLY, ORDER, plainFields, readWanted, refuseFlags, wantedSecrets, websiteOf, oneLine } from './item-input.ts';
import { jsonName, plural } from './kdbx-report.ts';
import type { ItemDetails, ItemField, ItemFields, ItemKind, ItemSelector, ItemSummary } from '../service.ts';

const KINDS: ItemKind[] = ['login', 'card', 'note', 'custom'];
const DAY = 24 * 3600 * 1000;
const PURGE_DAYS = 30;

/** The reference a command prints for an item: its title when it has one, else its id. */
export function itemReference(item: { id: string; title: string }): string {
  return formatReference({ item: item.title === '' ? { id: item.id } : { title: item.title } });
}

const quoted = (reference: string) => shellQuote(reference);

// ---------------------------------------------------------------- show

const LABELS: Record<string, string> = {
  username: 'Username', password: 'Password', code: 'Verification code', card: 'Card number', expiry: 'Expiry', card_code: 'Security code', card_pin: 'PIN',
  cardholder: 'Name on card', notes: 'Notes',
};
const ORDERS: Record<ItemKind, string[]> = {
  login: ['username', 'password', 'code', 'notes'],
  custom: ['username', 'password', 'code', 'notes'],
  card: ['card', 'Valid from', 'expiry', 'card_code', 'card_pin', 'cardholder', 'Card issuer', 'notes'],
  note: ['notes'],
};
const KIND_NAME: Record<ItemKind, string> = { login: 'Login', card: 'Card', note: 'Secure note', custom: 'Custom item' };

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

function orderedFields(d: ItemDetails): ItemField[] {
  const order = ORDERS[d.kind];
  const rank = (f: ItemField) => { const i = f.custom ? -1 : order.indexOf(f.name); return i < 0 ? order.length : i; };
  return d.fields.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}

export function showText(d: ItemDetails): string {
  const rows: Array<[string, string]> = [['Kind', KIND_NAME[d.kind]], ['Group', printable(d.item.group)]];
  if (d.item.deleted) {
    const when = d.deletedAt === undefined ? 'unknown date' : whenOf(d.deletedAt);
    const gone = d.deletedAt === undefined ? '' : `; removed for good on ${whenOf(d.deletedAt + PURGE_DAYS * DAY).slice(0, 10)}`;
    rows.push(['Deleted', `${when}${gone}`]);
  }
  if (d.created !== undefined) rows.push(['Added', whenOf(d.created)]);
  if (d.edited !== undefined && d.edited !== d.created) rows.push(['Edited', whenOf(d.edited)]);
  const fields = orderedFields(d);
  const sites: Array<[string, string]> = d.websites.length > 0 ? [[d.websites.length === 1 ? 'Website' : 'Websites', d.websites.map((w) => printable(w, 120)).join(', ')]] : [];
  if (d.kind !== 'card' && d.kind !== 'note') rows.push(...sites);
  for (const f of fields) {
    const label = f.custom ? printable(f.name) : (LABELS[f.name] ?? printable(f.name));
    const text = f.hidden ? `hidden${f.detail ? `, ${f.detail}` : ''}` : printable(f.value ?? '', 120);
    rows.push([label, text]);
  }
  if (d.kind === 'card') rows.push(...sites);
  if (d.passkey) rows.push(['Passkey', `${printable(d.passkey.name, 80)} on ${printable(d.passkey.site, 80)}, made ${whenOf(d.passkey.created).slice(0, 10)}`]);
  if (d.tags.length > 0) rows.push(['Tags', d.tags.map((t) => printable(t, 60)).join(', ')]);
  if (d.files.length > 0) rows.push([d.files.length === 1 ? 'File' : 'Files', d.files.map((f) => `${printable(f.name, 80)} (${sizeText(f.size)})`).join(', ')]);
  const width = Math.max(...rows.map((r) => r[0].length)) + 2;
  const title = d.item.title === '' ? '(no name)' : printable(d.item.title);
  return `${title}\n${rows.map(([k, v]) => `  ${k.padEnd(width)}${v}`.trimEnd()).join('\n')}\n`;
}

export function showJson(d: ItemDetails): Record<string, unknown> {
  return {
    reference: formatReference({ item: { id: d.item.id } }),
    item: { id: d.item.id, title: jsonName(d.item.title), group: jsonName(d.item.group) },
    kind: d.kind,
    deleted: d.item.deleted,
    deletedAt: d.item.deleted ? (d.deletedAt === undefined ? null : isoOf(d.deletedAt)) : null,
    added: d.created === undefined ? null : isoOf(d.created),
    edited: d.edited === undefined ? null : isoOf(d.edited),
    websites: d.websites.map(jsonName),
    tags: d.tags.map(jsonName),
    fields: orderedFields(d).map((f) => ({ name: jsonName(f.name), hidden: f.hidden, ...(f.custom ? { custom: true } : {}), ...(f.hidden ? {} : { value: jsonName(f.value ?? '') }), ...(f.detail !== undefined ? { detail: f.detail } : {}) })),
    files: d.files.map((f) => ({ name: jsonName(f.name), size: f.size })),
    hasCode: d.hasCode,
    passkey: d.passkey ? { site: jsonName(d.passkey.site), name: jsonName(d.passkey.name), created: isoOf(d.passkey.created) } : null,
  };
}

const show: Command = {
  name: 'item show',
  summary: 'Show one item: its kind, fields, dates, tags and files, without protected values',
  usage: 'item show <reference> [--json]',
  options: { ...jsonOption },
  args: { min: 0, max: 1 },
  details: [
    'Shows every field of one item in the order the apps use, with its dates (UTC), websites, tags and attached files.',
    'A protected value is never printed here, however it is asked for: the password, the verification code, a card number (its last four digits are said),',
    'the security code, the PIN, the notes (their length is said) and a hidden extra field show as "hidden". Read one with: psss get "psss://Example Bank/password".',
    'An item in Recently Deleted can be shown too; it says when it is removed for good.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'item show', 'item', true);
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, 'item').selector;
    const vault = await ctx.open();
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({}));
      selector = { id: (await chooseItem(ctx, vault.name, items, `There is nothing in ${vault.name} yet.`)).id };
    } else selector = resolved;
    let found = await svc.show(selector);
    if (!found.ok && found.kind === 'notFound' && found.what === 'item') {
      const again = await svc.show(selector, { deleted: true });
      if (again.ok) {
        found = again;
        ctx.err('That item is in Recently Deleted.\n');
      }
    }
    if (!found.ok && found.kind === 'notFound' && found.what === 'group' && 'title' in selector && selector.group !== undefined) {
      await findItem(ctx, svc, 'item show', selector, false);
    }
    const d = ctx.unwrap(found);
    if (hasJson(ctx.values)) ctx.json(showJson(d));
    else {
      ctx.out(showText(d));
      const hidden = d.fields.find((f) => f.hidden && f.name !== 'notes');
      if (hidden && ctx.io.isTTY.stderr === true) ctx.err(`Hidden values are not shown. Print one with: psss get ${quoted(formatReference({ item: { id: d.item.id }, field: hidden.name }))}\n`);
    }
    return 0;
  },
};

// ---------------------------------------------------------------- add

const kindOption = { type: 'string' as const, valueName: 'kind', description: 'login (default), card, note or custom' };

function kindOf(raw: unknown): ItemKind {
  const k = raw === undefined ? 'login' : String(raw).toLowerCase();
  if ((KINDS as string[]).includes(k)) return k as ItemKind;
  const near = nearTitles(k, KINDS);
  throw new ValidationError(`"${printable(String(raw), 30)}" is not a kind of item. Choose one of: ${KINDS.join(', ')}.${near.length > 0 ? `\nDid you mean: ${near.join(', ')}?` : ''}`);
}

function checkTitle(f: ItemFields): void {
  if (f.title !== undefined && f.title === '') delete f.title;
}

const add: Command = {
  name: 'item add',
  summary: 'Add an item; prints its reference',
  usage: 'item add [--kind login|card|note|custom] [--title <text>] [options] [--dry-run] [--json]',
  options: {
    kind: kindOption,
    ...itemFieldOptions,
    'dry-run': { type: 'boolean', description: 'Check the item and say what would be added; write nothing and read no secret' },
    ...jsonOption,
  },
  args: { min: 0, max: 0 },
  details: [
    'Makes one item in one record. Standard output is its reference (psss://Example, or psss://id:… when it has no name) and nothing else, so a script can keep it.',
    'A title is optional: an item without one is shown by its website or account, as in the apps. A title that another item already has is allowed, with a warning, since a reference by that title then needs the id.',
    'Secrets are never arguments. --password, --card-number, --card-code, --card-pin, --notes and --secret <label> take no value: at a terminal each is asked without echo.',
    `From a pipe, one secret option takes all of standard input; several take one line each, in this order: ${ORDER}.`,
    'A login and a custom item take --username, --url and --password. A card takes --cardholder, --expiry, --valid-from, --issuer, --card-number, --card-code and --card-pin.',
    'Every kind takes --notes, --tag, --field label=value and --secret label.',
    'With --group (or PSSS_GROUP) the item goes to that group; otherwise to the only group this computer can write to.',
  ],
  async run(ctx) {
    const kind = kindOf(ctx.values.kind);
    if (kind === 'card') refuseFlags(ctx.values, LOGIN_ONLY, 'is for a login or a custom item, not a card.');
    if (kind === 'note') refuseFlags(ctx.values, LOGIN_ONLY, 'is for a login or a custom item, not a note.');
    if (kind !== 'card') refuseFlags(ctx.values, CARD_ONLY, 'is for a card. Add --kind card.');
    const f = plainFields(ctx.values);
    checkTitle(f);
    if (f.expiry !== undefined && ctx.values['card-number'] !== true) throw new ValidationError('--expiry goes with a card number: add --card-number.');
    const wanted = wantedSecrets(ctx.values, kind === 'note');
    if (f.title === undefined && Object.keys(f).length === 0 && wanted.length === 0) {
      throw new ValidationError('There is nothing to add. Give a title or a field, such as: psss item add --kind login --title "Example" --username robin --password');
    }
    const dryRun = ctx.values['dry-run'] === true;
    const svc = await ctx.service();
    if (dryRun) {
      const vault = await ctx.open({ readOnly: true });
      const done = ctx.unwrap(await svc.add({ kind, ...f }, { dryRun: true }));
      const asks = wanted.length > 0 ? ` It would ask for: ${wanted.map((w) => w.name).join(', ')}.` : '';
      if (hasJson(ctx.values)) {
        ctx.json({ dryRun: true, kind, title: f.title === undefined ? null : jsonName(f.title), group: jsonName(done.item.group), asks: wanted.map((w) => w.name) });
      } else {
        ctx.out(`Would add ${a(kind)} ${f.title === undefined ? '' : `"${printable(f.title)}" `}to ${vault.name}.${asks}\nNothing was written.\n`);
      }
      return 0;
    }
    const vault = await ctx.open({ changes: true });
    await readWanted(ctx, wanted, f, 'item add');
    if (f.cardNumber !== undefined) {
      const c = cardDigits(f.cardNumber);
      f.cardNumber = c.digits;
      if (!c.luhn) ctx.err('warning: that card number does not pass the usual check-digit test. It was saved as given.\n');
    }
    const done = ctx.unwrap(await svc.add({ kind, ...f }));
    const twin = done.item.title === '' ? undefined : await svc.find({ title: done.item.title });
    if (twin && !twin.ok && twin.kind === 'ambiguous') {
      ctx.err(`warning: another item is also called "${printable(done.item.title)}", so psss://${printable(done.item.title)} no longer picks one.\nName this one by its id: ${quoted(formatReference({ item: { id: done.item.id } }))}\n`);
    }
    const delivery = await checkDelivery(ctx);
    const reference = twin && !twin.ok && twin.kind === 'ambiguous' ? formatReference({ item: { id: done.item.id } }) : itemReference(done.item);
    if (hasJson(ctx.values)) {
      ctx.json({ reference, item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) }, kind, delivery: deliveryJson(delivery) });
      return 0;
    }
    if (ctx.io.isTTY.stderr === true) ctx.err(`Added ${a(kind)} ${done.item.title === '' ? '' : `"${printable(done.item.title)}" `}to ${vault.name}.\n`);
    ctx.out(`${reference}\n`);
    return 0;
  },
};
const a = (kind: ItemKind) => (kind === 'login' ? 'a login' : kind === 'card' ? 'a card' : kind === 'note' ? 'a note' : 'a custom item');

// ---------------------------------------------------------------- edit

const { tag: _tag, ...editFieldOptions } = itemFieldOptions;
void _tag;

const edit: Command = {
  name: 'item edit',
  summary: 'Change fields of an item; says which changed, by name',
  usage: 'item edit <reference> [options] [--json]',
  options: {
    ...editFieldOptions,
    'add-url': { type: 'string', multiple: true, valueName: 'address', description: 'Add a website to the ones it has' },
    'remove-url': { type: 'string', multiple: true, valueName: 'address', description: 'Remove a website' },
    'add-tag': { type: 'string', multiple: true, valueName: 'text', description: 'Add a tag' },
    'remove-tag': { type: 'string', multiple: true, valueName: 'text', description: 'Remove a tag' },
    'remove-field': { type: 'string', multiple: true, valueName: 'label', description: 'Remove an extra field by its label' },
    ...jsonOption,
  },
  args: { min: 1, max: 1 },
  details: [
    'Changes only what is asked, in one record, and prints the names of the fields that changed, never a value. A field that already holds the value is not rewritten; nothing changed writes nothing.',
    '--url replaces the whole list of websites (give it once for each one to keep); --add-url and --remove-url change the list one address at a time.',
    '--title "" removes the name. Secrets are never arguments; see psss item add --help for how they are read.',
    'An item in Recently Deleted cannot be edited: restore it first. Moving an item to another group is not built yet.',
    'Setting one field to a value from the standard input is also what psss set does.',
  ],
  async run(ctx) {
    const f = plainFields(ctx.values);
    delete f.addTags;
    const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
    const addTags = list(ctx.values['add-tag']).map((t) => oneLine('add-tag', t, 100)).filter(Boolean);
    const removeTags = list(ctx.values['remove-tag']).map((t) => oneLine('remove-tag', t, 100)).filter(Boolean);
    if (addTags.length > 0) f.addTags = addTags;
    if (removeTags.length > 0) f.removeTags = removeTags;
    for (const label of list(ctx.values['remove-field'])) (f.custom ??= []).push({ label: oneLine('remove-field', label, 100), value: null, concealed: false });
    const wanted = wantedSecrets(ctx.values, false);
    const addUrls = list(ctx.values['add-url']).map(websiteOf), removeUrls = list(ctx.values['remove-url']).map(websiteOf);
    if (f.websites !== undefined && (addUrls.length > 0 || removeUrls.length > 0)) throw new ValidationError('--url replaces the list of websites, so it cannot go with --add-url or --remove-url. Use one way.');
    if (Object.keys(f).length === 0 && wanted.length === 0 && addUrls.length === 0 && removeUrls.length === 0) {
      throw new ValidationError(
        ctx.settings.group !== undefined
          ? 'There is nothing to change. --group only says which group to look in: moving an item to another group is not built yet.\nSay what to change, such as: psss item edit "psss://Example" --username robin --add-tag work'
          : 'There is nothing to change. Say what, such as: psss item edit "psss://Example" --username robin --add-tag work',
      );
    }
    const { selector } = resolveReference(ctx, ctx.positionals[0]!, 'item');
    const vault = await ctx.open({ changes: true });
    const svc = await ctx.service();
    const found = await svc.find(selector);
    if (!found.ok && found.kind === 'notFound' && found.what === 'item') {
      const gone = await svc.find(selector, { deleted: true });
      if (gone.ok) {
        throw new CliError(`"${printable(gone.value.title)}" is in Recently Deleted, and an item there cannot be changed.\nBring it back first with: psss restore ${quoted(formatReference({ item: { id: gone.value.id } }))}`, EXIT_FAILED);
      }
    }
    const item = await findItem(ctx, svc, 'item edit', selector, false);
    {
      // the same rule as `item add`: a kind has only its own fields
      const kind = ctx.unwrap(await svc.show({ id: item.id })).kind;
      const none = ' Nothing was changed.';
      if (kind === 'card') refuseFlags(ctx.values, [...LOGIN_ONLY, 'add-url', 'remove-url'], `is for a login or a custom item, not a card.${none}`);
      if (kind === 'note') refuseFlags(ctx.values, [...LOGIN_ONLY, 'add-url', 'remove-url'], `is for a login or a custom item, not a note.${none}`);
      if (kind !== 'card') refuseFlags(ctx.values, CARD_ONLY, `is for a card, and this item is ${a(kind)}.${none}`);
    }
    if (addUrls.length > 0 || removeUrls.length > 0) {
      const d = ctx.unwrap(await svc.show({ id: item.id }));
      const drop = new Set(removeUrls);
      const next = d.websites.filter((w) => !drop.has(w));
      for (const w of addUrls) if (!next.includes(w)) next.push(w);
      f.websites = next;
    }
    await readWanted(ctx, wanted, f, 'item edit');
    if (f.cardNumber !== undefined) {
      const c = cardDigits(f.cardNumber);
      f.cardNumber = c.digits;
      if (!c.luhn) ctx.err('warning: that card number does not pass the usual check-digit test. It was saved as given.\n');
    }
    if (f.title === '') f.title = '';
    const done = ctx.unwrap(await svc.edit({ id: item.id }, f), {});
    const delivery = await checkDelivery(ctx);
    if (hasJson(ctx.values)) {
      ctx.json({ item: { id: done.item.id, title: jsonName(done.item.title), group: jsonName(done.item.group) }, changed: done.changed.map(jsonName), delivery: deliveryJson(delivery) });
      return 0;
    }
    if (done.changed.length === 0) {
      ctx.out('Nothing changed.\n');
      return 0;
    }
    ctx.out(`Changed ${done.changed.map((n) => printable(n)).join(', ')} of ${done.item.title === '' ? 'the item' : `"${printable(done.item.title)}"`} (${vault.name}).\n`);
    return 0;
  },
};

// ---------------------------------------------------------------- purge

const purge: Command = {
  name: 'item purge',
  summary: 'Delete an item in Recently Deleted for good',
  usage: 'item purge <reference> [--dry-run] [--yes] [--json]',
  options: {
    'dry-run': { type: 'boolean', description: 'Say what would be deleted and write nothing' },
    ...jsonOption,
  },
  args: { min: 0, max: 1 },
  details: [
    'Only an item that is already in Recently Deleted can be deleted for good; move a live one there first with psss rm. Items there are also removed by the apps 30 days after they were deleted.',
    'At a terminal it asks first, naming the item. A script has to say --yes (or set PSSS_YES), since there is nobody to ask. --dry-run asks nothing and writes nothing.',
    'It cannot be undone. This computer stops showing the item at once and other computers do when they next sync; the old records stay in the vault\'s files',
    'until a checkpoint removes them (not built yet), and copies of the vault that were made earlier still hold it. Files attached to the item stay in the folder for the same reason.',
  ],
  async run(ctx) {
    const typed = ctx.positionals[0];
    const dryRun = ctx.values['dry-run'] === true;
    if (typed === undefined && !ctx.interactive) throw missingReferenceError(ctx, 'item purge', 'item', true);
    const resolved = typed === undefined ? undefined : resolveReference(ctx, typed, 'item').selector;
    const vault = await ctx.open(dryRun ? { readOnly: true } : { changes: true });
    const svc = await ctx.service();
    let selector: ItemSelector;
    if (resolved === undefined) {
      const items = ctx.unwrap(await svc.list({ deleted: true }));
      selector = { id: (await chooseItem(ctx, vault.name, items, `Recently Deleted in ${vault.name} is empty.`)).id };
    } else selector = resolved;
    const gone = await svc.find(selector, { deleted: true });
    if (!gone.ok && gone.kind === 'notFound' && gone.what === 'item') {
      const live = await svc.find(selector);
      if (live.ok) {
        throw new CliError(
          `"${printable(live.value.title)}" is not in Recently Deleted, and psss only deletes for good what is already there.\nMove it there first with: psss rm ${quoted(formatReference({ item: { id: live.value.id } }))}\nNothing was changed.`,
          EXIT_FAILED,
        );
      }
    }
    const item: ItemSummary = (await findItem(ctx, svc, 'item purge', selector, true));
    const name = item.title === '' ? 'this item' : `"${printable(item.title)}"`;
    if (dryRun) {
      const would = ctx.unwrap(await svc.purge({ id: item.id }, { dryRun: true }));
      if (hasJson(ctx.values)) ctx.json({ dryRun: true, item: { id: item.id, title: jsonName(item.title), group: jsonName(item.group) }, files: would.files, deleted: false });
      else ctx.out(`Would delete ${name} for good from ${vault.name}${would.files > 0 ? `, with its ${plural(would.files, 'attached file')}` : ''}.\nNothing was deleted.\n`);
      return 0;
    }
    if (!ctx.settings.yes) {
      if (!ctx.interactive) {
        throw new ValidationError(`psss item purge deletes ${name} for good and cannot ask here. Add --yes to go ahead, or --dry-run to see what it would do. Nothing was deleted.`);
      }
      const ok = await confirm(ctx.io, `Delete ${name} for good? It cannot be recovered.`);
      if (!ok) {
        ctx.out('Nothing was deleted.\n');
        return 0;
      }
    }
    ctx.unwrap(await svc.purge({ id: item.id }, { dryRun: false }));
    const delivery = await checkDelivery(ctx);
    if (hasJson(ctx.values)) {
      ctx.json({ item: { id: item.id, title: jsonName(item.title), group: jsonName(item.group) }, deleted: true, delivery: deliveryJson(delivery) });
      return 0;
    }
    ctx.out(
      `Deleted ${name} for good from ${vault.name}.\nThis computer no longer shows it. Other computers stop showing it when they next sync.\nThe old records stay in the vault's files until a checkpoint removes them, and earlier copies of the vault still hold it.\n`,
    );
    return 0;
  },
};

const item: Command = {
  name: 'item',
  summary: 'Show, add, edit and purge whole items',
  usage: 'item <show|add|edit|purge>',
  options: {},
  args: { min: 0, max: 0 },
  subcommands: [show, add, edit, purge],
  async run() {
    return 2;
  },
};

export default item;
