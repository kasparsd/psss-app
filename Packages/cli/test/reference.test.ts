import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationError } from '../src/errors.ts';
import { formatReference, parseReference, shellQuote, toSelector } from '../src/reference.ts';

const field = (text: string) => parseReference(text, 'field');

test('field references parse into group, item and field, with spaces, slashes and non-ASCII', () => {
  const table: Array<[string, unknown]> = [
    ['psss://Example API/token', { item: { title: 'Example API' }, field: 'token' }],
    ['psss://Personal/Example API/token', { group: 'Personal', item: { title: 'Example API' }, field: 'token' }],
    ['psss://Example%20API/token', { item: { title: 'Example API' }, field: 'token' }],
    ['psss://a%2Fb/token', { item: { title: 'a/b' }, field: 'token' }],
    ['psss://Café Ünï/пароль', { item: { title: 'Café Ünï' }, field: 'пароль' }],
    ['psss://Caf%C3%A9/password', { item: { title: 'Café' }, field: 'password' }],
    ['psss://100%25 sure/password', { item: { title: '100% sure' }, field: 'password' }],
    ['psss://id%3Afoo/password', { item: { title: 'id:foo' }, field: 'password' }],
    ['psss://id:7F3A9C21/password', { item: { id: '7f3a9c21' }, field: 'password' }],
    ['psss://Family Group/Bank & Co/api key', { group: 'Family Group', item: { title: 'Bank & Co' }, field: 'api key' }],
  ];
  for (const [text, expected] of table) {
    assert.deepEqual(field(text), expected, `${text} should parse as ${JSON.stringify(expected)}`);
  }
});

test('item references (rm, restore) parse with one or two parts', () => {
  assert.deepEqual(parseReference('psss://Example API', 'item'), { item: { title: 'Example API' } }, 'one part is a title');
  assert.deepEqual(parseReference('psss://Family/Example API', 'item'), { group: 'Family', item: { title: 'Example API' } }, 'two parts are group and title');
  assert.deepEqual(parseReference('psss://id:7f3a9c21', 'item'), { item: { id: '7f3a9c21' } }, 'an id alone');
  assert.throws(() => parseReference('psss://a/b/c', 'item'), ValidationError, 'three parts are too many for an item');
});

test('too many parts explain how a slash in a title is written', () => {
  for (const [text, kind] of [['psss://a/b/c/d', 'field'], ['psss://a/b/c', 'item']] as const) {
    assert.throws(
      () => parseReference(text, kind),
      (e: Error) => e instanceof ValidationError && e.message.includes('A slash in a title is written %2F.'),
      `${text} as a ${kind} reference should explain %2F`,
    );
  }
});

test('malformed references are usage errors that say what is wrong', () => {
  const bad: Array<[string, RegExp, string]> = [
    ['Example/token', /is not a reference/, 'no scheme'],
    ['psss:/Example/token', /is not a reference/, 'one slash after the scheme'],
    ['psss://token', /too few parts/, 'a field reference needs an item and a field'],
    ['psss:///token', /empty part/, 'empty item'],
    ['psss://a//b', /empty part/, 'empty middle part'],
    ['psss://a/b/', /empty part/, 'trailing slash'],
    ['psss://a/b/c/d', /too many parts/, 'four parts'],
    ['psss://a%/b', /not followed by two hex digits/, 'a bare percent'],
    ['psss://a%zz/b', /not followed by two hex digits/, 'a bad escape'],
    ['psss://a%ff/b', /not followed by two hex digits/, 'invalid UTF-8'],
    ['psss://a/b?previous=1', /reserved/, 'a query is reserved'],
    ['psss://a#x/b', /reserved/, 'a fragment is reserved'],
    ['psss://id:xyz/b', /not hex/, 'an id must be hex'],
    ['psss://id:ab/b', /not hex/, 'an id has at least four digits'],
    ['psss://g/id:abcd/b', /unique/, 'a group and an id'],
    ['psss://%0A/b', /control character/, 'a line break in a name'],
    ['psss://a/b%09c', /control character/, 'a tab in a field name'],
  ];
  for (const [text, message, why] of bad) {
    assert.throws(() => field(text), (e: Error) => e instanceof ValidationError && message.test(e.message), `${text} (${why}) should be rejected with ${message}`);
  }
});

test('formatReference output parses back to the same reference, for hard titles', () => {
  const titles = ['Example API', 'a/b', '100% sure', 'id:foo', '?why #1', '  lead', 'trail ', 'Café', 'a%2Fb', 'psss://x'];
  for (const title of titles) {
    for (const group of [undefined, 'Family/Home']) {
      const ref = { ...(group ? { group } : {}), item: { title }, field: 'pass word' };
      const text = formatReference(ref);
      assert.deepEqual(parseReference(text, 'field'), ref, `${JSON.stringify(title)} should survive format and parse as ${text}`);
    }
  }
  assert.equal(formatReference({ item: { id: '7f3a9c21' }, field: 'password' }), 'psss://id:7f3a9c21/password', 'an id reference has no group and no encoding');
  assert.equal(formatReference({ item: { title: 'Example API' }, field: 'token' }), 'psss://Example API/token', 'spaces and letters stay readable');
});

test('toSelector keeps the group and the id', () => {
  assert.deepEqual(toSelector(field('psss://G/Item/f')), { title: 'Item', group: 'G' }, 'group and title');
  assert.deepEqual(toSelector(field('psss://id:abcd/f')), { id: 'abcd' }, 'id');
});

test('shellQuote quotes what a person would quote', () => {
  assert.equal(shellQuote('psss://Deploy/token'), 'psss://Deploy/token', 'plain text is left alone');
  assert.equal(shellQuote('psss://Example API/token'), '"psss://Example API/token"', 'spaces get double quotes, as in the docs');
  assert.equal(shellQuote('psss://It\'s $HOME/token'), `'psss://It'\\''s $HOME/token'`, 'a dollar sign forces single quotes');
});
