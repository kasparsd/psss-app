// References (docs/cli.md, "References"): the name of one field of one item, safe to write in a script or a conversation.
//   psss://item/field            psss://group/item/field            psss://id:<hex>/field
// optionally followed by ?previous=<n>: the n-th earlier value of the field (1 is the newest earlier one).
// A segment is a title or group name as typed (spaces are fine), with `%`, `/`, `?` and `#` and control characters written as %XX.
// A segment that begins with `id:` and then 4 to 32 lowercase hexadecimal digits names an item (or group) by identifier, or by the start of it.
import { VaultError } from './errors.ts';

export type Selector = { title: string } | { id: string };
export interface Reference {
  group?: Selector;
  item: Selector;
  field: string;
  /** 1 or more: the n-th earlier value of the field */
  previous?: number;
}

const PREFIX = 'psss://';
const bad = (why: string, text: string) => new VaultError('bad_reference', `${why}: ${text}`);

/** Percent-decoding that leaves a lone `%` alone (so "100% safe" typed in a shell still works) and refuses bytes that are not UTF-8. */
function decodeSegment(raw: string, text: string): string {
  return raw.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try { return decodeURIComponent(run); } catch { throw bad('invalid percent-encoding', text); }
  });
}

function selector(raw: string, text: string): Selector {
  if (raw.startsWith('id:')) {
    const id = raw.slice(3);
    if (!/^[0-9a-f]{4,32}$/.test(id)) throw bad('an id is 4 to 32 lowercase hexadecimal digits', text);
    return { id };
  }
  return { title: decodeSegment(raw, text).normalize('NFC') };
}

/** Throws VaultError `bad_reference`. */
export function parseReference(text: string): Reference {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) throw bad(`a reference starts with ${PREFIX}`, String(text));
  let rest = text.slice(PREFIX.length);
  let query = '';
  const q = rest.indexOf('?');
  if (q >= 0) { query = rest.slice(q + 1); rest = rest.slice(0, q); }
  const segments = rest.split('/');
  if (segments.length < 2 || segments.length > 3) throw bad('expected item/field or group/item/field', text);
  if (segments.some((s) => s === '')) throw bad('an empty part', text);
  const ref: Reference = {
    item: selector(segments[segments.length - 2]!, text),
    field: decodeSegment(segments[segments.length - 1]!, text).normalize('NFC'),
  };
  if (segments.length === 3) ref.group = selector(segments[0]!, text);
  if (query !== '') {
    const m = /^previous=([0-9]+)$/.exec(query);
    if (!m || Number(m[1]) < 1 || !Number.isSafeInteger(Number(m[1]))) throw bad('the only option is ?previous=<n>, n from 1', text);
    ref.previous = Number(m[1]);
  }
  return ref;
}

const escapeSegment = (s: string) => s.replace(/[%/?#\u0000-\u001f\u007f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

function formatSelector(s: Selector): string {
  if ('id' in s) return `id:${s.id}`;
  // a title that itself begins with "id:" must not be read as an identifier
  return s.title.startsWith('id:') ? `id%3A${escapeSegment(s.title.slice(3))}` : escapeSegment(s.title);
}

export function formatReference(ref: Reference): string {
  const parts = [...(ref.group ? [formatSelector(ref.group)] : []), formatSelector(ref.item), escapeSegment(ref.field)];
  return `${PREFIX}${parts.join('/')}${ref.previous !== undefined ? `?previous=${ref.previous}` : ''}`;
}
