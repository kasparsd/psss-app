// A write that did not reach every location says so (frame A11): the words, the streams, the exit code, --json, and `status`. With the fake service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import type { Delivery } from '../src/service.ts';
import { ITEMS, runCli, sandbox, scenarioFor } from './helpers.ts';

const flat = (text: string) => text.replace(/\n/g, ' ');
const one = (box: { home: string }): Delivery => ({ undelivered: 3, locations: [{ label: 'iCloud Drive', path: `${box.home}/Library/Mobile Documents/Personal.psss`, reason: 'permission denied' }] });

test('set, rm and restore say on standard error when changes are kept on this computer only, and still exit 0', async () => {
  const box = sandbox();
  try {
    const d = one(box);
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS, delivery: d }));
    const warning = 'warning: 3 changes are kept on this computer only; ~/Library/Mobile Documents/Personal.psss could not be written (permission denied). Run psss sync to deliver them.';
    for (const [argv, stdin] of [[['set', 'psss://Example API/token'], 'new\n'], [['rm', 'psss://Example Bank'], ''], [['restore', 'psss://Example Bank'], '']] as const) {
      const r = await runCli([...argv], { box, fake, stdin });
      assert.equal(r.code, 0, `${argv[0]} exits as it would have: the change is stored here`);
      assert.equal(flat(r.stderr).trim(), warning, `${argv[0]}: the words of frame A11`);
      assert.ok(r.stderr.split('\n').every((l) => l.length <= 62), 'wrapped like the other warnings');
      assert.ok(!r.stdout.includes('warning'), 'standard output carries no warning');
      assert.ok(!r.stdout.includes('new') || argv[0] !== 'set', 'and never the value');
    }
    assert.ok(fake.calls.includes('delivery'));
  } finally {
    box.cleanup();
  }
});

test('one change says "is", two locations are both named, and a change that no location is named for still says how to deliver it', async () => {
  const box = sandbox();
  try {
    const mk = (delivery: Delivery) => new FakeVaultService(scenarioFor(box, { items: ITEMS, delivery }));
    const a = await runCli(['rm', 'psss://Example Bank'], { box, fake: mk({ undelivered: 1, locations: [{ label: 'Dropbox', path: '/dropbox/P.psss', reason: 'the disk is full' }] }) });
    assert.equal(flat(a.stderr).trim(), 'warning: 1 change is kept on this computer only; /dropbox/P.psss could not be written (the disk is full). Run psss sync to deliver it.');
    const b = await runCli(['rm', 'psss://Example Bank'], { box, fake: mk({ undelivered: 2, locations: [{ label: 'A', path: '/a/P.psss', reason: 'permission denied' }, { label: 'B', path: '/b/P.psss', reason: 'the folder is missing' }] }) });
    assert.equal(flat(b.stderr).trim(), 'warning: 2 changes are kept on this computer only; /a/P.psss could not be written (permission denied) and /b/P.psss could not be written (the folder is missing). Run psss sync to deliver them.');
    const c = await runCli(['rm', 'psss://Example Bank'], { box, fake: mk({ undelivered: 2, locations: [] }) });
    assert.equal(flat(c.stderr).trim(), 'warning: 2 changes are kept on this computer only; it has not reached every location. Run psss sync to deliver them.');
    const none = await runCli(['rm', 'psss://Example Bank'], { box, fake: mk({ undelivered: 0, locations: [] }) });
    assert.equal(none.stderr, '', 'nothing waiting: no warning');
  } finally {
    box.cleanup();
  }
});

test('--json carries the same fact in a delivery field, and the warning stays off standard output', async () => {
  const box = sandbox();
  try {
    const d = one(box);
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS, delivery: d }));
    for (const [argv, stdin] of [[['set', 'psss://Example API/token', '--json'], 'new\n'], [['rm', 'psss://Example Bank', '--json'], ''], [['restore', 'psss://Example Bank', '--json'], '']] as const) {
      const r = await runCli([...argv], { box, fake, stdin });
      assert.equal(r.code, 0);
      const body = JSON.parse(r.stdout) as { delivery: unknown };
      assert.deepEqual(body.delivery, { undelivered: 3, locations: [{ label: 'iCloud Drive', path: d.locations[0]!.path, reason: 'permission denied' }] }, `${argv[0]} --json`);
      assert.match(r.stderr, /^warning: 3 changes are kept on this computer only/, 'the warning is on standard error');
      assert.ok(!r.stdout.includes('warning'));
    }
  } finally {
    box.cleanup();
  }
});

test('import warns after its summary when changes are kept here only; a dry run never asks, never warns and has no delivery field', async () => {
  const box = sandbox();
  try {
    const file = `${box.cwd}/Family.kdbx`;
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS, delivery: one(box), kdbxFiles: { [file]: { password: 'pw', items: 2 } } }));
    const real = await runCli(['import', 'Family.kdbx'], { box, fake, stdin: 'pw\n' });
    assert.equal(real.code, 0, real.stderr);
    assert.match(real.stdout, /^Added 2 items/);
    assert.match(flat(real.stderr), /warning: 3 changes are kept on this computer only; .* could not be written \(permission denied\)\. Run psss sync to deliver them\./);
    const json = await runCli(['import', 'Family.kdbx', '--json'], { box, fake, stdin: 'pw\n' });
    assert.equal((JSON.parse(json.stdout) as { delivery: Delivery }).delivery.undelivered, 3);
    const callsBefore = fake.calls.filter((c) => c === 'delivery').length;
    const dry = await runCli(['import', 'Family.kdbx', '--dry-run', '--json'], { box, fake, stdin: 'pw\n' });
    assert.equal(dry.stderr, '');
    assert.equal('delivery' in JSON.parse(dry.stdout), false);
    assert.equal(fake.calls.filter((c) => c === 'delivery').length, callsBefore, 'a dry run does not ask');
  } finally {
    box.cleanup();
  }
});

test('status says how many changes are kept here only, names the fix, and never says Up to date while any wait', async () => {
  const box = sandbox();
  try {
    const personal = `${box.home}/Psss/Personal.psss`;
    const fake = new FakeVaultService(
      scenarioFor(box, {
        items: ITEMS,
        delivery: { undelivered: 95, locations: [] },
        locations: [{ label: 'This computer', path: personal, state: 'behind', pending: 95 }],
      }),
    );
    const r = await runCli(['status'], { box, fake });
    assert.ok(!r.stdout.includes('Up to date'));
    assert.match(r.stdout, /This computer +~\/Psss\/Personal\.psss +Behind\n/);
    assert.match(r.stdout, /95 changes are kept on this computer only, not in every location yet\.\nRun psss sync to deliver them\.\n/);
    assert.ok(!r.stdout.includes('cannot know what a location has not delivered'), 'a location that only lacks our changes is not the "has not seen everything" case');
    const j = JSON.parse((await runCli(['status', '--json'], { box, fake })).stdout) as { undelivered: number; locations: Array<{ state: string }> };
    assert.equal(j.undelivered, 95);
    assert.equal(j.locations[0]!.state, 'behind');
  } finally {
    box.cleanup();
  }
});

test('--json writes control, direction and zero-width characters of names as \\u{..}, like a warning, and leaves a value alone', async () => {
  const box = sandbox();
  try {
    const evil = 'Bank‮​\u0007\nEnd';
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ id: 'aa11bb22', title: evil, group: 'Only⁦Me', fields: { 'pa​ss': 'v‮alue' } }], groups: ['Only⁦Me'] }));
    const shown = 'Bank\\u{202e}\\u{200b}\\u{7}\\u{a}End';
    const list = JSON.parse((await runCli(['list', '--json'], { box, fake })).stdout) as { items: Array<{ title: string; group: string; fields: string[] }> };
    assert.equal(list.items[0]!.title, shown);
    assert.equal(list.items[0]!.group, 'Only\\u{2066}Me');
    assert.deepEqual(list.items[0]!.fields.map((f) => f.includes('​')), [false]);
    const raw = (await runCli(['list', '--json'], { box, fake })).stdout;
    assert.ok(!/[‮​⁦\u0007]/.test(raw), 'not one of those characters is in the output');
    const got = JSON.parse((await runCli(['get', 'psss://id:aa11bb22/pa​ss', '--json'], { box, fake })).stdout) as { item: { title: string }; value: string };
    assert.equal(got.item.title, shown);
    assert.equal(got.value, 'v‮alue', 'a value is never changed');
    const st = JSON.parse((await runCli(['status', '--json'], { box, fake })).stdout) as { groups: string[] };
    assert.deepEqual(st.groups, ['Only\\u{2066}Me']);
  } finally {
    box.cleanup();
  }
});
