import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hex } from '../../format/src/bytes.ts';
import { openVault, seededRandom } from '../src/index.ts';
import { Insider, newVault, read } from './helpers.ts';

const reopen = (e: ReturnType<typeof newVault>, locations: string[], stateDir = e.stateDir) =>
  openVault({ locations, unlock: { keyFile: e.keyFile }, stateDir, now: e.clock.now, random: seededRandom('reopen') });

test('(f) a second location added later receives everything on sync, and opens on its own', (t) => {
  const e = newVault(t, { password: 'pw', argon2: { memory: 256, passes: 2, lanes: 1 }, testOnlyWeakKdf: true });
  for (let i = 0; i < 5; i++) { e.clock.tick(); e.vault.addItem({ title: `Item ${i}`, username: `u${i}`, password: `p${i}` }); }
  e.clock.tick(); e.vault.setField('psss://Item 1/password', 'changed');
  e.clock.tick(); e.vault.deleteItem('psss://Item 4/title');

  const second = join(e.dir, 'Second.psss');
  const v = reopen(e, [e.location, second]);
  const before = v.info().locations;
  assert.equal(before[0]!.status, 'upToDate', 'the first location holds everything');
  assert.equal(before[1]!.status, 'behind', 'a new empty location is behind');
  assert.match(before[1]!.reason ?? '', /nothing has been written/, 'and says why');
  assert.equal(existsSync(second), false, 'opening writes nothing to a new location: only sync does');

  const report = v.sync();
  assert.deepEqual(report.locations.map((l) => l.status), ['upToDate', 'upToDate'], 'after sync both locations hold every record');
  assert.equal(report.locations[1]!.records, report.locations[0]!.records, 'the new location holds as many records as the first');
  assert.ok(report.locations[1]!.wrote > 5, 'sync wrote the records, and the slots, wraps and psss.json');
  assert.equal(readFileSync(join(second, 'psss.json'), 'utf8'), '{"format":"psss-vault","version":1}\n', 'psss.json is exactly the bytes of spec 8.1');

  // the copy stands alone: open it with nothing else, with the key and also with the password
  for (const unlock of [{ keyFile: e.keyFile }, { password: 'pw', testOnlyWeakKdf: true }] as const) {
    const only = openVault({ locations: [second], unlock, stateDir: join(e.dir, `only-${Object.keys(unlock)[0]}`), now: e.clock.now, random: seededRandom('only') });
    assert.deepEqual(only.list().map((i) => i.title), ['Item 0', 'Item 1', 'Item 2', 'Item 3'], 'the second location alone shows the same live items');
    assert.deepEqual(only.deleted().map((i) => i.title), ['Item 4'], 'and the same Recently Deleted');
    const g = only.get('psss://Item 1/password');
    assert.equal(g.kind === 'value' && g.value, 'changed', 'and the current password');
    assert.equal(only.verify().ok, true, 'and verifies');
  }
  // a later write goes to both
  e.clock.tick(); v.setField('psss://Item 2/password', 'both');
  assert.equal(new Insider(second, e.keyFile).records().length, new Insider(e.location, e.keyFile).records().length, 'a write after sync reaches both locations');
  assert.equal(v.sync().locations.every((l) => l.status === 'upToDate'), true, 'a second sync changes nothing');
  assert.equal(v.verify().ok, true, 'verify is clean');
});

test('(g) a failed write to one location keeps the record in the outbox, and sync retries the same sealed bytes', (t) => {
  const e = newVault(t);
  e.clock.tick(); e.vault.addItem({ title: 'Item', password: 'p0' });
  const second = join(e.dir, 'Second.psss');
  const v = reopen(e, [e.location, second]);
  v.sync();
  const secondInsider = new Insider(second, e.keyFile);
  const chainDir = secondInsider.path(secondInsider.chainDirs()[0]!, '').replace(/\/$/, '');
  const writable = process.getuid?.() !== 0;
  if (!writable) { t.diagnostic('running as root: a read-only folder does not stop writes, so this test would prove nothing'); return; }
  chmodSync(chainDir, 0o500); // the second location can be read and this device's chain folder in it no longer written
  t.after(() => { try { chmodSync(chainDir, 0o700); } catch { /* the folder is already gone */ } });

  e.clock.tick();
  const w = v.setField('psss://Item/password', 'p1');
  assert.deepEqual(w.delivered, [e.location], 'the record reached the location that works');
  assert.equal(w.failed.length, 1, 'and one location failed');
  assert.equal(w.failed[0]!.location, second, 'the failure names the location');
  assert.equal(w.inOutbox, true, 'the record stays in the outbox');
  const pending = v.outbox();
  assert.equal(pending.length, 1, 'the outbox holds exactly that record');
  assert.deepEqual([pending[0]!.id, pending[0]!.pendingLocations], [w.id, [second]], 'and knows which location still lacks it');
  assert.equal(v.info().outbox, 1, 'info() counts it');
  assert.equal(v.info().locations[1]!.status, 'behind', 'the failed location is behind');
  const outboxFile = join(e.stateDir, 'outbox', readdirSync(join(e.stateDir, 'outbox'))[0]!);
  const sealed = read(outboxFile);
  assert.equal(hex(new Uint8Array(createHash('sha256').update(sealed).digest())), w.id, 'the outbox file is the sealed record: its hash is the record id');
  const g = v.get('psss://Item/password');
  assert.equal(g.kind === 'value' && g.value, 'p1', 'the person already sees their own write');

  const r1 = v.sync();
  assert.equal(r1.locations[1]!.status, 'behind', 'sync cannot fix a location that still refuses writes, and says so');
  assert.match(r1.locations[1]!.reason ?? '', /record|denied|EACCES|permission/i, 'with a reason');
  assert.equal(r1.outbox, 1, 'the record is still in the outbox');
  const restarted = reopen(e, [e.location, second]);
  assert.equal(restarted.outbox().length, 1, 'the outbox survives a restart');
  const gr = restarted.get('psss://Item/password');
  assert.equal(gr.kind === 'value' && gr.value, 'p1', 'and so does the write');

  chmodSync(chainDir, 0o700);
  const r2 = restarted.sync();
  assert.deepEqual(r2.locations.map((l) => l.status), ['upToDate', 'upToDate'], 'once the location works again, sync brings it up to date');
  assert.equal(r2.outbox, 0, 'and the outbox is empty');
  assert.equal(readdirSync(join(e.stateDir, 'outbox')).length, 0, 'the outbox file is gone');
  const chain = new Insider(second, e.keyFile);
  const delivered = chain.records().find((r) => hex(r.id) === w.id);
  assert.ok(delivered, 'the second location now holds the record with the very id it was sealed with: the body was sealed once (4.1)');
  assert.deepEqual(new Uint8Array(delivered!.sealed), sealed, 'byte for byte the stored bytes');
});

test('a write made offline is sealed and stored first, survives a restart, and sync delivers it', (t) => {
  const e = newVault(t);
  e.clock.tick(); e.vault.addItem({ title: 'Item', password: 'p0' });
  e.vault.setOffline(true);
  e.clock.tick();
  const w = e.vault.setField('psss://Item/password', 'offline');
  assert.deepEqual([w.delivered, w.failed, w.inOutbox], [[], [], true], 'offline: no location is touched');
  assert.equal(new Insider(e.location, e.keyFile).records().length, 3, 'the folder has only the three earlier records');
  const v = reopen(e, [e.location]);
  const g = v.get('psss://Item/password');
  assert.equal(g.kind === 'value' && g.value, 'offline', 'a restarted device still sees its stored write');
  assert.equal(v.info().locations[0]!.status, 'behind', 'the location is behind by the record in the outbox');
  assert.equal(v.sync().outbox, 0, 'sync delivers it');
  assert.equal(new Insider(e.location, e.keyFile).records().length, 4, 'the folder has it now');
  e.clock.tick(); v.setField('psss://Item/password', 'next');
  assert.deepEqual(new Insider(e.location, e.keyFile).records().map((r) => r.seq), [1, 2, 3, 4, 5], 'the chain continues without a gap');
});

test('a crash between storing a record and advancing the sequence number is recovered from the outbox', (t) => {
  const e = newVault(t);
  e.clock.tick(); e.vault.addItem({ title: 'Item', password: 'p0' });
  e.vault.setOffline(true);
  e.clock.tick(); e.vault.setField('psss://Item/password', 'p1');
  // roll the sequence number back to what it was before the record, as if the process died after the outbox write
  const statePath = join(e.stateDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const gid = Object.keys(state.chains)[0]!;
  const ins = new Insider(e.location, e.keyFile);
  const last = ins.records().at(-1)!;
  state.chains[gid] = { seq: last.seq, id: hex(last.id) };
  writeFileSync(statePath, JSON.stringify(state));
  const v = reopen(e, [e.location]);
  assert.equal(v.info().warnings.length, 0, 'the outbox is the proof: no new device id is needed');
  e.clock.tick(); v.setField('psss://Item/password', 'p2');
  v.sync();
  assert.deepEqual(new Insider(e.location, e.keyFile).records().map((r) => r.seq), [1, 2, 3, 4, 5], 'the next record is seq 5, not a second seq 4');
  assert.equal(v.verify().ok, true, 'no fork');
});

test('a location that is not a vault is reported, not written to', (t) => {
  const e = newVault(t);
  const junk = join(e.dir, 'junk');
  mkdirSync(junk);
  writeFileSync(join(junk, 'file.txt'), 'x');
  const v = reopen(e, [e.location, junk]);
  const info = v.info();
  assert.equal(info.locations[1]!.status, 'behind', 'an unreadable location is behind');
  assert.match(info.locations[1]!.reason ?? '', /cannot be read.*not a psss vault/, 'with the reason');
  e.clock.tick();
  const w = v.addItem({ title: 'x' }).write;
  assert.deepEqual([w.delivered, w.failed.length, w.inOutbox], [[e.location], 1, true], 'a write reaches the good location and stays in the outbox for the bad one');
  assert.deepEqual(readdirSync(junk), ['file.txt'], 'nothing was written into the folder that is not a vault');
  const verify = v.verify();
  assert.ok(verify.problems.some((p) => p.code === 'unreadable_location' && p.location === junk), 'verify names the unreadable location');
});

