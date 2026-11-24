// The in-memory database. Plain data: no class instances, so it can be cloned, compared and serialized freely.
// Times are Dates (whole seconds are kept on write), UUIDs are 32 lowercase hex digits (the file stores base64).
import { randomBytes } from 'node:crypto';
import { hex } from './bytes.ts';
import { InvalidArgument } from './errors.ts';
import { xml } from './xml.ts';
import type { XmlNode } from './xml.ts';
import type { KdfFormat } from './kdf.ts';

export type RandomSource = (length: number) => Uint8Array;
export const systemRandom: RandomSource = (n) => new Uint8Array(randomBytes(n));

export type KdbxVersion = '3.1' | '4.0' | '4.1';

/** What a file uses (set by `readKdbx`, and the defaults of the next `writeKdbx`). */
export interface KdbxFormat {
  /** The version as read, such as "3.1", "4.0", "4.1" (or "3.0"). */
  version: string;
  cipher: 'aes256' | 'chacha20';
  compression: 'gzip' | 'none';
  kdf: KdfFormat;
}

export interface KdbxTimes {
  creation?: Date;
  lastModification?: Date;
  lastAccess?: Date;
  expiry?: Date;
  expires: boolean;
  usageCount: number;
  locationChanged?: Date;
}

export interface KdbxField {
  name: string;
  value: string;
  protected: boolean;
}

export interface KdbxAttachment {
  name: string;
  data: Uint8Array;
  /** The KeePass "protected" flag of the attachment (a hint to the program; the file stores the bytes the same way). */
  protected: boolean;
}

export interface KdbxCustomDataItem {
  key: string;
  value: string;
  /** KDBX 4.1 */
  lastModified?: Date;
}

export interface KdbxEntry {
  uuid: string;
  iconId: number;
  customIconUuid?: string;
  foregroundColor: string;
  backgroundColor: string;
  tags: string[];
  times: KdbxTimes;
  /** In file order. Title, UserName, Password, URL and Notes are fields like any other. */
  fields: KdbxField[];
  attachments: KdbxAttachment[];
  /** The Auto-Type element, kept as opaque XML. */
  autoType?: XmlNode;
  /** Earlier versions, oldest first as the file has them. Each has an empty history of its own. */
  history: KdbxEntry[];
  customData: KdbxCustomDataItem[];
  /** KDBX 4.1: the group the entry was in before it was moved (the Recycle Bin uses it). */
  previousParentGroup?: string;
  /** Child elements this package does not model, kept and written back after the modelled ones. */
  unknown: XmlNode[];
  /** Attributes of the Entry element, kept. */
  attributes: [string, string][];
}

export interface KdbxGroup {
  uuid: string;
  name: string;
  notes: string;
  iconId: number;
  customIconUuid?: string;
  tags: string[];
  times: KdbxTimes;
  isExpanded: boolean;
  customData: KdbxCustomDataItem[];
  previousParentGroup?: string;
  groups: KdbxGroup[];
  entries: KdbxEntry[];
  unknown: XmlNode[];
  attributes: [string, string][];
}

export interface KdbxMeta {
  generator: string;
  name: string;
  nameChanged?: Date;
  description: string;
  descriptionChanged?: Date;
  defaultUserName: string;
  defaultUserNameChanged?: Date;
  maintenanceHistoryDays: number;
  masterKeyChanged?: Date;
  recycleBinEnabled: boolean;
  /** Undefined when the file names none (the all-zero UUID). */
  recycleBinUuid?: string;
  recycleBinChanged?: Date;
  /** -1 is unlimited. */
  historyMaxItems: number;
  /** In bytes; -1 is unlimited. */
  historyMaxSize: number;
  settingsChanged?: Date;
  customData: KdbxCustomDataItem[];
  unknown: XmlNode[];
  attributes: [string, string][];
}

export interface KdbxDeletedObject {
  uuid: string;
  time?: Date;
}

export interface KdbxDatabase {
  /** Set by readKdbx. */
  format?: KdbxFormat;
  meta: KdbxMeta;
  root: KdbxGroup;
  deletedObjects: KdbxDeletedObject[];
  /** The header's public custom data (a variant dictionary), kept as bytes. KDBX 4 only. */
  publicCustomData?: Uint8Array;
  /** Unknown children of the KeePassFile element and of the Root element. */
  unknown: XmlNode[];
  rootUnknown: XmlNode[];
}

export function newUuid(random: RandomSource = systemRandom): string {
  return hex(random(16));
}

export const ZERO_UUID = '0'.repeat(32);

/** True for a UUID as this package holds it: exactly 32 lowercase hexadecimal digits. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** Throws `InvalidArgument` (naming `what`, never a value longer than a UUID) unless `value` is a UUID. */
export function assertUuid(value: unknown, what: string): asserts value is string {
  if (isUuid(value)) return;
  const shown = typeof value === 'string' ? ` (got ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value)})` : '';
  throw new InvalidArgument(`${what} is not a UUID: expected 32 lowercase hexadecimal digits${shown}`);
}

export function newTimes(now: Date = new Date()): KdbxTimes {
  return { creation: now, lastModification: now, lastAccess: now, expiry: now, expires: false, usageCount: 0, locationChanged: now };
}

export interface NewEntry {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  tags?: string[];
  /** Extra fields; protected defaults to false. */
  fields?: { name: string; value: string; protected?: boolean }[];
  uuid?: string;
}

export function newEntry(spec: NewEntry = {}, o: { now?: Date; random?: RandomSource } = {}): KdbxEntry {
  if (spec.uuid !== undefined) assertUuid(spec.uuid, 'the entry uuid');
  const fields: KdbxField[] = [
    { name: 'Title', value: spec.title ?? '', protected: false },
    { name: 'UserName', value: spec.username ?? '', protected: false },
    { name: 'Password', value: spec.password ?? '', protected: true },
    { name: 'URL', value: spec.url ?? '', protected: false },
    { name: 'Notes', value: spec.notes ?? '', protected: false },
  ];
  for (const f of spec.fields ?? []) fields.push({ name: f.name, value: f.value, protected: f.protected ?? false });
  return {
    uuid: spec.uuid ?? newUuid(o.random), iconId: 0, foregroundColor: '', backgroundColor: '', tags: [...(spec.tags ?? [])],
    times: newTimes(o.now), fields, attachments: [], history: [], customData: [], unknown: [], attributes: [],
  };
}

export function newGroup(name: string, o: { now?: Date; random?: RandomSource; uuid?: string } = {}): KdbxGroup {
  if (o.uuid !== undefined) assertUuid(o.uuid, 'the group uuid');
  return {
    uuid: o.uuid ?? newUuid(o.random), name, notes: '', iconId: 48, tags: [], times: newTimes(o.now), isExpanded: true, customData: [],
    groups: [], entries: [], unknown: [], attributes: [],
  };
}

export interface NewDatabase {
  name: string;
  description?: string;
  defaultUserName?: string;
  /** Name of the root group; default "Root". */
  rootGroupName?: string;
  generator?: string;
  now?: Date;
  random?: RandomSource;
  /** What a first write uses unless it says otherwise. */
  format?: Partial<KdbxFormat>;
}

export function newDatabase(spec: NewDatabase): KdbxDatabase {
  const now = spec.now ?? new Date();
  const protection = xml('MemoryProtection', '', [], [
    xml('ProtectTitle', 'False'), xml('ProtectUserName', 'False'), xml('ProtectPassword', 'True'), xml('ProtectURL', 'False'),
    xml('ProtectNotes', 'False'),
  ]);
  const db: KdbxDatabase = {
    meta: {
      generator: spec.generator ?? 'psss-kdbx', name: spec.name, nameChanged: now, description: spec.description ?? '',
      descriptionChanged: now, defaultUserName: spec.defaultUserName ?? '', defaultUserNameChanged: now,
      maintenanceHistoryDays: 365, masterKeyChanged: now, recycleBinEnabled: true, recycleBinChanged: now, historyMaxItems: 10,
      historyMaxSize: 6_291_456, settingsChanged: now, customData: [], unknown: [protection], attributes: [],
    },
    root: newGroup(spec.rootGroupName ?? 'Root', { now, ...(spec.random ? { random: spec.random } : {}) }),
    deletedObjects: [], unknown: [], rootUnknown: [],
  };
  if (spec.format) {
    db.format = {
      version: spec.format.version ?? '4.1', cipher: spec.format.cipher ?? 'chacha20', compression: spec.format.compression ?? 'gzip',
      kdf: spec.format.kdf ?? { type: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 2 },
    };
  }
  return db;
}
