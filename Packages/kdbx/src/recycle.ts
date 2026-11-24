// The Recycle Bin: the standard group KeePass and KeePassXC use (name "Recycle Bin", icon 43, Meta.recycleBinUuid).
import { findEntry, findGroup, walkGroups } from './entry.ts';
import { newGroup, systemRandom } from './model.ts';
import type { KdbxDatabase, KdbxGroup, RandomSource } from './model.ts';

export interface BinOptions {
  now?: Date;
  random?: RandomSource;
}

/** The bin group the metadata names, or undefined. */
export function getRecycleBin(db: KdbxDatabase): KdbxGroup | undefined {
  const id = db.meta.recycleBinUuid;
  return id ? findGroup(db, id)?.group : undefined;
}

/**
 * The bin group, made when missing. A group that Meta.recycleBinUuid already names is reused even when another program
 * switched the bin off (the flag is set back on), so no second "Recycle Bin" appears.
 */
export function ensureRecycleBin(db: KdbxDatabase, o: BinOptions = {}): KdbxGroup {
  const now = o.now ?? new Date();
  const existing = getRecycleBin(db);
  if (existing) {
    if (!db.meta.recycleBinEnabled) {
      db.meta.recycleBinEnabled = true;
      db.meta.recycleBinChanged = now;
    }
    return existing;
  }
  const bin = newGroup('Recycle Bin', { now, random: o.random ?? systemRandom });
  bin.iconId = 43;
  bin.isExpanded = false;
  db.root.groups.push(bin);
  db.meta.recycleBinEnabled = true;
  db.meta.recycleBinUuid = bin.uuid;
  db.meta.recycleBinChanged = now;
  return bin;
}

/** Moves a live entry, with its history, to the bin and remembers where it came from. False when it is not a live entry. */
export function moveToRecycleBin(db: KdbxDatabase, entryUuid: string, o: BinOptions = {}): boolean {
  const found = findEntry(db, entryUuid);
  if (!found || found.inRecycleBin) return false;
  const now = o.now ?? new Date();
  const bin = ensureRecycleBin(db, o);
  found.group.entries = found.group.entries.filter((e) => e !== found.entry);
  found.entry.previousParentGroup = found.group.uuid;
  found.entry.times.locationChanged = now;
  bin.entries.push(found.entry);
  return true;
}

/** Puts a recycled entry back in the group it came from, or the root group when that is gone or unknown. */
export function restoreFromRecycleBin(db: KdbxDatabase, entryUuid: string, o: BinOptions = {}): boolean {
  const found = findEntry(db, entryUuid);
  if (!found || !found.inRecycleBin) return false;
  const now = o.now ?? new Date();
  let target = db.root;
  const from = found.entry.previousParentGroup;
  if (from) {
    const g = [...walkGroups(db)].find((v) => v.group.uuid === from && !v.inRecycleBin);
    if (g) target = g.group;
  }
  found.group.entries = found.group.entries.filter((e) => e !== found.entry);
  delete found.entry.previousParentGroup;
  found.entry.times.locationChanged = now;
  target.entries.push(found.entry);
  return true;
}

/** Removes the entry for good, wherever it is, and records it in the deleted objects. */
export function deletePermanently(db: KdbxDatabase, entryUuid: string, o: BinOptions = {}): boolean {
  const found = findEntry(db, entryUuid);
  if (!found) return false;
  found.group.entries = found.group.entries.filter((e) => e !== found.entry);
  db.deletedObjects.push({ uuid: entryUuid, time: o.now ?? new Date() });
  return true;
}
