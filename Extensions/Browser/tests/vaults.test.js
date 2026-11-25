// Vaults: what the popup's vault pick list and notices say. Several vaults can be open at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import vaultsModule from '../src/vaults.js';

const { Vaults } = vaultsModule;
const vault = (id, name, state = 'open', active = false, extra = {}) => ({ id, name, state, active, ...extra });

test('the pick list keeps the order the app reports, whichever vault is open, locked or chosen', () => {
  const list = [vault('a', 'Passwords', 'locked'), vault('b', 'Work', 'open', true), vault('c', 'Archive', 'open'), vault('d', 'Family', 'needs-password')];
  assert.deepEqual(Vaults.options(list, 'c').map((o) => o.value), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Vaults.options(list, 'c').map((o) => o.selected), [false, false, true, false]);
  assert.deepEqual(Vaults.options(list.toReversed().toReversed(), 'a').map((o) => o.value), ['a', 'b', 'c', 'd']);
});

test('an option is the vault name only: no padlock, no glyph, no state words', () => {
  const list = [vault('a', 'Passwords', 'open'), vault('b', 'Work', 'locked'), vault('c', 'Old', 'not-found'), vault('d', 'Family', 'needs-password')];
  assert.deepEqual(Vaults.options(list, 'a').map((o) => o.text), ['Passwords', 'Work', 'Old', 'Family']);
  for (const o of Vaults.options(list, 'a')) assert.doesNotMatch(o.text, /[\u{1F512}\u{1F513}\u{1F510}]|lock|unlock|open/iu);
});

test('the popup uses the vault the app shows until another is chosen, and keeps a choice that is still listed', () => {
  const list = [vault('a', 'A', 'open'), vault('b', 'B', 'open', true), vault('c', 'C', 'locked')];
  assert.equal(Vaults.pick(list, undefined).id, 'b');
  assert.equal(Vaults.pick(list, 'a').id, 'a', 'a second open vault can be the one filled from while another is shown');
  assert.equal(Vaults.pick(list, 'c').id, 'c');
  assert.equal(Vaults.pick(list, 'gone').id, 'b', 'a vault that left the list falls back to the shown one');
  assert.equal(Vaults.pick([vault('x', 'X'), vault('y', 'Y')], undefined).id, 'x');
  assert.equal(Vaults.pick([], 'a'), undefined, 'no list at all: nothing to choose');
});

test('a locked vault says so with Unlock, an open one has no notice of its own', () => {
  assert.deepEqual(Vaults.notice(vault('a', 'Work', 'locked'), undefined, 2), { text: 'Work is locked. Choose Unlock to use Touch ID.', kind: 'info', unlock: true });
  assert.equal(Vaults.notice(vault('a', 'Work', 'needs-password', false, { reason: 'off' }), undefined, 2).text, 'Touch ID is off for Work. Unlock with the vault password.');
  assert.equal(Vaults.notice(vault('a', 'Work', 'needs-password', false, { reason: 'changed' }), undefined, 2).text, 'Touch ID changed since Work was set up. Unlock with the vault password.');
  assert.equal(Vaults.notice(vault('a', 'Work', 'needs-password', false, { reason: 'locked-out' }), undefined, 2).text, 'Touch ID is locked out right now. Unlock with the vault password.');
  assert.equal(Vaults.notice(vault('a', 'Work', 'not-found'), undefined, 2).unlock, false);
  assert.match(Vaults.notice(vault('a', 'Work', 'not-found'), undefined, 2).text, /choose another vault\.$/);
  assert.doesNotMatch(Vaults.notice(vault('a', 'Work', 'not-found'), undefined, 1).text, /another vault/);
  assert.equal(Vaults.notice(vault('a', 'Work', 'locked'), 'cancelled').unlock, true);
  assert.equal(Vaults.notice(vault('a', 'Work', 'locked'), 'needs-app').text, 'Open Psss to unlock Work.');
});

test('a hostile vault name is one safe line in the pick list and in every notice', () => {
  const hostile = 'Wo‮rk\nTaxes​' + 'x'.repeat(500);
  const v = vault('h', hostile, 'locked');
  const [option] = Vaults.options([v], 'h');
  assert.ok(option.text.length <= 40 && option.text.endsWith('…'));
  for (const text of [option.text, Vaults.name(v), Vaults.notice(v, undefined, 2).text, Vaults.notice(v, 'needs-app', 2).text, Vaults.notice({ ...v, state: 'not-found' }, undefined, 2).text]) {
    assert.doesNotMatch(text, /[\n\r‮​]/u);
    assert.ok(text.length < 200, 'cut, never the whole 500 characters');
  }
  assert.equal(Vaults.name({ name: '‮​\n' }), 'Vault', 'a name with nothing left is Vault');
  assert.equal(Vaults.name({}), 'Vault');
  assert.equal(Vaults.name({ name: '<img src=x onerror=1>' }), '<img src=x onerror=1>', 'text, never markup: the popup uses textContent only');
});
