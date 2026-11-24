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
