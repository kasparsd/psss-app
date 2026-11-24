import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { ITEMS, runCli, sandbox, scenarioFor } from './helpers.ts';

const json = (text: string) => JSON.parse(text);

test('--json: every result command prints a documented, stable shape on standard output; only get carries a value', async () => {
  const box = sandbox();
  try {
    const personal = path.join(box.home, 'Psss', 'Personal.psss');
    const fake = new FakeVaultService(
      scenarioFor(box, {
        items: [{ ...ITEMS[0], url: 'https://api.example.com' }, ITEMS[1]],
        wayBack: ['password'],
        locations: [
          { label: 'This computer', path: personal, state: 'upToDate' },
          { label: 'iCloud Drive', path: '/icloud/P.psss', state: 'behind' },
        ],
        sync: { locations: [{ label: 'iCloud Drive', path: '/icloud/P.psss', pulled: 2, pushed: 1 }] },
        verify: { records: 5, locations: 1, problems: [{ kind: 'missing', location: '/icloud/P.psss' }] },
      }),
    );
    const out = async (argv: string[], opts: Parameters<typeof runCli>[1] = { box, fake }) => json((await runCli([...argv, '--json'], { ...opts, box, fake })).stdout);

    assert.deepEqual(
      await out(['status']),
      {
        vault: { name: 'Personal', path: personal, formatVersion: 1 },
        groups: ['Only Me'],
        items: 2,
        key: { source: 'keyFile' },
        wayBack: ['password'],
        undelivered: 0,
        locations: [
          { label: 'This computer', path: personal, state: 'upToDate' },
          { label: 'iCloud Drive', path: '/icloud/P.psss', state: 'behind' },
        ],
      },
      'status --json shape',
    );
    assert.deepEqual(
      await out(['list']),
      {
        items: [
          { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', url: 'https://api.example.com', group: 'Only Me', fields: ['token'] },
          { id: '7f3a9c21', title: 'Example Bank', username: 'robin@example.com', group: 'Only Me', fields: ['password', 'code'] },
        ].sort((a, b) => a.title.localeCompare(b.title)),
      },
      'list --json shape, sorted by title, with field names and no values',
    );
    assert.deepEqual(
      await out(['get', 'psss://Example API/token']),
      {
        reference: 'psss://id:a1b2c3d4/token',
        item: { id: 'a1b2c3d4', title: 'Example API', group: 'Only Me' },
        field: 'token',
        value: 'sk-example-old',
      },
      'get --json shape: the only one with a value',
    );
    const set = await runCli(['set', 'psss://Example API/token', '--json'], { box, fake, stdin: 'new-value\n' });
    assert.deepEqual(
      json(set.stdout),
      { item: { id: 'a1b2c3d4', title: 'Example API', group: 'Only Me' }, field: 'token', itemCreated: false, previousKept: true, delivery: { undelivered: 0, locations: [] } },
      'set --json shape, with no value',
    );
    assert.deepEqual(await out(['rm', 'psss://Example Bank']), { item: { id: '7f3a9c21', title: 'Example Bank', group: 'Only Me' }, deleted: true, delivery: { undelivered: 0, locations: [] } }, 'rm --json shape');
    assert.deepEqual(await out(['restore', 'psss://Example Bank']), { item: { id: '7f3a9c21', title: 'Example Bank', group: 'Only Me' }, restored: true, delivery: { undelivered: 0, locations: [] } }, 'restore --json shape');
    assert.deepEqual(await out(['sync']), { locations: [{ label: 'iCloud Drive', path: '/icloud/P.psss', pulled: 2, pushed: 1 }] }, 'sync --json shape');
    const verify = await runCli(['verify', '--json'], { box, fake });
    assert.deepEqual(json(verify.stdout), { ok: false, records: 5, locations: 1, problems: [{ kind: 'missing', location: '/icloud/P.psss' }] }, 'verify --json shape');
    assert.equal(verify.code, 2, 'verify --json still exits 2 on a problem');
    const init = await runCli(['init', 'Team', '--json'], { box, fake, stdin: '' });
    assert.deepEqual(
      json(init.stdout),
      {
        vault: { name: 'Team', path: path.join(box.home, 'Psss', 'Team.psss') },
        key: { path: path.join(box.home, '.config', 'psss', 'keys', 'Team.key'), ownerOnly: true, created: true },
        wayBack: [],
      },
      'init --json shape',
    );
    assert.match(init.stderr, /^warning: that key file is the only way/, 'init --json still warns on standard error');
  } finally {
    box.cleanup();
  }
});

test('piping: get prints exactly the value into a pipe and a line break at a terminal; results never leak onto standard error', async () => {
  const box = sandbox();
  try {
    const piped = await runCli(['get', 'psss://Example API/token'], { box, scenario: { items: [ITEMS[0]] } });
    assert.equal(piped.stdout, 'sk-example-old', 'into a pipe or a file the value has no added newline');
    assert.equal(piped.stderr, '', 'nothing else on standard error');
    const tty = await runCli(['get', 'psss://Example API/token'], { box, scenario: { items: [ITEMS[0]] }, stdoutTty: true });
    assert.equal(tty.stdout, 'sk-example-old\n', 'at a terminal the value ends with a line break');
    const multi = await runCli(['get', 'psss://Note/body'], { box, scenario: { items: [{ id: 'aaaa1111', title: 'Note', fields: { body: 'line one\nline two\n' } }] } });
    assert.equal(multi.stdout, 'line one\nline two\n', 'a value with its own line breaks is printed untouched');
    const username = await runCli(['get', 'psss://Example API/username'], { box, scenario: { items: [ITEMS[0]] } });
    assert.equal(username.stdout, 'robin@example.com', 'username is a field too');
  } finally {
    box.cleanup();
  }
});

test('CI and terminals: menus only for a person at a terminal, never in CI, and standard input is never read to choose', async () => {
  const box = sandbox();
  try {
    const items = [ITEMS[0], ITEMS[1]];
    const ci = await runCli(['get'], { box, typed: '1\n', stdoutTty: true, env: { CI: '1' }, scenario: { items } });
    assert.equal(ci.code, 2, 'CI with a terminal still offers no menu: exit 2');
    assert.equal(ci.stderr, 'psss get needs a reference, such as\n"psss://Example API/token". CI is set,\nso Psss cannot offer a list to choose from.\n', 'and says CI is why');
    for (const name of ['rm', 'restore']) {
      const r = await runCli([name], { box, stdin: '1\n', scenario: { items } });
      assert.equal(r.code, 2, `psss ${name} with no reference and no terminal exits 2`);
      assert.match(r.stderr, new RegExp(`^psss ${name} needs a reference, such as\\n"psss://Example API"\\. No terminal is attached`), `psss ${name} names the missing reference`);
    }
    const set = await runCli(['set'], { box, typed: 'x\r', stdoutTty: true, scenario: { items } });
    assert.equal(set.code, 2, 'set offers no list: it creates, so it needs a name');
    assert.equal(set.stderr, 'psss set needs a reference, such as\n"psss://Example API/token".\n', 'and says so without blaming the terminal');

    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const menu = await runCli(['get'], { box, fake, typed: '1\n1\n', stdoutTty: true });
    assert.equal(menu.code, 0, 'a person at a terminal is offered a list');
    assert.equal(menu.stdout, 'sk-example-old\n', 'the chosen value is the only thing on standard output');
    assert.match(menu.stderr, /^Which item in Personal\?\n {2}1 {2}Example API {2}robin@example\.com\n {2}2 {2}Example Bank/, 'the menu is on standard error');
    assert.match(menu.stderr, /Which field of "Example API"\?\n {2}1 {2}token\n {2}2 {2}username\n/, 'then the fields of that item');
    const cancel = await runCli(['get'], { box, fake, typed: '\n', stdoutTty: true });
    assert.equal(cancel.code, 1, 'Enter at the menu cancels with exit 1');
    assert.equal(cancel.stdout, '', 'and prints no value');
    const bad = await runCli(['get'], { box, fake, typed: 'x\ny\nz\n', stdoutTty: true });
    assert.equal(bad.code, 2, 'three wrong answers end the menu with a usage error');
  } finally {
    box.cleanup();
  }
});

test('the menu is small: nine items at most, and it says how to narrow down', async () => {
  const box = sandbox();
  try {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `0000000${i.toString(16)}`, title: `Item ${String(i).padStart(2, '0')}`, fields: { password: `p${i}` } }));
    const r = await runCli(['get'], { box, typed: '\n', stdoutTty: true, scenario: { items } });
    assert.match(r.stderr, /Which item in Personal\? \(the first 9 of 12; name one to narrow it down\)/, 'the heading says it is a partial list');
    assert.ok(r.stderr.includes('  9  Item 08') && !r.stderr.includes('Item 09'), 'exactly nine rows');
  } finally {
    box.cleanup();
  }
});

test('rm moves to Recently Deleted without asking, restore brings it back, titles match exactly', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[0], ITEMS[1]] }));
    const yes = await runCli(['rm', 'psss://Example Bank'], { box, fake, typed: '', stdoutTty: true });
    assert.equal(yes.code, 0, 'rm at a terminal deletes at once');
    assert.equal(yes.stderr, '', 'and asks nothing');
    assert.equal(yes.stdout, 'Moved "Example Bank" to Recently Deleted.\nBring it back with: psss restore psss://id:7f3a9c21\n', 'and says how to undo it');
    assert.equal((await runCli(['list'], { box, fake })).stdout.includes('Example Bank'), false, 'the item is gone from list');
    const deleted = await runCli(['list', '--deleted'], { box, fake });
    assert.equal(deleted.stdout, 'Example Bank   robin@example.com    password, code\n', 'list --deleted shows it');
    const miss = await runCli(['restore', 'psss://Example API'], { box, fake });
    assert.equal(miss.stderr, 'There is no item called "Example API" in Recently Deleted in Personal.\nSee what is there with: psss list --deleted\n', 'restore looks only in Recently Deleted');
    assert.equal(miss.code, 3, 'and exits 3');
    const back = await runCli(['restore', 'psss://id:7f3a9c21'], { box, fake });
    assert.equal(back.stdout, 'Restored "Example Bank" from Recently Deleted.\n', 'restore by id');
    assert.equal((await runCli(['list'], { box, fake })).stdout.includes('Example Bank'), true, 'it is back');
    assert.equal((await runCli(['rm', 'psss://Example API', '--yes'], { box, fake, stdin: '' })).code, 0, '--yes is accepted');
    const prefix = await runCli(['rm', 'psss://Example'], { box, fake });
    assert.equal(prefix.code, 3, 'rm never guesses by prefix');
    assert.equal(prefix.stderr, 'There is no item called "Example" in Personal.\nDid you mean: Example Bank?\nSee what is there with: psss list\n', 'and offers a hint');
    const empty = await runCli(['rm', 'psss://Nothing'], { box, fake });
    assert.equal(empty.stderr, 'There is no item called "Nothing" in Personal.\nSee what is there with: psss list\n', 'no such item');
  } finally {
    box.cleanup();
  }
});

test('rm and restore take an item: psss://item and psss://group/item work, a field is explained, and a slash in a title is explained', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { groups: ['Only Me', 'Family'], items: [ITEMS[0], { ...ITEMS[1], group: 'Family' }] }));
    const field = await runCli(['rm', 'psss://Example API/token'], { box, fake });
    assert.equal(field.stderr, 'rm takes an item, not a field. Use: psss rm "psss://Example API"\n', 'a field on rm is explained with the corrected command');
    assert.equal(field.code, 2, 'and is a usage error, exit 2');
    assert.equal(field.stdout, '', 'and nothing was printed as a result');
    assert.equal((await runCli(['list'], { box, fake })).stdout.includes('Example API'), true, 'and nothing was deleted');
    const nothing = await runCli(['rm', 'psss://Nope/token'], { box, fake });
    assert.equal(nothing.stderr, 'There is no group called "Nope" in Personal.\n', 'a first part that is not an item keeps the group message');
    assert.equal(nothing.code, 3, 'exit 3');
    const grouped = await runCli(['rm', 'psss://Family/Example Bank'], { box, fake });
    assert.equal(grouped.code, 0, 'psss://group/item works for rm');
    const slash = await runCli(['restore', 'psss://Family/Example Bank/password'], { box, fake });
    assert.equal(slash.code, 2, 'three parts are too many for restore');
    assert.match(slash.stderr, /too many parts\. A reference looks like "psss:\/\/Example API"\.\nA slash in a title is written %2F\.\n$/, 'and the message explains how to write a slash in a title');
    const back = await runCli(['restore', 'psss://Family/Example Bank'], { box, fake });
    assert.equal(back.stdout, 'Restored "Example Bank" from Recently Deleted.\n', 'psss://group/item works for restore');
    assert.equal((await runCli(['rm', 'psss://Example API'], { box, fake })).code, 0, 'psss://item works for rm');
    const restoreField = await runCli(['restore', 'psss://Example API/token'], { box, fake });
    assert.equal(restoreField.stderr, 'restore takes an item, not a field. Use: psss restore "psss://Example API"\n', 'restore says the same for a field');
    assert.equal(restoreField.code, 2, 'exit 2');
  } finally {
    box.cleanup();
  }
});

test('list shows an id for items that share a title, and keeps the look of frame A4 when none do', async () => {
  const box = sandbox();
  try {
    const plain = await runCli(['list'], { box, scenario: { items: [ITEMS[0], ITEMS[1]] } });
    assert.equal(plain.stdout, 'Example API    robin@example.com    token\nExample Bank   robin@example.com    password, code\n', 'no duplicates: no id column');
    const dup = await runCli(['list'], {
      box,
      scenario: {
        items: [
          { id: '7f3a9c21', title: 'Example', username: 'robin@example.com', fields: { password: 'a' } },
          { id: 'b01d5e44', title: 'example', username: 'sam@example.com', fields: { password: 'b' } },
          { id: 'a1b2c3d4', title: 'Other', username: 'robin@example.com', fields: { token: 'c' } },
        ],
      },
    });
    const lines = dup.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 3, 'one line per item');
    const rows = Object.fromEntries(lines.map((l) => [l.split(/\s/)[0] + (l.includes('sam@') ? '-sam' : ''), l]));
    assert.match(rows.Example, /^Example\s+robin@example\.com\s+id:7f3a9c21\s+password$/, 'the first of two with one title shows its id');
    assert.match(rows['example-sam'], /^example\s+sam@example\.com\s+id:b01d5e44\s+password$/, 'the second shows its id; titles that differ only in case are the same title');
    assert.equal(/id:/.test(rows.Other), false, 'a title that is alone shows no id');
    assert.equal(rows.Other.indexOf('token'), rows.Example.indexOf('password'), 'and the field names still line up');
  } finally {
    box.cleanup();
  }
});

test('set on a title that does not exist fails unless --create is given, and never writes to a near match', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [ITEMS[1]] }));
    const r = await runCli(['set', 'psss://Example/password'], { box, fake, stdin: 'v\n' });
    assert.equal(r.code, 3, 'a title that does not exist exits 3');
    assert.equal(r.stderr, 'There is no item called "Example" in Personal.\nDid you mean: Example Bank?\nTo add it as a new item, run: psss set --create psss://Example/password\n', 'and says how to add it');
    assert.deepEqual(fake.calls.filter((x) => x === 'set'), [], 'nothing was written, and the value was not even asked for');
    const made = await runCli(['set', '--create', 'psss://Example/password'], { box, fake, stdin: 'v\n' });
    assert.equal(made.code, 0, '--create adds it');
    assert.equal(made.stdout, 'Saved "password" in Example (Personal).\nThere was no item with that title, so it was added (--create).\n', 'and says it was new');
    assert.equal(fake.peek('Example Bank', 'password'), 'bank-pw-1', '"Example Bank" is untouched');
    const again = await runCli(['set', '--create', 'psss://Example/password'], { box, fake, stdin: 'w\n' });
    assert.equal(again.stdout, 'Saved "password" in Example (Personal).\nThe earlier value is kept under previous values.\n', '--create on an existing item just saves');
    const group = await runCli(['set', 'psss://Nowhere/X/y', '--create'], { box, fake, stdin: 'v\n' });
    assert.equal(group.code, 3, 'a group that does not exist exits 3');
    assert.equal(group.stderr, 'There is no group called "Nowhere" in Personal.\n', 'and says so');
    const id = await runCli(['set', 'psss://id:ffff0000/password', '--create'], { box, fake, stdin: 'v\n' });
    assert.equal(id.code, 3, 'an id that does not exist is never created');
    assert.equal(id.stderr, 'There is no item with the id "ffff0000" in Personal.\nSee what is there with: psss list\n', 'and says so');
  } finally {
    box.cleanup();
  }
});

test('a field that does not exist lists the fields that do', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['get', 'psss://Example Bank/pin'], { box, scenario: { items: [ITEMS[1]] } });
    assert.equal(r.stderr, '"Example Bank" has no field called "pin".\nIt has: password, code.\n', 'field names are not secrets');
    assert.equal(r.code, 3, 'exit 3');
  } finally {
    box.cleanup();
  }
});

test('get --group scopes the lookup, and a reference with a group works', async () => {
  const box = sandbox();
  try {
    const items = [
      { id: 'aaaa0001', title: 'Wifi', group: 'Home', fields: { password: 'home-wifi' } },
      { id: 'aaaa0002', title: 'Wifi', group: 'Work', fields: { password: 'work-wifi' } },
    ];
    const both = await runCli(['get', 'psss://Wifi/password'], { box, scenario: { groups: ['Home', 'Work'], items } });
    assert.equal(both.code, 3, 'the same title in two groups is ambiguous');
    assert.equal((await runCli(['get', 'psss://Work/Wifi/password'], { box, scenario: { groups: ['Home', 'Work'], items } })).stdout, 'work-wifi', 'a group in the reference');
    assert.equal((await runCli(['get', '--group', 'Home', 'psss://Wifi/password'], { box, scenario: { groups: ['Home', 'Work'], items } })).stdout, 'home-wifi', '--group');
    assert.equal((await runCli(['get', 'psss://Wifi/password'], { box, env: { PSSS_GROUP: 'Home' }, scenario: { groups: ['Home', 'Work'], items } })).stdout, 'home-wifi', 'PSSS_GROUP');
    const list = await runCli(['list', 'Work'], { box, scenario: { groups: ['Home', 'Work'], items } });
    assert.equal(list.stdout, 'Wifi   password\n', 'list with a group argument');
  } finally {
    box.cleanup();
  }
});

test('list says so when there is nothing, and status handles plurals and other key sources', async () => {
  const box = sandbox();
  try {
    assert.equal((await runCli(['list'], { box })).stdout, 'There is nothing in Personal yet.\nAdd something with: psss set "psss://Example API/token"\n', 'an empty vault');
    assert.equal((await runCli(['list', '--deleted'], { box })).stdout, 'Recently Deleted in Personal is empty.\n', 'an empty Recently Deleted');
    const s = await runCli(['status'], {
      box,
      scenario: { groups: ['Only Me', 'Family'], items: [ITEMS[0]], keySource: 'password', wayBack: ['recoveryKit', 'password'], locations: [{ label: 'This computer', path: '/v/P.psss', state: 'behind' }, { label: 'Drive', path: '/d/P.psss', state: 'behind' }] },
    });
    assert.equal(
      s.stdout,
      `Vault     Personal   2 groups (Only Me, Family), 1 item
Key       the vault password
Way back  a recovery kit and a vault password
Kept in
  This computer    /v/P.psss      Behind
  Drive            /d/P.psss      Behind
Behind: psss has not seen everything these locations hold.
It cannot know what a location has not delivered yet.
Run psss sync to merge.
`,
      'status with two groups, two locations behind, and a password',
    );
    const env = await runCli(['status'], { box, scenario: { keySource: 'keyEnvironment' } });
    assert.match(env.stdout, /^Key {7}the key in PSSS_KEY$/m, 'the key in the environment is named, not shown');
  } finally {
    box.cleanup();
  }
});

test('sync: progress on standard error, one plain line per location, exit 1 when a location cannot be reached', async () => {
  const box = sandbox();
  try {
    const ok = await runCli(['sync'], {
      box,
      scenario: { sync: { locations: [{ label: 'This computer', path: '/a', pulled: 0, pushed: 0 }, { label: 'iCloud Drive', path: '/b', pulled: 3, pushed: 1 }, { label: 'NAS', path: '/c', pulled: 1, pushed: 0 }] } },
    });
    assert.equal(ok.stdout, 'This computer: nothing new.\niCloud Drive: read 3 new records, wrote 1.\nNAS: read 1 new record, wrote 0.\nMerged with 3 locations.\n', 'sync results on standard output');
    assert.equal(ok.stderr, 'Reading This computer\nReading iCloud Drive\nReading NAS\n', 'one progress line per stage on standard error, with no terminal');
    assert.equal(ok.code, 0, 'exit 0');
    const bad = await runCli(['sync'], { box, scenario: { sync: { locations: [{ label: 'iCloud Drive', path: '/b', pulled: 0, pushed: 0, error: 'the folder is offline' }, { label: 'This computer', path: '/a', pulled: 0, pushed: 0 }] } } });
    assert.match(bad.stderr, /iCloud Drive \(\/b\) could not be reached: the folder is offline\n$/, 'the failure is on standard error');
    assert.match(bad.stdout, /Merged with 1 of 2 locations\. Nothing was lost; run psss sync again/, 'and the count says how much was done');
    assert.equal(bad.code, 1, 'exit 1');
  } finally {
    box.cleanup();
  }
});

test('init in a terminal: choosing a password asks twice without echo and passes it on; bad answers end with a usage error; --no-recovery is quiet; a key inside the vault is refused', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box));
    const pw = await runCli(['init', 'A'], { box, fake, typed: '1\nhunter2-pw\rhunter2-pw\r', stdoutTty: true });
    assert.equal(pw.code, 0, 'a vault password can be set while creating');
    assert.equal(fake.password, 'hunter2-pw', 'the password reached the service');
    assert.ok(!pw.combined.includes('hunter2-pw'), 'and was never printed');
    assert.match(pw.stdout, /\nDone\. The vault also opens with that password\.\nNext: /, 'the result says so');
    const diff = await runCli(['init', 'B'], { box, typed: '1\none\rtwo\r', stdoutTty: true });
    assert.equal(diff.code, 2, 'two different passwords are a usage error');
    assert.match(diff.stderr, /The two passwords differ, so none was set\. The vault was created; add one with: psss key password set\n$/, 'and the vault stays, as said');
    const no = await runCli(['init', 'C'], { box, typed: '\n', stdoutTty: true });
    assert.equal(no.code, 0, 'Enter at the question is "Not now"');
    assert.ok(!/recovery kit/i.test(no.combined), 'a recovery kit is not offered while it does not exist');
    const bad = await runCli(['init', 'D'], { box, typed: 'a\nb\nc\n', stdoutTty: true });
    assert.equal(bad.code, 2, 'three wrong answers end with a usage error');
    const quiet = await runCli(['init', 'E', '--no-recovery'], { box, stdin: '' });
    assert.equal(quiet.stderr, '', '--no-recovery stops the warning');
    assert.match(quiet.stdout, /^Created the vault "E" in ~\/Psss\/E\.psss\nKey file: ~\/\.config\/psss\/keys\/E\.key \(readable by you only\)\n$/, 'and the result is still printed');
    const quietTty = await runCli(['init', 'F', '--no-recovery'], { box, typed: '', stdoutTty: true });
    assert.equal(quietTty.stderr, '', '--no-recovery asks nothing at a terminal');
    assert.match(quietTty.stdout, /Next: psss set --create "psss:\/\/Example API\/token"\n$/, 'and still says what to do next');
    const inside = await runCli(['init', 'G', '--vault', './v', '--key-file', './v/G.psss/device.key'], { box, stdin: '' });
    assert.equal(inside.code, 2, 'a key file inside the vault folder is refused with exit 2');
    assert.equal(inside.stderr, 'The key file ./v/G.psss/device.key is inside the vault folder ./v/G.psss.\nA key beside the vault would travel with it. Choose a key file outside the vault folder, or another place for the vault.\n', 'naming both paths');
    const dflt = await runCli(['init', 'H', '--vault', path.join(box.home, '.config', 'psss', 'keys', 'x')], { box, stdin: '' });
    assert.equal(dflt.code, 0, 'a vault next to, not around, the default key is fine');
    const state = await runCli(['status'], { box, env: { XDG_CONFIG_HOME: '/xdg/c', XDG_STATE_HOME: '/xdg/s' } });
    assert.equal(state.serviceOptions?.configDir, '/xdg/c/psss', 'the config folder honours XDG_CONFIG_HOME');
    assert.equal(state.serviceOptions?.stateDir, '/xdg/s/psss', 'the state folder honours XDG_STATE_HOME');
    const dflts = await runCli(['status'], { box });
    assert.equal(dflts.serviceOptions?.stateDir, path.join(box.home, '.local', 'state', 'psss'), 'device state defaults to ~/.local/state/psss');
    const dup = await (async () => {
      const f = new FakeVaultService(scenarioFor(box));
      await runCli(['init', 'Dup'], { box, fake: f, stdin: '' });
      return runCli(['init', 'Dup'], { box, fake: f, stdin: '' });
    })();
    assert.equal(dup.code, 1, 'a vault that exists is a failure, exit 1');
  } finally {
    box.cleanup();
  }
});

test('run: passes on the exit code, reads every reference first, stands in for stdin, and reports a program that is not there', async () => {
  const box = sandbox();
  try {
    const marker = path.join(box.cwd, 'ran.txt');
    box.write('mark.sh', `#!/bin/sh\necho ran > "${marker}"\necho "A=$A B=$B"\nexit 7\n`, 0o755);
    box.write('cat.sh', '#!/bin/sh\ncat\n', 0o755);
    const items = [{ id: 'aaaa0001', title: 'Svc', fields: { a: 'alpha', b: 'beta gamma' } }];
    const fake = new FakeVaultService(scenarioFor(box, { items }));

    const r = await runCli(['run', '--env', 'A=psss://Svc/a', '--env', 'B=psss://Svc/b', '--', './mark.sh'], { box, fake });
    assert.equal(r.stdout, 'A=alpha B=beta gamma\n', 'both variables arrive in the program');
    assert.equal(r.code, 7, "the program's own exit code is passed on");

    unlinkSync(marker);
    const miss = await runCli(['run', '--env', 'A=psss://Svc/a', '--env', 'B=psss://Svc/none', '--', './mark.sh'], { box, fake });
    assert.equal(miss.code, 3, 'a reference that cannot be read stops everything with its own code');
    assert.equal(existsSync(marker), false, 'and the program is never started');

    box.write('refs.env', '# deploy\n\nA=psss://Svc/a\nexport B="psss://Svc/b"\n');
    const file = await runCli(['run', '--env-file', 'refs.env', '--', './mark.sh'], { box, fake });
    assert.equal(file.stdout, 'A=alpha B=beta gamma\n', 'an env file of references, with comments, blank lines, export and quotes');
    box.write('lit.env', 'A=hunter2\n');
    const lit = await runCli(['run', '--env-file', 'lit.env', '--', './mark.sh'], { box, fake });
    assert.equal(lit.code, 2, 'a literal in an env file is refused');
    assert.match(lit.stderr, /lit\.env line 1: the value of A must be a psss:\/\/ reference\. A secret is never written in a command\.\n/, 'naming file and line, without repeating the value');
    assert.ok(!lit.combined.includes('hunter2'), 'the literal is not echoed');
    const nofile = await runCli(['run', '--env-file', 'nope.env', '--', './mark.sh'], { box, fake });
    assert.equal(nofile.code, 1, 'a missing env file is a failure');

    const piped = await runCli(['run', '--env', 'A=psss://Svc/a', '--', './cat.sh'], { box, fake, stdin: 'from stdin\n' });
    assert.equal(piped.stdout, 'from stdin\n', 'standard input reaches the program when it is not a terminal');

    const gone = await runCli(['run', '--env', 'A=psss://Svc/a', '--', './no-such-program'], { box, fake });
    assert.equal(gone.code, 1, 'a program that does not exist is a failure');
    assert.equal(gone.stderr, 'Cannot run "./no-such-program": no such file or program.\n', 'with a plain message');
    box.write('plain.txt', 'x');
    const noexec = await runCli(['run', '--env', 'A=psss://Svc/a', '--', './plain.txt'], { box, fake });
    assert.equal(noexec.stderr, 'Cannot run "./plain.txt": it is not executable.\n', 'a file that is not executable');

    const args = await runCli(['run', '--env', 'A=psss://Svc/a', '--', 'sh', '-c', 'echo "$0 $1 $A"', '--flag', '-y'], { box, fake });
    assert.equal(args.stdout, '--flag -y alpha\n', 'everything after -- belongs to the program, even words that look like options');
  } finally {
    box.cleanup();
  }
});
