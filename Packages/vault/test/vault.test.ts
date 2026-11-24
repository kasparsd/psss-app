import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ARGON2 } from '../../format/src/slots.ts';
import { VaultError, createVault, openVault, seededRandom } from '../src/index.ts';
import { Insider, WEAK, copyDir, newVault, tmp, makeClock } from './helpers.ts';

const open = (e: ReturnType<typeof newVault>, unlock: Parameters<typeof openVault>[0]['unlock'], stateDir = e.stateDir) =>
  openVault({ locations: [e.location], unlock, stateDir, now: e.clock.now, random: seededRandom('open') });

test('(a) create, set, reopen with each unlock source, get', (t) => {
  const e = newVault(t, { password: 'correct horse battery', recoveryKit: true, ...WEAK });
  assert.match(e.recoveryKit ?? '', /^RK1(-[0-9A-Z]{4}){9}$/, 'creating with recoveryKit: true returns the printed kit text');
  e.clock.tick();
  e.vault.addItem({ title: 'Example', username: 'ada', password: 'hunter2', url: 'example.com', notes: 'a note' });
  e.clock.tick();
  e.vault.setField('psss://Example/password', 'hunter3');

  assert.equal(statSync(e.keyFile).mode & 0o777, 0o600, 'the device key file is written with mode 0600');
  assert.match(readFileSync(e.keyFile, 'utf8'), /^\{"format":"psss-device-key","version":1,"kem_seed":"[0-9a-f]{64}"\}\n$/, 'the key file has the documented content');

  const sources: [string, Parameters<typeof openVault>[0]['unlock'], string][] = [
    ['key file', { keyFile: e.keyFile }, 'keyFile'],
    ['key bytes as text', { keyBytes: readFileSync(e.keyFile, 'utf8') }, 'keyBytes'],
    ['key bytes as bytes', { keyBytes: new Uint8Array(readFileSync(e.keyFile)) }, 'keyBytes'],
    ['password', { password: 'correct horse battery', testOnlyWeakKdf: true }, 'password'],
    ['recovery kit text', { recoveryKit: e.recoveryKit! }, 'recoveryKit'],
    ['recovery kit typed in lower case without hyphens', { recoveryKit: e.recoveryKit!.toLowerCase().replaceAll('-', ' ') }, 'recoveryKit'],
  ];
  for (const [name, unlock, source] of sources) {
    const v = open(e, unlock);
    const got = v.get('psss://Example/password');
    assert.equal(got.kind === 'value' && got.value, 'hunter3', `opening with the ${name} must give the current password`);
    assert.equal(v.info().unlock.source, source, `info() says the vault was opened with ${source}`);
    const u = v.get('psss://Example/username');
    assert.equal(u.kind === 'value' && u.value, 'ada', `the username is readable after opening with the ${name}`);
  }
  const info = open(e, { keyFile: e.keyFile }).info();
  assert.deepEqual(info.wayBack, { password: true, recoveryKit: true, any: true }, 'a password slot and a kit slot count as a way back');
  assert.equal(info.name, 'Personal', 'the vault name given at creation is kept in the device state');
  assert.deepEqual(info.groups.map((g) => [g.name, g.role, g.items]), [['Only Me', 'manager', 1]], 'one group, Only Me, with one item');
  assert.equal(info.locations[0]!.status, 'upToDate', 'a single location that holds every record is up to date');
});

test('(a) wrong secrets are refused with a reason, and a vault with no password has no way back', (t) => {
  const e = newVault(t, { password: 'right', ...WEAK });
  const code = (f: () => unknown) => { try { f(); } catch (x) { return x instanceof VaultError ? x.code : String(x); } return 'no error'; };
  assert.equal(code(() => open(e, { password: 'wrong', testOnlyWeakKdf: true })), 'bad_unlock', 'a wrong password does not open the vault');
  assert.equal(code(() => open(e, { password: 'right' })), 'bad_slot_parameters', 'without the test-only switch the weak Argon2id parameters of the slot are refused (7.2)');
  assert.equal(code(() => open(e, { recoveryKit: 'RK1-0000-0000-0000-0000-0000-0000-0000-0000-0000' })), 'bad_recovery_kit', 'a mistyped kit is told apart from a kit that opens nothing');
  assert.equal(code(() => open(e, { keyFile: join(e.dir, 'missing.key') })), 'no_key_file', 'a missing key file is named');
  const other = newVault(t, {}, 'other');
  assert.equal(code(() => open(e, { keyFile: other.keyFile })), 'no_device_slot', 'a key of another vault opens no slot here');
  assert.equal(code(() => open(other, { password: 'x', testOnlyWeakKdf: true })), 'no_slot', 'a vault created without a password has no password slot');
  assert.equal(other.vault.info().wayBack.any, false, 'with the device key as the only way in, info() says there is no way back');
  assert.equal(code(() => createVault({ name: 'x', location: join(e.dir, 'N.psss'), keyFile: join(e.dir, 'n.key'), stateDir: join(e.dir, 'ns'), password: 'p', argon2: { memory: 256, passes: 2, lanes: 1 } })), 'bad_slot_parameters', 'creating a password slot below the Argon2id limits needs the test-only switch');
  assert.deepEqual(DEFAULT_ARGON2, { memory: 131072, passes: 3, lanes: 4 }, 'the default Argon2id parameters are 128 MiB, 3 passes, 4 lanes (7.2)');
  assert.equal(code(() => createVault({ name: 'x', location: e.location, keyFile: join(e.dir, 'n2.key'), stateDir: join(e.dir, 'ns2') })), 'location_not_empty', 'a new vault is never made on top of a vault');
  assert.equal(code(() => createVault({ name: 'x', location: join(e.dir, 'M.psss'), keyFile: e.keyFile, stateDir: join(e.dir, 'ns3') })), 'key_file_exists', 'a device key file is never overwritten');
});

test('(b) a device restart continues its own chain', (t) => {
  const e = newVault(t);
  e.clock.tick(); e.vault.addItem({ title: 'One', password: 'p1' });
  const deviceId = e.vault.info().deviceId;
  e.clock.tick();
  const v2 = open(e, { keyFile: e.keyFile });
  assert.equal(v2.info().deviceId, deviceId, 'the device id survives a restart');
  v2.setField('psss://One/password', 'p2');
  e.clock.tick();
  const v3 = open(e, { keyFile: e.keyFile });
  v3.setField('psss://One/password', 'p3');
  v3.addItem({ title: 'Two' });

  const ins = new Insider(e.location, e.keyFile);
  assert.equal(ins.chainDirs().length, 1, 'three sessions of one device write one chain, not three');
  const recs = ins.records();
  assert.deepEqual(recs.map((r) => r.seq), [1, 2, 3, 4, 5, 6], 'sequence numbers run 1 to 6 without a gap or a repeat across restarts');
  recs.slice(1).forEach((r, i) => assert.deepEqual(r.prev, recs[i]!.id, `record ${r.seq} names the record before it as prev`));
  const v = open(e, { keyFile: e.keyFile });
  const history = v.history('psss://One/password');
  assert.deepEqual(history.kind === 'history' && history.entries.map((h) => h.value), ['p2', 'p1'], 'previous passwords across restarts are p2 then p1');
  assert.equal(v.verify().ok, true, 'verify finds nothing wrong in a chain continued across restarts');
});

test('(b) a device whose state is older than its own records takes a new device id and does not fork (3.2)', (t) => {
  const e = newVault(t);
  e.clock.tick(); e.vault.addItem({ title: 'One', password: 'p1' });
  copyDir(e.stateDir, join(e.dir, 'state-backup'));
  e.clock.tick(); e.vault.setField('psss://One/password', 'p2');
  e.clock.tick(); e.vault.setField('psss://One/password', 'p3');
  const before = e.vault.info().deviceId;
  const restored = open(e, { keyFile: e.keyFile }, join(e.dir, 'state-backup'));
  assert.notEqual(restored.info().deviceId, before, 'a state restored from a backup cannot continue the old chain: it takes a new device id');
  assert.match(restored.info().warnings.join(' '), /new device id/, 'info() tells the person');
  e.clock.tick(); restored.setField('psss://One/password', 'p4');
  const v = restored.verify();
  assert.equal(v.ok, true, `no fork and no problem after the new chain: ${JSON.stringify(v.problems)}`);
  const ins = new Insider(e.location, e.keyFile);
  assert.equal(ins.chainDirs().length, 2, 'the old chain stays and the new device id has its own');
  const g = restored.get('psss://One/password');
  assert.equal(g.kind === 'value' && g.value, 'p4', 'the new write wins over the three of the old chain');
});

test('(e) references: one item, an ambiguous title with candidates by id, a missing item and a missing field', (t) => {
  const e = newVault(t);
  const v = e.vault;
  e.clock.tick(); const a = v.addItem({ title: 'Example', username: 'ada', password: 'pa', url: 'a.example.com' });
  e.clock.tick(); const b = v.addItem({ title: 'Example', username: 'bob', password: 'pb', url: 'b.example.com' });
  e.clock.tick(); v.addItem({ title: 'Unique', password: 'pu', custom: { Region: 'eu' } });

  const amb = v.get('psss://Example/password');
  assert.equal(amb.kind, 'ambiguous', 'two items with one title make an ambiguous result, not a guess');
  if (amb.kind === 'ambiguous') {
    assert.deepEqual(amb.candidates.map((c) => c.id).sort(), [a.id, b.id].sort(), 'the candidates are listed by item id');
    assert.deepEqual(amb.candidates.map((c) => c.username).sort(), ['ada', 'bob'], 'with enough to tell them apart');
  }
  assert.equal(v.find('psss://Example/password').kind, 'ambiguous', 'find says the same');
  assert.equal(v.find('psss://Only Me/Example/password').kind, 'ambiguous', 'naming the group does not help when both items are in it');
  for (const [item, pw] of [[a, 'pa'], [b, 'pb']] as const) {
    const g = v.get(`psss://id:${item.id}/password`);
    assert.equal(g.kind === 'value' && g.value, pw, 'psss://id:<hex>/field names exactly one item');
    const short = v.get(`psss://id:${item.id.slice(0, 8)}/password`);
    assert.equal(short.kind === 'value' && short.value, pw, 'a unique start of the id is enough');
  }
  assert.equal(v.get('psss://Nothing/password').kind, 'notFound', 'a title that matches nothing is notFound');
  assert.equal(v.get('psss://id:ffffffff/password').kind, 'notFound', 'an id that matches nothing is notFound');
  assert.equal(v.get('psss://Other Group/Unique/password').kind, 'notFound', 'a group that does not exist is notFound');
  assert.equal(v.get('psss://Unique/username').kind, 'noField', 'an item without the field is noField, not an empty value');
  assert.equal(v.get('psss://Unique/code').kind, 'noField', 'code of an item with no verification-code secret is noField');
  const one = v.get('psss://unique/region');
  assert.equal(one.kind === 'value' && one.value, 'eu', 'a title matches when only case differs and nothing matches exactly; a custom field is read by its label');
  assert.equal(v.get('psss://Only Me/Unique/password').kind, 'value', 'psss://group/item/field with the group name');
  assert.throws(() => v.get('Example/password'), (x: unknown) => x instanceof VaultError && x.code === 'bad_reference', 'a malformed reference throws');
  assert.throws(() => v.setField('psss://Example/password', 'x'), (x: unknown) => x instanceof VaultError && x.code === 'ambiguous' && x.candidates?.length === 2, 'a write to an ambiguous reference throws with the candidates and writes nothing');
  assert.throws(() => v.setField('psss://Nothing/password', 'x'), (x: unknown) => x instanceof VaultError && x.code === 'not_found', 'a write to a missing item throws not_found');
});

test('fields: edit several at once, custom fields, tags, urls, the verification code and previous passwords', (t) => {
  const e = newVault(t, {}, 'fields', 59_000);
  const v = e.vault;
  v.addItem({ title: 'Bank', username: 'u', password: 'one', url: 'bank.example', tags: { add: ['money', 'later'] }, custom: { PIN: '1234', Branch: { value: 'north', concealed: false } },
    otp: { secret: new TextEncoder().encode('12345678901234567890'), digits: 8, period: 30, algorithm: 1 } });
  const code = v.get('psss://Bank/code');
  assert.deepEqual(code.kind === 'value' && [code.value, code.expiresInSeconds], ['94287082', 1], 'code is computed from the otp field at the injected time (RFC 6238)');
  e.clock.tick(30_000);
  const code2 = v.get('psss://Bank/code');
  assert.notEqual(code2.kind === 'value' && code2.value, '94287082', 'the code of the next step differs');
  assert.throws(() => v.setField('psss://Bank/code', '000000'), (x: unknown) => x instanceof VaultError && x.code === 'read_only_field', 'code cannot be set');

  const w = v.editItem('psss://Bank/title', { username: 'ada', url: 'bank.example/login', tags: { add: ['work'], remove: ['later'] }, custom: { PIN: '9999', Branch: null, Account: '42' }, password: 'two' });
  assert.equal(w.seq, 4, 'an edit of several fields is one record');
  const shown = v.show('psss://Bank/title');
  assert.equal(shown.kind, 'found');
  if (shown.kind === 'found') {
    const f = Object.fromEntries(shown.item.fields.map((x) => [x.name, x]));
    assert.equal(f.username!.value, 'ada', 'username edited');
    assert.equal(f.url!.value, 'https://bank.example/login', 'the primary website is replaced, with https:// put in front (schema 3)');
    assert.equal(f.PIN!.value, '9999', 'an existing custom field keeps its identity and takes the new value');
    assert.equal(f.PIN!.secret, true, 'a custom field added without concealed is concealed');
    assert.equal(f.Branch, undefined, 'null removes a custom field');
    assert.equal(f.Account!.value, '42', 'a new custom field is added');
    assert.equal(f.password!.secret, true, 'a password is marked secret for the caller');
    assert.deepEqual(shown.item.tags, ['money', 'work'], 'tags added and removed, shown in order');
  }
  assert.deepEqual(v.search('money').map((i) => i.title), ['Bank'], 'search finds a tag');
  assert.deepEqual(v.search('BANK  ada').map((i) => i.title), ['Bank'], 'search: every term must match, case ignored, across title and username');
  assert.deepEqual(v.search('pin').map((i) => i.title), ['Bank'], 'search matches custom field labels');
  assert.deepEqual(v.search('9999').map((i) => i.title), [], 'search never looks into custom values');
  assert.deepEqual(v.search('two').map((i) => i.title), [], 'search never looks into passwords');
  const hist = v.history('psss://Bank/password');
  assert.deepEqual(hist.kind === 'history' && hist.entries.map((h) => h.value), ['one'], 'the password before the edit is a previous password');
  const prev = v.get('psss://Bank/password?previous=1');
  assert.equal(prev.kind === 'value' && prev.value, 'one', '?previous=1 reads it');
  assert.equal(v.get('psss://Bank/password?previous=2').kind, 'noField', '?previous=2 with only one earlier value is noField');
  const uh = v.history('psss://Bank/username');
  assert.deepEqual(uh.kind === 'history' && uh.entries.map((h) => h.value), ['u'], 'another field keeps its earlier writes as history, with the date it was replaced');
  assert.equal(uh.kind === 'history' && uh.entries[0]!.replaced, e.clock.now(), 'dated by the write that replaced it');
});

test('deleting moves to Recently Deleted, restoring brings it back, and a purge request hides it for good', (t) => {
  const e = newVault(t);
  const v = e.vault;
  e.clock.tick(); v.addItem({ title: 'Keep', password: 'k' });
  e.clock.tick(); v.addItem({ title: 'Doomed', password: 'd' });
  e.clock.tick(); v.deleteItem('psss://Doomed/password');
  assert.deepEqual(v.list().map((i) => i.title), ['Keep'], 'a deleted item leaves the list');
  assert.deepEqual(v.deleted().map((i) => i.title), ['Doomed'], 'and is in Recently Deleted');
  assert.equal(v.get('psss://Doomed/password').kind, 'notFound', 'get does not read a deleted item');
  assert.equal(v.find('psss://Doomed/password', { scope: 'deleted' }).kind, 'found', 'but find can look in Recently Deleted');
  assert.deepEqual(v.info().deletedCount, 1, 'info counts it');
  e.clock.tick(); v.restoreItem('psss://Doomed/password');
  assert.deepEqual(v.list().map((i) => i.title), ['Doomed', 'Keep'], 'restore brings it back');
  e.clock.tick(); v.deleteItem('psss://Doomed/password');
  e.clock.tick(); v.purgeItem('psss://Doomed/password');
  assert.deepEqual(v.deleted().map((i) => i.title), [], 'after a purge request the item is not in Recently Deleted either (5.4: every reader hides its writes at once)');
  assert.equal(v.info().purgesPending, 1, 'info says a purge request waits for a checkpoint, which this library does not write');
  const again = open(e, { keyFile: e.keyFile });
  assert.deepEqual(again.list({ scope: 'all' }).map((i) => i.title), ['Keep'], 'the purge holds after a restart');
  assert.equal(again.verify().ok, true, 'verify has nothing to say about a purge request');
});

test('groups are found by name, and a group that does not exist cannot be written to', (t) => {
  const e = newVault(t);
  assert.deepEqual(e.vault.groups().map((g) => [g.name, g.role, g.epoch]), [['Only Me', 'manager', 0]], 'one group, Only Me, epoch 0');
  assert.throws(() => e.vault.addItem({ title: 'x', group: 'Family' }), (x: unknown) => x instanceof VaultError && x.code === 'no_group', 'a group that does not exist cannot be written to');
  const ok = e.vault.addItem({ title: 'x', group: 'only me' });
  assert.equal(ok.item.group, 'Only Me', 'a group is found by name, case ignored');
});
