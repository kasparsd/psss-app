// Groups: how the popup splits logins into "For This Site" and "Other Matches", and the words of an Other Matches row.
import test from 'node:test';
import assert from 'node:assert/strict';
import groups from '../src/groups.js';

const { Groups } = groups;
const row = (title, website, matches) => ({ title, website, matches });

test('a login whose website matches the page is For This Site; every other result is an Other Match', () => {
  const rows = [row('A', 'gitforge.example', true), row('B', 'githosting.example', false), row('C', '', false), row('D', 'gitforge.example', true)];
  const { site, other } = Groups.split(rows);
  assert.deepEqual(site.map((r) => r.title), ['A', 'D']);
  assert.deepEqual(other.map((r) => r.title), ['B', 'C']);
});

test('the host decides: a row without a boolean "matches" is never For This Site', () => {
  const { site, other } = Groups.split([{ title: 'X' }, { title: 'Y', matches: 'true' }]);
  assert.equal(site.length, 0);
  assert.equal(other.length, 2);
});

test('an empty group is an empty array, so the popup leaves its heading out', () => {
  assert.deepEqual(Groups.split([row('A', 'gitforge.example', true)]).other, []);
  assert.deepEqual(Groups.split([row('B', '', false)]).site, []);
  assert.deepEqual(Groups.split([]), { site: [], other: [] });
});

test('Other Matches rows say where the login is saved, or that it has no website', () => {
  assert.equal(Groups.savedFor(row('B', 'githosting.example', false)), 'Saved for githosting.example');
  assert.equal(Groups.savedFor(row('C', '', false)), 'No website');
  assert.equal(Groups.savedFor({ title: 'C' }), 'No website');
  assert.equal(Groups.savedFor(row('C', '  \n\t ', false)), 'No website');
  assert.equal(Groups.savedFor(row('C', '‮​', false)), 'No website', 'only invisible characters is no website');
});

test('a hostile saved site is escaped and cut, never shown raw', () => {
  const bidi = Groups.savedFor(row('B', 'githosting.example‮gpj.exe', false));
  assert.equal(bidi, 'Saved for githosting.examplegpj.exe');
  assert.equal(Groups.savedFor(row('B', 'evil.example\nSaved for gitforge.example', false)), 'Saved for evil.example Saved for gitforge.example', 'one line');
  const long = Groups.savedFor(row('B', 'a'.repeat(5000) + '.example', false));
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 'Saved for '.length + 80);
  assert.equal(Groups.savedSite(row('B', '<img src=x onerror=1>', false)), '<img src=x onerror=1>', 'text, not markup: the popup uses textContent only');
});
