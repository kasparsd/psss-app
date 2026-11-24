// Entry history, with the rules of the app's KeePassHistory: an earlier version is a whole copy of the entry (without its
// own history); the list is bounded by Meta.historyMaxItems and Meta.historyMaxSize, oldest dropped first; a version
// identical to the newest one already there is not added twice.
import type { KdbxDatabase, KdbxEntry } from './model.ts';

const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_MAX_SIZE = 6_291_456;

/** A copy of the entry as it is now, with no history of its own, ready to become a history item. */
export function snapshotEntry(entry: KdbxEntry): KdbxEntry {
  // structuredClone would copy a whole backing buffer for every attachment view, so attachments share their bytes.
  const copy = structuredClone({ ...entry, attachments: [], history: [] as KdbxEntry[] });
  copy.attachments = entry.attachments.map((a) => ({ ...a }));
  return copy;
}

/** History items oldest first by modification time, in file order among equal times (other writers may not sort them). */
export function orderedHistory(entry: KdbxEntry): KdbxEntry[] {
  return entry.history.map((item, index) => ({ item, index })).sort((a, b) => {
    const x = a.item.times.lastModification?.getTime() ?? -Infinity;
    const y = b.item.times.lastModification?.getTime() ?? -Infinity;
    return x === y ? a.index - b.index : x < y ? -1 : 1;
  }).map((o) => o.item);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((v, i) => v === b[i]);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** The bytes an item counts for against historyMaxSize: names and values of its fields, attachments, tags and custom data. */
export function historyItemSize(item: KdbxEntry): number {
  const enc = new TextEncoder();
  let n = 0;
  for (const f of item.fields) n += enc.encode(f.name).length + enc.encode(f.value).length;
  for (const a of item.attachments) n += enc.encode(a.name).length + a.data.length;
  for (const c of item.customData) n += enc.encode(c.key).length + enc.encode(c.value).length;
  for (const t of item.tags) n += enc.encode(t).length;
  return n;
}

/** Drops the oldest items until the history fits (-1 means unlimited). */
export function trimHistory(db: KdbxDatabase, entry: KdbxEntry): void {
  const dropOldest = () => {
    const oldest = orderedHistory(entry)[0];
    if (oldest) entry.history = entry.history.filter((h) => h !== oldest);
  };
  const maxItems = db.meta.historyMaxItems ?? DEFAULT_MAX_ITEMS;
  while (maxItems >= 0 && entry.history.length > maxItems) dropOldest();
  const maxSize = db.meta.historyMaxSize ?? DEFAULT_MAX_SIZE;
  if (maxSize >= 0) {
    let total = entry.history.reduce((n, h) => n + historyItemSize(h), 0);
    while (total > maxSize && entry.history.length > 0) {
      const oldest = orderedHistory(entry)[0]!;
      total -= historyItemSize(oldest);
      entry.history = entry.history.filter((h) => h !== oldest);
    }
  }
}

/** Appends the snapshot to the entry's history (unless it equals the newest item) and trims. */
export function pushHistory(db: KdbxDatabase, entry: KdbxEntry, snapshot: KdbxEntry): void {
  const newest = orderedHistory(entry).at(-1);
  if (newest && deepEqual(newest, snapshot)) return;
  entry.history.push(snapshot);
  trimHistory(db, entry);
}

/**
 * Changes an entry the way KeePass does: the version before the change goes into history, the change is applied, and the
 * modification time moves to `now`. Nothing is recorded when the change leaves the entry as it was.
 */
export function updateEntry(db: KdbxDatabase, entry: KdbxEntry, change: (entry: KdbxEntry) => void, now: Date = new Date()): boolean {
  const before = snapshotEntry(entry);
  change(entry);
  if (deepEqual(before, snapshotEntry(entry))) return false;
  pushHistory(db, entry, before);
  entry.times.lastModification = now;
  return true;
}
