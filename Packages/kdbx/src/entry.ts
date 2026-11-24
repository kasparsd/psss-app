// Small helpers over the model: fields, attachments, walking the group tree.
import type { KdbxAttachment, KdbxDatabase, KdbxEntry, KdbxField, KdbxGroup } from './model.ts';

export function getField(entry: KdbxEntry, name: string): string | undefined {
  return entry.fields.find((f) => f.name === name)?.value;
}

export function getFieldObject(entry: KdbxEntry, name: string): KdbxField | undefined {
  return entry.fields.find((f) => f.name === name);
}

/**
 * Sets a field. An existing field keeps its position and, unless `protected` is given, its protection. A new field is
 * appended; it is protected when asked, and otherwise only if it is the Password field.
 */
export function setField(entry: KdbxEntry, name: string, value: string, options: { protected?: boolean } = {}): void {
  const existing = entry.fields.find((f) => f.name === name);
  if (existing) {
    existing.value = value;
    if (options.protected !== undefined) existing.protected = options.protected;
  } else {
    entry.fields.push({ name, value, protected: options.protected ?? name === 'Password' });
  }
}

export function removeField(entry: KdbxEntry, name: string): boolean {
  const before = entry.fields.length;
  entry.fields = entry.fields.filter((f) => f.name !== name);
  return entry.fields.length !== before;
}

export function getAttachment(entry: KdbxEntry, name: string): KdbxAttachment | undefined {
  return entry.attachments.find((a) => a.name === name);
}

/** Adds an attachment, replacing one of the same name. */
export function addAttachment(entry: KdbxEntry, name: string, data: Uint8Array, options: { protected?: boolean } = {}): void {
  const attachment: KdbxAttachment = { name, data, protected: options.protected ?? false };
  const i = entry.attachments.findIndex((a) => a.name === name);
  if (i >= 0) entry.attachments[i] = attachment;
  else entry.attachments.push(attachment);
}

export function removeAttachment(entry: KdbxEntry, name: string): boolean {
  const before = entry.attachments.length;
  entry.attachments = entry.attachments.filter((a) => a.name !== name);
  return entry.attachments.length !== before;
}

export interface GroupVisit {
  group: KdbxGroup;
  parent: KdbxGroup | undefined;
  /** Names from below the root group down to this group; empty for the root group. */
  path: string[];
  inRecycleBin: boolean;
}

/** Every group, the root group first, parents before children. */
export function* walkGroups(db: KdbxDatabase): Generator<GroupVisit> {
  const bin = db.meta.recycleBinUuid;
  function* visit(group: KdbxGroup, parent: KdbxGroup | undefined, path: string[], inBin: boolean): Generator<GroupVisit> {
    const binHere = inBin || (bin !== undefined && group.uuid === bin);
    yield { group, parent, path, inRecycleBin: binHere };
    for (const g of group.groups) yield* visit(g, group, [...path, g.name], binHere);
  }
  yield* visit(db.root, undefined, [], false);
}

export interface EntryVisit {
  entry: KdbxEntry;
  group: KdbxGroup;
  path: string[];
  inRecycleBin: boolean;
}

export function* walkEntries(db: KdbxDatabase, options: { includeRecycleBin?: boolean } = {}): Generator<EntryVisit> {
  const include = options.includeRecycleBin ?? true;
  for (const v of walkGroups(db)) {
    if (v.inRecycleBin && !include) continue;
    for (const entry of v.group.entries) yield { entry, group: v.group, path: v.path, inRecycleBin: v.inRecycleBin };
  }
}

export function findEntry(db: KdbxDatabase, uuid: string): EntryVisit | undefined {
  for (const v of walkEntries(db)) if (v.entry.uuid === uuid) return v;
  return undefined;
}

export function findGroup(db: KdbxDatabase, uuid: string): GroupVisit | undefined {
  for (const v of walkGroups(db)) if (v.group.uuid === uuid) return v;
  return undefined;
}
