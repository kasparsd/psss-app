import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVault } from './helpers.ts';

const SECRET = new TextEncoder().encode('12345678901234567890');

test('changes: one entry per write, newest first, with the fields each touched and no value anywhere', (t) => {
  const e = newVault(t, {}, 'changes');
  const v = e.vault;
  e.clock.tick(); const added = e.clock.now();
  v.addItem({ title: 'Bank', username: 'u', password: 'pw-one-4f9c', url: 'bank.example', custom: { PIN: '1234-secret' }, otp: { secret: SECRET, digits: 6, period: 30, algorithm: 1 } });
  e.clock.tick(60_000); const second = e.clock.now();
  v.editItem('psss://Bank/password', { password: 'pw-two-77aa', username: 'u2' });
  e.clock.tick(60_000); const third = e.clock.now();
  v.editItem('psss://Bank/password', { custom: { PIN: '9999-secret', Branch: { value: 'north', concealed: false } }, tags: { add: ['money'] } });
  e.clock.tick(60_000); const fourth = e.clock.now();
  v.deleteItem('psss://Bank/password');
  e.clock.tick(60_000); const fifth = e.clock.now();
  v.restoreItem('psss://Bank/password');

  const r = v.changes('psss://Bank/password');
  assert.equal(r.kind, 'changes', 'an item with history has changes');
  if (r.kind !== 'changes') return;
  assert.deepEqual(r.entries.map((c) => [c.at, c.kind]), [[fifth, 'restored'], [fourth, 'deleted'], [third, 'changed'], [second, 'changed'], [added, 'added']], 'newest first: restore, delete, two edits, the creation');
  assert.deepEqual(r.entries[2]!.fields, ['tags', 'Branch', 'PIN'].sort((a, b) => (a === 'tags' ? -1 : b === 'tags' ? 1 : a < b ? -1 : 1)), 'tags then custom labels');
  assert.deepEqual(r.entries[3]!.fields, ['username', 'password'], 'two fields of one write are one entry, in the order a person reads them');
  assert.deepEqual(r.entries[4]!.fields, ['title', 'username', 'password', 'url', 'code', 'type', 'PIN'], 'the creation names every field it wrote');
  const text = JSON.stringify(r);
  for (const secret of ['pw-one', 'pw-two', '1234-secret', '9999-secret', 'north']) assert.ok(!text.includes(secret), `${secret} is a value and must not be in the result`);
  assert.equal(v.changes('psss://Nothing/x').kind, 'notFound', 'a missing item is notFound');
});

test('changes: a deleted item still has changes, and a custom field that was cleared keeps its label', (t) => {
  const e = newVault(t, {}, 'changes2');
  const v = e.vault;
  e.clock.tick(); v.addItem({ title: 'Gone', password: 'p', custom: { Extra: 'x' } });
  e.clock.tick(); v.editItem('psss://Gone/password', { custom: { Extra: null } });
  e.clock.tick(); v.deleteItem('psss://Gone/password');
  const r = v.changes('psss://Gone/password');
  assert.equal(r.kind, 'changes', 'the default scope includes Recently Deleted');
  if (r.kind !== 'changes') return;
  assert.deepEqual(r.entries.map((c) => [c.kind, c.fields]), [['deleted', []], ['changed', ['Extra']], ['added', ['title', 'password', 'type', 'Extra']]]);
});

test('get of a code says the period as well as the seconds left', (t) => {
  const e = newVault(t, {}, 'period', 59_000);
  e.vault.addItem({ title: 'Bank', otp: { secret: SECRET, digits: 8, period: 45, algorithm: 1 } });
  const c = e.vault.get('psss://Bank/code');
  assert.equal(c.kind === 'value' && c.period, 45, 'the period of the item');
  assert.equal(c.kind === 'value' && c.expiresInSeconds, 45 - (59 % 45), 'and the seconds left in it');
});

test('setField and editItem of a value the item already holds write nothing: no record, no history row, no new date', (t) => {
  const e = newVault(t, {}, 'unchanged');
  const v = e.vault;
  e.clock.tick(); v.addItem({ title: 'Bank', username: 'robin', password: 'pw-one', url: 'bank.example', notes: 'n', custom: { Branch: { value: 'north', concealed: false }, PIN: '1234' }, tags: { add: ['money'] } });
  const rows = () => (v.changes('psss://Bank/password') as { entries: unknown[] }).entries.length;
  const seqs = () => v.delivery().pending;
  const before = rows();
  const samePassword = v.setField('psss://Bank/password', 'pw-one');
  assert.equal(samePassword.unchanged, true, 'the same password is not a change');
  assert.deepEqual([samePassword.id, samePassword.seq, samePassword.delivered, samePassword.failed, samePassword.inOutbox], ['', 0, [], [], false]);
  for (const [field, value] of [['username', 'robin'], ['title', 'Bank'], ['url', 'bank.example'], ['url', 'https://bank.example'], ['notes', 'n'], ['Branch', 'north'], ['PIN', '1234']] as const) {
    e.clock.tick();
    assert.equal(v.setField(`psss://Bank/${field}`, value).unchanged, true, `${field} with the value it holds`);
  }
  assert.equal(v.editItem('psss://Bank/password', { password: 'pw-one', username: 'robin', custom: { Branch: 'north' }, tags: { add: ['money'] } }).unchanged, true, 'several fields, none different');
  assert.equal(v.editItem('psss://Bank/password', { custom: { Missing: null }, tags: { remove: ['absent'] } }).unchanged, true, 'clearing what is not there');
  assert.equal(rows(), before, 'no history row was added');
  assert.equal(v.history('psss://Bank/password').kind === 'history' && (v.history('psss://Bank/password') as { entries: unknown[] }).entries.length, 0, 'and no earlier password');
  assert.equal(v.show('psss://Bank/password').kind, 'found');
  assert.equal(seqs(), 0, 'nothing waits in the outbox');

  // a different value is still one record, and a partly different edit writes the whole record
  e.clock.tick();
  const changed = v.setField('psss://Bank/password', 'pw-two');
  assert.equal(changed.unchanged, undefined, 'a real change is written');
  assert.equal(changed.id.length > 0 && changed.seq > 0, true);
  e.clock.tick();
  assert.equal(v.editItem('psss://Bank/password', { password: 'pw-two', username: 'sam' }).unchanged, undefined, 'one field differs');
  assert.equal(v.setField('psss://Bank/Branch', 'north', { concealed: true }).unchanged, undefined, 'the same text but hidden is a change');
  assert.equal(v.setField('psss://Bank/PIN', '1234', { concealed: false }).unchanged, undefined, 'the same text but shown is a change');
  assert.equal(rows(), before + 4, 'exactly the four real writes are rows');
  const prev = v.history('psss://Bank/password');
  assert.equal(prev.kind === 'history' && prev.entries.map((h) => h.value).join(','), 'pw-one', 'the unchanged write did not push the password into history');
  // the same value again after the change is a no-op again, and a value changed back is a change
  assert.equal(v.setField('psss://Bank/password', 'pw-two').unchanged, true);
  e.clock.tick();
  assert.equal(v.setField('psss://Bank/password', 'pw-one').unchanged, undefined, 'changing back is a change');
  assert.equal(v.get('psss://Bank/password').kind === 'value' && (v.get('psss://Bank/password') as { value: string }).value, 'pw-one');
});

test('a verification code cannot be made with digits outside 6 to 8, though the record can hold them: get refuses it, show still lists the item', (t) => {
  const e = newVault(t, {}, 'digits');
  for (const digits of [4, 5, 9, 10]) e.vault.addItem({ title: `D${digits}`, otp: { secret: SECRET, digits, period: 30, algorithm: 1 } });
  for (const digits of [6, 7, 8]) e.vault.addItem({ title: `D${digits}`, otp: { secret: SECRET, digits, period: 30, algorithm: 1 } });
  for (const digits of [6, 7, 8]) {
    const c = e.vault.get(`psss://D${digits}/code`);
    assert.equal(c.kind === 'value' && (c as { value: string }).value.length, digits, `${digits} digits are made`);
  }
  for (const digits of [4, 5, 9, 10]) {
    assert.throws(() => e.vault.get(`psss://D${digits}/code`), new RegExp(`unsupported digits ${digits}`), `${digits} digits are refused, in words the CLI can read`);
    const shown = e.vault.show(`psss://D${digits}/code`);
    assert.ok(shown.kind === 'found' && shown.item.fields.some((f) => f.name === 'code' && f.computed === true && f.value === ''), 'the item still lists a code field, with no value, so a list never fails');
  }
});
