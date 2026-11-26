// Kept: what the popup keeps between openings.
import test from 'node:test';
import assert from 'node:assert/strict';
import keptModule from '../src/kept.js';

const { Kept } = keptModule;

const memory = () => {
  const data = {};
  return { data, api: { storage: { session: {
    get: async (k) => ({ [k]: data[k] }),
    set: async (o) => { Object.assign(data, o); },
    remove: async (k) => { delete data[k]; }
  } } } };
};

test('the same site and vault get the search back', async () => {
  const { api } = memory();
  await Kept.save(api, 'https://a.example', 'v1', { query: 'north', fields: ['name'], account: 'sam' });
  assert.deepEqual(await Kept.load(api, 'https://a.example', 'v1'), { query: 'north', fields: ['name'], account: 'sam' });
});

test('another site or vault starts empty', async () => {
  const { api } = memory();
  await Kept.save(api, 'https://a.example', 'v1', { query: 'north' });
  assert.equal(await Kept.load(api, 'https://b.example', 'v1'), null);
  assert.equal(await Kept.load(api, 'https://a.example', 'v2'), null);
});

test('only the three typed values are stored, bounded', async () => {
  const { api, data } = memory();
  await Kept.save(api, 'https://a.example', undefined, { query: 'q'.repeat(999), fields: ['password', 'website'], account: 7, secret: 'hunter2' });
  assert.deepEqual(Object.keys(data.popup).sort(), ['account', 'fields', 'origin', 'query', 'vault']);
  assert.equal(data.popup.query.length, 256);
  assert.deepEqual(data.popup.fields, ['website']);
  assert.equal(data.popup.account, '');
});

test('clear forgets, and a missing or failing store is harmless', async () => {
  const { api } = memory();
  await Kept.save(api, 'https://a.example', 'v1', { query: 'north' });
  await Kept.clear(api);
  assert.equal(await Kept.load(api, 'https://a.example', 'v1'), null);
  await Kept.save({}, 'https://a.example', 'v1', {});
  await Kept.clear({});
  assert.equal(await Kept.load({}, 'https://a.example', 'v1'), null);
});
