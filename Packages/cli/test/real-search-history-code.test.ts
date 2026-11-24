// search, history and code through the real binary on real vault folders: ranking and fields, dates, codes checked against RFC 6238 and keepassxc-cli,
// hostile names, a vault of 5,000 items, and a vault with a record that fails its checks.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { newDatabase, newEntry, writeKdbx } from '../../kdbx/src/index.ts';
import { totp } from '../../vault/src/index.ts';
import { device, segments, SECRET } from './real-helpers.ts';
import type { Device } from './real-helpers.ts';

const XC = '/opt/homebrew/bin/keepassxc-cli';
const RLO = '\u202e';
const hidden = (text: string) => /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2028\u2029]/.test(text);
/** The ASCII secret of the RFC 6238 vectors: 20 bytes for SHA-1, 32 for SHA-256, 64 for SHA-512. */
const seed = (n: number) => new TextEncoder().encode('1234567890'.repeat(7).slice(0, n));

function vault(t: TestContext): Device {
  const d = device(t);
  assert.equal(d.psss(['init', 'Personal', '--no-recovery']).code, 0, 'setup: init should work');
  return d;
}
const set = (d: Device, ref: string, value: string, create = true) => assert.equal(d.psss(['set', ...(create ? ['--create'] : []), ref], { stdin: value }).code, 0, `setup: set ${ref}`);

test('search: finds by name, username and website only, in title order, with ids for a shared name, and never reads a value', (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  lib.addItem({ title: 'Example Bank', username: 'robin@example.com', password: 'unique-bank-pw', url: 'https://bank.example', notes: 'notes-only-needle' });
  lib.addItem({ title: 'Example', username: 'robin@example.com', password: 'p1' });
  lib.addItem({ title: 'example', username: 'sam@example.com', password: 'p2' });
  lib.addItem({ title: 'Caf\u00e9 Noir', username: 'amelie', password: 'p3', url: 'https://cafe-noir.example/login', tags: { add: ['tag-only-needle'] }, custom: { 'label-only-needle': 'value-only-needle' } });
  const bank = d.psss(['search', 'bank']);
  assert.equal(bank.code, 0, bank.stderr);
  assert.equal(bank.stdout, 'Example Bank   robin@example.com    password, notes\n', 'a name match, with the account and the field names');
  const ex = d.psss(['search', 'EXAMPLE']);
  const lines = ex.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 4, 'every item whose name, username or website holds the text');
  assert.match(lines[0]!, /^Caf\u00e9 Noir {2,}amelie {2,}password, label-only-needle$/, 'in title order (accents sort with their letter); found by its website text "example"');
  assert.match(lines[1]!, /^(Example|example) {2,}(robin|sam)@example\.com {2,}id:[0-9a-f]{8} {2,}password$/, 'the shared name has an id');
  assert.match(lines[2]!, /^(Example|example) {2,}(robin|sam)@example\.com {2,}id:[0-9a-f]{8} {2,}password$/, 'and so does its twin');
  assert.match(lines[3]!, /^Example Bank {2,}robin@example\.com {2,}password, notes$/, 'an item with a unique name has none');
  const ids = lines.slice(1, 3).map((l) => /id:([0-9a-f]{8})/.exec(l)![1]);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(d.psss(['get', `psss://id:${ids[0]}/username`]).code, 0, 'the id works in a reference');
  assert.match(d.psss(['search', 'cafe noir']).stdout, /^Caf\u00e9 Noir/, 'accents and case are ignored');
  assert.match(d.psss(['search', 'cafe-noir.example']).stdout, /^Caf\u00e9 Noir/, 'a website is found by its text');
  assert.match(d.psss(['search', 'amelie']).stdout, /^Caf\u00e9 Noir/, 'a username is found');
  for (const needle of ['unique-bank-pw', 'notes-only-needle', 'tag-only-needle', 'label-only-needle', 'value-only-needle']) {
    const r = d.psss(['search', needle]);
    assert.equal(r.code, 3, `"${needle}" is a secret, a note, a tag or a custom field: search never reads it`);
    assert.equal(r.stderr, `No items match "${needle}".\n`);
    assert.equal(r.stdout, '', 'nothing on standard output');
  }
  const near = d.psss(['search', 'exampel']);
  assert.equal(near.code, 3);
  assert.equal(near.stderr, 'No items match "exampel".\nDid you mean: example, Example, Example Bank?\n', 'near misses are text, never a result');
  const json = JSON.parse(d.psss(['search', 'bank', '--json']).stdout) as { items: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(json.items[0]!), ['id', 'title', 'username', 'url', 'group', 'fields'], 'the same item shape as list --json');
  assert.deepEqual(d.psss(['search', 'bank', '--json']).stdout, JSON.stringify(JSON.parse(d.psss(['search', 'bank', '--json']).stdout), null, 2) + '\n', 'indented JSON, one document');
  assert.equal(d.psss(['search']).code, 2, 'no text is a usage error');
  assert.equal(d.psss(['search', 'a', 'b']).code, 2, 'two words are a usage error');
  assert.equal(d.psss(['search', 'bank', '--group', 'Nope']).code, 3, 'an unknown group exits 3');
  assert.equal(d.psss(['rm', 'psss://Example Bank']).code, 0);
  assert.equal(d.psss(['search', 'bank']).code, 3, 'a deleted item is not found');
  assert.match(d.psss(['search', 'bank', '--deleted']).stdout, /^Example Bank/, '--deleted finds it in Recently Deleted');
  // (a search for the text itself echoes it on standard error: that is the person's own argument)
  for (const r of d.log) assert.ok(!/unique-bank-pw|notes-only-needle/.test(r.stdout + (r.argv.some((a) => /needle|unique-bank-pw/.test(a)) ? '' : r.stderr)), 'no value in any output');
});

test('history: changes with dates and fields and never a value; a field lists its earlier values only with --show; Recently Deleted and ambiguity', (t) => {
  const d = vault(t);
  const before = Date.now();
  set(d, 'psss://Bank/password', 'pw-one-4f9c');
  set(d, 'psss://Bank/password', 'pw-two-77aa', false);
  set(d, 'psss://Bank/password', 'pw-three-1c2d', false);
  set(d, 'psss://Bank/username', 'robin', false);
  set(d, 'psss://Bank/Branch', 'north', false);
  set(d, 'psss://Bank/username', 'sam', false);
  const after = Date.now();

  const changes = d.psss(['history', 'psss://Bank']);
  assert.equal(changes.code, 0, changes.stderr);
  const rows = changes.stdout.trimEnd().split('\n');
  assert.equal(rows.length, 6, `one row per write, none folded: ${changes.stdout}`);
  const shape = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC {2}(.*)$/;
  assert.deepEqual(
    rows.map((r) => shape.exec(r)![2]),
    ['Changed username', 'Changed Branch', 'Changed username', 'Changed password', 'Changed password', 'Added'],
    'newest first: sam, north, robin, the two later passwords, then the creation (a custom field is named by its label)',
  );
  const stamp = (row: string) => Date.parse(`${shape.exec(row)![1]!.replace(' ', 'T')}:00Z`);
  assert.ok(stamp(rows[0]!) >= Math.floor(before / 60_000) * 60_000 && stamp(rows[0]!) <= after, 'the dates are the real ones, in UTC');
  assert.ok(!/pw-|sam|robin|north/.test(changes.stdout + changes.stderr), 'no value anywhere');

  const field = d.psss(['history', 'psss://Bank/password']);
  assert.match(field.stdout, /^(Replaced \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\n){2}$/, 'two earlier passwords, with dates and no value');
  assert.equal(field.stderr, '', 'no hint into a pipe');
  assert.ok(!/pw-/.test(field.stdout));
  const shown = d.psss(['history', 'psss://Bank/password', '--show']);
  assert.deepEqual(shown.stdout.trimEnd().split('\n').map((l) => l.replace(/^Replaced .* UTC {2}/, '')), ['pw-two-77aa', 'pw-one-4f9c'], 'newest first, never the current password');
  const json = JSON.parse(d.psss(['history', 'psss://Bank/password', '--json', '--show']).stdout) as { field: string; earlier: Array<{ replaced: string; value: string }> };
  assert.deepEqual(json.earlier.map((e) => e.value), ['pw-two-77aa', 'pw-one-4f9c']);
  assert.ok(json.earlier.every((e) => Date.parse(e.replaced) >= before - 1000 && Date.parse(e.replaced) <= after + 1000), 'ISO dates');
  const plain = d.psss(['history', 'psss://Bank/password', '--json']);
  assert.ok(!/pw-/.test(plain.stdout), 'no value in JSON without --show');
  const user = d.psss(['history', 'psss://Bank/username', '--show']);
  assert.deepEqual(user.stdout.trimEnd().split('\n').map((l) => l.replace(/^Replaced .* UTC {2}/, '')), ['robin'], 'another field keeps its earlier writes');
  const custom = d.psss(['history', 'psss://Bank/Branch']);
  assert.equal(custom.code, 0, 'a custom field by its label');
  assert.equal(custom.stdout, '', 'with no earlier value');
  assert.equal(custom.stderr, '"Bank" has no earlier value of "Branch".\n');
  const nofield = d.psss(['history', 'psss://Bank/nothing']);
  assert.equal(nofield.code, 3);
  assert.equal(nofield.stderr, '"Bank" has no field called "nothing".\nIt has: password, Branch.\n');
  assert.equal(d.psss(['history', 'psss://Bank', '--show']).code, 2, '--show needs a field');
  assert.equal(d.psss(['history', 'psss://Banc']).code, 3, 'no such item');

  assert.equal(d.psss(['rm', 'psss://Bank']).code, 0);
  const gone = d.psss(['history', 'psss://Bank']);
  assert.equal(gone.code, 0, 'an item in Recently Deleted has a history');
  assert.match(gone.stdout.split('\n')[0]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC {2}Moved to Recently Deleted$/, 'the move is the newest change');
  assert.match(gone.stderr, /^"Bank" is in Recently Deleted\. Bring it back with: psss restore psss:\/\/id:[0-9a-f]+\n$/);
  assert.equal(d.psss(['restore', 'psss://Bank']).code, 0);
  assert.match(d.psss(['history', 'psss://Bank']).stdout.split('\n')[0]!, /Restored from Recently Deleted$/);

  const lib = d.library('Personal');
  lib.addItem({ title: 'Twin', password: 'a' });
  lib.addItem({ title: 'twin', password: 'b' });
  const twin = d.psss(['history', 'psss://Twin']);
  assert.equal(twin.code, 3, 'two items with one name: ambiguous');
  assert.match(twin.stderr, /^"Twin" matches 2 items in Personal\. Use one of these:\n {2}psss:\/\/id:[0-9a-f]{32} /);
});

test('code: the real code for SHA-1, SHA-256 and SHA-512, digits and period, equal to RFC 6238 and to keepassxc-cli; never the setup key', (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  const cases = [
    { title: 'Sha1', otp: { secret: seed(20), digits: 6, period: 30, algorithm: 1 as const } },
    { title: 'Sha256', otp: { secret: seed(32), digits: 8, period: 60, algorithm: 2 as const } },
    { title: 'Sha512', otp: { secret: seed(64), digits: 7, period: 45, algorithm: 3 as const } },
  ];
  for (const c of cases) lib.addItem({ title: c.title, username: 'robin', password: 'not-the-code', otp: c.otp });
  for (const c of cases) {
    const t0 = Date.now();
    const r = d.psss(['code', `psss://${c.title}`]);
    const t1 = Date.now();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^\\d{${c.otp.digits}}\\n$`), `${c.title}: just the code and a line break`);
    assert.equal(r.stderr, '', 'no terminal on standard error: nothing there');
    const code = r.stdout.trim();
    assert.ok([totp(c.otp, t0).code, totp(c.otp, t1).code].includes(code), `${c.title}: ${code} is the RFC 6238 code for its algorithm, digits and period`);
    const j = JSON.parse(d.psss(['code', `psss://${c.title}/code`, '--json']).stdout) as { reference: string; code: string; period: number; remaining: number; item: { title: string } };
    assert.equal(j.period, c.otp.period, 'the period');
    assert.ok(j.remaining >= 1 && j.remaining <= c.otp.period, 'the seconds left');
    assert.match(j.reference, /^psss:\/\/id:[0-9a-f]{32}\/code$/);
    assert.equal(j.item.title, c.title);
  }
  const setupKey = Buffer.from(seed(20)).toString('base64');
  for (const r of d.log) assert.ok(!(r.stdout + r.stderr).includes('1234567890123456') && !(r.stdout + r.stderr).includes(setupKey), 'the setup key is never printed');

  const none = d.psss(['code', 'psss://Nothing']);
  assert.equal(none.code, 3);
  set(d, 'psss://Plain/password', 'pw-plain');
  const noCode = d.psss(['code', 'psss://Plain']);
  assert.equal(noCode.code, 3, 'an item with no verification code exits 3');
  assert.equal(noCode.stderr, '"Plain" has no verification code.\nIt has: password.\n');
  assert.equal(noCode.stdout, '');
  set(d, 'psss://Plain/code', '999999', false);
  const stored = d.psss(['code', 'psss://Plain']);
  assert.equal(stored.code, 3, 'a stored field that is only called "code" is a value and not a verification code');
  assert.equal(stored.stdout, '', 'so it is not printed by code');
  assert.equal(d.psss(['get', 'psss://Plain/code']).stdout, '999999', '(get still reads it)');
  assert.equal(d.psss(['code', 'psss://Sha1/password']).code, 2, 'another field is a usage error');
  assert.ok(!d.log.slice(-1)[0]!.stdout.includes('not-the-code'));
});

test('code equals keepassxc-cli show -t for a code of an imported KeePass entry', (t) => {
  const d = vault(t);
  const db = newDatabase({ name: 'src', now: new Date() });
  const link = (secret: string, extra: string) => `otpauth://totp/Bank:robin?secret=${secret}&issuer=Bank${extra}`;
  const b32 = (bytes: Uint8Array) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    return out;
  };
  const entries: Array<[string, string]> = [
    ['Kp1', link(b32(seed(20)), '')],
    ['Kp256', link(b32(seed(32)), '&algorithm=SHA256&digits=8&period=60')],
    ['Kp512', link(b32(seed(64)), '&algorithm=SHA512&digits=6&period=30')],
  ];
  for (const [title, otp] of entries) db.root.entries.push(newEntry({ title, username: 'u', password: 'p', fields: [{ name: 'otp', value: otp, protected: true }] }, { now: new Date() }));
  const file = path.join(d.cwd, 'Codes.kdbx');
  writeFileSync(file, writeKdbx(db, { password: 'file-pw' }, { version: '4.1' }));
  const pwFile = path.join(d.root, 'pw.txt');
  writeFileSync(pwFile, 'file-pw\n', { mode: 0o600 });
  assert.equal(d.psss(['import', file], { env: { PSSS_KDBX_PASSWORD_FILE: pwFile } }).code, 0, 'setup: import');
  for (const [title] of entries) {
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const x = spawnSync(XC, ['show', '-q', '-t', file, title], { input: 'file-pw\n', encoding: 'utf8' });
      const mine = d.psss(['code', `psss://${title}`]);
      const again = spawnSync(XC, ['show', '-q', '-t', file, title], { input: 'file-pw\n', encoding: 'utf8' });
      assert.equal(x.status, 0, x.stderr);
      assert.equal(mine.code, 0, mine.stderr);
      // the same step on both sides of ours: the three agree (a step that ended in between is tried again)
      if (x.stdout.trim() === again.stdout.trim()) {
        assert.equal(mine.stdout.trim(), x.stdout.trim(), `${title}: psss code and keepassxc-cli show -t agree`);
        ok = true;
      }
    }
    assert.ok(ok, `${title}: a stable step was found to compare`);
  }
});

test('hostile names: a title with a direction mark, a line break and a fake warning forges no line in search, history or code, in text or JSON', (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  const evil = `Evil\nwarning: forged ${RLO}gnp.exe ${'x'.repeat(80)}`;
  lib.addItem({ title: evil, username: `us${RLO}er\nx`, password: 'p', custom: { [`la${RLO}bel`]: 'v' }, otp: { secret: seed(20), digits: 6, period: 30, algorithm: 1 } });
  lib.addItem({ title: `Ex${RLO}ample`, password: 'p2' });
  const search = d.psss(['search', 'evil']);
  assert.equal(search.code, 0, search.stderr);
  assert.ok(!hidden(search.stdout), 'no raw direction mark');
  assert.equal(search.stdout.trimEnd().split('\n').length, 1, 'a line break in a title is one line of output');
  assert.match(search.stdout, /^Evil\\u\{a\}warning: forged \\u\{202e\}gnp\.exe x+\u2026 /, 'escaped and cut to 60 characters');
  const json = d.psss(['search', 'evil', '--json']);
  assert.ok(!hidden(json.stdout) && JSON.parse(json.stdout).items[0].title.startsWith('Evil\\u{a}warning: forged \\u{202e}gnp.exe'), 'escaped in JSON');
  assert.ok(!hidden(d.psss(['search', `Exam${RLO}`]).stderr), 'the searched text is escaped in the error');
  const near = d.psss(['search', `Exampl${RLO}e`]);
  assert.equal(near.stderr, 'No items match "Exampl\\u{202e}e".\nDid you mean: Ex\\u{202e}ample?\n');
  const id = JSON.parse(json.stdout).items[0].id as string;
  const history = d.psss(['history', `psss://id:${id}`]);
  assert.equal(history.stdout.trimEnd().split('\n').length, 1, 'one change, one line');
  const hj = d.psss(['history', `psss://id:${id}`, '--json']);
  assert.ok(!hidden(hj.stdout) && !hidden(history.stdout + history.stderr), 'no raw mark in history');
  const code = d.psss(['code', `psss://id:${id}`]);
  assert.equal(code.code, 0, code.stderr);
  assert.match(code.stdout, /^\d{6}\n$/);
  const cj = d.psss(['code', `psss://id:${id}`, '--json']);
  assert.ok(!hidden(cj.stdout), 'no raw mark in the JSON of code');
  const nocode = d.psss(['code', `psss://Ex%E2%80%AEample`]);
  assert.equal(nocode.code, 3);
  assert.ok(!hidden(nocode.stderr), nocode.stderr);
});

test('search of 5,000 items finds the right ones and costs no more than listing them', { timeout: 600_000 }, (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  const now = new Date(1_700_000_000_000);
  const db = newDatabase({ name: 'big', now });
  for (let i = 0; i < 5000; i++) db.root.entries.push(newEntry({ title: `Item ${i}`, username: `user${i}@example.com`, password: `pw-${i}`, url: `https://site${i}.example` }, { now }));
  assert.equal(lib.importKdbx(db).added, 5000, 'setup: 5,000 items');
  const t0 = Date.now();
  const list = d.psss(['list']);
  const listMs = Date.now() - t0;
  assert.equal(list.stdout.trimEnd().split('\n').length, 5000, 'setup: list shows them all');
  const t1 = Date.now();
  const hit = d.psss(['search', 'site4999.example']);
  const searchMs = Date.now() - t1;
  assert.equal(hit.stdout.trimEnd().split('\n').length, 1, 'one item');
  assert.match(hit.stdout, /^Item 4999 /);
  const t2 = Date.now();
  const many = d.psss(['search', 'ITEM 12']);
  const manyMs = Date.now() - t2;
  assert.equal(many.stdout.trimEnd().split('\n').length, 111, '"item 12": 12, 120 to 129, 1200 to 1299');
  assert.ok(!/pw-/.test(many.stdout + hit.stdout), 'no value');
  const none = d.psss(['search', 'nowhere']);
  assert.equal(none.code, 3);
  assert.equal(none.stderr, 'No items match "nowhere".\n');
  // opening a vault of this size is most of the time of any command; the search itself must not add to it
  assert.ok(searchMs <= listMs * 1.5 + 3000, `search took ${searchMs} ms, list ${listMs} ms`);
  assert.ok(manyMs <= listMs * 1.5 + 3000, `a search that finds 111 items took ${manyMs} ms, list ${listMs} ms`);
});

test('a vault with a record that fails its checks still reads: search, history and code print their result, warn once on standard error and exit 0', (t) => {
  const d = vault(t);
  const lib = d.library('Personal');
  lib.addItem({ title: 'Example Bank', username: 'robin', password: 'bank-pw', otp: { secret: seed(20), digits: 6, period: 30, algorithm: 1 } });
  for (const v of ['a', 'b', 'c']) set(d, 'psss://Example Bank/password', v, false);
  set(d, 'psss://Other/password', 'o');
  assert.equal(d.psss(['verify']).code, 0, 'setup: the vault verifies');
  const target = segments(d.vaultPath('Personal')).pop()!;
  const bytes = readFileSync(target);
  bytes[bytes.length - 20] ^= 0x01;
  writeFileSync(target, bytes);
  assert.equal(d.psss(['verify']).code, 2, 'setup: now verify fails');
  const result = 'warning: "Personal" has a problem, so the result above may be\nout of date. Run psss verify to see what is wrong.\n';
  const search = d.psss(['search', 'example']);
  assert.equal(search.code, 0, search.stderr);
  assert.match(search.stdout, /^Example Bank /);
  assert.equal(search.stderr, result, 'the warning of frame A11, in the words for a result');
  const history = d.psss(['history', 'psss://Example Bank']);
  assert.equal(history.code, 0, history.stderr);
  assert.ok(history.stdout.trimEnd().split('\n').length >= 2, 'a history is still shown');
  assert.equal(history.stderr, result);
  const code = d.psss(['code', 'psss://Example Bank']);
  assert.equal(code.code, 0, code.stderr);
  assert.match(code.stdout, /^\d{6}\n$/);
  assert.equal(code.stderr, 'warning: "Personal" has a problem, so the value above may be\nout of date. Run psss verify to see what is wrong.\n');
  assert.ok(!(search.stdout + search.stderr + history.stdout + code.stderr).includes('bank-pw'));
});

test('no value leaves the real binary except where documented', (t) => {
  const d = vault(t);
  set(d, 'psss://Example API/token', SECRET);
  set(d, 'psss://Example API/token', `${SECRET}-2`, false);
  for (const argv of [['search', 'example'], ['search', 'example', '--json'], ['history', 'psss://Example API'], ['history', 'psss://Example API', '--json'], ['history', 'psss://Example API/token'], ['history', 'psss://Example API/token', '--json'], ['code', 'psss://Example API']]) {
    const r = d.psss([...argv, '--verbose']);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET), `psss ${argv.join(' ')} must not print a stored value`);
  }
  const shown = d.psss(['history', 'psss://Example API/token', '--show']);
  assert.ok(shown.stdout.includes(SECRET) && !shown.stdout.includes(`${SECRET}-2`), '--show prints the earlier value, and not the current one');
  assert.equal(shown.stderr, '');
});
