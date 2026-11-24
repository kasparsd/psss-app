// generate, set --generate, item show/add/edit/purge and file get/put/list against the in-memory service (frames A16 to A18).
// What each test protects is in its name; the real vault is exercised in real-items-files.test.ts.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import { runCli, sandbox, scenarioFor, SECRET } from './helpers.ts';
import type { FakeItem } from '../src/fake-service.ts';

const RLO = '‮';
const BANK: FakeItem = { id: 'c0ffee01', title: 'Example Bank', username: 'robin@example.com', url: 'https://bank.example', fields: { password: SECRET, code: '123456', notes: `line one ${SECRET}\nline two` }, tags: ['banking'], created: Date.UTC(2026, 9, 2, 8, 0), edited: Date.UTC(2026, 10, 20, 9, 12) };
const API: FakeItem = { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', fields: { token: SECRET }, files: { 'ca.pem': 'PEM-BYTES\n', 'notes.txt': 'x'.repeat(3000) } };

// ---------------------------------------------------------------- generate

test('generate: one password and a line break on standard output, nothing on standard error, and no vault is opened', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['generate'], { box, noService: true });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}\n$/, 'the default is the app\'s Safari-like password');
    assert.equal(r.stderr, '', 'nothing else');
  } finally {
    box.cleanup();
  }
});

test('generate: --count, --words, --length and --json', async () => {
  const box = sandbox();
  try {
    const many = await runCli(['generate', '--count', '4'], { box, noService: true });
    assert.equal(many.stdout.trimEnd().split('\n').length, 4, 'one per line');
    assert.equal(new Set(many.stdout.trimEnd().split('\n')).size, 4, 'all different');
    const words = await runCli(['generate', '--words', '5', '--separator', 'space', '--no-numbers'], { box, noService: true });
    assert.match(words.stdout, /^([A-Z][a-z]+ ){4}[A-Z][a-z]+\n$/);
    const chars = await runCli(['generate', '--length', '30', '--symbols'], { box, noService: true });
    assert.match(chars.stdout, /^[A-Za-z0-9!@#$%&*?]{30}\n$/);
    assert.match(chars.stdout, /[!@#$%&*?]/);
    const json = JSON.parse((await runCli(['generate', '--json', '--count', '2'], { box, noService: true })).stdout) as { kind: string; bits: number; count: number; values: string[] };
    assert.deepEqual(Object.keys(json), ['kind', 'bits', 'count', 'values']);
    assert.equal(json.kind, 'apple');
    assert.equal(json.bits, 72);
    assert.equal(json.values.length, 2);
  } finally {
    box.cleanup();
  }
});

test('generate: silly sizes and contradictory options are refused with a plain message and exit 2, before anything is made', async () => {
  const box = sandbox();
  try {
    const cases: Array<[string[], RegExp]> = [
      [['--length', '3'], /--length 3 is not sensible: random characters are between 8 and 128\./],
      [['--length', '100000'], /not sensible/],
      [['--length', 'many'], /needs a whole number/],
      [['--length', '-5'], /--length -5 is below the smallest allowed/],
      [['--words', '2'], /--words 2 is not sensible/],
      [['--words', '4', '--length', '20'], /Use one kind/],
      [['--separator', 'space'], /needs --words/],
      [['--words', '5', '--separator', 'x'], /is not one of: hyphen, space, period, none/],
      [['--no-capitalize'], /needs --words/],
      [['--count', '0'], /--count 0 is not sensible/],
      [['--count', '5000'], /not sensible/],
      [['--no-uppercase', '--no-lowercase', '--no-numbers'], /Nothing is left to choose from/],
      [['extra'], /takes no arguments/],
    ];
    for (const [args, message] of cases) {
      const r = await runCli(['generate', ...args], { box, noService: true });
      assert.equal(r.code, 2, `generate ${args.join(' ')} should exit 2`);
      assert.equal(r.stdout, '', 'nothing on standard output');
      assert.match(r.stderr, message, `generate ${args.join(' ')}`);
    }
  } finally {
    box.cleanup();
  }
});

test('generate: a password weaker than the recommended one says so on standard error only', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['generate', '--length', '8'], { box, noService: true });
    assert.match(r.stderr, /^warning: that is weaker than the recommended password \(about \d+ bits against 71\)/);
    assert.match(r.stdout, /^[A-Za-z0-9]{8}\n$/);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- set --generate

test('set --generate: prints only the reference, saves a value nobody sees, and the value is nowhere in the output', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    const r = await runCli(['set', '--generate', '--create', 'psss://New Service/token'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'psss://New Service/token\n', 'standard output is the reference and nothing else');
    assert.equal(r.stderr, '', 'standard error is silent in a script');
    const made = fake.peek('New Service', 'token')!;
    assert.match(made, /^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/, 'a value was saved');
    assert.ok(!r.combined.includes(made), 'the value is in neither stream');
    const json = await runCli(['set', '--generate', '--create', '--json', 'psss://Another/token', '--length', '24'], { box, fake });
    assert.ok(!json.combined.includes(fake.peek('Another', 'token')!), 'nor in --json');
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    assert.equal(parsed.reference, 'psss://Another/token');
    assert.equal(parsed.generated, true);
    assert.equal(fake.peek('Another', 'token')!.length, 24);
    assert.ok(!('value' in parsed));
  } finally {
    box.cleanup();
  }
});

test('set --generate: a field that has a value is not replaced without --force; with it the earlier value is kept and standard error says so', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    const refused = await runCli(['set', '--generate', 'psss://Example API/token'], { box, fake });
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /^"Example API" already has a value for "token"\. Nothing was changed\.\nTo replace it with a new one, add --force\. The earlier value is kept under previous values\.\n$/);
    assert.equal(fake.peek('Example API', 'token'), SECRET, 'untouched');
    const forced = await runCli(['set', '--generate', '--force', 'psss://Example API/token'], { box, fake });
    assert.equal(forced.code, 0);
    assert.equal(forced.stdout, 'psss://Example API/token\n');
    assert.equal(forced.stderr, 'The earlier value is kept under previous values.\n');
    assert.notEqual(fake.peek('Example API', 'token'), SECRET);
    const missing = await runCli(['set', '--generate', 'psss://Nope/token'], { box, fake });
    assert.equal(missing.code, 3, 'a title that does not exist still needs --create');
  } finally {
    box.cleanup();
  }
});

test('set: generator options without --generate are a usage error and read nothing', async () => {
  const box = sandbox();
  try {
    for (const args of [['--length', '20'], ['--force'], ['--words', '5']]) {
      const r = await runCli(['set', 'psss://Example API/token', ...args], { box, stdin: 'value' });
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stderr, /only work with --generate/);
    }
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- item show

test('item show: every field in the app\'s order, protected values hidden whatever the flags, and no value in any stream', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [BANK] }));
    const r = await runCli(['item', 'show', 'psss://Example Bank'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(
      r.stdout,
      'Example Bank\n  Kind               Login\n  Group              Only Me\n  Added              2026-10-02 08:00 UTC\n  Edited             2026-11-20 09:12 UTC\n  Website            https://bank.example\n  Username           robin@example.com\n  Password           hidden\n  Verification code  hidden\n  Notes              hidden, 2 lines\n  Tags               banking\n',
    );
    assert.ok(!r.combined.includes(SECRET) && !r.combined.includes('123456'));
    const json = await runCli(['item', 'show', 'psss://Example Bank', '--json'], { box, fake });
    assert.ok(!json.combined.includes(SECRET) && !json.combined.includes('123456'), 'nor in --json');
    const parsed = JSON.parse(json.stdout) as Record<string, unknown> & { fields: Array<{ name: string; hidden: boolean; value?: string }> };
    assert.deepEqual(Object.keys(parsed), ['reference', 'item', 'kind', 'deleted', 'deletedAt', 'added', 'edited', 'websites', 'tags', 'fields', 'files', 'hasCode', 'passkey']);
    assert.equal(parsed.fields.find((f) => f.name === 'password')?.hidden, true);
    assert.ok(!('value' in parsed.fields.find((f) => f.name === 'password')!));
    assert.equal(parsed.fields.find((f) => f.name === 'username')?.value, 'robin@example.com');
    assert.equal(parsed.hasCode, true);
    const flagged = await runCli(['item', 'show', 'psss://Example Bank', '--show-secrets'], { box, fake });
    assert.equal(flagged.code, 2, 'there is no flag that shows a secret');
  } finally {
    box.cleanup();
  }
});

test('item show: an item in Recently Deleted says so and when it goes; a name with a direction mark is written out; a wrong name is exit 3 with a hint', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...BANK, id: 'dead0001', title: `Old${RLO}drowssap`, deleted: true, deletedAt: Date.UTC(2026, 10, 20, 8, 0) }, { ...API }] }));
    const r = await runCli(['item', 'show', 'psss://id:dead0001'], { box, fake });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Old\\u\{202e\}drowssap\n/);
    assert.match(r.stdout, /Deleted {2,}2026-11-20 08:00 UTC; removed for good on 2026-12-20/);
    assert.ok(!/‮/.test(r.combined));
    const miss = await runCli(['item', 'show', 'psss://Example Ap'], { box, fake });
    assert.equal(miss.code, 3);
    assert.match(miss.stderr, /There is no item called "Example Ap"/);
    assert.match(miss.stderr, /Did you mean: Example API\?/);
  } finally {
    box.cleanup();
  }
});

test('item show: a card says the last four digits and hides the rest; files are listed with sizes', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ id: 'cafe0001', title: 'Visa', kind: 2, fields: { card: '4111111111114417', card_code: '999', cardholder: 'Robin R', expiry: '03/2028' }, plain: ['cardholder', 'expiry'], files: { 'statement.pdf': 'x'.repeat(2048) } }] }));
    const r = await runCli(['item', 'show', 'psss://Visa'], { box, fake });
    assert.match(r.stdout, /Card number {2,}hidden, ends in 4417/);
    assert.match(r.stdout, /Security code {2,}hidden\n/);
    assert.match(r.stdout, /Name on card {2,}Robin R/);
    assert.match(r.stdout, /File {2,}statement\.pdf \(2 KiB\)/);
    assert.ok(!r.combined.includes('4111111111114417') && !r.combined.includes('999'));
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- item add

test('item add: a login from options and a secret on standard input; the reference is the only thing on standard output; no flag takes a secret', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box));
    const r = await runCli(['item', 'add', '--title', 'Example Shop', '--username', 'robin', '--url', 'shop.example', '--tag', 'work', '--password'], { box, fake, stdin: `${SECRET}\n` });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'psss://Example Shop\n');
    assert.equal(r.stderr, '');
    assert.equal(fake.peek('Example Shop', 'password'), SECRET, 'the secret came from standard input');
    assert.ok(!r.combined.includes(SECRET));
    const shown = await runCli(['item', 'show', 'psss://Example Shop'], { box, fake });
    assert.match(shown.stdout, /Website {2,}https:\/\/shop\.example/);
    assert.match(shown.stdout, /Tags {2,}work/);
    const value = await runCli(['item', 'add', '--title', 'X', '--value', 'abc'], { box, fake });
    assert.equal(value.code, 2, 'there is no --value');
    assert.match(value.stderr, /Unknown option --value/);
    const asArg = await runCli(['item', 'add', '--title', 'X', '--password', 'hunter2'], { box, fake });
    assert.equal(asArg.code, 2, 'a password after the flag is an extra argument, never a value');
    assert.ok(!asArg.stderr.includes('hunter2'), 'and it is not echoed');
    assert.match(asArg.stderr, /takes no arguments, but 1 more was not expected/);
  } finally {
    box.cleanup();
  }
});

test('item add: a card reads number, code and PIN one per line in the documented order; a wrong number of lines is refused', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box));
    const r = await runCli(['item', 'add', '--kind', 'card', '--title', 'Visa', '--cardholder', 'Robin R', '--expiry', '03/28', '--valid-from', '4/2024', '--issuer', 'Example Bank', '--card-number', '--card-code', '--card-pin'], { box, fake, stdin: '4111 1111 1111 1111\n123\n9876\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'psss://Visa\n');
    assert.equal(fake.peek('Visa', 'card'), '4111111111111111', 'spaces are removed');
    assert.equal(fake.peek('Visa', 'card_code'), '123');
    assert.equal(fake.peek('Visa', 'card_pin'), '9876');
    assert.equal(fake.peek('Visa', 'expiry'), '03/2028');
    assert.equal(fake.peek('Visa', 'Valid from'), '04/2024');
    const short = await runCli(['item', 'add', '--kind', 'card', '--title', 'Two', '--card-number', '--card-code'], { box, fake, stdin: '4111111111111111\n' });
    assert.equal(short.code, 2);
    assert.match(short.stderr, /needs 2 lines, in that order, and none empty\. It got 1\. Nothing was saved\./);
    assert.equal(fake.peek('Two', 'card'), undefined, 'nothing was saved');
    const bad = await runCli(['item', 'add', '--kind', 'card', '--title', 'Bad', '--card-number'], { box, fake, stdin: 'abc\n' });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /A card number is 12 to 19 digits/);
    const luhn = await runCli(['item', 'add', '--kind', 'card', '--title', 'Gift', '--card-number'], { box, fake, stdin: '1234567890123456\n' });
    assert.equal(luhn.code, 0);
    assert.match(luhn.stderr, /^warning: that card number does not pass the usual check-digit test\./);
  } finally {
    box.cleanup();
  }
});

test('item add: a kind that does not fit the options, an unknown kind, nothing to add, and --dry-run', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box));
    const cases: Array<[string[], RegExp]> = [
      [['--kind', 'card', '--username', 'a'], /--username is for a login or a custom item, not a card/],
      [['--kind', 'login', '--cardholder', 'a'], /--cardholder is for a card/],
      [['--kind', 'note', '--url', 'a.example'], /not a note/],
      [['--kind', 'logn', '--title', 'x'], /"logn" is not a kind of item[\s\S]*Did you mean: login\?/],
      [[], /There is nothing to add/],
      [['--expiry', '03/28', '--kind', 'card'], /--expiry goes with a card number/],
      [['--kind', 'card', '--card-number', '--expiry', '13/28'], /is not a month and year/],
      [['--title', 'x\ny'], /one line of text/],
      [['--field', 'nolabel'], /needs label=value/],
    ];
    for (const [args, message] of cases) {
      const r = await runCli(['item', 'add', ...args], { box, fake, stdin: '' });
      assert.equal(r.code, 2, `item add ${args.join(' ')}`);
      assert.match(r.stderr, message, args.join(' '));
    }
    const dry = await runCli(['item', 'add', '--title', 'Dry', '--password', '--dry-run'], { box, fake });
    assert.equal(dry.code, 0);
    assert.equal(dry.stdout, 'Would add a login "Dry" to Personal. It would ask for: password.\nNothing was written.\n');
    assert.equal(fake.peek('Dry', 'password'), undefined);
    assert.ok(fake.calls.includes('open:readOnly'), 'a dry run opens read-only');
  } finally {
    box.cleanup();
  }
});

test('item add: a name another item already has is allowed with a warning that names the id; no title prints the id form', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    const r = await runCli(['item', 'add', '--title', 'Example API', '--username', 'other'], { box, fake });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /warning: another item is also called "Example API"/);
    assert.match(r.stdout, /^psss:\/\/id:[0-9a-f]{8}\n$/, 'an ambiguous title is not printed as a reference');
    const none = await runCli(['item', 'add', '--url', 'noname.example'], { box, fake });
    assert.match(none.stdout, /^psss:\/\/id:[0-9a-f]{8}\n$/);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- item edit

test('item edit: prints the names of what changed and never a value; what already holds the value is not a change', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...BANK }] }));
    const r = await runCli(['item', 'edit', 'psss://Example Bank', '--username', 'sam', '--add-tag', 'family', '--url', 'https://bank.example', '--url', 'https://login.bank.example', '--password'], { box, fake, stdin: 'new-secret-pw\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'Changed username, password, url, tags of "Example Bank" (Personal).\n');
    assert.ok(!r.combined.includes('new-secret-pw'));
    assert.equal(fake.peek('Example Bank', 'password'), 'new-secret-pw');
    const again = await runCli(['item', 'edit', 'psss://Example Bank', '--username', 'sam'], { box, fake });
    assert.equal(again.stdout, 'Nothing changed.\n');
    const json = await runCli(['item', 'edit', 'psss://Example Bank', '--title', 'Bank', '--json'], { box, fake });
    const parsed = JSON.parse(json.stdout) as { changed: string[]; delivery: { undelivered: number } };
    assert.deepEqual(parsed.changed, ['title']);
    assert.equal(parsed.delivery.undelivered, 0);
    const none = await runCli(['item', 'edit', 'psss://Bank'], { box, fake });
    assert.equal(none.code, 2);
    assert.match(none.stderr, /There is nothing to change/);
    const gone = await runCli(['item', 'edit', 'psss://Bank', '--remove-field', 'missing'], { box, fake });
    assert.equal(gone.code, 3);
    assert.match(gone.stderr, /has no field called "missing"/);
  } finally {
    box.cleanup();
  }
});

test('item edit: an item in Recently Deleted is not changed and the message says how to bring it back', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API, deleted: true }] }));
    const r = await runCli(['item', 'edit', 'psss://Example API', '--username', 'x'], { box, fake });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^"Example API" is in Recently Deleted, and an item there cannot be changed\.\nBring it back first with: psss restore psss:\/\/id:a1b2c3d4\n$/);
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- item purge

test('item purge: asks at a terminal, needs --yes without one, only touches Recently Deleted, and --dry-run writes nothing', async () => {
  const box = sandbox();
  try {
    const items: FakeItem[] = [{ ...API, deleted: true, deletedAt: Date.UTC(2026, 10, 20) }, { ...BANK }];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const script = await runCli(['item', 'purge', 'psss://Example API'], { box, fake });
    assert.equal(script.code, 2);
    assert.match(script.stderr, /cannot ask here\. Add --yes to go ahead, or --dry-run to see what it would do\. Nothing was deleted\./);
    const dry = await runCli(['item', 'purge', 'psss://Example API', '--dry-run'], { box, fake });
    assert.equal(dry.code, 0);
    assert.equal(dry.stdout, 'Would delete "Example API" for good from Personal, with its 2 attached files.\nNothing was deleted.\n');
    const live = await runCli(['item', 'purge', 'psss://Example Bank', '--yes'], { box, fake });
    assert.equal(live.code, 1, 'a live item is never purged');
    assert.match(live.stderr, /is not in Recently Deleted, and psss only deletes for good what is already there\.\nMove it there first with: psss rm psss:\/\/id:c0ffee01\nNothing was changed\./);
    const no = await runCli(['item', 'purge', 'psss://Example API'], { box, fake, typed: 'n\n', stdoutTty: true });
    assert.equal(no.code, 0);
    assert.match(no.combined, /Delete "Example API" for good\? It cannot be recovered\. \[y\/N\]/);
    assert.match(no.stdout, /Nothing was deleted\./);
    assert.ok((await fake.list({ deleted: true })).ok && ((await fake.list({ deleted: true })) as { value: unknown[] }).value.length === 1, 'still there');
    const yes = await runCli(['item', 'purge', 'psss://Example API', '--yes'], { box, fake });
    assert.equal(yes.code, 0, yes.stderr);
    assert.match(yes.stdout, /^Deleted "Example API" for good from Personal\.\nThis computer no longer shows it\. Other computers stop showing it when they next sync\.\nThe old records stay in the vault's files until a checkpoint removes them, and earlier copies of the vault still hold it\.\n$/);
    assert.equal(((await fake.list({ deleted: true })) as { value: unknown[] }).value.length, 0);
    const again = await runCli(['item', 'purge', 'psss://Example API', '--yes'], { box, fake });
    assert.equal(again.code, 3, 'nothing left to delete is a wrong name');
  } finally {
    box.cleanup();
  }
});

// ---------------------------------------------------------------- file

test('file list and file get: sizes, the bytes on standard output when it is not a terminal, and a refusal at a terminal', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    const list = await runCli(['file', 'list', 'psss://Example API'], { box, fake });
    assert.equal(list.stdout, 'ca.pem      10 bytes\nnotes.txt   2.9 KiB\n');
    const json = JSON.parse((await runCli(['file', 'list', 'psss://Example API', '--json'], { box, fake })).stdout) as { files: Array<{ name: string; size: number }> };
    assert.deepEqual(json.files, [{ name: 'ca.pem', size: 10 }, { name: 'notes.txt', size: 3000 }]);
    const out = await runCli(['file', 'get', 'psss://Example API/ca.pem'], { box, fake });
    assert.equal(out.stdout, 'PEM-BYTES\n');
    const tty = await runCli(['file', 'get', 'psss://Example API/ca.pem'], { box, fake, stdoutTty: true });
    assert.equal(tty.code, 2);
    assert.match(tty.stderr, /would print the bytes of a file into your terminal\. Name a place instead, such as: psss file get "psss:\/\/Example API\/ca\.pem" --output \./);
    const miss = await runCli(['file', 'get', 'psss://Example API/nope.pem'], { box, fake });
    assert.equal(miss.code, 3);
    assert.equal(miss.stderr, '"Example API" has no file called "nope.pem".\nIt has: ca.pem, notes.txt.\n');
    const none = await runCli(['file', 'list', 'psss://Example Bank'], { box, scenario: { items: [{ ...BANK }] } });
    assert.equal(none.stdout, '"Example Bank" has no files.\n');
  } finally {
    box.cleanup();
  }
});

test('file get --output: a file or a folder, mode 0600, never over a file without --force, never outside the folder, never in the vault folder', async () => {
  const box = sandbox();
  try {
    const evil = '../../etc/passwd';
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API, files: { [evil]: 'ROOT', 'ca.pem': 'PEM', 'a\nb': 'x' } }] }));
    mkdirSync(path.join(box.cwd, 'out'));
    const hostile = await runCli(['file', 'get', 'psss://Example API/id%3A', '--output', 'out'], { box, fake });
    assert.equal(hostile.code, 3, 'wrong name sanity');
    const r = await runCli(['file', 'get', `psss://Example API/${encodeURIComponent(evil).replaceAll('%2F', '%2F')}`, '--output', 'out'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(path.join(box.cwd, 'out', 'passwd')), 'a name with slashes becomes its last part, inside the chosen folder');
    assert.ok(!existsSync(path.join(box.root, 'etc')), 'nothing was written outside');
    assert.equal(statSync(path.join(box.cwd, 'out', 'passwd')).mode & 0o777, 0o600);
    assert.equal(r.stdout, 'Wrote ./out/passwd (4 bytes) from "Example API".\nIt is readable by you only.\n');
    const one = await runCli(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out/copy.pem'], { box, fake });
    assert.equal(readFileSync(path.join(box.cwd, 'out', 'copy.pem'), 'utf8'), 'PEM');
    assert.equal(one.code, 0);
    const again = await runCli(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out/copy.pem'], { box, fake });
    assert.equal(again.code, 1);
    assert.equal(again.stderr, './out/copy.pem already exists, so nothing was written.\nChoose another name, or add --force to replace it.\n');
    writeFileSync(path.join(box.cwd, 'out', 'copy.pem'), 'OLD');
    assert.equal((await runCli(['file', 'get', 'psss://Example API/ca.pem', '--output', 'out/copy.pem', '--force'], { box, fake })).code, 0);
    assert.equal(readFileSync(path.join(box.cwd, 'out', 'copy.pem'), 'utf8'), 'PEM');
    const control = await runCli(['file', 'get', 'psss://Example API/a%0Ab', '--output', 'out'], { box, fake });
    assert.equal(control.code, 2, 'a control character in a name cannot even be written in a reference');
    const inside = path.join(box.home, 'Psss', 'Personal.psss');
    mkdirSync(inside, { recursive: true });
    const refused = await runCli(['file', 'get', 'psss://Example API/ca.pem', '--output', path.join(inside, 'ca.pem')], { box, fake });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /is inside ~\/Psss\/Personal\.psss, a place this vault is kept in and shared from\.\nA file saved there would sync with the vault\./);
    assert.ok(!existsSync(path.join(inside, 'ca.pem')));
    const json = await runCli(['file', 'get', 'psss://Example API/ca.pem', '--json'], { box, fake });
    assert.equal(json.code, 2, '--json cannot describe bytes sent to standard output');
  } finally {
    box.cleanup();
  }
});

test('file put: stores the base name, refuses a name that is empty or has separators, a file over the limit, a name already there and a directory', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    box.write('docs/new.txt', 'hello');
    const r = await runCli(['file', 'put', 'psss://Example API', 'docs/new.txt'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'psss://Example API/new.txt\n');
    const dup = await runCli(['file', 'put', 'psss://Example API', 'docs/new.txt'], { box, fake });
    assert.equal(dup.code, 1);
    assert.equal(dup.stderr, '"Example API" already has a file called "new.txt". Nothing was changed.\nTo replace it, add --force.\n');
    const forced = await runCli(['file', 'put', 'psss://Example API', 'docs/new.txt', '--force'], { box, fake });
    assert.equal(forced.code, 0);
    assert.equal(forced.stderr, 'Replaced the earlier file called "new.txt".\n');
    for (const name of ['', 'a/b', '..', 'x\ny']) {
      const bad = await runCli(['file', 'put', 'psss://Example API', 'docs/new.txt', '--name', name], { box, fake });
      assert.equal(bad.code, 2, JSON.stringify(name));
      assert.match(bad.stderr, /cannot be the name of a file in an item/);
    }
    assert.equal((await runCli(['file', 'put', 'psss://Example API', 'docs'], { box, fake })).code, 1, 'a folder is not a file');
    assert.equal((await runCli(['file', 'put', 'psss://Example API', 'missing.txt'], { box, fake })).code, 1);
    const big = path.join(box.cwd, 'big.bin');
    writeFileSync(big, '');
    const { truncateSync } = await import('node:fs');
    truncateSync(big, 100 * 1024 * 1024);
    const huge = await runCli(['file', 'put', 'psss://Example API', 'big.bin'], { box, fake });
    assert.equal(huge.code, 1);
    assert.equal(huge.stderr, './big.bin is 100 MiB, larger than the 64 MiB an attached file can be. Nothing was changed.\n');
    assert.equal(huge.stdout, '');
    const bidi = await runCli(['file', 'put', 'psss://Example API', 'docs/new.txt', '--name', `inv${RLO}fdp.exe`], { box, fake });
    assert.equal(bidi.code, 0);
    assert.ok(!/‮/.test(bidi.combined.replace(/%E2%80%AE/g, '')), 'the direction mark is written out, never sent to the terminal');
  } finally {
    box.cleanup();
  }
});
