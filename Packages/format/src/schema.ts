// The item schema (docs/format-schema.md, draft 3): what the fields of an item are on top of specification 5.1. Pure: no file system.
//  - names and shapes of fields (sections 1 to 3, 8) and the rule that a value of the wrong shape counts as cleared and is kept;
//  - builders that produce the `set` and `clear` of a kind 16 payload, with the writer's limits;
//  - positions between two others and at the end;
//  - `viewItem`: folded state (with the history the reader holds) turned into what the app shows (sections 4 to 7);
//  - moving an item and recognising a move (section 7) and the group settings item (section 8).
import { cmp, concat, eq, hex, utf8 } from './bytes.ts';
import { cmap, encode, isBytes, isMap, isUint, type CborValue, type CMap } from './cbor.ts';
import { isDeleted, type Entry } from './fold.ts';
import { CONTENT_FAMILIES, CONTENT_FIXED, FIXED_FIELDS, REPEATED_FAMILIES, SETTINGS_FIELDS, classifyName, isContentField, type NameClass } from './fields.ts';
import { limits, rules } from './limits.ts';
import { sha256 } from './prims.ts';
import { compareKeys, type OrderKey } from './record.ts';
import { hiddenPlace, isPlace, passwordInForce, previousFromWrites, schemaRetention, type Retention } from './retention.ts';

export { schemaRetention, hiddenPlace, classifyName, isContentField, FIXED_FIELDS, SETTINGS_FIELDS, REPEATED_FAMILIES, CONTENT_FIXED, CONTENT_FAMILIES };
export type { Retention, NameClass };

export type Fields = Map<string, Entry[]>;

/** Schema 8: the item whose item_id is 16 zero bytes is the group's settings, not an item. */
export const SETTINGS_ITEM_ID = new Uint8Array(16);
export const isSettingsItem = (itemId: Uint8Array) => eq(itemId, SETTINGS_ITEM_ID);

export class SchemaError extends Error {
  code: string;
  constructor(code: string, detail = '') { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

/** Schema 1: the id of a repeated field, 8 bytes in lowercase hexadecimal. */
export function newId(eightBytes: Uint8Array): string {
  if (eightBytes.length !== 8) throw new SchemaError('bad_id', 'an id is 8 bytes');
  return hex(eightBytes);
}

// ---------------------------------------------------------------- positions (schema 1)

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const dv = (c: string) => DIGITS.indexOf(c);
/** Schema 1: text of `0`-`9` and `a`-`z`, never empty, never ending in `0`. */
export const validPosition = (p: unknown): p is string => typeof p === 'string' && /^[0-9a-z]*[1-9a-z]$/.test(p);

/** Schema 1: a position that sorts (bytewise) strictly between `a` and `b`; `a` null means "before everything", `b` null "after everything".
 *  It always exists when a < b. With `b` null this is the position at the end. */
export function positionBetween(a: string | null, b: string | null): string {
  const lo = a ?? '';
  if (b !== null && !(lo < b)) throw new SchemaError('bad_position', 'the lower position must sort before the upper one');
  if (a !== null && !validPosition(a)) throw new SchemaError('bad_position', a);
  if (b !== null && !validPosition(b)) throw new SchemaError('bad_position', b);
  let out = '';
  let upper: string | null = b;
  for (let i = 0; ; i++) {
    const da = i < lo.length ? dv(lo[i]!) : 0;
    const db = upper === null ? 36 : i < upper.length ? dv(upper[i]!) : 0;
    if (da === db) { out += DIGITS[da]; continue; }
    if (db - da > 1) return out + DIGITS[da + ((db - da) >> 1)];
    out += DIGITS[da];
    upper = null; // below the upper position from here on: only the lower bound matters
  }
}
/** Schema 1: a position after the last of `existing` (any order; empty gives a first position). */
export const positionAtEnd = (existing: string[]): string => positionBetween(existing.length ? [...existing].sort().pop()! : null, null);

// ---------------------------------------------------------------- shapes (schema 2, 3, 8)

const isText = (v: unknown): v is string => typeof v === 'string';
const optText = (m: CMap, k: number) => !m.has(k) || isText(m.get(k));

const clockShape = (v: unknown) => Array.isArray(v) && v.length === 5 && isUint(v[0]) && isUint(v[1]) && isBytes(v[2], 32) && isBytes(v[3], 16) && isUint(v[4]);

/** Schema 2, 3, 8: does `value` have the shape of field `name`? A field the schema does not know has no shape to get wrong. A map value may carry
 *  keys the schema does not define: they are ignored (the schema does not say). */
export function shapeOk(name: string, value: CborValue, settings = false): boolean {
  const c = classifyName(name, settings);
  if (c.kind === 'invalid') return false;
  const m = isMap(value) ? value : null;
  if (c.kind === 'repeated') {
    if (!c.known) return true;
    switch (c.family) {
      case 'web': return !!m && isText(m.get(1)) && validPosition(m.get(2));
      case 'f': return !!m && isText(m.get(1)) && isText(m.get(2)) && typeof m.get(3) === 'boolean' && validPosition(m.get(4));
      case 'a': return !!m && isText(m.get(1)) && attachmentShape(m.get(2)) && validPosition(m.get(3)) && isUint(m.get(4));
      case 't': return isText(value);
      case 'gone': {
        if (!m || !isText(m.get(1)) || !isText(m.get(2)) || !isUint(m.get(3))) return false;
        return c.id === goneId(m.get(1) as string, m.get(2) as string);
      }
    }
    return true;
  }
  if (!c.known) return true;
  switch (name) {
    case 'type': return isUint(value);
    case 'title': case 'username': case 'password': case 'password_rules': case 'cardholder': case 'card_code': case 'card_pin': case 'notes': case 'name': return isText(value);
    case 'otp': return !!m && isBytes(m.get(1)) && isUint(m.get(2)) && (m.get(2) as number) >= limits.otpDigitsMin && (m.get(2) as number) <= limits.otpDigitsMax &&
      isUint(m.get(3)) && (m.get(3) as number) >= limits.otpPeriodMin && (m.get(3) as number) <= limits.otpPeriodMax && isUint(m.get(4)) && [1, 2, 3].includes(m.get(4) as number) && optText(m, 5) && optText(m, 6);
    case 'passkey': return !!m && isBytes(m.get(1)) && isBytes(m.get(2)) && isText(m.get(3)) && isText(m.get(4)) && isBytes(m.get(5)) && isUint(m.get(6));
    case 'card': {
      if (!m || !isText(m.get(1)) || !/^[0-9]+$/.test(m.get(1) as string)) return false;
      const y = m.get(2), mo = m.get(3);
      if (y === undefined && mo === undefined) return true;
      return isUint(y) && y >= 1000 && y <= 9999 && isUint(mo) && mo >= 1 && mo <= 12;
    }
    case 'created': case 'edited': case 'deleted': return isUint(value);
    case 'source': return !!m && isText(m.get(1)) && isText(m.get(2)) && isBytes(m.get(3));
    case 'password_history':
      return Array.isArray(value) && value.length <= 10 && value.every((e) => Array.isArray(e) && e.length === 2 && isText(e[0]) && isUint(e[1]));
    case 'history_hidden': return value === 1;
    case 'moved': case 'moved_from': return !!m && isBytes(m.get(1), 32) && isUint(m.get(2));
    case 'password_over': return value === null || clockShape(value);
  }
  return true;
}
function attachmentShape(v: unknown): boolean {
  return isMap(v) && isBytes(v.get(1), 32) && isUint(v.get(2)) && Array.isArray(v.get(3)) && (v.get(3) as unknown[]).every((c) => isBytes(c, 32));
}

/** Schema 8 (draft 2): the `id` in `gone/id`: the first 8 bytes of SHA-256 of the deterministic CBOR array `[kind, id]`, in hexadecimal. */
export const goneId = (kind: string, id: string): string => hex(sha256(encode([kind, id])).slice(0, 8));

// ---------------------------------------------------------------- builders (writer side)

const nfc = (s: string) => s.normalize('NFC');
const byteLen = (s: string) => utf8(s).length;
/** Schema 3 (draft 3): an address that does not contain `://` gets `https://` in front (so `localhost:3000` becomes `https://localhost:3000`). */
const hasScheme = (a: string) => a.includes('://');

export interface Counts { websites: { field: string }[]; customFields: { field: string }[]; attachments: { field: string }[]; tags: { field: string }[] }
export interface Otp { secret: Uint8Array; digits: number; period: number; algorithm: 1 | 2 | 3; issuer?: string; account?: string }
export interface Passkey { credentialId: Uint8Array; privateKey: Uint8Array; relyingParty: string; userName: string; userHandle: Uint8Array; created: number }
export interface Card { number: string; year?: number; month?: number }
export interface Source { kind: string; id: string; baseline: Uint8Array }

/** Builds the `set` and `clear` of one item change. Every method refuses what a writer must not write (schema 1: sizes, names, shapes).
 *  `existing` (a view of the item) lets it count the entries already there and tell an edit from an addition. */
export class ItemChange {
  set = new Map<string, CborValue>();
  clear = new Set<string>();
  private existing?: Partial<Counts>;
  constructor(existing?: Partial<Counts>) { this.existing = existing; }

  private put(name: string, value: CborValue, settings = false): this {
    if (classifyName(name, settings).kind === 'invalid') throw new SchemaError('bad_field_name', name);
    this.clear.delete(name);
    this.set.set(name, value);
    return this;
  }
  private text(s: string, max = limits.textBytes): string {
    if (typeof s !== 'string') throw new SchemaError('bad_value', 'text expected');
    if (byteLen(s) > max) throw new SchemaError(max === limits.notesBytes ? 'notes_too_long' : 'text_too_long');
    return s;
  }
  private room(kind: keyof Counts, name: string, max: number, code: string): void {
    const have = this.existing?.[kind] ?? [];
    const adding = !have.some((x) => x.field === name) && !this.set.has(name);
    const pending = [...this.set.keys()].filter((k) => k.startsWith(kind === 'websites' ? 'web/' : kind === 'customFields' ? 'f/' : kind === 'attachments' ? 'a/' : 't/')).filter((k) => !have.some((x) => x.field === k)).length;
    if (adding && have.length + pending >= max) throw new SchemaError(code);
  }
  private repeated(family: string, id: string): string {
    const name = `${family}/${id}`;
    if (classifyName(name).kind !== 'repeated') throw new SchemaError('bad_field_name', name);
    return name;
  }

  /** Writes any field by name and value, unchecked beyond the name: for fields this version does not know, and for tests of wrong shapes. */
  raw(name: string, value: CborValue): this { return this.put(name, value); }
  /** Writes a name a writer must not write: for tests of what a reader does with a record from a writer that did. */
  rawAnyName(name: string, value: CborValue): this { this.clear.delete(name); this.set.set(name, value); return this; }
  /** Removing a field is clearing it (specification 5.1). */
  remove(name: string): this { if (classifyName(name).kind === 'invalid') throw new SchemaError('bad_field_name', name); this.set.delete(name); this.clear.add(name); return this; }

  type(n: 1 | 2 | 3 | 4): this { return this.put('type', n); }
  title(s: string): this { return this.put('title', this.text(nfc(s))); }
  username(s: string): this { return this.put('username', this.text(s)); }
  /** A secret is stored exactly as entered (schema 1). */
  /** Schema 2 (draft 2): every change of `password` carries `password_over` in the same record: the place of the write this device saw as the
   *  current password (`view.passwordPlace`), or null when it saw none. */
  password(s: string, over: OrderKey | null = null): this {
    this.put('password', this.text(s));
    return this.checked('password_over', over === null ? null : placeValue(over));
  }
  passwordRules(s: string): this { return this.put('password_rules', this.text(s)); }
  otp(o: Otp): this {
    const m = cmap([[1, o.secret], [2, o.digits], [3, o.period], [4, o.algorithm]]);
    if (o.issuer !== undefined) m.set(5, this.text(o.issuer));
    if (o.account !== undefined) m.set(6, this.text(o.account));
    return this.checked('otp', m);
  }
  passkey(p: Passkey): this {
    return this.checked('passkey', cmap([[1, p.credentialId], [2, p.privateKey], [3, this.text(p.relyingParty)], [4, this.text(p.userName)], [5, p.userHandle], [6, p.created]]));
  }
  cardholder(s: string): this { return this.put('cardholder', this.text(nfc(s))); }
  card(c: Card): this {
    const m = cmap([[1, c.number]]);
    if (c.year !== undefined) m.set(2, c.year);
    if (c.month !== undefined) m.set(3, c.month);
    return this.checked('card', m);
  }
  cardCode(s: string): this { return this.put('card_code', this.text(s)); }
  cardPin(s: string): this { return this.put('card_pin', this.text(s)); }
  notes(s: string): this { return this.put('notes', this.text(nfc(s), limits.notesBytes)); }
  created(ms: number): this { return this.checked('created', ms); }
  edited(ms: number): this { return this.checked('edited', ms); }
  source(s: Source): this { return this.checked('source', cmap([[1, this.text(s.kind)], [2, this.text(s.id)], [3, s.baseline]])); }
  passwordHistory(list: [string, number][]): this { return this.checked('password_history', list.map(([p, t]) => [this.text(p), t] as CborValue)); }
  /** Schema 2 and 4 (draft 3): the value is `1`; what is hidden follows from the place of this write itself. */
  historyHidden(): this { return this.checked('history_hidden', 1); }
  moved(gid: Uint8Array, when: number): this { return this.checked('moved', cmap([[1, gid], [2, when]])); }
  movedFrom(gid: Uint8Array, when: number): this { return this.checked('moved_from', cmap([[1, gid], [2, when]])); }
  passwordOver(over: OrderKey | null): this { return this.checked('password_over', over === null ? null : placeValue(over)); }
  /** Schema 5 (draft 2): the first record of an item sets `created`. */
  static newItem(nowMs: number): ItemChange { return new ItemChange().created(nowMs); }
  deleted(ms: number): this { return this.checked('deleted', ms); }

  /** `https://` is added when the person gave no scheme (schema 3). */
  website(id: string, address: string, pos: string): this {
    const name = this.repeated('web', id);
    this.room('websites', name, limits.websites, 'too_many_websites');
    const a = this.text(hasScheme(address) ? address : `https://${address}`);
    return this.checked(name, cmap([[1, a], [2, pos]]));
  }
  customField(id: string, label: string, value: string, concealed: boolean, pos: string): this {
    const name = this.repeated('f', id);
    this.room('customFields', name, limits.customFields, 'too_many_custom_fields');
    return this.checked(name, cmap([[1, this.text(nfc(label))], [2, this.text(value)], [3, concealed], [4, pos]]));
  }
  attachment(id: string, fileName: string, attachment: CborValue, pos: string, added: number): this {
    const name = this.repeated('a', id);
    this.room('attachments', name, limits.attachments, 'too_many_attachments');
    return this.checked(name, cmap([[1, this.text(nfc(fileName))], [2, attachment], [3, pos], [4, added]]));
  }
  tag(id: string, text: string): this {
    const name = this.repeated('t', id);
    this.room('tags', name, limits.tags, 'too_many_tags');
    return this.checked(name, this.text(nfc(text)));
  }
  /** Schema 3 (draft 3): removing a tag by its text clears every field that holds the text, as many as the view lists. The text is compared as NFC.
   *  A tag the item does not hold changes nothing. */
  removeTag(v: Pick<ItemView, 'tags'>, text: string): this {
    const t = nfc(text);
    for (const tag of v.tags) if (tag.text === t) for (const f of tag.fields) this.remove(f);
    return this;
  }
  /** Schema 8, the settings item. */
  groupName(s: string): this { return this.put('name', this.text(nfc(s)), true); }
  gone(kind: string, id: string, when: number): this { return this.checked(`gone/${goneId(kind, id)}`, cmap([[1, kind], [2, id], [3, when]]), true); }

  private checked(name: string, value: CborValue, settings = false): this {
    if (!shapeOk(name, value, settings)) throw new SchemaError('bad_value', name);
    return this.put(name, value, settings);
  }

  /** Schema 4: Restoring a previous password sets `password` to that value (a new write). */
  restorePassword(value: string, over: OrderKey | null = null): this { return this.password(value, over); }
  /** Schema 4 (draft 3): Clear Previous Passwords sets `history_hidden` (value `1`) and clears `password_history`. Needs the view, only to see that
   *  there is a current write of `password`; with none there is nothing to clear. */
  clearPreviousPasswords(v: Pick<ItemView, 'passwordPlace'>): this {
    if (!v.passwordPlace) throw new SchemaError('no_password', 'there is no current password write to clear the history of');
    return this.historyHidden().remove('password_history');
  }

  /** The kind 16 payload for `itemId` (specification 5.1). */
  payload(itemId: Uint8Array): CMap { return changePayload(itemId, this.set, [...this.clear]); }
}

const placeValue = (k: OrderKey): CborValue => [k[0], k[1], k[2], k[3], k[4]];

/** A kind 16 payload from a set and a clear. */
export function changePayload(itemId: Uint8Array, set: Map<string, CborValue> | [string, CborValue][], clear: string[]): CMap {
  const names = [...clear].sort((a, b) => cmp(encode(a), encode(b)));
  return cmap([[1, itemId], [2, new Map(set) as CborValue], [3, names]]);
}

// ---------------------------------------------------------------- the view (reader side)

export interface Site { field: string; address: string; pos: string }
export interface Custom { field: string; label: string; value: string; concealed: boolean; pos: string }
export interface Attached { field: string; fileName: string; attachment: CborValue; pos: string; added: number }
export interface TagView { text: string; fields: string[] }
export interface Previous { value: string; replaced: number; from: 'writes' | 'import' }

export interface ItemView {
  /** 1 login, 2 card, 3 secure note, 4 custom item; an unknown or absent type is shown as 4 */
  type: number;
  typeRaw: number | null;
  title?: string;
  /** the title, or for a login without one the first website */
  displayTitle?: string;
  username?: string; password?: string; passwordRules?: string;
  otp?: { secret: Uint8Array; digits: number; period: number; algorithm: number; issuer?: string; account?: string };
  passkey?: { credentialId: Uint8Array; privateKey: Uint8Array; relyingParty: string; userName: string; userHandle: Uint8Array; created: number };
  cardholder?: string;
  card?: { number: string; year?: number; month?: number };
  cardCode?: string; cardPin?: string; notes?: string;
  websites: Site[]; customFields: Custom[]; attachments: Attached[]; tags: TagView[];
  previousPasswords: Previous[];
  /** the place of the current winning write of `password`, for Clear Previous Passwords */
  passwordPlace: OrderKey | null;
  /** schema 4 (draft 2): the winning write of `password` was made by a device that had not seen the write just before it in the order */
  passwordNote: 'changed_on_two_devices' | null;
  /** Added: `created`, or (no valid `created`) the wall time of the earliest write the reader holds, which can drift after a checkpoint */
  added?: number;
  /** true when `added` is the earliest write held and not `created` */
  addedEstimated: boolean;
  /** Edited as the schema defines it before the rule that hides it unless it is later than Added: what a move writes into `edited` */
  editedRaw?: number;
  /** Edited as shown: only when later than Added */
  edited?: number;
  deleted: boolean; deletedAt?: number;
  moved?: { gid: Uint8Array; when: number; key: OrderKey };
  movedFrom?: { gid: Uint8Array; when: number; key: OrderKey };
  /** schema 7: an item with `moved` set is not shown */
  shown: boolean;
  /** fields with a wrong shape or a name the schema does not allow: treated as cleared, kept */
  invalid: string[];
  /** fields the schema does not know: never shown, never cleared, carried along */
  unknown: string[];
  /** every current field that is not cleared, as written (wrong shapes and unknown fields included) */
  carry: Map<string, CborValue>;
}

const win = (list: Entry[] | undefined): Entry | undefined => list?.[list.length - 1];

/** Turns one item's folded state (every write the reader holds, oldest first per field) into what the app shows. */
export function viewItem(fields: Fields): ItemView {
  const invalid: string[] = [], unknown: string[] = [];
  const carry = new Map<string, CborValue>();
  /** the effective value of a field: its winning write when that is not cleared and of the right shape */
  const eff = new Map<string, { value: CborValue; entry: Entry }>();
  for (const [name, list] of fields) {
    const w = win(list);
    if (!w) continue;
    const c = classifyName(name);
    if (!w.cleared) carry.set(name, w.value);
    if (c.kind === 'invalid') { invalid.push(name); continue; }
    if (!c.known) { unknown.push(name); continue; }
    if (w.cleared) continue;
    if (rules.wrongShapeIsCleared && !shapeOk(name, w.value)) { invalid.push(name); continue; }
    eff.set(name, { value: w.value, entry: w });
  }
  const text = (n: string) => (eff.get(n)?.value as string | undefined);
  const num = (n: string) => (eff.get(n)?.value as number | undefined);
  const rep = <T extends { pos: string; field: string }>(family: string, f: (field: string, m: CMap) => T): T[] => {
    const out: T[] = [];
    for (const [name, e] of eff) if (name.startsWith(`${family}/`)) out.push(f(name, e.value as CMap));
    return out.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : rules.positionTiesByName ? (a.field < b.field ? -1 : 1) : 0));
  };
  const websites = rep<Site>('web', (field, m) => ({ field, address: m.get(1) as string, pos: m.get(2) as string }));
  const customFields = rep<Custom>('f', (field, m) => ({ field, label: m.get(1) as string, value: m.get(2) as string, concealed: m.get(3) as boolean, pos: m.get(4) as string }));
  const attachments = rep<Attached>('a', (field, m) => ({ field, fileName: m.get(1) as string, attachment: m.get(2)!, pos: m.get(3) as string, added: m.get(4) as number }));
  const tagMap = new Map<string, string[]>();
  for (const [name, e] of eff) if (name.startsWith('t/')) { const t = e.value as string; tagMap.set(t, [...(tagMap.get(t) ?? []), name]); }
  const tags = [...tagMap].sort(([a], [b]) => (rules.tagsUtf8Order ? cmp(utf8(a), utf8(b)) : a < b ? -1 : a > b ? 1 : 0)).map(([t, fs]) => ({ text: t, fields: fs.sort() }));

  const typeRaw = num('type') ?? null;
  const type = typeRaw !== null && typeRaw >= 1 && typeRaw <= 3 ? typeRaw : 4;
  const title = text('title');
  const view: ItemView = {
    type, typeRaw, websites, customFields, attachments, tags, previousPasswords: [], passwordPlace: null, passwordNote: null, addedEstimated: false,
    deleted: false, shown: true, invalid: invalid.sort(), unknown: unknown.sort(), carry,
  };
  if (title !== undefined) view.title = title;
  view.displayTitle = title ?? (type === 1 ? websites[0]?.address : undefined);
  for (const [k, n] of [['username', 'username'], ['password', 'password'], ['passwordRules', 'password_rules'], ['cardholder', 'cardholder'], ['cardCode', 'card_code'], ['cardPin', 'card_pin'], ['notes', 'notes']] as const) {
    const v = text(n);
    if (v !== undefined) (view as any)[k] = v;
  }
  const otp = eff.get('otp')?.value as CMap | undefined;
  if (otp) view.otp = { secret: otp.get(1) as Uint8Array, digits: otp.get(2) as number, period: otp.get(3) as number, algorithm: otp.get(4) as number, ...(otp.has(5) ? { issuer: otp.get(5) as string } : {}), ...(otp.has(6) ? { account: otp.get(6) as string } : {}) };
  const pk = eff.get('passkey')?.value as CMap | undefined;
  if (pk) view.passkey = { credentialId: pk.get(1) as Uint8Array, privateKey: pk.get(2) as Uint8Array, relyingParty: pk.get(3) as string, userName: pk.get(4) as string, userHandle: pk.get(5) as Uint8Array, created: pk.get(6) as number };
  const card = eff.get('card')?.value as CMap | undefined;
  if (card) view.card = { number: card.get(1) as string, ...(card.has(2) ? { year: card.get(2) as number, month: card.get(3) as number } : {}) };

  // Schema 4 (draft 2): previous passwords.
  const pw = fields.get('password') ?? [];
  const pwWin = win(pw);
  if (pwWin) view.passwordPlace = pwWin.key;
  const inForce = passwordInForce(pw, rules.historyHiddenApplies ? hiddenPlace(fields) : null);
  const prev: Previous[] = previousFromWrites(inForce).map((p) => ({ value: p.write.value as string, replaced: p.next.key[0], from: 'writes' as const }));
  const cur = view.password;
  const seen = new Set<string>(cur !== undefined ? [cur] : []);
  for (const p of prev) seen.add(p.value);
  const ph = eff.get('password_history')?.value as [string, number][] | undefined;
  if (ph) for (const [p, t] of ph) {
    if (rules.previousUnique && seen.has(p)) continue;
    seen.add(p);
    prev.push({ value: p, replaced: t, from: 'import' });
  }
  view.previousPasswords = prev.slice(0, limits.historyShown);
  // The note: the winning write's password_over (written in the same record) is not the place of the write just before it.
  if (inForce.length >= 2 && pwWin && inForce[inForce.length - 1] === pwWin && !pwWin.cleared && isText(pwWin.value)) {
    const ow = win(fields.get('password_over'));
    if (ow && !ow.cleared && compareKeys(ow.key, pwWin.key) === 0 && (ow.value === null || isPlace(ow.value))) {
      const before = inForce[inForce.length - 2]!;
      if (ow.value === null || compareKeys(ow.value as OrderKey, before.key) !== 0) view.passwordNote = 'changed_on_two_devices';
    }
  }

  // Schema 5 (draft 2): dates.
  const created = num('created');
  let earliest: number | undefined;
  for (const list of fields.values()) for (const e of list) earliest = earliest === undefined ? e.key[0] : Math.min(earliest, e.key[0]);
  const added = created ?? earliest;
  if (added !== undefined) view.added = added;
  view.addedEstimated = created === undefined && added !== undefined;
  let latest: OrderKey | null = null;
  for (const [name, list] of fields) {
    if (!isContentField(name)) continue;
    const w = win(list)!;
    if (!latest || compareKeys(w.key, latest) > 0) latest = w.key;
  }
  const editedField = eff.get('edited');
  if (editedField && rules.importedEditedKept && !(latest && compareKeys(latest, editedField.entry.key) > 0)) view.editedRaw = editedField.value as number;
  else if (latest) view.editedRaw = latest[0];
  if (view.editedRaw !== undefined && (added === undefined || view.editedRaw > added)) view.edited = view.editedRaw;

  // Schema 6 and specification 5.1: Recently Deleted. One implementation, in fold.ts, with the schema's list of content fields.
  const del = eff.get('deleted');
  if (del && isDeleted(fields)) { view.deleted = true; view.deletedAt = del.value as number; }

  // Schema 7: moved.
  const keyed = (n: string) => { const e = eff.get(n); if (!e) return undefined; const m = e.value as CMap; return { gid: m.get(1) as Uint8Array, when: m.get(2) as number, key: e.entry.key }; };
  const mv = keyed('moved');
  if (mv) { view.moved = mv; view.shown = false; }
  const mf = keyed('moved_from');
  if (mf) view.movedFrom = mf;
  return view;
}

// ---------------------------------------------------------------- the settings item (schema 8)

export interface SettingsView { name?: string; gone: { field: string; kind: string; id: string; when: number }[]; invalid: string[]; unknown: string[] }

export function viewSettings(fields: Fields): SettingsView {
  const out: SettingsView = { gone: [], invalid: [], unknown: [] };
  for (const [name, list] of fields) {
    const w = win(list);
    if (!w) continue;
    const c = classifyName(name, true);
    if (c.kind === 'invalid') { out.invalid.push(name); continue; }
    if (!c.known) { out.unknown.push(name); continue; }
    if (w.cleared) continue;
    if (rules.wrongShapeIsCleared && !shapeOk(name, w.value, true)) { out.invalid.push(name); continue; }
    if (name === 'name') out.name = w.value as string;
    else { const m = w.value as CMap; out.gone.push({ field: name, kind: m.get(1) as string, id: m.get(2) as string, when: m.get(3) as number }); }
  }
  out.gone.sort((a, b) => (a.field < b.field ? -1 : 1)); out.invalid.sort(); out.unknown.sort();
  return out;
}

// ---------------------------------------------------------------- moving an item (schema 7, draft 3)

export interface MoveRecords {
  /** record 1, in the group the item goes to */
  target: { set: Map<string, CborValue>; clear: string[] };
  /** record 2, in the group it leaves: sets `moved`, naming the group the item went to */
  source: { set: Map<string, CborValue>; clear: string[] };
}

const NOT_CARRIED = new Set(['created', 'edited', 'moved', 'moved_from', 'password_over', 'deleted', 'password_history', 'history_hidden']);

/** Schema 7 (draft 3): the two payloads, in the order they must be written. Earlier writes are not copied.
 *  `target` is the folded state of the item in the group it goes to (the copy that group already holds, for example one marked `moved`
 *  when the item is coming back), or null when that group holds none. It decides `password_over` (the place of the winning write of `password`
 *  in that copy, or null) and which content fields the record clears (those the copy has and the arriving item does not).
 *  `reseal` seals an attachment again as a new attachment, since chunks live with a group (it needs the chunks, which this module does not have). */
export function moveRecords(view: ItemView, fromGid: Uint8Array, toGid: Uint8Array, nowMs: number, target: Fields | null,
                            reseal?: (attachment: CborValue) => CborValue): MoveRecords {
  const set = new Map<string, CborValue>();
  // every content field, every unknown field and every field of the wrong shape: the view's `carry` holds the current value of each
  for (const [name, value] of view.carry) {
    const c = classifyName(name);
    if (c.kind === 'invalid' || NOT_CARRIED.has(name)) continue; // not a field name: a writer must not write it
    set.set(name, c.kind === 'repeated' && c.family === 'a' && reseal && shapeOk(name, value) ? cmap([...(value as CMap)].map(([k, v]) => [k, k === 2 ? reseal(v) : v] as [number, CborValue])) : value);
  }
  if (view.added !== undefined) set.set('created', view.added);
  if (view.editedRaw !== undefined) set.set('edited', view.editedRaw);
  set.set('moved_from', cmap([[1, fromGid], [2, nowMs]]));
  const held = target?.get('password');
  const heldWin = held && held.length ? held[held.length - 1]! : undefined;
  set.set('password_over', heldWin ? placeValue(heldWin.key) : null);
  const clear = new Set<string>(['moved']);
  if (view.deleted && view.deletedAt !== undefined) set.set('deleted', view.deletedAt); else clear.add('deleted');
  if (target) for (const [name, list] of target) { const w = win(list); if (w && !w.cleared && isContentField(name) && !set.has(name)) clear.add(name); }
  return {
    target: { set, clear: [...clear].sort() },
    source: { set: new Map<string, CborValue>([['moved', cmap([[1, toGid], [2, nowMs]])]]), clear: [] },
  };
}

export interface InGroup { gid: Uint8Array; fields: Fields }
export type TwoGroups =
  | { kind: 'moved'; from: Uint8Array; to: Uint8Array }
  | { kind: 'move_in_progress'; from: Uint8Array; to: Uint8Array; markOn: Uint8Array }
  | { kind: 'separate' };

/** Schema 7 (draft 2): the same item_id in two groups. If one copy carries `moved_from` naming the other group: when the other copy has a `moved`
 *  later than that `moved_from` and naming this group the move is complete (`moved`); otherwise it is in progress (the other copy is about to go: the
 *  device that wrote the first record writes the second). If both carry `moved_from` naming each other (there and back), the later one is the way the item went last.
 *  With no `moved_from` from one to the other the two are separate items. */
export function classifyInTwoGroups(a: InGroup, b: InGroup): TwoGroups {
  const va = viewItem(a.fields), vb = viewItem(b.fields);
  const arrived = (to: InGroup, vt: ItemView, from: InGroup) => (vt.movedFrom && eq(vt.movedFrom.gid, from.gid) ? vt.movedFrom : undefined);
  const ta = arrived(a, va, b), tb = arrived(b, vb, a);
  const pick = (to: InGroup, vt: ItemView, from: InGroup, vf: ItemView, mf: NonNullable<ItemView['movedFrom']>): TwoGroups =>
    vf.moved && eq(vf.moved.gid, to.gid) && compareKeys(vf.moved.key, mf.key) > 0 ? { kind: 'moved', from: from.gid, to: to.gid } : { kind: 'move_in_progress', from: from.gid, to: to.gid, markOn: from.gid };
  if (ta && tb) return compareKeys(ta.key, tb.key) >= 0 ? pick(a, va, b, vb, ta) : pick(b, vb, a, va, tb);
  if (ta) return pick(a, va, b, vb, ta);
  if (tb) return pick(b, vb, a, va, tb);
  return { kind: 'separate' };
}
