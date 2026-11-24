// The helpers that read and change the model: fields, attachments, history, the Recycle Bin, walking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addAttachment, deletePermanently, ensureRecycleBin, findEntry, findGroup, getAttachment, getField, getRecycleBin, historyItemSize,
  moveToRecycleBin, newDatabase, newEntry, newGroup, orderedHistory, pushHistory, readKdbx, removeAttachment, removeField,
  restoreFromRecycleBin, setField, snapshotEntry, trimHistory, updateEntry, walkEntries, walkGroups, writeKdbx,
} from '../src/index.ts';
import type { KdbxDatabase } from '../src/index.ts';
import { sampleDatabase, seeded } from './support.ts';

const at = (s: number) => new Date(s * 1000);
const rnd = () => seeded('model');

test('fields: setField keeps position and protection of an existing field, protects a new Password, appends others unprotected', () => {
  const e = newEntry({ title: 'T', password: 'p' });
  setField(e, 'Title', 'T2');
  setField(e, 'Password', 'p2');
  setField(e, 'Custom', 'c');
  setField(e, 'Secret', 's', { protected: true });
  assert.deepEqual(e.fields.map((f) => [f.name, f.value, f.protected]), [
    ['Title', 'T2', false], ['UserName', '', false], ['Password', 'p2', true], ['URL', '', false], ['Notes', '', false],
    ['Custom', 'c', false], ['Secret', 's', true]]);
  setField(e, 'Custom', 'c2', { protected: true });
  assert.equal(e.fields.find((f) => f.name === 'Custom')!.protected, true, 'protection can be changed explicitly');
  const bare = { ...e, fields: [] };
  setField(bare, 'Password', 'x');
  assert.equal(bare.fields[0]!.protected, true, 'a Password field added later is protected');
});

test('fields: getField reads the first match or undefined, removeField says whether it removed anything', () => {
  const e = newEntry({ title: 'T' });
  assert.equal(getField(e, 'Title'), 'T');
  assert.equal(getField(e, 'Nope'), undefined);
  assert.equal(removeField(e, 'Notes'), true);
  assert.equal(removeField(e, 'Notes'), false);
  assert.equal(getField(e, 'Notes'), undefined);
});

test('attachments: add replaces one of the same name, get and remove find it by name', () => {
  const e = newEntry();
  addAttachment(e, 'a.txt', Uint8Array.of(1));
  addAttachment(e, 'b.txt', Uint8Array.of(2), { protected: true });
  addAttachment(e, 'a.txt', Uint8Array.of(3));
  assert.deepEqual(e.attachments.map((a) => [a.name, [...a.data], a.protected]), [['a.txt', [3], false], ['b.txt', [2], true]]);
  assert.deepEqual([...getAttachment(e, 'b.txt')!.data], [2]);
  assert.equal(removeAttachment(e, 'a.txt'), true);
  assert.equal(removeAttachment(e, 'a.txt'), false);
  assert.equal(e.attachments.length, 1);
});

test('walking: groups come parents first with their path (root has none), entries carry their group and whether they are recycled', () => {
  const db = sampleDatabase();
  assert.deepEqual([...walkGroups(db)].map((v) => v.path.join('/')), ['', 'Work', 'Work/Clients', 'Recycle Bin']);
  const all = [...walkEntries(db)].map((v) => [getField(v.entry, 'Title'), v.path.join('/'), v.inRecycleBin]);
  assert.deepEqual(all, [['Login', '', false], ['Unicode 😀 é', '', false], ['Portal', 'Work/Clients', false], ['Gone', 'Recycle Bin', true]]);
  assert.equal([...walkEntries(db, { includeRecycleBin: false })].length, 3);
  assert.equal(findEntry(db, db.root.entries[0]!.uuid)!.group, db.root);
  assert.equal(findGroup(db, db.root.groups[0]!.uuid)!.parent, db.root);
  assert.equal(findEntry(db, 'ff'.repeat(16)), undefined);
});

test('history: snapshotEntry copies the entry without history and shares attachment bytes instead of copying them', () => {
  const e = newEntry({ title: 'T', password: 'p' });
  addAttachment(e, 'big', new Uint8Array(10));
  e.history.push(newEntry());
  const s = snapshotEntry(e);
  assert.equal(s.history.length, 0);
  assert.deepEqual(s.fields, e.fields);
  assert.notEqual(s.fields, e.fields);
  assert.equal(s.attachments[0]!.data, e.attachments[0]!.data);
  s.fields[0]!.value = 'changed';
  assert.equal(e.fields[0]!.value, 'T', 'the snapshot is independent of the entry');
});

test('history: updateEntry puts the version before the change into history, applies it and moves the modification time', () => {
  const db = newDatabase({ name: 'H', random: rnd() });
  const e = newEntry({ title: 'T', password: 'one' }, { now: at(1000) });
  db.root.entries.push(e);
  assert.equal(updateEntry(db, e, (x) => setField(x, 'Password', 'two'), at(2000)), true);
  assert.equal(getField(e, 'Password'), 'two');
  assert.deepEqual(e.history.map((h) => getField(h, 'Password')), ['one']);
  assert.equal(e.history[0]!.times.lastModification!.getTime(), 1_000_000, 'the history item keeps the old time');
  assert.equal(e.times.lastModification!.getTime(), 2_000_000);
  assert.equal(updateEntry(db, e, (x) => setField(x, 'Password', 'two'), at(3000)), false, 'no change, no history, no new time');
  assert.equal(e.history.length, 1);
  assert.equal(e.times.lastModification!.getTime(), 2_000_000);
});

test('history: a version identical to the newest one is not added twice', () => {
  const db = newDatabase({ name: 'H' });
  const e = newEntry({ title: 'T' }, { now: at(1) });
  pushHistory(db, e, snapshotEntry(e));
  pushHistory(db, e, snapshotEntry(e));
  assert.equal(e.history.length, 1);
});

test('history: the oldest items go first when the count or the size is over the limit (-1 is unlimited)', () => {
  const db = newDatabase({ name: 'H' });
  db.meta.historyMaxItems = 3;
  const e = newEntry({ title: 'T' }, { now: at(0) });
  for (let i = 1; i <= 5; i++) {
    const h = newEntry({ title: 'T', password: `v${i}` }, { now: at(i) });
    h.times.lastModification = at(i);
    pushHistory(db, e, h);
  }
  assert.deepEqual(e.history.map((h) => getField(h, 'Password')), ['v3', 'v4', 'v5']);
  db.meta.historyMaxItems = -1;
  db.meta.historyMaxSize = historyItemSize(e.history[0]!) * 2;
  trimHistory(db, e);
  assert.deepEqual(e.history.map((h) => getField(h, 'Password')), ['v4', 'v5'], 'size limit drops the oldest until it fits');
  db.meta.historyMaxSize = -1;
  for (let i = 6; i < 40; i++) pushHistory(db, e, Object.assign(newEntry({ password: `v${i}` }, { now: at(i) }), {}));
  assert.ok(e.history.length > 20, 'unlimited keeps everything');
});

test('history: orderedHistory sorts by modification time (other writers may not), ties by file order', () => {
  const e = newEntry();
  for (const t of [30, 10, 20, 10]) {
    const h = newEntry({ title: `t${t}` }, { now: at(t) });
    h.times.lastModification = at(t);
    e.history.push(h);
  }
  e.history.push({ ...newEntry({ title: 'undated' }), times: { expires: false, usageCount: 0 } });
  assert.deepEqual(orderedHistory(e).map((h) => getField(h, 'Title')), ['undated', 't10', 't10', 't20', 't30']);
});

test('history: the size of an item counts field names and values, attachments, custom data and tags in bytes', () => {
  const e = newEntry({ title: 'ab', tags: ['xyz'] });
  e.fields = [{ name: 'k', value: 'ü', protected: false }];
  e.customData = [{ key: 'ck', value: 'cv' }];
  addAttachment(e, 'f', new Uint8Array(100));
  assert.equal(historyItemSize(e), 1 + 2 + 2 + 2 + 1 + 100 + 3);
});

test('recycle bin: moving makes the bin once, remembers the origin, stamps the move and keeps the history', () => {
  const db = sampleDatabase();
  const login = db.root.entries[0]!;
  assert.ok(getRecycleBin(db), 'the sample already has a bin');
  const binId = db.meta.recycleBinUuid;
  assert.equal(moveToRecycleBin(db, login.uuid, { now: at(5000) }), true);
  assert.equal(db.root.entries.includes(login), false);
  assert.equal(getRecycleBin(db)!.entries.at(-1), login);
  assert.equal(login.previousParentGroup, db.root.uuid);
  assert.equal(login.times.locationChanged!.getTime(), 5_000_000);
  assert.equal(login.history.length, 2);
  assert.equal(db.meta.recycleBinUuid, binId, 'no second bin');
  assert.equal(moveToRecycleBin(db, login.uuid), false, 'an entry already in the bin does not move again');
  assert.equal(moveToRecycleBin(db, 'ee'.repeat(16)), false, 'an unknown entry does not move');
});

test('recycle bin: the first delete creates "Recycle Bin" (icon 43) and names it in the metadata; a bin switched off elsewhere is reused and switched on', () => {
  const db = newDatabase({ name: 'B', random: rnd() });
  const e = newEntry({ title: 'x' });
  db.root.entries.push(e);
  assert.equal(getRecycleBin(db), undefined);
  assert.equal(moveToRecycleBin(db, e.uuid, { now: at(1), random: seeded('another seed, so the bin id differs from the root id') }), true);
  const bin = getRecycleBin(db)!;
  assert.equal(bin.name, 'Recycle Bin');
  assert.equal(bin.iconId, 43);
  assert.equal(db.meta.recycleBinEnabled, true);
  db.meta.recycleBinEnabled = false;
  assert.equal(ensureRecycleBin(db, { now: at(2) }), bin);
  assert.equal(db.meta.recycleBinEnabled, true, 'switched back on');
  assert.equal(db.root.groups.filter((g) => g.name === 'Recycle Bin').length, 1);
});

test('recycle bin: restore puts the entry back where it came from, or in the root when that group is gone, and clears the mark', () => {
  const db = sampleDatabase();
  const portal = findEntry(db, db.root.groups[0]!.groups[0]!.entries[0]!.uuid)!.entry;
  const clients = db.root.groups[0]!.groups[0]!;
  moveToRecycleBin(db, portal.uuid, { now: at(10) });
  assert.equal(restoreFromRecycleBin(db, portal.uuid, { now: at(20) }), true);
  assert.equal(clients.entries.includes(portal), true);
  assert.equal(portal.previousParentGroup, undefined);
  assert.equal(portal.times.locationChanged!.getTime(), 20_000);
  moveToRecycleBin(db, portal.uuid);
  db.root.groups[0]!.groups = []; // the Clients group is deleted
  assert.equal(restoreFromRecycleBin(db, portal.uuid), true);
  assert.equal(db.root.entries.includes(portal), true, 'back in the root group');
  assert.equal(restoreFromRecycleBin(db, portal.uuid), false, 'a live entry is not restored');
  // The sample's own recycled entry remembers the Work group.
  const gone = [...walkEntries(db)].find((v) => getField(v.entry, 'Title') === 'Gone')!;
  assert.equal(restoreFromRecycleBin(db, gone.entry.uuid), true);
  assert.equal(db.root.groups[0]!.entries.includes(gone.entry), true);
});

test('recycle bin: deleting for good removes the entry wherever it is and records a deleted object', () => {
  const db = sampleDatabase();
  const gone = [...walkEntries(db)].find((v) => getField(v.entry, 'Title') === 'Gone')!.entry;
  const before = db.deletedObjects.length;
  assert.equal(deletePermanently(db, gone.uuid, { now: at(99) }), true);
  assert.equal(findEntry(db, gone.uuid), undefined);
  assert.equal(db.deletedObjects.length, before + 1);
  assert.deepEqual(db.deletedObjects.at(-1), { uuid: gone.uuid, time: at(99) });
  assert.equal(deletePermanently(db, gone.uuid), false);
});

test('recycle bin: a database edited with these helpers survives a write and read', () => {
  const db: KdbxDatabase = sampleDatabase();
  moveToRecycleBin(db, db.root.entries[1]!.uuid, { now: at(7) });
  const back = readKdbx(writeKdbx(db, { password: 'p' }, { kdf: { type: 'aes', rounds: 5 } }), { password: 'p' });
  const moved = [...walkEntries(back)].find((v) => getField(v.entry, 'Title')?.startsWith('Unicode'))!;
  assert.equal(moved.inRecycleBin, true);
  assert.equal(moved.entry.previousParentGroup, back.root.uuid);
});

test('model: newDatabase gives an empty database with a root group, a bin that is on but unnamed, and sensible limits', () => {
  const db = newDatabase({ name: 'N', description: 'D', defaultUserName: 'u', rootGroupName: 'Top', now: at(100), random: rnd() });
  assert.equal(db.meta.name, 'N');
  assert.equal(db.meta.description, 'D');
  assert.equal(db.meta.defaultUserName, 'u');
  assert.equal(db.root.name, 'Top');
  assert.equal(db.meta.recycleBinEnabled, true);
  assert.equal(db.meta.recycleBinUuid, undefined);
  assert.equal(db.meta.historyMaxItems, 10);
  assert.equal(db.meta.historyMaxSize, 6_291_456);
  assert.equal(db.root.times.creation!.getTime(), 100_000);
  assert.equal(newGroup('x').iconId, 48);
  assert.equal(newDatabase({ name: 'a', random: seeded('s') }).root.uuid, newDatabase({ name: 'a', random: seeded('s') }).root.uuid, 'the random source is used for ids');
});

test('tags: both separators are read, entries write with ";" and empty parts are dropped', () => {
  const db = sampleDatabase();
  db.root.entries[0]!.tags = ['a', 'b c', 'd'];
  const back = readKdbx(writeKdbx(db, { password: 'p' }, { kdf: { type: 'aes', rounds: 5 } }), { password: 'p' });
  assert.deepEqual(back.root.entries[0]!.tags, ['a', 'b c', 'd']);
});
