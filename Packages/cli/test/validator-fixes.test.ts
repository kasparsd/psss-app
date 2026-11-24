// Fixes after the independent validation of generate, item and file (2026-11-24): what each test protects is in its name.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { commands } from '../src/commands/index.ts';
import { safeFileName } from '../src/commands/file.ts';
import { showJson, showText, sizeText } from '../src/commands/item.ts';
import { FakeVaultService } from '../src/fake-service.ts';
import type { FakeItem } from '../src/fake-service.ts';
import type { ItemDetails } from '../src/service.ts';
import { runCli, sandbox, scenarioFor, SECRET } from './helpers.ts';

const API: FakeItem = { id: 'a1b2c3d4', title: 'Example API', username: 'robin', fields: { token: SECRET } };

// 1. a card number's last digits

test('item show: the last four digits are said only for a real card number of 12 or more digits', async () => {
  const box = sandbox();
  try {
    const items: FakeItem[] = [
      { id: 'c1', title: 'Short', kind: 2, fields: { card: '123' } },
      { id: 'c2', title: 'Five', kind: 2, fields: { card: '12345' } },
      { id: 'c3', title: 'Long', kind: 2, fields: { card: '4111 1111 1111 4417' } },
      { id: 'c4', title: 'Login with card field', kind: 1, fields: { card: '4111111111114417' } },
    ];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    for (const [title, want] of [['Short', /Card number {2,}hidden\n/], ['Five', /Card number {2,}hidden\n/], ['Long', /Card number {2,}hidden, ends in 4417/], ['Login with card field', /hidden\n/]] as const) {
      const r = await runCli(['item', 'show', `psss://${title}`], { box, fake });
      assert.match(r.stdout, want, title);
      if (title !== 'Long') assert.ok(!/ends in/.test(r.stdout), `${title} must not say any digit`);
    }
    const short = await runCli(['item', 'show', 'psss://Short', '--json'], { box, fake });
    assert.ok(!short.stdout.includes('123'), 'nor in --json');
  } finally {
    box.cleanup();
  }
});

test('item show: an extra field that is called card, notes or password is shown under its own name, never as the built-in field', () => {
  const d: ItemDetails = {
    item: { id: 'x', title: 'T', group: 'G', deleted: false },
    kind: 'card', websites: [], tags: [], files: [], hasCode: false,
    fields: [
      { name: 'card', hidden: true, detail: 'ends in 4417' },
      { name: 'card', hidden: false, value: 'a plain note to myself', custom: true },
      { name: 'Notes', hidden: true, custom: true },
    ],
  };
  const text = showText(d);
  assert.match(text, /Card number {2,}hidden, ends in 4417/);
  assert.match(text, /\n {2}card {2,}a plain note to myself/, 'a custom field keeps its own label');
  assert.match(text, /\n {2}Notes {2,}hidden\n/);
  const fields = (showJson(d).fields as Array<{ custom?: boolean }>).map((f) => f.custom === true);
  assert.deepEqual(fields, [false, true, true]);
});

test('item show: a passkey is listed with its name, site and date, never its key', () => {
  const d: ItemDetails = {
    item: { id: 'x', title: 'T', group: 'G', deleted: false }, kind: 'login', websites: [], tags: [], files: [], hasCode: false, fields: [],
    passkey: { site: 'example.com', name: 'robin@example.com', created: Date.UTC(2026, 4, 3, 10, 0) },
  };
  assert.match(showText(d), /Passkey {2,}robin@example\.com on example\.com, made 2026-05-03\n/);
  assert.deepEqual(showJson(d).passkey, { site: 'example.com', name: 'robin@example.com', created: '2026-05-03T10:00:00.000Z' });
  assert.equal(showJson({ ...d, passkey: undefined }).passkey, null);
});

// 2. edit keeps a hidden field hidden

test('item edit --field on a hidden field is refused and the field stays hidden; --secret changes it from standard input', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API, fields: { 'Hidden Field': 'old-hidden', 'Visible Field': 'old' }, plain: ['Visible Field'] }] }));
    const refused = await runCli(['item', 'edit', 'psss://Example API', '--field', 'Hidden Field=typed-on-the-command-line'], { box, fake });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /"Hidden Field" is a hidden field, so its value is not taken as an argument, and it stays hidden\.\nTo change it, read the new value from standard input with: --secret "Hidden Field"\nNothing was changed\./);
    assert.equal(fake.peek('Example API', 'Hidden Field'), 'old-hidden');
    const shown = await runCli(['item', 'show', 'psss://Example API'], { box, fake });
    assert.match(shown.stdout, /Hidden Field {2,}hidden\n/);
    assert.ok(!shown.combined.includes('old-hidden') && !shown.combined.includes('typed-on-the-command-line'));
    const ok = await runCli(['item', 'edit', 'psss://Example API', '--secret', 'Hidden Field'], { box, fake, stdin: 'new-hidden\n' });
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(fake.peek('Example API', 'Hidden Field'), 'new-hidden');
    assert.match((await runCli(['item', 'show', 'psss://Example API'], { box, fake })).stdout, /Hidden Field {2,}hidden\n/);
    const visible = await runCli(['item', 'edit', 'psss://Example API', '--field', 'Visible Field=new'], { box, fake });
    assert.equal(visible.stdout, 'Changed Visible Field of "Example API" (Personal).\n');
  } finally {
    box.cleanup();
  }
});

// 3. missing arguments

test('every command and verb with a required argument refuses to run without it: exit 2, a usage line, never a crash', async () => {
  const box = sandbox();
  try {
    const list = commands.flatMap((c) => (c.subcommands ? c.subcommands : [c])).filter((c) => !c.planned && c.args.min > 0);
    assert.ok(list.length >= 8, 'the check looks at the commands that need arguments');
    for (const c of list) {
      const words = c.name.split(' ');
      const r = await runCli([...words], { box, stdin: '' });
      assert.equal(r.code, 2, `psss ${c.name} without arguments`);
      assert.ok(!/unexpected error|Cannot read properties/i.test(r.combined), `psss ${c.name} must not crash: ${r.stderr}`);
      assert.match(r.stderr, /\S/, `psss ${c.name} says something`);
      assert.equal(r.stdout, '');
    }
    for (const args of [['file', 'get'], ['file', 'put'], ['file', 'put', 'psss://Example API']]) {
      const r = await runCli(args, { box });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /^psss file (get|put) needs (one argument|2 arguments), and got (none|1)\. Usage: psss file (get|put) /);
    }
  } finally {
    box.cleanup();
  }
});

// 4, 5, 6. names, kinds and --group

test('item add and edit: an extra field cannot have the name of a field the item has, and the message names the right option', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    const cases: Array<[string[], RegExp]> = [
      [['--field', 'password=x'], /"password" is a field an item already has, so --field cannot add a second one with that name\. Use --password \(the value is read from standard input\)\./],
      [['--field', 'Notes=x'], /Use --notes/],
      [['--field', 'USERNAME=x'], /Use --username\./],
      [['--field', 'Valid From=x'], /Use --valid-from\./],
      [['--secret', 'Password'], /--secret cannot add a second one/],
      [['--secret', 'code'], /verification code/],
    ];
    for (const verb of [['item', 'add', '--title', 'N'], ['item', 'edit', 'psss://Example API']]) {
      for (const [args, message] of cases) {
        const r = await runCli([...verb, ...args], { box, fake, stdin: 'x\n' });
        assert.equal(r.code, 2, `${verb.join(' ')} ${args.join(' ')}`);
        assert.match(r.stderr, message);
      }
    }
    assert.equal((await runCli(['item', 'add', '--title', 'Fine', '--field', 'Account number=1'], { box, fake })).code, 0, 'other names are fine');
  } finally {
    box.cleanup();
  }
});

test('item edit: the fields of a kind are the same as for item add; --group alone says that it does not move an item', async () => {
  const box = sandbox();
  try {
    const items: FakeItem[] = [{ id: 'n1', title: 'A Note', kind: 3, fields: { notes: 'x' } }, { id: 'l1', title: 'A Login', kind: 1, fields: { password: 'p' } }, { id: 'k1', title: 'A Card', kind: 2, fields: { card: '4111111111111111' } }];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const note = await runCli(['item', 'edit', 'psss://A Note', '--password'], { box, fake, stdin: 'x\n' });
    assert.equal(note.code, 2);
    assert.match(note.stderr, /^--password is for a login or a custom item, not a note\. Nothing was changed\./);
    assert.equal((await runCli(['item', 'edit', 'psss://A Note', '--username', 'x'], { box, fake })).code, 2);
    assert.match((await runCli(['item', 'edit', 'psss://A Login', '--cardholder', 'x'], { box, fake })).stderr, /--cardholder is for a card, and this item is a login\. Nothing was changed\./);
    assert.match((await runCli(['item', 'edit', 'psss://A Card', '--password'], { box, fake, stdin: 'x\n' })).stderr, /not a card/);
    assert.equal((await runCli(['item', 'edit', 'psss://A Login', '--username', 'ok'], { box, fake })).code, 0);
    const group = await runCli(['item', 'edit', 'psss://A Login', '--group', 'Personal'], { box, fake });
    assert.equal(group.code, 2);
    assert.match(group.stderr, /^There is nothing to change\. --group only says which group to look in: moving an item to another group is not built yet\./);
  } finally {
    box.cleanup();
  }
});

// 9, 10, 11, 12. names and sizes

test('file names: Windows device names, forbidden characters, trailing dots, zero-width and C1 characters, and length are made safe on every platform', () => {
  const cases: Array<[string, string]> = [
    ['CON', '_CON'], ['nul', '_nul'], ['aux.txt', '_aux.txt'], ['COM1.txt', '_COM1.txt'], ['lpt9', '_lpt9'], ['console.txt', 'console.txt'], ['com10.txt', 'com10.txt'],
    ['a:b', 'a_b'], ['a<b>c"d|e?f*g', 'a_b_c_d_e_f_g'], ['name.', 'name'], ['name. . ', 'name'], ['  spaced  ', 'spaced'], ['..', 'attachment'], ['', 'attachment'], ['///', 'attachment'],
    ['../../etc/passwd', 'passwd'], ['C:\\Windows\\win.ini', 'win.ini'],
    ['zero\u200bwidth.txt', 'zero_width.txt'], ['c1\u0085x.txt', 'c1_x.txt'], ['bidi\u202efdp.exe', 'bidi_fdp.exe'], ['tab\tname', 'tab_name'], ['sep\u2028x', 'sep_x'],
  ];
  for (const [input, want] of cases) assert.equal(safeFileName(input), want, JSON.stringify(input));
  const long = `${'x'.repeat(400)}.pdf`;
  const cut = safeFileName(long);
  assert.ok(Buffer.byteLength(cut) <= 255 && cut.endsWith('.pdf') && cut.startsWith('xxx'), 'cut, keeping the extension');
  const wide = safeFileName(`${'é'.repeat(300)}.tar.gz`);
  assert.ok(Buffer.byteLength(wide) <= 255 && wide.endsWith('.gz') && !wide.includes('\ufffd'), 'cut at a character boundary');
  assert.ok(Buffer.byteLength(safeFileName('y'.repeat(300))) <= 255);
});

test('file get --output: a long stored name and a device name are written under safe names, and the printed path has no hidden character', async () => {
  const box = sandbox();
  try {
    const files = { [`${'n'.repeat(300)}.pem`]: 'LONG', 'NUL.txt': 'DEV', 'a:b.txt': 'COLON', 'inv\u200bis.txt': 'ZW' };
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API, files }] }));
    mkdirSync(path.join(box.cwd, 'out'));
    for (const name of Object.keys(files)) {
      const r = await runCli(['file', 'get', `psss://Example API/${name.replace(/[\u200b]/g, '%E2%80%8B')}`, '--output', 'out'], { box, fake });
      assert.equal(r.code, 0, `${name.slice(0, 20)}: ${r.stderr}`);
      assert.ok(!/[\u200b-\u200f\u0080-\u009f]/.test(r.combined), 'no hidden character reaches the terminal');
      assert.ok(r.stdout.split('\n')[0]!.length < 300, 'the long path is cut when it is printed');
    }
    const written = ['_NUL.txt', 'a_b.txt', 'inv_is.txt'].map((n) => existsSync(path.join(box.cwd, 'out', n)));
    assert.deepEqual(written, [true, true, true]);
  } finally {
    box.cleanup();
  }
});

test('file put: a name over 255 bytes is refused with a plain message; sizes use KiB and MiB everywhere', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ ...API }] }));
    box.write('f.txt', 'x');
    const long = await runCli(['file', 'put', 'psss://Example API', 'f.txt', '--name', `${'a'.repeat(300)}.txt`], { box, fake });
    assert.equal(long.code, 2);
    assert.match(long.stderr, /^"a{39}\\u\{2026\}" is 304 bytes long|^"a+…" is 304 bytes long, and a file name in an item can be at most 255\. Choose a shorter one with --name\./);
    assert.equal((await runCli(['file', 'put', 'psss://Example API', 'f.txt', '--name', `${'a'.repeat(251)}.txt`], { box, fake })).code, 0, '255 bytes is allowed');
    const big = path.join(box.cwd, 'big.bin');
    writeFileSync(big, '');
    truncateSync(big, 64 * 1024 * 1024 + 1);
    const r = await runCli(['file', 'put', 'psss://Example API', 'big.bin'], { box, fake });
    assert.equal(r.stderr, './big.bin is 64 MiB, larger than the 64 MiB an attached file can be. Nothing was changed.\n');
    assert.equal(sizeText(2048), '2 KiB');
    assert.equal(sizeText(3 * 1024 * 1024), '3 MiB');
    assert.equal(sizeText(5 * 1024 ** 3), '5 GiB');
    assert.equal(sizeText(1), '1 byte');
    assert.ok(!/\b[KMG]B\b/.test(r.stderr));
  } finally {
    box.cleanup();
  }
});

// 12. generate

test('generate: the weaker-than-recommended advice fits what was asked, and a negative number is below the smallest allowed', async () => {
  const box = sandbox();
  try {
    const words = await runCli(['generate', '--words', '4'], { box, noService: true });
    assert.match(words.stderr, /Use more words\.\n$/);
    assert.ok(!/use --words/i.test(words.stderr), 'it does not tell a person who used --words to use --words');
    const chars = await runCli(['generate', '--length', '8'], { box, noService: true });
    assert.match(chars.stderr, /Make it longer, or use --words\.\n$/);
    for (const [flag, name] of [['--length', 'random characters are'], ['--words', 'a passphrase has'], ['--count', 'make']] as const) {
      const r = await runCli(['generate', flag, '-5'], { box, noService: true });
      assert.equal(r.code, 2, flag);
      assert.ok(!/needs a value/.test(r.stderr), `${flag} -5 is a value`);
      assert.match(r.stderr, new RegExp(`--${flag.slice(2)} -5 is (below the smallest allowed|not sensible|needs a whole number)`));
      void name;
    }
    assert.match((await runCli(['generate', '--length', '-5'], { box, noService: true })).stderr, /--length -5 is below the smallest allowed: random characters are between 8 and 128\./);
  } finally {
    box.cleanup();
  }
});

test('the apps\' offensive-terms filter is mirrored: the same file, today with no terms, and the default password is still made', async () => {
  const box = sandbox();
  try {
    const r = await runCli(['generate', '--count', '50'], { box, noService: true });
    assert.equal(r.stdout.trimEnd().split('\n').length, 50);
    assert.equal(readFileSync(new URL('../../vault/src/offensive-terms.txt', import.meta.url)).toString(), readFileSync(new URL('../../../App/Core/OffensiveTerms.txt', import.meta.url)).toString());
  } finally {
    box.cleanup();
  }
});

test('the usage line of set --generate says that piped input is ignored', async () => {
  const box = sandbox();
  try {
    const help = await runCli(['set', '--help'], { box, noService: true });
    assert.match(help.stdout, /nothing is read from standard input: whatever is piped in is ignored/);
  } finally {
    box.cleanup();
  }
});
