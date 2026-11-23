// Which writes of a field a checkpoint carries (specification 5.3 leaves it to the item schema; schema 4, draft 2).
import { compareKeys, type OrderKey } from './record.ts';
import type { Entry } from './fold.ts';
import { limits, rules } from './limits.ts';

/** `writes` are the field's writes, oldest first, the last being the winner. `fields` are all fields of the item. Returns the writes to
 *  carry: it MUST include the winner. */
export type Retention = (item: string, field: string, writes: Entry[], fields: Map<string, Entry[]>) => Entry[];

const isClock = (v: unknown): v is OrderKey =>
  Array.isArray(v) && v.length === 5 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[2] instanceof Uint8Array && v[2].length === 32 &&
  v[3] instanceof Uint8Array && v[3].length === 16 && typeof v[4] === 'number';
export const isPlace = isClock;

/** Schema 4 (draft 3): where Clear Previous Passwords hides from: the place of the winning write of `history_hidden` itself, when its value is a
 *  valid `1`. The value says nothing else, so a clearing that is later in the order always hides at least what an earlier one hid. */
export function hiddenPlace(fields: Map<string, Entry[]>): OrderKey | null {
  const list = fields.get('history_hidden');
  const cur = list?.[list.length - 1];
  return cur && !cur.cleared && cur.value === 1 ? cur.key : null;
}

/** Schema 4 (draft 3): the writes of `password` that are in force. Of the writes before the winning write of `history_hidden` (`hidden`) in the
 *  order, all but the last are left out: the last is the password that was current when the person cleared. `pw` is oldest first. */
export function passwordInForce(pw: Entry[], hidden: OrderKey | null): Entry[] {
  if (!hidden || !rules.historyHiddenApplies) return pw;
  let last = -1;
  for (let i = 0; i < pw.length && compareKeys(pw[i]!.key, hidden) < 0; i++) last = i;
  return last <= 0 ? pw : pw.slice(last);
}

const textOf = (e: Entry): string | null => (e.cleared || typeof e.value !== 'string' ? null : e.value);

/** Schema 4: the entries that earlier writes of `password` give, newest first, each with the write that replaced it (which dates it).
 *  A write that cleared the password (or has the wrong shape), or set the value the write after it also set, is not an entry. An entry equal
 *  to the current password or to a newer entry is left out. `inForce` is `passwordInForce(...)`, oldest first, the winner last. */
export function previousFromWrites(inForce: Entry[]): { write: Entry; next: Entry }[] {
  if (inForce.length < 2) return [];
  const win = inForce[inForce.length - 1]!;
  const seen = new Set<string>();
  const cur = textOf(win);
  if (cur !== null) seen.add(cur);
  const out: { write: Entry; next: Entry }[] = [];
  for (let i = inForce.length - 2; i >= 0; i--) {
    const e = inForce[i]!, next = inForce[i + 1]!, v = textOf(e);
    if (v === null) continue;
    if (rules.previousUnique && seen.has(v)) continue;
    seen.add(v);
    out.push({ write: e, next });
  }
  return out;
}

/** Schema 4, the table: `password` keeps the writes its first 10 entries need (each entry's write and the write after it, which dates it), the
 *  write just before the winner (the one `password_over` is compared with), the winner, and (not in the table of draft 3) the last write before
 *  `history_hidden`; every other field keeps its winner only. */
export const schemaRetention: Retention = (_item, field, writes, fields) => {
  const win = writes[writes.length - 1]!;
  if (field !== 'password') return [win];
  const inForce = passwordInForce(writes, hiddenPlace(fields));
  if (inForce[inForce.length - 1] !== win) return [win];
  const entries = previousFromWrites(inForce).slice(0, Math.max(0, limits.historyKept));
  const keep = new Set<Entry>([win]);
  for (const e of entries) { keep.add(e.write); if (rules.retentionKeepsNeighbours) keep.add(e.next); }
  if (rules.retentionKeepsNeighbours && inForce.length >= 2) keep.add(inForce[inForce.length - 2]!);
  // The write that divides what is hidden from what is shown: the last write before `history_hidden`. A write that arrives after the checkpoint and
  // sorts before it must not become the divider in its place, which would show the passwords between them.
  const hid = hiddenPlace(fields);
  if (rules.retentionKeepsDivider && hid && inForce.length && compareKeys(inForce[0]!.key, hid) < 0) keep.add(inForce[0]!);
  return writes.filter((w) => keep.has(w));
};
