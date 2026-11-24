// search, history and code against the fake service: the words of frames A13 to A15 character for character, exit codes, streams, --json shapes,
// escaping of hostile names, the A11 warning, and that no value or setup key is printed where it must not be.
// (The real vault is in real-search-history-code.test.ts.)

import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeVaultService } from '../src/fake-service.ts';
import type { FakeItem } from '../src/fake-service.ts';
import type { VaultIssue } from '../src/service.ts';
import { norm, runCli, sandbox, scenarioFor, SECRET } from './helpers.ts';

const at = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi);
const RLO = '\u202e';
const hidden = (text: string) => /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2028\u2029]/.test(text);

/** The fictional vault of frames A13 to A15. */
const ITEMS: FakeItem[] = [
  { id: '7f3a9c21', title: 'Example', username: 'robin@example.com', url: 'https://example.com', fields: { password: 'ex-pw-1' } },
  { id: 'b01d5e44', title: 'Example', username: 'sam@example.com', fields: { password: 'ex-pw-2' } },
  { id: 'a1b2c3d4', title: 'Example API', username: 'robin@example.com', fields: { token: 'sk-example-old' } },
  {
    id: 'c0ffee01',
    title: 'Example Bank',
    username: 'robin@example.com',
    url: 'https://bank.example',
    fields: { password: 'bank-pw-3', code: '123456' },
    changes: [
      { at: at(2026, 11, 20, 9, 12), kind: 'changed', fields: ['password', 'code'] },
      { at: at(2026, 11, 3, 14, 7), kind: 'changed', fields: ['password'] },
      { at: at(2026, 10, 2, 8, 0), kind: 'added', fields: [] },
    ],
    earlier: { password: [{ replaced: at(2026, 11, 20, 9, 12), value: 'bank-pw-2' }, { replaced: at(2026, 11, 3, 14, 7), value: 'bank-pw-1' }] },
  },
];

const issue: VaultIssue = { code: 'gap', location: '/x', detail: 'chain 99aa: records 4 to 5 missing', plain: 'A record is missing from the middle of a device history.' };

test('A13: search prints one line per match as list does, with ids for a shared name, and a near miss exits 3 with a hint', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS }));
    const hit = await runCli(['search', 'example'], { box, fake, stdoutTty: true });
    assert.equal(
      hit.combined,
      `Example        robin@example.com    id:7f3a9c21   password
Example        sam@example.com      id:b01d5e44   password
Example API    robin@example.com                  token
Example Bank   robin@example.com                  password, code
`,
      'A13 search: one line per item, an id only for the two that share a name',
    );
    assert.equal(hit.code, 0, 'a match exits 0');
    const miss = await runCli(['search', 'exampel'], { box, fake, stdoutTty: true });
    assert.equal(miss.combined, 'No items match "exampel".\nDid you mean: Example, Example API, Example Bank?\n', 'A13 near miss: plain words and a hint on standard error');
    assert.equal(miss.stdout, '', 'nothing on standard output');
    assert.equal(miss.code, 3, 'no match exits 3, like no such item');
    const none = await runCli(['search', 'zzz'], { box, fake });
    assert.equal(none.stderr, 'No items match "zzz".\n', 'no hint line when nothing is close');
    assert.equal(none.code, 3);
  } finally {
    box.cleanup();
  }
});

test('search reads the name, the username and the website, ignores case, accents and spaces around the text, and never a value or a field name', async () => {
  const box = sandbox();
  try {
    const items: FakeItem[] = [
      ...ITEMS,
      { id: 'd4e5f601', title: 'Caf\u00e9 Noir', username: 'amelie', url: 'https://cafe-noir.example/login', fields: { password: 'zxcv-secret' } },
      { id: 'e5f60112', title: 'Cafe\u0301 Blanc', fields: { password: 'p' } },
    ];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const names = async (text: string) => (await runCli(['search', text, '--json'], { box, fake })).stdout;
    const titles = async (text: string): Promise<string[]> => {
      const out = await names(text);
      return out === '' ? [] : (JSON.parse(out) as { items: Array<{ title: string }> }).items.map((i) => i.title);
    };
    assert.deepEqual(await titles('  CAFE  '), ['Cafe\u0301 Blanc', 'Caf\u00e9 Noir'], 'case, accents, Unicode form and surrounding spaces do not matter');
    assert.deepEqual(await titles('amelie'), ['Caf\u00e9 Noir'], 'the username is searched');
    assert.deepEqual(await titles('cafe-noir.example'), ['Caf\u00e9 Noir'], 'the website is searched, by its text');
    assert.deepEqual(await titles('bank.example'), ['Example Bank'], 'the website of another item');
    assert.deepEqual(await titles('sk-example'), [], 'a stored value is never searched');
    assert.deepEqual(await titles('zxcv'), [], 'neither is a password');
    assert.deepEqual(await titles('token'), [], 'nor the name of a field');
    const deleted = new FakeVaultService(scenarioFor(box, { items: [...ITEMS, { id: 'f6011223', title: 'Old Shop', fields: { password: 'p' }, deleted: true }] }));
    const live = await runCli(['search', 'old'], { box, fake: deleted });
    assert.equal(live.code, 3, 'Recently Deleted is not searched by default');
    const bin = await runCli(['search', 'old', '--deleted'], { box, fake: deleted });
    assert.equal(bin.stdout, 'Old Shop   password\n', '--deleted searches Recently Deleted');
    const binMiss = await runCli(['search', 'zzz', '--deleted'], { box, fake: deleted });
    assert.equal(binMiss.stderr, 'No items in Recently Deleted match "zzz".\n');
  } finally {
    box.cleanup();
  }
});

test('search --json lists id, title, username, url, group and field names, never a value, and is the same item shape as list --json', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS }));
    const r = await runCli(['search', 'bank', '--json'], { box, fake });
    assert.deepEqual(JSON.parse(r.stdout), { items: [{ id: 'c0ffee01', title: 'Example Bank', username: 'robin@example.com', url: 'https://bank.example', group: 'Only Me', fields: ['password', 'code'] }] });
    const list = JSON.parse((await runCli(['list', '--json'], { box, fake })).stdout) as { items: Array<{ id: string }> };
    assert.deepEqual(JSON.parse(r.stdout).items[0], list.items.find((i) => i.id === 'c0ffee01'), 'the same shape as an item of list --json');
    assert.ok(!r.stdout.includes('bank-pw'), 'no value');
    const miss = await runCli(['search', 'zzz', '--json'], { box, fake });
    assert.equal(miss.code, 3, 'no match exits 3 with --json too');
    assert.equal(miss.stdout, '', 'an error is text on standard error and leaves standard output empty');
  } finally {
    box.cleanup();
  }
});

test('search needs exactly one piece of text, narrows to --group, and refuses an unknown group', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { groups: ['Only Me', 'Team'], items: [{ id: '11111111', title: 'Shared', group: 'Team', fields: { token: 't' } }, ...ITEMS] }));
    const none = await runCli(['search'], { box, fake });
    assert.equal(none.code, 2, 'no text is a usage error');
    assert.match(none.stderr, /^psss search needs some text to look for, such as: psss search example\n/);
    assert.equal((await runCli(['search', '   '], { box, fake })).code, 2, 'only spaces is no text');
    const two = await runCli(['search', 'example', 'api'], { box, fake });
    assert.equal(two.code, 2, 'two words are two arguments');
    assert.equal(two.stderr, 'psss search takes one argument, but 1 more was not expected. Put text with spaces in quotes, as in: psss search "example api"\n');
    assert.deepEqual(fake.calls.filter((c) => c === 'search'), [], 'a usage error searches nothing');
    const team = await runCli(['search', 'a', '--group', 'Team'], { box, fake });
    assert.equal(team.stdout, 'Shared   token\n', '--group narrows the search');
    const bad = await runCli(['search', 'a', '--group', 'Nope'], { box, fake });
    assert.equal(bad.code, 3, 'an unknown group exits 3');
    assert.equal(bad.stderr, 'There is no group called "Nope" in Personal.\n');
  } finally {
    box.cleanup();
  }
});

test('search writes a hostile name as escapes: no direction mark, no forged line, cut to 60 characters, in text and in --json, and in the hint', async () => {
  const box = sandbox();
  try {
    const forged = `Evil\nwarning: forged line ${RLO}gnp.exe ${'x'.repeat(100)}`;
    const items: FakeItem[] = [
      { id: '11111111', title: forged, username: `us${RLO}er`, fields: { [`to${RLO}ken`]: 'v' } },
      { id: '22222222', title: `Ex${RLO}ample` },
    ];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const r = await runCli(['search', 'evil'], { box, fake });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!hidden(r.stdout), 'no raw direction mark on standard output');
    assert.equal(r.stdout.trimEnd().split('\n').length, 1, 'a line break in a title forges no line');
    assert.match(r.stdout, /^Evil\\u\{a\}warning: forged line \\u\{202e\}gnp\.exe x+\u2026 +us\\u\{202e\}er +to\\u\{202e\}ken\n$/, r.stdout);
    const j = await runCli(['search', 'evil', '--json'], { box, fake });
    assert.ok(!hidden(j.stdout), 'no raw direction mark in the JSON');
    assert.ok(JSON.parse(j.stdout).items[0].title.startsWith('Evil\\u{a}warning'), 'escaped, not cut, in JSON');
    const miss = await runCli(['search', `Exampl${RLO}`], { box, fake });
    assert.equal(miss.code, 3);
    assert.ok(!hidden(miss.stderr), 'the searched text and the hint are escaped: ' + miss.stderr);
    assert.match(miss.stderr, /^No items match "Exampl\\u\{202e\}"\.\nDid you mean: Ex\\u\{202e\}ample\?\n$/);
  } finally {
    box.cleanup();
  }
});

test('A14: history lists what changed and when, never a value; a field lists when each earlier value was replaced; --show prints the values', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS }));
    const mock = `2026-11-20 09:12 UTC  Changed password, code
2026-11-03 14:07 UTC  Changed password
2026-10-02 08:00 UTC  Added
`;
    const item = await runCli(['history', 'psss://Example Bank'], { box, fake, stdoutTty: true });
    assert.equal(item.combined, mock, 'A14: the changes of an item, newest first');
    assert.equal(item.code, 0);
    const field = await runCli(['history', 'psss://Example Bank/password'], { box, fake, stdoutTty: true });
    assert.equal(
      field.combined,
      `Replaced 2026-11-20 09:12 UTC
Replaced 2026-11-03 14:07 UTC
The values are hidden. Print them with: psss history "psss://Example Bank/password" --show
`,
      'A14: a field lists dates, hides the values and says how to see them',
    );
    assert.equal(field.stdout, 'Replaced 2026-11-20 09:12 UTC\nReplaced 2026-11-03 14:07 UTC\n', 'the hint is on standard error');
    const piped = await runCli(['history', 'psss://Example Bank/password'], { box, fake });
    assert.equal(piped.stderr, '', 'into a pipe there is no hint');
    const shown = await runCli(['history', 'psss://Example Bank/password', '--show'], { box, fake, stdoutTty: true });
    assert.equal(shown.combined, 'Replaced 2026-11-20 09:12 UTC  bank-pw-2\nReplaced 2026-11-03 14:07 UTC  bank-pw-1\n', 'A14: --show prints the earlier values, newest first, one per line');
    assert.ok(!shown.combined.includes('bank-pw-3'), 'never the current value');
    for (const r of [item, field, piped]) assert.ok(!/bank-pw/.test(r.combined), 'without --show no value is printed');
    const other = await runCli(['history', 'psss://Example Bank/token'], { box, fake });
    assert.equal(other.stderr, '"Example Bank" has no field called "token".\nIt has: password, code.\n', 'A14: a field the item lacks');
    assert.equal(other.code, 3, 'exit 3');
  } finally {
    box.cleanup();
  }
});

test('history: the group form, the id form, an item with no earlier value, Recently Deleted and the usage errors', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [...ITEMS, { id: '99999999', title: 'Old Shop', fields: { password: 'p' }, deleted: true, changes: [{ at: at(2026, 11, 1, 10, 0), kind: 'deleted', fields: [] }, { at: at(2026, 9, 1, 10, 0), kind: 'added', fields: [] }] }] }));
    assert.equal((await runCli(['history', 'psss://id:c0ffee01'], { box, fake })).code, 0, 'the id form works');
    assert.equal((await runCli(['history', 'psss://Only Me/Example Bank/password'], { box, fake })).code, 0, 'group, item and field works');
    const empty = await runCli(['history', 'psss://Example API/token', '--show'], { box, fake });
    assert.equal(empty.stdout, '', 'no earlier value: nothing on standard output, so a script reading --show gets nothing');
    assert.equal(empty.stderr, '"Example API" has no earlier value of "token".\n');
    assert.equal(empty.code, 0, 'which is not an error');
    const bin = await runCli(['history', 'psss://Old Shop'], { box, fake });
    assert.equal(bin.stdout, '2026-11-01 10:00 UTC  Moved to Recently Deleted\n2026-09-01 10:00 UTC  Added\n', 'an item in Recently Deleted has a history');
    assert.equal(bin.stderr, '"Old Shop" is in Recently Deleted. Bring it back with: psss restore psss://id:99999999\n');
    const dup = await runCli(['history', 'psss://Example'], { box, fake });
    assert.equal(dup.code, 3, 'two items with one name is ambiguous');
    assert.match(dup.stderr, /^"Example" matches 2 items in Personal\. Use one of these:\n  psss:\/\/id:7f3a9c21 /);
    const miss = await runCli(['history', 'psss://Exampel Bank'], { box, fake });
    assert.equal(miss.code, 3);
    assert.match(miss.stderr, /^There is no item called "Exampel Bank" in Personal\.\nDid you mean: Example Bank\?\n/);
    const noShow = await runCli(['history', 'psss://Example Bank', '--show'], { box, fake });
    assert.equal(noShow.code, 2, '--show needs a field');
    assert.equal(noShow.stderr, '--show prints the earlier values of one field, so name the field, as in: psss history "psss://Example Bank/password" --show\n');
    const none = await runCli(['history'], { box, fake });
    assert.equal(none.code, 2, 'no reference and no terminal is a usage error');
    assert.match(none.stderr, /^psss history needs a reference, such as\n"psss:\/\/Example API"\. No terminal is attached,/);
    assert.equal((await runCli(['history', 'Example Bank'], { box, fake })).code, 2, 'a bare name is not a reference');
  } finally {
    box.cleanup();
  }
});

test('history --json: ISO dates, field names escaped, a value only with --show, and a date no calendar can show is null', async () => {
  const box = sandbox();
  try {
    const items: FakeItem[] = [
      {
        id: 'c0ffee01',
        title: 'Bank',
        fields: { password: 'now', [`pi${RLO}n`]: 'x' },
        changes: [{ at: at(2026, 11, 20, 9, 12), kind: 'changed', fields: [`pi${RLO}n`] }, { at: 9e18, kind: 'added', fields: [] }],
        earlier: { password: [{ replaced: at(2026, 11, 20, 9, 12), value: 'old-pw' }, { replaced: 9e18, value: 'older-pw' }] },
      },
    ];
    const fake = new FakeVaultService(scenarioFor(box, { items }));
    const changes = await runCli(['history', 'psss://Bank', '--json'], { box, fake });
    assert.deepEqual(JSON.parse(changes.stdout), {
      item: { id: 'c0ffee01', title: 'Bank', group: 'Only Me' },
      changes: [{ at: '2026-11-20T09:12:00.000Z', kind: 'changed', fields: ['pi\\u{202e}n'] }, { at: null, kind: 'added', fields: [] }],
    });
    assert.ok(!hidden(changes.stdout));
    const hiddenValues = await runCli(['history', 'psss://Bank/password', '--json'], { box, fake });
    assert.deepEqual(JSON.parse(hiddenValues.stdout).earlier, [{ replaced: '2026-11-20T09:12:00.000Z' }, { replaced: null }], 'no value by default, even in JSON');
    assert.ok(!hiddenValues.stdout.includes('old-pw'));
    const shown = await runCli(['history', 'psss://Bank/password', '--json', '--show'], { box, fake });
    assert.deepEqual(JSON.parse(shown.stdout).earlier, [{ replaced: '2026-11-20T09:12:00.000Z', value: 'old-pw' }, { replaced: null, value: 'older-pw' }]);
    const text = await runCli(['history', 'psss://Bank'], { box, fake });
    assert.equal(text.stdout, '2026-11-20 09:12 UTC  Changed pi\\u{202e}n\nunknown date          Added\n', 'a date that cannot be shown says so, and the text still lines up');
  } finally {
    box.cleanup();
  }
});

test('history --show writes a value on one line: a line break or direction mark is an escape, and --json has it exactly', async () => {
  const box = sandbox();
  try {
    const value = `line one\nline two ${RLO}tail`;
    const fake = new FakeVaultService(scenarioFor(box, { items: [{ id: 'c0ffee01', title: 'Bank', fields: { password: 'x' }, earlier: { password: [{ replaced: at(2026, 1, 1, 0, 0), value }] } }] }));
    const r = await runCli(['history', 'psss://Bank/password', '--show'], { box, fake });
    assert.equal(r.stdout, 'Replaced 2026-01-01 00:00 UTC  line one\\u{a}line two \\u{202e}tail\n', 'one line, escaped');
    const j = await runCli(['history', 'psss://Bank/password', '--show', '--json'], { box, fake });
    assert.equal(JSON.parse(j.stdout).earlier[0].value, value, 'the JSON value is exact');
  } finally {
    box.cleanup();
  }
});

test('A15: code prints the code and a line break on standard output, the seconds left on standard error only at a terminal', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS }));
    const tty = await runCli(['code', 'psss://Example Bank'], { box, fake, stdoutTty: true, stderrTty: true });
    assert.equal(tty.combined, '123456\nValid for 21 more seconds.\n', 'A15: the code, then the seconds left');
    assert.equal(tty.stdout, '123456\n', 'only the code on standard output');
    const piped = await runCli(['code', 'psss://Example Bank'], { box, fake, stderrTty: false });
    assert.deepEqual([piped.stdout, piped.stderr, piped.code], ['123456\n', '', 0], 'with no terminal on standard error nothing is said there');
    const out = await runCli(['code', 'psss://Example Bank'], { box, fake, stdoutTty: true, stderrTty: true, scenario: undefined });
    assert.equal(out.code, 0);
    const one = new FakeVaultService(scenarioFor(box, { items: ITEMS, codeRemaining: 1 }));
    assert.equal((await runCli(['code', 'psss://Example Bank'], { box, fake: one, stderrTty: true })).stderr, 'Valid for 1 more second.\n');
    const ref = await runCli(['code', 'psss://Example Bank/code'], { box, fake });
    assert.equal(ref.stdout, '123456\n', 'the code field of an item names the same thing');
    assert.equal((await runCli(['code', 'psss://Only Me/Example Bank/CODE'], { box, fake })).stdout, '123456\n', 'with a group, and the field in any case');
    assert.equal((await runCli(['code', 'psss://id:c0ffee01'], { box, fake })).stdout, '123456\n', 'and by id');
    const json = await runCli(['code', 'psss://Example Bank', '--json'], { box, fake, stderrTty: true });
    assert.deepEqual(JSON.parse(json.stdout), { reference: 'psss://id:c0ffee01/code', item: { id: 'c0ffee01', title: 'Example Bank', group: 'Only Me' }, code: '123456', period: 30, remaining: 21 });
    assert.equal(json.stderr, '', '--json says nothing on standard error');
  } finally {
    box.cleanup();
  }
});

test('A15: an item with no verification code exits 3 and says what it has; a wrong field, a missing name and a code that cannot be made are plain', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: [...ITEMS, { id: 'dddddddd', title: 'Odd', fields: { code: '000000', password: 'p' } }], codeUnsupported: ['Odd'] }));
    const none = await runCli(['code', 'psss://Example API'], { box, fake, stdoutTty: true, stderrTty: true });
    assert.equal(none.combined, '"Example API" has no verification code.\nIt has: token.\n', 'A15: none');
    assert.equal(none.code, 3);
    assert.equal(none.stdout, '', 'nothing on standard output');
    const miss = await runCli(['code', 'psss://Exampel Bank'], { box, fake });
    assert.equal(miss.code, 3);
    assert.match(miss.stderr, /^There is no item called "Exampel Bank" in Personal\.\nDid you mean: Example Bank\?\n/);
    const dup = await runCli(['code', 'psss://Example'], { box, fake });
    assert.equal(dup.code, 3, 'ambiguous');
    assert.match(dup.stderr, /^"Example" matches 2 items in Personal\. Use one of these:\n  psss:\/\/id:7f3a9c21\/code /, 'the candidates are written as the code field of each');
    const other = await runCli(['code', 'psss://Example Bank/password'], { box, fake });
    assert.equal(other.code, 2, 'another field is a usage error');
    assert.equal(other.stdout, '', 'and the password is not printed');
    assert.match(other.stderr, /^code makes the verification code of an item\. Use: psss code "psss:\/\/Example Bank"\n/);
    const odd = await runCli(['code', 'psss://Odd'], { box, fake });
    assert.equal(odd.code, 1, 'a code that cannot be made is a failure');
    assert.equal(odd.stderr, 'The verification code of "Odd" cannot be made: its setup key asks for an algorithm Psss does not support (7).\n');
    assert.equal(odd.stdout, '', 'and prints nothing');
    const noRef = await runCli(['code'], { box, fake });
    assert.equal(noRef.code, 2);
    assert.match(noRef.stderr, /^psss code needs a reference, such as\n"psss:\/\/Example API"\. No terminal is attached,/);
    const locked = await runCli(['code', 'psss://Example Bank'], { box, scenario: { items: ITEMS, keyState: 'keyFileMissing' } });
    assert.equal(locked.code, 4, 'no key exits 4');
    assert.equal(locked.stdout, '');
  } finally {
    box.cleanup();
  }
});

test('with a terminal, history and code offer a short list when no reference is given; code lists only items that have a code', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(scenarioFor(box, { items: ITEMS }));
    const c = await runCli(['code'], { box, fake, typed: '1\n', stdoutTty: true });
    assert.equal(c.code, 0, c.stderr);
    assert.match(c.stderr, /Which item in Personal\?\n +1 +Example Bank/, 'only the item with a code is listed');
    assert.ok(!/Example API/.test(c.stderr), 'an item with no code is not offered');
    assert.equal(c.stdout, '123456\n');
    const h = await runCli(['history'], { box, fake, typed: '4\n', stdoutTty: true });
    assert.equal(h.code, 0, h.stderr);
    assert.match(h.stdout, /^2026-11-20 09:12 UTC {2}Changed password, code\n/);
    const none = await runCli(['code'], { box, scenario: { items: [ITEMS[2]] }, typed: '\n', stdoutTty: true });
    assert.equal(none.code, 3, 'nothing to choose from');
    assert.equal(none.stderr, 'No item in Personal has a verification code.\n');
  } finally {
    box.cleanup();
  }
});

test('A11: search, history and code warn when the vault has a problem, after the result, in their own words, and keep their exit code', async () => {
  const box = sandbox();
  try {
    const bad = new FakeVaultService(scenarioFor(box, { items: ITEMS, issues: [issue, { ...issue, code: 'fork' }] }));
    const result = 'warning: "Personal" has a problem, so the result above may be\nout of date. Run psss verify to see what is wrong.\n';
    const search = await runCli(['search', 'bank'], { box, fake: bad });
    assert.equal(search.stderr, result, 'search says the result above');
    assert.equal(search.combined, `Example Bank   robin@example.com    password, code\n${result}`, 'after the result');
    assert.equal(search.code, 0);
    const history = await runCli(['history', 'psss://Example Bank'], { box, fake: bad });
    assert.equal(history.stderr, result, 'history says the result above');
    const code = await runCli(['code', 'psss://Example Bank'], { box, fake: bad });
    assert.equal(code.stdout, '123456\n', 'code still prints the code');
    assert.equal(code.stderr, 'warning: "Personal" has a problem, so the value above may be\nout of date. Run psss verify to see what is wrong.\n', 'code says the value above');
    assert.equal(code.code, 0, 'a problem never changes the exit code of a read');
    const json = await runCli(['code', 'psss://Example Bank', '--json'], { box, fake: bad });
    assert.equal(JSON.parse(json.stdout).code, '123456', 'standard output stays clean JSON');
    const miss = await runCli(['search', 'zzz'], { box, fake: bad });
    assert.equal(miss.stderr, 'No items match "zzz".\n', 'a failed command warns about nothing');
    const open = await runCli(['search', 'bank'], { box, scenario: { items: ITEMS, keyFileReadableByOthers: true } });
    assert.match(open.stderr, /^warning: ~\/\.config\/psss\/keys\/Personal\.key can be read by\nother users\. Run: chmod 600 /, 'a key file other users can read is warned about, before the result');
  } finally {
    box.cleanup();
  }
});

test('no value reaches standard output or error except where documented: history --show, and the code of code', async () => {
  const box = sandbox();
  try {
    const fake = new FakeVaultService(
      scenarioFor(box, {
        items: [{ id: 'c0ffee01', title: 'Bank', username: 'robin', fields: { password: SECRET, code: '654321' }, earlier: { password: [{ replaced: at(2026, 1, 1, 0, 0), value: `${SECRET}-old` }] } }],
      }),
    );
    for (const argv of [['search', 'bank'], ['search', 'bank', '--json'], ['search', 'zzz'], ['history', 'psss://Bank'], ['history', 'psss://Bank', '--json'], ['history', 'psss://Bank/password'], ['history', 'psss://Bank/password', '--json'], ['history', 'psss://Bank/nope'], ['code', 'psss://Bank/password'], ['search', '--help'], ['history', '--help'], ['code', '--help']]) {
      const r = await runCli([...argv, '--verbose'], { box, fake, stdoutTty: true, stderrTty: true });
      assert.ok(!r.combined.includes(SECRET), `psss ${argv.join(' ')} must not print a stored value`);
    }
    const shown = await runCli(['history', 'psss://Bank/password', '--show'], { box, fake });
    assert.ok(shown.stdout.includes(`${SECRET}-old`), 'history --show prints the earlier value on standard output');
    assert.equal(shown.stderr, '', 'and nothing on standard error');
    const code = await runCli(['code', 'psss://Bank'], { box, fake, stderrTty: true });
    assert.ok(!code.stderr.includes('654321'), 'the code is on standard output only');
  } finally {
    box.cleanup();
  }
});

test('help for the three commands says what they print, and norm of the frames needs no trailing spaces', async () => {
  const box = sandbox();
  try {
    for (const [name, words] of [['search', /never searched/], ['history', /--show prints|--show/], ['code', /setup key/]] as const) {
      const r = await runCli([name, '--help'], { box, noService: true });
      assert.match(r.stdout, words, `psss ${name} --help`);
      assert.match(r.stdout, new RegExp(`^Usage: psss ${name} `), 'usage line');
    }
    assert.equal(norm('a  \nb'), 'a\nb');
  } finally {
    box.cleanup();
  }
});
