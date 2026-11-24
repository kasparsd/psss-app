import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaultError, formatReference, parseReference, type Reference } from '../src/index.ts';

test('a reference names item and field, with an optional group in front and an optional earlier value behind', () => {
  assert.deepEqual(parseReference('psss://Example API/token'), { item: { title: 'Example API' }, field: 'token' }, 'psss://item/field: spaces in a title are fine as typed');
  assert.deepEqual(parseReference('psss://Work/Example API/token'), { group: { title: 'Work' }, item: { title: 'Example API' }, field: 'token' }, 'psss://group/item/field');
  assert.deepEqual(parseReference('psss://id:00ff12ab/password'), { item: { id: '00ff12ab' }, field: 'password' }, 'psss://id:<hex>/field names an item by identifier');
  assert.deepEqual(parseReference('psss://Work/id:00ff12ab/password?previous=2'), { group: { title: 'Work' }, item: { id: '00ff12ab' }, field: 'password', previous: 2 }, 'group, id and ?previous=n together');
});

test('percent-escapes carry the characters a reference cannot hold, and a lone percent sign is left alone', () => {
  assert.deepEqual(parseReference('psss://a%2Fb%3Fc%23d%25e/f'), { item: { title: 'a/b?c#d%e' }, field: 'f' }, 'escaped slash, question mark, hash and percent decode to themselves');
  assert.deepEqual(parseReference('psss://100% safe/password'), { item: { title: '100% safe' }, field: 'password' }, 'a % that starts no escape is a literal % (what a person types in a shell)');
  assert.deepEqual(parseReference('psss://id%3Afoo/password'), { item: { title: 'id:foo' }, field: 'password' }, 'a title that starts with id: is written with an escaped colon');
  assert.deepEqual(parseReference('psss://Caf%C3%A9/password'), { item: { title: 'Café' }, field: 'password' }, 'UTF-8 escapes decode');
  assert.deepEqual(parseReference('psss://Café/password'), { item: { title: 'Café' }, field: 'password' }, 'titles are compared in NFC');
});

test('formatReference and parseReference are inverses for any title, group and field', () => {
  const titles = ['Example', 'Example API', 'a/b', 'what?', '#1', '100%', 'id:abcd', 'id:', 'Café', '日本語', 'tab\there', 'line\nbreak', '%2F', ' leading and trailing '];
  for (const item of titles) for (const field of ['password', 'my field', 'a/b']) {
    for (const ref of [{ item: { title: item }, field }, { group: { title: item }, item: { id: 'abcd1234' }, field, previous: 3 }] as Reference[]) {
      const text = formatReference(ref);
      assert.deepEqual(parseReference(text), { ...ref, item: 'title' in ref.item ? { title: ref.item.title.normalize('NFC') } : ref.item, ...(ref.group ? { group: { title: (ref.group as { title: string }).title.normalize('NFC') } } : {}), field: field.normalize('NFC') }, `round trip of ${JSON.stringify(ref)} through ${text}`);
    }
  }
  assert.equal(formatReference({ item: { title: 'Example API' }, field: 'token' }), 'psss://Example API/token', 'a space stays readable');
});

test('a malformed reference is refused with bad_reference', () => {
  for (const bad of ['', 'example/password', 'psss://', 'psss://password', 'psss:///password', 'psss://a//password', 'psss://a/b/c/d', 'psss://id:xyz/password', 'psss://id:ab/password',
    'psss://id:ABCDEF12/password', 'psss://a/b?previous=0', 'psss://a/b?previous=x', 'psss://a/b?previous=1&x=2', 'psss://a/b?other=1', 'psss://a%ff/b']) {
    assert.throws(() => parseReference(bad), (e: unknown) => e instanceof VaultError && e.code === 'bad_reference', `${JSON.stringify(bad)} must be refused as a bad reference`);
  }
});
