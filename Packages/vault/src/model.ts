// The read model: what a folded group looks like to a caller. Pure functions over the format's folded state and item schema.
import { hex } from '../../format/src/bytes.ts';
import type { CborValue, CMap } from '../../format/src/cbor.ts';
import type { Entry } from '../../format/src/fold.ts';
import type { GroupView } from '../../format/src/group.ts';
import { compareKeys, type OrderKey } from '../../format/src/record.ts';
import { classifyName, viewItem, type Fields, type ItemView } from '../../format/src/schema.ts';
import type { Candidate } from './errors.ts';
import { totp } from './totp.ts';

export interface ItemSummary {
  /** the item id in lowercase hexadecimal */
  id: string;
  group: string;
  groupId: string;
  /** 1 login, 2 card, 3 secure note, 4 custom item */
  type: number;
  /** the title; for a login without one, its first website */
  title: string;
  username?: string;
  url?: string;
  tags: string[];
  created?: number;
  edited?: number;
  deleted: boolean;
  deletedAt?: number;
}

export interface DetailField {
  name: string;
  value: string;
  /** a password, a concealed custom field, a card number, a code or a PIN: the caller decides whether to show it */
  secret: boolean;
  /** true for the verification code, which is computed and not stored */
  computed?: boolean;
}
export interface ItemDetail extends ItemSummary {
  fields: DetailField[];
  /** the folded item as the item schema reads it */
  view: ItemView;
  /** a note the schema asks the app to show, e.g. that the password was changed on two devices at once */
  notes: string[];
}

export interface HistoryEntry {
  value: string;
  /** milliseconds: when the value was replaced (the clock of the write that replaced it, or the date an import gave) */
  replaced: number;
  from: 'writes' | 'import';
}

/** One change of an item, as a person reads it: when, and which fields. Never a value. */
export interface ChangeEntry {
  /** milliseconds: the clock of the write */
  at: number;
  /** `added` for the write that made the item, `deleted` and `restored` for a move to and out of Recently Deleted, otherwise `changed` */
  kind: 'added' | 'changed' | 'deleted' | 'restored';
  /** the fields the write touched, named as a reference names them (`password`, `url`, `code`, a custom field's label); empty for `deleted` and `restored` */
  fields: string[];
}

export interface GroupCtx {
  gid: string;
  gidBytes: Uint8Array;
  view: GroupView;
  name: string;
  /** 0 not a member, 1 reader, 2 writer, 3 manager, as of the newest membership record this device holds */
  role: number;
  epoch: number;
  /** the key of the current epoch, checked against the commitment of the membership chain; null when this device has none */
  writeKey: Uint8Array | null;
  /** every visible item, live and deleted, in title order (computed on first use) */
  entries: () => ItemEntry[];
}
export interface ItemEntry { id: string; bytes: Uint8Array; fields: Fields; view: ItemView; group: GroupCtx }

export const ZERO_ITEM = '0'.repeat(32);

export function buildEntries(group: GroupCtx): ItemEntry[] {
  const out: ItemEntry[] = [];
  for (const [id, fields] of group.view.state) {
    if (id === ZERO_ITEM) continue; // the settings item (schema 8) is not an item
    const view = viewItem(fields);
    if (!view.shown) continue; // moved away (schema 7)
    out.push({ id, bytes: Uint8Array.from({ length: 16 }, (_, i) => parseInt(id.slice(2 * i, 2 * i + 2), 16)), fields, view, group });
  }
  return out.sort(compareEntries);
}

const fold = (s: string) => s.normalize('NFC').toLowerCase();
export const titleOf = (v: ItemView): string => v.displayTitle ?? '';
export function compareEntries(a: ItemEntry, b: ItemEntry): number {
  const x = fold(titleOf(a.view)), y = fold(titleOf(b.view));
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function summarize(e: ItemEntry): ItemSummary {
  const v = e.view;
  const s: ItemSummary = { id: e.id, group: e.group.name, groupId: e.group.gid, type: v.type, title: titleOf(v), tags: v.tags.map((t) => t.text), deleted: v.deleted };
  if (v.username !== undefined) s.username = v.username;
  if (v.websites[0]) s.url = v.websites[0].address;
  if (v.added !== undefined) s.created = v.added;
  if (v.edited !== undefined) s.edited = v.edited;
  if (v.deletedAt !== undefined) s.deletedAt = v.deletedAt;
  return s;
}

export function candidateOf(e: ItemEntry): Candidate {
  const s = summarize(e);
  const c: Candidate = { id: s.id, group: s.group, groupId: s.groupId, deleted: s.deleted };
  if (s.title !== '') c.title = s.title;
  if (s.username !== undefined) c.username = s.username;
  if (s.url !== undefined) c.url = s.url;
  return c;
}

export function detail(e: ItemEntry, nowMs: number): ItemDetail {
  const v = e.view;
  const fields: DetailField[] = [];
  const add = (name: string, value: string | undefined, secret = false) => { if (value !== undefined) fields.push({ name, value, secret }); };
  add('username', v.username);
  add('password', v.password, true);
  v.websites.forEach((w, i) => add(i === 0 ? 'url' : `url ${i + 1}`, w.address));
  if (v.otp) fields.push({ name: 'code', value: totp(v.otp, nowMs).code, secret: true, computed: true });
  add('cardholder', v.cardholder);
  if (v.card) add('card', v.card.number, true);
  add('card_code', v.cardCode, true);
  add('card_pin', v.cardPin, true);
  add('notes', v.notes);
  for (const f of v.customFields) add(f.label, f.value, f.concealed);
  return { ...summarize(e), fields, view: v, notes: v.passwordNote ? [v.passwordNote] : [] };
}

// ---------------------------------------------------------------- fields by name

/** Built-in field names of a reference (case does not matter) mapped to the schema field. */
const BUILTIN: Record<string, string> = {
  title: 'title', username: 'username', password: 'password', url: 'url', note: 'notes', notes: 'notes', cardholder: 'cardholder',
  card: 'card', card_number: 'card', card_code: 'card_code', card_pin: 'card_pin',
};
export const builtinField = (field: string): string | undefined => BUILTIN[field.toLowerCase()];

export interface FieldTarget {
  /** the schema field that holds it (its writes are the history) */
  name: string;
  /** the label of a custom field, or the built-in name */
  label: string;
  custom: boolean;
  /** the current value */
  value: string;
  /** the text of one write's value */
  text: (v: CborValue) => string | undefined;
}

const asText = (v: CborValue): string | undefined => (typeof v === 'string' ? v : undefined);
const mapText = (key: number) => (v: CborValue): string | undefined => (v instanceof Map && typeof v.get(key) === 'string' ? (v.get(key) as string) : undefined);

/** Where a field of a reference lives in an item, or null when the item has no such field. `code` is computed and has no target. */
export function fieldTarget(v: ItemView, field: string): FieldTarget | null {
  const b = builtinField(field);
  if (b) {
    switch (b) {
      case 'url': { const w = v.websites[0]; return w ? { name: w.field, label: 'url', custom: false, value: w.address, text: mapText(1) } : null; }
      case 'card': return v.card ? { name: 'card', label: 'card', custom: false, value: v.card.number, text: mapText(1) } : null;
      default: {
        const value = ({ title: v.title, username: v.username, password: v.password, notes: v.notes, cardholder: v.cardholder, card_code: v.cardCode, card_pin: v.cardPin } as Record<string, string | undefined>)[b];
        return value === undefined ? null : { name: b, label: b, custom: false, value, text: asText };
      }
    }
  }
  const want = field.normalize('NFC');
  const exact = v.customFields.find((f) => f.label === want);
  const loose = v.customFields.filter((f) => fold(f.label) === fold(want));
  const f = exact ?? (loose.length === 1 ? loose[0] : undefined);
  return f ? { name: f.field, label: f.label, custom: true, value: f.value, text: mapText(2) } : null;
}

/** Earlier values of a field, newest first. For `password` this is Previous Passwords of the item schema (schema 4: repeated values
 *  and cleared writes are left out, at most 10, imported ones after); for any other field every earlier write the device still holds
 *  (a checkpoint drops them, schema 4). */
export function historyOf(entry: ItemEntry, target: FieldTarget): HistoryEntry[] {
  if (target.name === 'password') return entry.view.previousPasswords.map((p) => ({ value: p.value, replaced: p.replaced, from: p.from }));
  const list: Entry[] = entry.fields.get(target.name) ?? [];
  const out: HistoryEntry[] = [];
  for (let i = list.length - 2; i >= 0; i--) {
    const e = list[i]!;
    if (e.cleared) continue;
    const text = target.text(e.value);
    if (text !== undefined) out.push({ value: text, replaced: list[i + 1]!.key[0], from: 'writes' });
  }
  return out;
}

// ---------------------------------------------------------------- changes

const FIXED_LABELS: Record<string, string> = {
  type: 'type', title: 'title', username: 'username', password: 'password', password_rules: 'password rules', otp: 'code', passkey: 'passkey',
  cardholder: 'cardholder', card: 'card', card_code: 'card_code', card_pin: 'card_pin', notes: 'notes',
};
const LABEL_ORDER = ['title', 'username', 'password', 'url', 'code', 'passkey', 'cardholder', 'card', 'card_code', 'card_pin', 'notes', 'password rules', 'type', 'tags', 'attachments'];
const keyId = (k: OrderKey) => `${k[0]}:${k[1]}:${hex(k[2])}:${hex(k[3])}:${k[4]}`;

/** What happened to an item, newest first, one entry per record that changed something a person sees. Fields written in one record are one entry.
 *  Held writes only: a checkpoint keeps the winner of each field and the writes the previous passwords need, so older changes may be missing.
 *  Bookkeeping fields (dates, the source of an import, the marker of Clear Previous Passwords) are not changes. Values never appear. */
export function changesOf(entry: ItemEntry): ChangeEntry[] {
  interface Group { key: OrderKey; labels: Set<string>; added: boolean; deleted: boolean; restored: boolean }
  const groups = new Map<string, Group>();
  for (const [name, list] of entry.fields) {
    const c = classifyName(name);
    if (c.kind === 'invalid' || !c.known) continue;
    list.forEach((w, i) => {
      let label: string | undefined;
      let special: 'added' | 'deleted' | undefined;
      if (c.kind === 'fixed') {
        if (name === 'created') special = 'added';
        else if (name === 'deleted') special = 'deleted';
        else label = FIXED_LABELS[name];
      } else if (c.family === 'web') label = 'url';
      else if (c.family === 't') label = 'tags';
      else if (c.family === 'a') label = 'attachments';
      else if (c.family === 'f') {
        const labelOf = (e: Entry | undefined) => (e && !e.cleared && e.value instanceof Map && typeof e.value.get(1) === 'string' ? (e.value.get(1) as string) : undefined);
        label = labelOf(w) ?? [...list.slice(0, i)].reverse().map(labelOf).find((l) => l !== undefined) ?? 'custom field';
      }
      if (label === undefined && special === undefined) return;
      const id = keyId(w.key);
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { key: w.key, labels: new Set(), added: false, deleted: false, restored: false }));
      if (label !== undefined) g.labels.add(label);
      if (special === 'added' && !w.cleared) g.added = true;
      if (special === 'deleted') { if (w.cleared) g.restored = true; else g.deleted = true; }
    });
  }
  const rank = (l: string) => { const i = LABEL_ORDER.indexOf(l); return i < 0 ? LABEL_ORDER.length : i; };
  const out: { key: OrderKey; entry: ChangeEntry }[] = [];
  for (const g of groups.values()) {
    const fields = [...g.labels].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    if (g.added) out.push({ key: g.key, entry: { at: g.key[0], kind: 'added', fields } });
    else if (fields.length > 0) out.push({ key: g.key, entry: { at: g.key[0], kind: 'changed', fields } });
    if (g.deleted) out.push({ key: g.key, entry: { at: g.key[0], kind: 'deleted', fields: [] } });
    if (g.restored) out.push({ key: g.key, entry: { at: g.key[0], kind: 'restored', fields: [] } });
  }
  return out.sort((a, b) => compareKeys(b.key, a.key) || KIND_ORDER[b.entry.kind] - KIND_ORDER[a.entry.kind]).map((o) => o.entry);
}
const KIND_ORDER = { added: 0, changed: 1, restored: 2, deleted: 3 } as const;

// ---------------------------------------------------------------- search

/** Every whitespace-separated term must appear (case and normal form ignored) in the title, the username, a website, a tag or a custom field's label.
 *  Not in passwords, notes or custom values. */
export function matchesText(e: ItemEntry, text: string): boolean {
  const terms = fold(text).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const v = e.view;
  const hay = fold([titleOf(v), v.username ?? '', ...v.websites.map((w) => w.address), ...v.tags.map((t) => t.text), ...v.customFields.map((f) => f.label)].join('\n'));
  return terms.every((t) => hay.includes(t));
}

export { hex };
export type { CMap };
