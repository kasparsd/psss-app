import type { Item, Kind } from './data';

/** The orders of the All list. */
export type SortKey = 'used' | 'most' | 'changed' | 'name';
export const sortKeys: SortKey[] = ['used', 'most', 'changed', 'name'];
export const sortNames: Record<SortKey, string> = {
  used: 'Recently used',
  most: 'Most used',
  changed: 'Recently changed',
  name: 'Name',
};

/** The kind of item the All list shows. One at a time. */
export type TypeKey = 'all' | 'logins' | 'notes' | 'custom';
export const typeKeys: TypeKey[] = ['all', 'logins', 'notes', 'custom'];
export const typeNames: Record<TypeKey, string> = { all: 'All', logins: 'Logins', notes: 'Notes', custom: 'Custom items' };
const kindOf: Record<Exclude<TypeKey, 'all'>, Kind> = { logins: 'login', notes: 'note', custom: 'custom' };

/** What an item has. Any number; an item must have all that are chosen. */
export type Feat = 'passkey' | 'notes';
export const featKeys: Feat[] = ['passkey', 'notes'];
export const featNames: Record<Feat, string> = { passkey: 'Passkey', notes: 'Notes' };

/** A choice that can never match the chosen kind is dimmed: only logins have a passkey, and a secure note is all notes. */
export function featApplies(f: Feat, t: TypeKey): boolean {
  if (f === 'notes') return t !== 'notes';
  return t === 'all' || t === 'logins';
}

const az = (a: Item, b: Item) => a.name.localeCompare(b.name);
/** A made-up "changed" order for the sample vault. */
const changedRank = (i: Item) => (i.id * 7) % 15;

export function sortItems<T extends Item>(list: T[], sort: SortKey): T[] {
  const l = [...list];
  switch (sort) {
    case 'name': return l.sort(az);
    case 'most': return l.sort((a, b) => b.uses - a.uses || az(a, b));
    case 'changed': return l.sort((a, b) => changedRank(b) - changedRank(a));
    // Items used in the last 30 days first, in the order they were used; the rest A to Z.
    case 'used': return l.sort((a, b) => Number(!!b.recent) - Number(!!a.recent) || (a.recent && b.recent ? a.id - b.id : az(a, b)));
  }
}

const hasFeat = (i: Item, f: Feat) =>
  f === 'passkey' ? !!i.passkey : i.kind !== 'note' && i.fields.some((x) => x.label === 'Notes');

export function listOne<T extends Item>(list: T[], type: TypeKey, feats: Feat[], sort: SortKey): T[] {
  const typed = type === 'all' ? list : list.filter((i) => i.kind === kindOf[type]);
  const kept = typed.filter((i) => feats.every((f) => !featApplies(f, type) || hasFeat(i, f)));
  // Expired cards always come last.
  return sortItems(kept, sort).sort((a, b) => Number(!!a.expired) - Number(!!b.expired));
}

/** "With passkey and notes", for the line under the title. */
export function featLine(feats: Feat[], type: TypeKey): string {
  const on = feats.filter((f) => featApplies(f, type)).map((f) => featNames[f].toLowerCase());
  if (!on.length) return '';
  return `With ${on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}` : on[0]}`;
}

// ---- The "Recently used" group at the top of All, Codes and Cards ----

/** At most this many items in the group; no group when the list has this many or fewer. */
export const recentMax = 5;

export interface Sectioned<T> {
  /** The group, most recently used first; empty when there is none. */
  recent: T[];
  /** Every listed item, including those in the group. */
  main: T[];
}

/**
 * The group of recently used items above a list. `main` is the list in the
 * order it is shown under the group. No group when the list has five items or
 * fewer, or when none was used in the last 30 days.
 */
export function withRecent<T extends Item>(list: T[], main: T[] = list): Sectioned<T> {
  if (list.length <= recentMax) return { recent: [], main };
  const recent = list.filter((i) => i.recent).sort((a, b) => a.id - b.id).slice(0, recentMax);
  return { recent, main };
}

/** All: the group appears only in the default order, and never in search results. */
export function allSections<T extends Item>(list: T[], type: TypeKey, feats: Feat[], sort: SortKey): Sectioned<T> {
  const main = listOne(list, type, feats, sort);
  if (sort !== 'used') return { recent: [], main };
  const grouped = withRecent(main.filter((i) => !i.expired), listOne(list, type, feats, 'name'));
  return grouped.recent.length ? grouped : { recent: [], main };
}

/** The heading over the full list when a group is shown above it. */
export const allHeading = (type: TypeKey) => (type === 'all' ? 'All items' : `All ${type === 'custom' ? 'custom items' : typeNames[type].toLowerCase()}`);
