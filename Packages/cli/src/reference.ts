// The `psss://` reference: a name for one field of one item (or, for rm and restore, for one item).
//
//   field form  psss://item/field            psss://group/item/field            psss://id:<hex>/field
//   item form   psss://item                  psss://group/item                  psss://id:<hex>
//
// Rules (docs/cli.md, "References"):
// - A reference is split at "/" first and each part is then percent-decoded as UTF-8. A "/" inside a title is written %2F.
// - Spaces and non-ASCII letters may be written as they are or percent-encoded. In a shell a reference with spaces is quoted.
// - "%" must be written %25 when it is part of a name; a "%" that is not followed by two hex digits is an error, not a guess.
// - "?" and "#" are reserved (a query such as ?previous= is planned) and must be written %3F and %23 inside a name.
// - A part that starts with the literal text "id:" is an item id (hex). A title that really starts with "id:" is written id%3A…
// - Control characters (a line break, a tab) never appear in a name; they are an error.
// - Names are compared by the vault, not here: this module does not change case or Unicode form.

import { ValidationError } from './errors.ts';
import type { ItemSelector } from './service.ts';

export type ReferenceKind = 'field' | 'item';

export interface Reference {
  group?: string;
  /** The item by id or by title. */
  item: { id: string } | { title: string };
  /** Present in the field form only. */
  field?: string;
}

const SCHEME = 'psss://';

function example(kind: ReferenceKind): string {
  return kind === 'field' ? '"psss://Example API/token"' : '"psss://Example API"';
}

function decodePart(raw: string, whole: string): string {
  let out: string;
  try {
    out = decodeURIComponent(raw);
  } catch {
    throw new ValidationError(
      `"${whole}" has a "%" that is not followed by two hex digits. Write a literal "%" as %25.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(out)) {
    throw new ValidationError(`"${whole}" has a control character in a name. Names are one line of text.`);
  }
  return out;
}

export function parseReference(text: string, kind: ReferenceKind): Reference {
  if (!text.startsWith(SCHEME)) {
    throw new ValidationError(`"${text}" is not a reference. A reference looks like ${example(kind)}.`);
  }
  const body = text.slice(SCHEME.length);
  if (/[?#]/.test(body)) {
    throw new ValidationError(
      `"${text}" has a "?" or "#", which are reserved. Write them as %3F and %23 when they are part of a name.`,
    );
  }
  const parts = body.split('/');
  if (parts.some((p) => p === '')) {
    throw new ValidationError(`"${text}" has an empty part. A reference looks like ${example(kind)}.`);
  }
  const min = kind === 'field' ? 2 : 1;
  const max = kind === 'field' ? 3 : 2;
  if (parts.length < min || parts.length > max) {
    if (parts.length > max) {
      throw new ValidationError(`"${text}" has too many parts. A reference looks like ${example(kind)}.\nA slash in a title is written %2F.`);
    }
    throw new ValidationError(`"${text}" has too few parts. A reference looks like ${example(kind)}.`);
  }

  const field = kind === 'field' ? decodePart(parts[parts.length - 1], text) : undefined;
  const itemParts = kind === 'field' ? parts.slice(0, -1) : parts;
  const rawItem = itemParts[itemParts.length - 1];
  const rawGroup = itemParts.length === 2 ? itemParts[0] : undefined;

  let item: Reference['item'];
  if (rawItem.startsWith('id:')) {
    const id = rawItem.slice(3);
    if (!/^[0-9a-fA-F]{4,64}$/.test(id)) {
      throw new ValidationError(
        `"${text}" has an id that is not hex. An id looks like psss://id:7f3a9c21. For a title that starts with "id:", write id%3A.`,
      );
    }
    if (rawGroup !== undefined) {
      throw new ValidationError(`"${text}" names a group and an id. An id is unique, so leave the group out.`);
    }
    item = { id: id.toLowerCase() };
  } else {
    item = { title: decodePart(rawItem, text) };
  }
  const ref: Reference = { item };
  if (rawGroup !== undefined) ref.group = decodePart(rawGroup, text);
  if (field !== undefined) ref.field = field;
  return ref;
}

function encodePart(name: string, isTitle: boolean): string {
  let out = '';
  for (const ch of name) {
    if (ch === '%') out += '%25';
    else if (ch === '/') out += '%2F';
    else if (ch === '?') out += '%3F';
    else if (ch === '#') out += '%23';
    // control, direction-mark and zero-width characters are written %-encoded so a printed reference cannot reorder or hide text; parsing reads them back unchanged
    else if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch)) out += encodeURIComponent(ch);
    else out += ch;
  }
  if (isTitle && out.startsWith('id:')) out = `id%3A${out.slice(3)}`;
  // Leading and trailing spaces are invisible in a quoted argument, so they are written out.
  out = out.replace(/^ +/, (m) => '%20'.repeat(m.length)).replace(/ +$/, (m) => '%20'.repeat(m.length));
  return out;
}

export function formatReference(ref: Reference): string {
  const parts: string[] = [];
  if (ref.group !== undefined) parts.push(encodePart(ref.group, false));
  parts.push('id' in ref.item ? `id:${ref.item.id}` : encodePart(ref.item.title, true));
  if (ref.field !== undefined) parts.push(encodePart(ref.field, false));
  return SCHEME + parts.join('/');
}

export function toSelector(ref: Reference): ItemSelector {
  if ('id' in ref.item) return { id: ref.item.id };
  return ref.group === undefined ? { title: ref.item.title } : { title: ref.item.title, group: ref.group };
}

/** Quotes a word for a POSIX shell the way a person would write it: double quotes, or single quotes when the text has `$`, a backtick, `"`, `\` or `!`. */
export function shellQuote(text: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  if (/[$`"\\!]/.test(text)) return `'${text.replace(/'/g, `'\\''`)}'`;
  return `"${text}"`;
}
