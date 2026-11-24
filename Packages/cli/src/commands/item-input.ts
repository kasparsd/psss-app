// Reading what `item add` and `item edit` are given: plain options as arguments, secrets from standard input, never as arguments.
//
// A secret option (--password, --card-number, --card-code, --card-pin, --notes, --secret <label>) takes no value. The command asks for each
// without echo at a terminal. From a pipe: with one secret option, all of standard input is the value (one trailing line break removed);
// with several, one line each, in the order below.

import { readSecret } from '../input.ts';
import { ValidationError } from '../errors.ts';
import type { ParsedValues } from '../config.ts';
import type { ItemFields } from '../service.ts';
import type { CommandContext, OptionSpec } from './command.ts';

export const ORDER = 'password, card number, security code, PIN, notes, then each --secret in the order given';

export const itemFieldOptions: Record<string, OptionSpec> = {
  title: { type: 'string', valueName: 'text', description: 'The name of the item (optional: an item is shown by its website or account when it has none)' },
  username: { type: 'string', valueName: 'text', description: 'Username or account' },
  url: { type: 'string', multiple: true, valueName: 'address', description: 'A website; repeat for more (the first is the main one)' },
  tag: { type: 'string', multiple: true, valueName: 'text', description: 'A tag; repeat for more' },
  field: { type: 'string', multiple: true, valueName: 'label=value', description: 'A plain extra field; repeat for more' },
  cardholder: { type: 'string', valueName: 'text', description: 'Card: name on the card' },
  expiry: { type: 'string', valueName: 'MM/YY', description: 'Card: expiry, needs the card number' },
  'valid-from': { type: 'string', valueName: 'MM/YY', description: 'Card: valid from' },
  issuer: { type: 'string', valueName: 'text', description: 'Card: issuer' },
  password: { type: 'boolean', description: 'Read the password from standard input' },
  'card-number': { type: 'boolean', description: 'Read the card number from standard input' },
  'card-code': { type: 'boolean', description: 'Read the security code from standard input' },
  'card-pin': { type: 'boolean', description: 'Read the PIN from standard input' },
  notes: { type: 'boolean', description: 'Read the notes from standard input' },
  secret: { type: 'string', multiple: true, valueName: 'label', description: 'A hidden extra field with this label; its value is read from standard input' },
};

export const CARD_ONLY = ['cardholder', 'expiry', 'valid-from', 'issuer', 'card-number', 'card-code', 'card-pin'] as const;
export const LOGIN_ONLY = ['username', 'url', 'password'] as const;

const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : v === undefined ? [] : [String(v)]);
const control = /[\u0000-\u001f\u007f\u2028\u2029]/;

/** Text from an argument: trimmed, one line. */
export function oneLine(flag: string, text: string, max = 200): string {
  const t = text.trim();
  if (control.test(t)) throw new ValidationError(`--${flag} must be one line of text, without line breaks or control characters.`);
  if ([...t].length > max) throw new ValidationError(`--${flag} is longer than ${max} characters.`);
  return t;
}

export function websiteOf(text: string): string {
  const t = oneLine('url', text, 2000);
  if (t === '') throw new ValidationError('--url needs an address, such as --url https://example.com.');
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
}

/** `03/28`, `3/2028` or `2028-03` as a month and a four-digit year. */
export function monthYear(flag: string, text: string): { year: number; month: number } {
  const t = text.trim();
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(t) ?? /^(\d{4})-(\d{1,2})$/.exec(t);
  let month: number, year: number;
  if (m && /^\d{4}$/.test(m[1]!) && t.includes('-')) { year = Number(m[1]); month = Number(m[2]); } else if (m) { month = Number(m[1]); year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]); } else month = year = NaN;
  if (!(month >= 1 && month <= 12) || !(year >= 1900 && year <= 2200)) throw new ValidationError(`--${flag} "${t.slice(0, 20)}" is not a month and year. Write it as 03/28 or 03/2028.`);
  return { year, month };
}
export const monthYearText = (v: { year: number; month: number }) => `${String(v.month).padStart(2, '0')}/${v.year}`;

/** A card number as digits: spaces and hyphens removed, 12 to 19 digits. */
export function cardDigits(text: string): { digits: string; luhn: boolean } {
  const digits = text.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits)) throw new ValidationError('A card number is 12 to 19 digits (spaces are fine). Nothing was saved.');
  let sum = 0;
  [...digits].reverse().forEach((c, i) => { let d = Number(c); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; });
  return { digits, luhn: sum % 10 === 0 };
}

export interface Wanted { name: string; prompt: string; apply(f: ItemFields, value: string): void }

/** The secrets the flags ask for, in the order of `ORDER`. */
export function wantedSecrets(values: ParsedValues, kindIsNote: boolean): Wanted[] {
  const out: Wanted[] = [];
  const t = (flag: string) => values[flag] === true;
  if (t('password')) out.push({ name: 'password', prompt: 'Password (not shown): ', apply: (f, v) => (f.password = v) });
  if (t('card-number')) out.push({ name: 'card number', prompt: 'Card number (not shown): ', apply: (f, v) => (f.cardNumber = v) });
  if (t('card-code')) out.push({ name: 'security code', prompt: 'Security code (not shown): ', apply: (f, v) => (f.cardCode = v) });
  if (t('card-pin')) out.push({ name: 'PIN', prompt: 'PIN (not shown): ', apply: (f, v) => (f.cardPin = v) });
  if (t('notes')) out.push({ name: 'notes', prompt: `${kindIsNote ? 'Note' : 'Notes'} (not shown): `, apply: (f, v) => (f.notes = v) });
  for (const label of asList(values.secret)) {
    const l = oneLine('secret', label, 100);
    if (l === '') throw new ValidationError('--secret needs the label of the field, such as --secret "API token".');
    refuseBuiltInName('secret', l);
    out.push({ name: `"${l}"`, prompt: `${l} (not shown): `, apply: (f, v) => ((f.custom ??= []).push({ label: l, value: v, concealed: true })) });
  }
  return out;
}

/** Reads every wanted secret. Nothing is read when none is wanted, so a script that gives no secret never waits on standard input. */
export async function readWanted(ctx: CommandContext, wanted: Wanted[], f: ItemFields, command: string): Promise<void> {
  if (wanted.length === 0) return;
  if (wanted.length === 1 || ctx.io.isTTY.stdin) {
    for (const w of wanted) w.apply(f, await readSecret(ctx.io, w.prompt, { emptyMessage: `No ${w.name} was given, so nothing was saved. Pipe it in, or type it when asked.` }));
    return;
  }
  const text = await readSecret(ctx.io, '', { allowEmpty: true });
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.length !== wanted.length || lines.some((l) => l === '')) {
    throw new ValidationError(
      `psss ${command} was asked for ${wanted.length} secrets (${wanted.map((w) => w.name).join(', ')}), so standard input needs ${wanted.length} lines, in that order, and none empty. It got ${lines.length}. Nothing was saved.\nThe order is: ${ORDER}.`,
    );
  }
  wanted.forEach((w, i) => w.apply(f, lines[i]!));
}

/** The plain fields from the options, validated. Secrets are not here. */
export function plainFields(values: ParsedValues): ItemFields {
  const f: ItemFields = {};
  if (values.title !== undefined) f.title = oneLine('title', String(values.title));
  if (values.username !== undefined) f.username = oneLine('username', String(values.username), 500);
  const urls = asList(values.url);
  if (urls.length > 0) f.websites = urls.map(websiteOf);
  if (values.cardholder !== undefined) f.cardholder = oneLine('cardholder', String(values.cardholder));
  if (values.expiry !== undefined) f.expiry = monthYear('expiry', String(values.expiry));
  if (values['valid-from'] !== undefined) f.validFrom = monthYearText(monthYear('valid-from', String(values['valid-from'])));
  if (values.issuer !== undefined) f.issuer = oneLine('issuer', String(values.issuer));
  const tags = asList(values.tag).map((t) => oneLine('tag', t, 100)).filter((t) => t !== '');
  if (tags.length > 0) f.addTags = tags;
  for (const raw of asList(values.field)) {
    const at = raw.indexOf('=');
    if (at <= 0) throw new ValidationError(`--field needs label=value, such as --field "Account number=12345". It got "${raw.slice(0, 30)}".`);
    const label = oneLine('field', raw.slice(0, at), 100);
    refuseBuiltInName('field', label);
    (f.custom ??= []).push({ label, value: oneLine('field', raw.slice(at + 1), 2000), concealed: false });
  }
  return f;
}

/** The built-in fields of an item, by the name a person might give an extra field, and the option that sets each one. */
const BUILT_IN: Record<string, string> = {
  title: '--title', username: '--username', password: '--password (the value is read from standard input)', url: '--url', website: '--url', note: '--notes (read from standard input)', notes: '--notes (read from standard input)',
  cardholder: '--cardholder', card: '--card-number (read from standard input)', 'card number': '--card-number (read from standard input)', card_number: '--card-number (read from standard input)',
  card_code: '--card-code (read from standard input)', 'security code': '--card-code (read from standard input)', card_pin: '--card-pin (read from standard input)', pin: '--card-pin (read from standard input)',
  expiry: '--expiry', 'valid from': '--valid-from', 'card issuer': '--issuer', code: 'the Psss app, which sets up a verification code', passkey: 'the Psss app, which makes a passkey',
};

/** An extra field cannot have the name of a field the item already has: it would be a second one that shows and reads like the first. */
export function refuseBuiltInName(flag: string, label: string): void {
  const use = BUILT_IN[label.normalize('NFC').toLowerCase()];
  if (use !== undefined) throw new ValidationError(`"${label.slice(0, 40)}" is a field an item already has, so --${flag} cannot add a second one with that name. Use ${use}.`);
}

export function refuseFlags(values: ParsedValues, flags: readonly string[], why: string): void {
  for (const flag of flags) {
    const v = values[flag];
    if (v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0)) throw new ValidationError(`--${flag} ${why}`);
  }
}
