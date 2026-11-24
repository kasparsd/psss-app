// The XML tree <-> the model. Reading puts every element it does not model in `unknown`; writing puts them back.
import { createHash } from 'node:crypto';
import { hex } from './bytes.ts';
import { Corrupt } from './errors.ts';
import { attr, childrenNamed, xml } from './xml.ts';
import type { XmlNode } from './xml.ts';
import { formatTimeIso, formatTimeTicks, parseTime } from './time.ts';
import { ZERO_UUID, assertUuid } from './model.ts';
import type {
  KdbxCustomDataItem, KdbxDatabase, KdbxEntry, KdbxField, KdbxGroup, KdbxMeta, KdbxTimes,
} from './model.ts';

export interface PoolItem {
  data: Uint8Array;
  protected: boolean;
}

export type TimeFormat = 'ticks' | 'iso';

// ---------------------------------------------------------------- reading

const isTrue = (text: string) => text.trim().toLowerCase() === 'true';

function toInt(text: string, fallback: number): number {
  const t = text.trim();
  return /^-?\d{1,15}$/.test(t) ? Number(t) : fallback;
}

function readUuid(text: string): string {
  const t = text.trim();
  if (!/^[A-Za-z0-9+/]{22}==$/.test(t)) throw new Corrupt('a UUID in the XML is not 16 bytes of base64');
  return hex(Buffer.from(t, 'base64'));
}

function uuidToBase64(id: string, what: string): string {
  assertUuid(id, what);
  return Buffer.from(id, 'hex').toString('base64');
}

function readTags(text: string): string[] {
  return text.split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');
}

function readTimes(node: XmlNode): KdbxTimes {
  const t: KdbxTimes = { expires: false, usageCount: 0 };
  for (const c of node.children) {
    switch (c.name) {
      case 'CreationTime': t.creation = parseTime(c.text); break;
      case 'LastModificationTime': t.lastModification = parseTime(c.text); break;
      case 'LastAccessTime': t.lastAccess = parseTime(c.text); break;
      case 'ExpiryTime': t.expiry = parseTime(c.text); break;
      case 'Expires': t.expires = isTrue(c.text); break;
      case 'UsageCount': t.usageCount = toInt(c.text, 0); break;
      case 'LocationChanged': t.locationChanged = parseTime(c.text); break;
      default: break;
    }
  }
  // Drop keys whose time could not be read, so `undefined` always means absent.
  for (const k of Object.keys(t) as (keyof KdbxTimes)[]) if (t[k] === undefined) delete t[k];
  return t;
}

function readCustomData(node: XmlNode): KdbxCustomDataItem[] {
  const items: KdbxCustomDataItem[] = [];
  for (const item of childrenNamed(node, 'Item')) {
    const key = item.children.find((c) => c.name === 'Key')?.text ?? '';
    const value = item.children.find((c) => c.name === 'Value')?.text ?? '';
    const modified = item.children.find((c) => c.name === 'LastModificationTime');
    const when = modified ? parseTime(modified.text) : undefined;
    items.push(when ? { key, value, lastModified: when } : { key, value });
  }
  return items;
}

function readEntry(node: XmlNode, resolve: (ref: string) => PoolItem | undefined, nested: boolean): KdbxEntry {
  const e: KdbxEntry = {
    uuid: ZERO_UUID, iconId: 0, foregroundColor: '', backgroundColor: '', tags: [], times: { expires: false, usageCount: 0 },
    fields: [], attachments: [], history: [], customData: [], unknown: [], attributes: [...node.attributes],
  };
  for (const c of node.children) {
    switch (c.name) {
      case 'UUID': e.uuid = readUuid(c.text); break;
      case 'IconID': e.iconId = toInt(c.text, 0); break;
      case 'CustomIconUUID': if (c.text.trim() !== '') e.customIconUuid = readUuid(c.text); break;
      case 'ForegroundColor': e.foregroundColor = c.text; break;
      case 'BackgroundColor': e.backgroundColor = c.text; break;
      case 'Tags': e.tags = readTags(c.text); break;
      case 'Times': e.times = readTimes(c); break;
      case 'String': {
        const key = c.children.find((x) => x.name === 'Key');
        const value = c.children.find((x) => x.name === 'Value');
        const field: KdbxField = { name: key?.text ?? '', value: value?.text ?? '', protected: value ? attr(value, 'Protected')?.toLowerCase() === 'true' : false };
        e.fields.push(field);
        break;
      }
      case 'Binary': {
        const key = c.children.find((x) => x.name === 'Key');
        const value = c.children.find((x) => x.name === 'Value');
        if (!value) break;
        const ref = attr(value, 'Ref');
        let item: PoolItem | undefined;
        if (ref !== undefined) item = resolve(ref);
        else item = inlineBinary(value);
        if (item) e.attachments.push({ name: key?.text ?? '', data: item.data, protected: item.protected });
        // A reference to a binary that is not in the pool names nothing; it is dropped.
        break;
      }
      case 'AutoType': e.autoType = c; break;
      case 'History':
        if (!nested) for (const h of childrenNamed(c, 'Entry')) e.history.push(readEntry(h, resolve, true));
        break;
      case 'CustomData': e.customData = readCustomData(c); break;
      case 'PreviousParentGroup': if (c.text.trim() !== '') e.previousParentGroup = readUuid(c.text); break;
      default: e.unknown.push(c);
    }
  }
  return e;
}

/** An attachment stored inline (older files): base64 text, optionally gzip-compressed. */
function inlineBinary(value: XmlNode): PoolItem | undefined {
  const text = value.text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined;
  return { data: new Uint8Array(Buffer.from(text, 'base64')), protected: false };
}

function readGroup(node: XmlNode, resolve: (ref: string) => PoolItem | undefined): KdbxGroup {
  const g: KdbxGroup = {
    uuid: ZERO_UUID, name: '', notes: '', iconId: 48, tags: [], times: { expires: false, usageCount: 0 }, isExpanded: true, customData: [],
    groups: [], entries: [], unknown: [], attributes: [...node.attributes],
  };
  for (const c of node.children) {
    switch (c.name) {
      case 'UUID': g.uuid = readUuid(c.text); break;
      case 'Name': g.name = c.text; break;
      case 'Notes': g.notes = c.text; break;
      case 'IconID': g.iconId = toInt(c.text, 48); break;
      case 'CustomIconUUID': if (c.text.trim() !== '') g.customIconUuid = readUuid(c.text); break;
      case 'Tags': g.tags = readTags(c.text); break;
      case 'Times': g.times = readTimes(c); break;
      case 'IsExpanded': g.isExpanded = isTrue(c.text); break;
      case 'CustomData': g.customData = readCustomData(c); break;
      case 'PreviousParentGroup': if (c.text.trim() !== '') g.previousParentGroup = readUuid(c.text); break;
      case 'Group': g.groups.push(readGroup(c, resolve)); break;
      case 'Entry': g.entries.push(readEntry(c, resolve, false)); break;
      default: g.unknown.push(c);
    }
  }
  return g;
}

function readMeta(node: XmlNode): KdbxMeta {
  const m: KdbxMeta = {
    generator: '', name: '', description: '', defaultUserName: '', maintenanceHistoryDays: 365, recycleBinEnabled: false,
    historyMaxItems: 10, historyMaxSize: 6_291_456, customData: [], unknown: [], attributes: [...node.attributes],
  };
  const time = (c: XmlNode, key: 'nameChanged' | 'descriptionChanged' | 'defaultUserNameChanged' | 'masterKeyChanged' | 'recycleBinChanged' | 'settingsChanged') => {
    const t = parseTime(c.text);
    if (t) m[key] = t;
  };
  for (const c of node.children) {
    switch (c.name) {
      case 'Generator': m.generator = c.text; break;
      case 'DatabaseName': m.name = c.text; break;
      case 'DatabaseNameChanged': time(c, 'nameChanged'); break;
      case 'DatabaseDescription': m.description = c.text; break;
      case 'DatabaseDescriptionChanged': time(c, 'descriptionChanged'); break;
      case 'DefaultUserName': m.defaultUserName = c.text; break;
      case 'DefaultUserNameChanged': time(c, 'defaultUserNameChanged'); break;
      case 'MaintenanceHistoryDays': m.maintenanceHistoryDays = toInt(c.text, 365); break;
      case 'MasterKeyChanged': time(c, 'masterKeyChanged'); break;
      case 'RecycleBinEnabled': m.recycleBinEnabled = isTrue(c.text); break;
      case 'RecycleBinUUID': {
        if (c.text.trim() !== '') {
          const id = readUuid(c.text);
          if (id !== ZERO_UUID) m.recycleBinUuid = id;
        }
        break;
      }
      case 'RecycleBinChanged': time(c, 'recycleBinChanged'); break;
      case 'HistoryMaxItems': m.historyMaxItems = toInt(c.text, 10); break;
      case 'HistoryMaxSize': m.historyMaxSize = toInt(c.text, 6_291_456); break;
      case 'SettingsChanged': time(c, 'settingsChanged'); break;
      case 'CustomData': m.customData = readCustomData(c); break;
      case 'HeaderHash': case 'Binaries': break; // KDBX 3 container details, not content
      default: m.unknown.push(c);
    }
  }
  return m;
}

export function xmlToDatabase(file: XmlNode, resolve: (ref: string) => PoolItem | undefined): KdbxDatabase {
  if (file.name !== 'KeePassFile') throw new Corrupt('the XML root is not KeePassFile');
  let meta: KdbxMeta | undefined;
  let root: KdbxGroup | undefined;
  const db: KdbxDatabase = {
    meta: undefined as unknown as KdbxMeta, root: undefined as unknown as KdbxGroup, deletedObjects: [], unknown: [], rootUnknown: [],
  };
  for (const c of file.children) {
    if (c.name === 'Meta') meta = readMeta(c);
    else if (c.name === 'Root') {
      for (const r of c.children) {
        if (r.name === 'Group' && !root) root = readGroup(r, resolve);
        else if (r.name === 'DeletedObjects') {
          for (const d of childrenNamed(r, 'DeletedObject')) {
            const id = d.children.find((x) => x.name === 'UUID');
            const when = d.children.find((x) => x.name === 'DeletionTime');
            if (!id) continue;
            const time = when ? parseTime(when.text) : undefined;
            db.deletedObjects.push(time ? { uuid: readUuid(id.text), time } : { uuid: readUuid(id.text) });
          }
        } else db.rootUnknown.push(r);
      }
    } else db.unknown.push(c);
  }
  if (!meta) throw new Corrupt('the XML has no Meta element');
  if (!root) throw new Corrupt('the XML has no root group');
  db.meta = meta;
  db.root = root;
  return db;
}

// ---------------------------------------------------------------- writing

export interface PoolWriter {
  items: PoolItem[];
  /** The pool index of this attachment's bytes, adding it when new. */
  add(data: Uint8Array, isProtected: boolean): number;
}

export function newPool(): PoolWriter {
  const items: PoolItem[] = [];
  const seen = new Map<string, number>();
  return {
    items,
    add(data, isProtected) {
      const key = `${isProtected ? 1 : 0}:${createHash('sha256').update(data).digest('hex')}`;
      let i = seen.get(key);
      if (i === undefined) {
        i = items.length;
        items.push({ data, protected: isProtected });
        seen.set(key, i);
      }
      return i;
    },
  };
}

export interface WriteContext {
  timeFormat: TimeFormat;
  pool: PoolWriter;
  /** KDBX 3: SHA-256 of the file header, stored in Meta/HeaderHash. */
  headerHash?: Uint8Array;
}

function t(ctx: WriteContext, name: string, date: Date | undefined): XmlNode[] {
  if (!date) return [];
  return [xml(name, ctx.timeFormat === 'ticks' ? formatTimeTicks(date) : formatTimeIso(date))];
}

const bool = (v: boolean) => (v ? 'True' : 'False');

function writeTimes(ctx: WriteContext, times: KdbxTimes): XmlNode {
  return xml('Times', '', [], [
    ...t(ctx, 'CreationTime', times.creation), ...t(ctx, 'LastModificationTime', times.lastModification),
    ...t(ctx, 'LastAccessTime', times.lastAccess), ...t(ctx, 'ExpiryTime', times.expiry),
    xml('Expires', bool(times.expires)), xml('UsageCount', String(times.usageCount)), ...t(ctx, 'LocationChanged', times.locationChanged),
  ]);
}

function writeCustomData(ctx: WriteContext, items: KdbxCustomDataItem[]): XmlNode[] {
  if (items.length === 0) return [];
  return [xml('CustomData', '', [], items.map((i) => xml('Item', '', [], [
    xml('Key', i.key), xml('Value', i.value), ...t(ctx, 'LastModificationTime', i.lastModified),
  ])))];
}

function writeEntry(ctx: WriteContext, e: KdbxEntry, nested: boolean): XmlNode {
  const children: XmlNode[] = [xml('UUID', uuidToBase64(e.uuid, 'an entry uuid')), xml('IconID', String(e.iconId))];
  if (e.customIconUuid) children.push(xml('CustomIconUUID', uuidToBase64(e.customIconUuid, 'an entry custom icon uuid')));
  children.push(xml('ForegroundColor', e.foregroundColor), xml('BackgroundColor', e.backgroundColor));
  if (e.tags.length > 0) children.push(xml('Tags', e.tags.join(';')));
  children.push(writeTimes(ctx, e.times));
  for (const f of e.fields) {
    children.push(xml('String', '', [], [xml('Key', f.name), xml('Value', f.value, f.protected ? [['Protected', 'True']] : [])]));
  }
  for (const a of e.attachments) {
    const index = ctx.pool.add(a.data, a.protected);
    children.push(xml('Binary', '', [], [xml('Key', a.name), xml('Value', '', [['Ref', String(index)]])]));
  }
  if (e.autoType) children.push(e.autoType);
  if (e.previousParentGroup) children.push(xml('PreviousParentGroup', uuidToBase64(e.previousParentGroup, 'an entry previousParentGroup')));
  children.push(...e.unknown, ...writeCustomData(ctx, e.customData));
  if (!nested && e.history.length > 0) children.push(xml('History', '', [], e.history.map((h) => writeEntry(ctx, h, true))));
  return xml('Entry', '', [...e.attributes], children);
}

function writeGroup(ctx: WriteContext, g: KdbxGroup): XmlNode {
  const children: XmlNode[] = [xml('UUID', uuidToBase64(g.uuid, 'a group uuid')), xml('Name', g.name), xml('Notes', g.notes)];
  if (g.tags.length > 0) children.push(xml('Tags', g.tags.join(';')));
  children.push(xml('IconID', String(g.iconId)));
  if (g.customIconUuid) children.push(xml('CustomIconUUID', uuidToBase64(g.customIconUuid, 'a group custom icon uuid')));
  children.push(writeTimes(ctx, g.times), xml('IsExpanded', bool(g.isExpanded)), ...g.unknown);
  if (g.previousParentGroup) children.push(xml('PreviousParentGroup', uuidToBase64(g.previousParentGroup, 'a group previousParentGroup')));
  children.push(...writeCustomData(ctx, g.customData));
  for (const e of g.entries) children.push(writeEntry(ctx, e, false));
  for (const sub of g.groups) children.push(writeGroup(ctx, sub));
  return xml('Group', '', [...g.attributes], children);
}

export function databaseToXml(db: KdbxDatabase, ctx: WriteContext): XmlNode {
  const group = writeGroup(ctx, db.root);
  const deleted = xml('DeletedObjects', '', [], db.deletedObjects.map((d) => xml('DeletedObject', '', [], [
    xml('UUID', uuidToBase64(d.uuid, 'a deleted object uuid')), ...t(ctx, 'DeletionTime', d.time),
  ])));
  const m = db.meta;
  const meta: XmlNode[] = [xml('Generator', m.generator)];
  if (ctx.headerHash) meta.push(xml('HeaderHash', Buffer.from(ctx.headerHash).toString('base64')));
  meta.push(
    ...t(ctx, 'SettingsChanged', m.settingsChanged),
    xml('DatabaseName', m.name), ...t(ctx, 'DatabaseNameChanged', m.nameChanged),
    xml('DatabaseDescription', m.description), ...t(ctx, 'DatabaseDescriptionChanged', m.descriptionChanged),
    xml('DefaultUserName', m.defaultUserName), ...t(ctx, 'DefaultUserNameChanged', m.defaultUserNameChanged),
    xml('MaintenanceHistoryDays', String(m.maintenanceHistoryDays)), ...t(ctx, 'MasterKeyChanged', m.masterKeyChanged),
    ...m.unknown,
    xml('RecycleBinEnabled', bool(m.recycleBinEnabled)), xml('RecycleBinUUID', uuidToBase64(m.recycleBinUuid ?? ZERO_UUID, 'the recycle bin uuid (meta.recycleBinUuid)')),
    ...t(ctx, 'RecycleBinChanged', m.recycleBinChanged),
    xml('HistoryMaxItems', String(m.historyMaxItems)), xml('HistoryMaxSize', String(m.historyMaxSize)),
  );
  if (ctx.timeFormat === 'iso') {
    // KDBX 3 keeps the attachment pool in Meta/Binaries, in the same order as the references.
    meta.push(xml('Binaries', '', [], ctx.pool.items.map((p, i) => xml('Binary', Buffer.from(p.data).toString('base64'), p.protected ? [['ID', String(i)], ['Protected', 'True']] : [['ID', String(i)]]))));
  }
  meta.push(...writeCustomData(ctx, m.customData));
  const file = xml('KeePassFile', '', [], [
    xml('Meta', '', [...m.attributes], meta), xml('Root', '', [], [group, deleted, ...db.rootUnknown]), ...db.unknown,
  ]);
  return file;
}
