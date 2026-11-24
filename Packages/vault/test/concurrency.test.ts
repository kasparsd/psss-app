import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { generateDeviceKey, openVault, seededRandom, writeKeyFile, type Vault } from '../src/index.ts';
import { Insider, makeRng, newVault } from './helpers.ts';

const ROUNDS = Number(process.env.ROUNDS ?? 200);
const FIELDS = ['title', 'username', 'notes', 'token', 'region'] as const;

test('(c) two devices on one shared folder make 200 rounds of concurrent offline edits: identical state, no lost edit, later clock wins, the loser stays in history', (t) => {
  // durable: false only here: 1,300 records with a flush to disk each take a minute and the property under test (merging) does not depend on it
  const e = newVault(t, { durable: false }, 'device-a');
  const A = e.vault;
  const rng = makeRng('rounds');
  const items: { id: string }[] = [];
  const model = new Map<string, string[]>(); // `${item}/${field}` -> every value written, oldest first
  const write = (vault: Vault, id: string, field: string, value: string) => {
    e.clock.tick();
    vault.setField(`psss://id:${id}/${field}`, value);
    const k = `${id}/${field}`;
    model.set(k, [...(model.get(k) ?? []), value]);
  };

  // six items, every field present from the start (two devices that each add a custom field offline would both keep it: schema 1)
  for (let i = 0; i < 6; i++) {
    e.clock.tick();
    const { id } = A.addItem({ title: `Item ${i}`, username: `user ${i}`, notes: `note ${i}`, custom: { token: `token ${i}`, region: `region ${i}` } });
    items.push({ id });
    for (const [f, v] of [['title', `Item ${i}`], ['username', `user ${i}`], ['notes', `note ${i}`], ['token', `token ${i}`], ['region', `region ${i}`]]) model.set(`${id}/${f}`, [v!]);
  }

  // device B is let in by a device slot written by A (the invitation exchange is not specified: spec 10)
  const bKey = generateDeviceKey(seededRandom('device-b-key'));
  writeKeyFile(join(e.dir, 'b.key'), bKey.kemSeed);
  A.admitDevice(bKey.kemPk);
  const B = openVault({ locations: [e.location], unlock: { keyFile: join(e.dir, 'b.key') }, stateDir: join(e.dir, 'state-b'), now: e.clock.now, random: seededRandom('device-b'), durable: false });
  assert.notEqual(A.info().deviceId, B.info().deviceId, 'each device has its own device id and so its own chain');
  assert.equal(A.info().person, B.info().person, 'both are devices of one person');
  A.setOffline(true);
  B.setOffline(true);
  assert.equal(B.sync().outbox, 0, 'B starts with the same items');

  let conflicts = 0, sameFieldLaterWon = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const touchedBy = new Map<string, Set<string>>();
    const ops = rng.between(2, 6);
    for (let k = 0; k < ops; k++) {
      const who = rng.pick(['A', 'B'] as const);
      const item = rng.pick(items).id, field = rng.pick(FIELDS);
      write(who === 'A' ? A : B, item, field, `r${round}.${k}`);
      const key = `${item}/${field}`;
      touchedBy.set(key, new Set([...(touchedBy.get(key) ?? []), who]));
    }
    for (const who of touchedBy.values()) if (who.size > 1) conflicts++;
    // before syncing, each device sees only its own edits of the round
    A.sync(); B.sync(); A.sync();
    assert.deepEqual(A.snapshot(), B.snapshot(), `after round ${round} both devices fold to identical state, every write and every clock included`);
  }
  assert.ok(conflicts >= 20, `the seeded rounds must contain real conflicts (the same field written by both devices in one round); there were ${conflicts}`);

  for (const [name, vault] of [['A', A], ['B', B]] as const) {
    for (const [key, values] of model) {
      const [id, field] = key.split('/') as [string, string];
      const ref = `psss://id:${id}/${field}`;
      const got = vault.get(ref);
      assert.equal(got.kind === 'value' && got.value, values[values.length - 1], `device ${name}: ${field} of ${id.slice(0, 6)} must hold the last value written (no edit lost, the later clock wins)`);
      const history = vault.history(ref);
      assert.deepEqual(history.kind === 'history' && history.entries.map((h) => h.value), values.slice(0, -1).reverse(),
        `device ${name}: every earlier value of ${field} of ${id.slice(0, 6)} (the losers included) is in its history, newest first`);
      if (values.length > 1) sameFieldLaterWon++;
    }
    assert.equal(vault.verify().ok, true, `device ${name}: verify is clean after the rounds: ${JSON.stringify(vault.verify().problems.slice(0, 3))}`);
    assert.equal(vault.outbox().length, 0, `device ${name}: nothing is left in the outbox`);
  }
  assert.ok(sameFieldLaterWon > 20, 'many fields were written more than once');
  const ins = new Insider(e.location, e.keyFile);
  assert.equal(ins.chainDirs().length, 2, 'the folder holds exactly two chains, one per device');
  const seqs = new Map<string, number[]>();
  for (const r of ins.records()) seqs.set(hex2(r.device), [...(seqs.get(hex2(r.device)) ?? []), r.seq]);
  for (const [device, list] of seqs) assert.deepEqual(list, list.map((_, i) => i + 1), `chain ${device.slice(0, 6)} runs 1..n without a gap or repeat`);
});

const hex2 = (b: Uint8Array) => Buffer.from(b).toString('hex');
