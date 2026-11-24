// KeePass import and export (src/keepass.ts and the importKdbx and exportKdbx methods of the vault).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newEntry, newDatabase, newGroup, readKdbx, writeKdbx, type KdbxDatabase } from '../../kdbx/src/index.ts';
import { openVault, seededRandom, FIELD_ROLE_ALIASES, readKeepass, buildKeepass, type Vault } from '../src/index.ts';
import { parseOtp, parseExpiry, hostOf, base32Encode, base32Decode, normalizedSecret } from '../src/keepass.ts';
import { newVault, tmp, WEAK } from './helpers.ts';

const FIXTURES = new URL('../../kdbx/fixtures/', import.meta.url).pathname;
const fixture = (name: string, password = 'fixture-password'): KdbxDatabase => readKdbx(new Uint8Array(readFileSync(join(FIXTURES, name))), { password });
const NOW = 1_700_000_000_000;

/** every file under a folder with its size and modification time: to prove that a dry run changed nothing */
function listing(dir: string): string[] {
  if (!existsSync(dir)) return ['(absent)'];
  const out: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else out.push(`${p} ${s.size} ${s.mtimeMs}`); } };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------- pieces

test('the alias table is the one in the Swift source', () => {
  const text = readFileSync(new URL('../../../App/Core/VaultItem.swift', import.meta.url), 'utf8');
  const block = /fileprivate var aliases: Set<String> \{[\s\S]*?\n    \}\n/.exec(text)?.[0] ?? '';
  assert.notEqual(block, '', 'FieldRole.aliases is where it was');
  const swift: Record<string, string[]> = {};
  for (const m of block.matchAll(/case \.(\w+): \[([^\]]*)\]/g)) swift[m[1]!] = [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  assert.deepEqual(Object.keys(swift).sort(), Object.keys(FIELD_ROLE_ALIASES).sort());
  for (const k of Object.keys(swift)) assert.deepEqual([...FIELD_ROLE_ALIASES[k]!].sort(), [...swift[k]!].sort(), `aliases of ${k}`);
});

test('verification code strings, expiries, hosts and Base32', () => {
  assert.equal(base32Encode(base32Decode('JBSWY3DPEHPK3PXP')!), 'JBSWY3DPEHPK3PXP');
  assert.equal(normalizedSecret('jbsw y3dp-ehpk 3pxp=='), 'JBSWY3DPEHPK3PXP');
  assert.equal(normalizedSecret('ABC'), null, 'fewer than 10 bytes is not a secret');
  const link = parseOtp('otpauth://totp/Example:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60&algorithm=SHA256');
  assert.ok(link.kind === 'setup' && link.otp.digits === 8 && link.otp.period === 60 && link.otp.algorithm === 2 && link.otp.issuer === 'Example' && link.otp.account === 'ada@example.com');
  const old = parseOtp('key=JBSWY3DPEHPK3PXP&size=7&step=45');
  assert.ok(old.kind === 'setup' && old.otp.digits === 7 && old.otp.period === 45);
  assert.equal(parseOtp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP').kind, 'unsupported');
  assert.equal(parseOtp('otpauth-migration://offline?data=x').kind, 'migration');
  assert.equal(parseOtp('https://example.com/2fa').kind, 'webLink');
  assert.deepEqual(parseExpiry('08/30'), { month: 8, year: 2030 });
  assert.deepEqual(parseExpiry('2030-08'), { month: 8, year: 2030 });
  assert.deepEqual(parseExpiry('0830'), { month: 8, year: 2030 });
  assert.equal(parseExpiry('13/30'), null);
  assert.equal(hostOf('https://www.Example.com:8443/login?x=1'), 'example.com');
  assert.equal(hostOf('not a url'), '');
});

// ---------------------------------------------------------------- reading

test('a fixture database reads as items, and says what it did not keep', () => {
  const r = readKeepass(fixture('kx41-recycled-attachment.kdbx'), { now: NOW });
  assert.equal(r.items.length, 5);
  assert.equal(r.trashed, 1, 'the Recycle Bin is left out');
  const login = r.items.find((i) => i.title === 'Example Login')!;
  assert.equal(login.type, 1);
  assert.deepEqual(login.websites, ['https://example.com/login']);
  assert.deepEqual(login.attachments.map((a) => a.name), ['report.bin']);
  assert.deepEqual([...login.tags].sort(), ['email', 'work']);
  assert.ok(login.custom.some((f) => f.label === 'PIN' && f.concealed), 'a PIN on a login is a hidden field of its own');
  assert.equal(login.previous.length, 2);
  assert.equal(r.items.find((i) => i.title === 'Client Notes')!.type, 3, 'no password and some notes is a secure note');
  assert.equal(r.inFolders, 3);
  assert.ok(r.issues.some((i) => i.kind === 'historyOtherFields'));
  for (const i of r.issues) assert.ok(!/fixture-password|hunter/.test(i.detail), 'a report never holds a value');
  const withTrash = readKeepass(fixture('kx41-recycled-attachment.kdbx'), { now: NOW, includeTrash: true });
  assert.equal(withTrash.items.length, 6);
  assert.equal(withTrash.items.filter((i) => i.deletedAt !== undefined).length, 1);
});

test('only the strings the app names as its own plumbing are dropped; any other PSSS_ string is a field, as in the app', () => {
  const db = newDatabase({ name: 'x', now: new Date(NOW) });
  const e = newEntry({ title: 'T', username: 'u', password: 'p', fields: [
    { name: 'PSSS_TYPE', value: 'login' }, { name: 'PSSS_FIELD_MAPPING', value: '{"kind":"login","keys":{}}' }, { name: 'PSSS_SOURCE', value: 'x' },
    { name: 'PSSS_IMPORT_HASHES', value: 'y' }, { name: 'PSSS_PASSKEY_CREATED', value: '2024-01-01T00:00:00Z' },
    { name: 'PSSS_DELETED_FROM', value: 'a' }, { name: 'PSSS_NOTE_TO_SELF', value: 'b' }, { name: 'KPEX_PASSKEY_X', value: 'z' },
    { name: 'Plain', value: 'kept' },
  ] }, { now: new Date(NOW) });
  db.root.entries.push(e);
  const item = readKeepass(db, { now: NOW }).items[0]!;
  assert.deepEqual(item.custom.map((f) => f.label), ['PSSS_DELETED_FROM', 'PSSS_NOTE_TO_SELF', 'KPEX_PASSKEY_X', 'Plain'], 'unknown PSSS_ and KPEX_ strings stay as fields');
});

test('a Wi-Fi network (PSSS_TYPE wifi) is a custom item with its name as username, Security and Hidden network as fields', () => {
  const db = newDatabase({ name: 'x', now: new Date(NOW) });
  db.root.entries.push(newEntry({ title: 'Home', username: 'HomeNet', password: 'wifi-secret', fields: [
    { name: 'PSSS_TYPE', value: 'wifi' }, { name: 'Security', value: 'WPA' }, { name: 'Hidden network', value: 'Yes' },
  ] }, { now: new Date(NOW) }));
  const item = readKeepass(db, { now: NOW }).items[0]!;
  assert.equal(item.type, 4, 'the record format has no Wi-Fi kind: it is a custom item');
  assert.equal(item.username, 'HomeNet');
  assert.equal(item.password, 'wifi-secret');
  assert.deepEqual(item.custom.map((f) => [f.label, f.value]), [['Security', 'WPA'], ['Hidden network', 'Yes']]);
});

test('characters XML cannot hold: refused with a warning, or stripped when asked', () => {
  const db = newDatabase({ name: 'x', now: new Date(NOW) });
  db.root.entries.push(newEntry({ title: 'Bad', username: 'u', password: 'p', fields: [{ name: 'Note\u0001', value: 'a\u0002b' }, { name: 'Fine', value: 'ok' }] }, { now: new Date(NOW) }));
  const refused = readKeepass(db, { now: NOW });
  assert.deepEqual(refused.items[0]!.custom.map((f) => f.label), ['Fine']);
  assert.equal(refused.refusedFields, 2);
  assert.ok(refused.issues.some((i) => i.kind === 'invalidCharacters' && i.item === 'Bad'));
  assert.equal(refused.invalidFields, 2, 'both were refused for their characters');
  assert.ok(!JSON.stringify(refused.issues).includes('\u0002'), 'the report holds no value');
  const stripped = readKeepass(db, { now: NOW, stripInvalid: true });
  assert.deepEqual(stripped.items[0]!.custom.map((f) => [f.label, f.value]), [['Note', 'ab'], ['Fine', 'ok']]);
  assert.equal(stripped.strippedFields, 2);
});

test('field kinds: card, note, custom item, mapped entries, passkey, second code', () => {
  const db = newDatabase({ name: 'x', now: new Date(NOW) });
  const now = new Date(NOW);
  db.root.entries.push(newEntry({ title: 'Visa', username: 'Ada Lovelace', password: '4111 1111 1111 1111', fields: [
    { name: 'PSSS_TYPE', value: 'card' }, { name: 'Expiry', value: '08/30' }, { name: 'Security code', value: '123', protected: true }, { name: 'PIN', value: '4321', protected: true },
    { name: 'Valid from', value: '08/25' }, { name: 'Card issuer', value: 'Bank' }, { name: 'Type', value: 'Visa' },
  ] }, { now }));
  db.root.entries.push(newEntry({ title: 'Mapped', fields: [
    { name: 'Num', value: '5500005555555559', protected: true }, { name: 'Exp', value: '1/29' }, { name: 'CVV', value: '999', protected: true }, { name: 'Holder', value: 'Grace' },
    { name: 'PIN', value: '1111', protected: true }, { name: 'Card issuer', value: 'Bank2' },
  ] }, { now }));
  db.root.entries[1]!.customData.push({ key: 'PSSS_FIELD_MAPPING', value: JSON.stringify({ kind: 'creditCard', keys: { 'cc-number': 'Num', 'cc-exp': 'Exp', 'cc-csc': 'CVV', 'cc-name': 'Holder' } }) });
  db.root.entries.push(newEntry({ title: 'Opaque', fields: [{ name: 'PSSS_TYPE', value: 'custom' }, { name: 'Serial', value: 'A1' }] }, { now }));
  db.root.entries.push(newEntry({ title: 'Twice', username: 'u', password: 'p', fields: [
    { name: 'otp', value: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP', protected: true }, { name: 'TimeOtp-Secret-Base32', value: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', protected: true },
  ] }, { now }));
  const r = readKeepass(db, { now: NOW });
  const [visa, mapped, opaque, twice] = r.items as [typeof r.items[0], typeof r.items[0], typeof r.items[0], typeof r.items[0]];
  assert.equal(visa.type, 2);
  assert.deepEqual(visa.card, { number: '4111111111111111', year: 2030, month: 8 });
  assert.equal(visa.cardholder, 'Ada Lovelace'); assert.equal(visa.cardCode, '123'); assert.equal(visa.cardPin, '4321');
  assert.deepEqual(visa.custom.map((f) => f.label), ['Valid from', 'Card issuer', 'Type'], 'a plain card keeps Valid from, Card issuer and Type as fields (the app shows them as fields of the card page)');
  assert.equal(mapped.type, 2);
  assert.deepEqual(mapped.card, { number: '5500005555555559', year: 2029, month: 1 });
  assert.equal(mapped.cardPin, undefined, 'a mapped card has no PIN slot');
  assert.deepEqual(mapped.custom.map((f) => f.label), ['PIN', 'Card issuer'], 'a mapped card keeps PIN and Card issuer as Other fields');
  assert.equal(opaque.type, 4);
  assert.ok(twice.otp);
  assert.ok(twice.custom.some((f) => f.label === 'TimeOtp-Secret-Base32' && f.concealed));
  assert.ok(r.issues.some((i) => i.kind === 'extraCode'));
});

// ---------------------------------------------------------------- importing into a vault

const openAgain = (e: ReturnType<typeof newVault>, readOnly = false): Vault =>
  openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: e.stateDir, now: e.clock.now, random: seededRandom('again'), ...(readOnly ? { readOnly: true } : {}) });

test('importing a file adds items with attachments, and importing it again changes nothing', (t) => {
  const e = newVault(t);
  const db = fixture('kx41-recycled-attachment.kdbx');
  const first = e.vault.importKdbx(db);
  assert.equal(first.added, 5);
  assert.equal(first.attachments, 1);
  assert.equal(first.skippedTrash, 1);
  assert.equal(e.vault.list().length, 5);
  const login = e.vault.get('psss://Example Login/password');
  assert.equal(login.kind, 'value');
  const before = e.vault.snapshot();
  e.clock.tick();
  const second = e.vault.importKdbx(db);
  assert.equal(second.added, 0);
  assert.equal(second.unchanged, 5);
  assert.deepEqual(e.vault.snapshot(), before, 'the second run wrote nothing');
  assert.equal(e.vault.list().length, 5, 'and so did not duplicate');
  // the attachment is stored and comes back byte for byte
  const original = db.root.groups.flatMap((g) => g.entries).concat(db.root.entries).find((x) => x.fields.find((f) => f.name === 'Title')?.value === 'Example Login')!.attachments[0]!;
  const item = e.vault.show('psss://Example Login/password').kind === 'found' ? (e.vault.show('psss://Example Login/password') as { item: { view: { attachments: { attachment: never }[] }; groupId: string } }).item : null;
  assert.ok(item);
  assert.deepEqual(e.vault.readAttachment(item.groupId, item.view.attachments[0]!.attachment), original.data);
  // and a fresh open reads the same items
  assert.equal(openAgain(e).list().length, 5);
});

test('a dry run plans the same and writes nothing, not even device state', (t) => {
  const e = newVault(t);
  const db = fixture('kx41-recycled-attachment.kdbx');
  e.vault.addItem({ title: 'Existing', password: 'x' });
  const before = [...listing(e.location), ...listing(e.stateDir)];
  const ro = openAgain(e, true);
  const plan = ro.importKdbx(db, { dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.added, 5);
  assert.equal(plan.attachments, 1);
  assert.deepEqual([...listing(e.location), ...listing(e.stateDir)], before, 'no file of the vault or the device state changed');
  assert.throws(() => ro.addItem({ title: 'No' }), (err: Error) => (err as { code?: string }).code === 'read_only');
  const real = e.vault.importKdbx(db);
  assert.equal(real.added, plan.added);
  assert.equal(real.attachments, plan.attachments);
  // a dry run into a state directory that does not exist creates none
  const fresh = openVault({ locations: [e.location], unlock: { keyFile: e.keyFile }, stateDir: join(e.dir, 'never-made'), readOnly: true });
  assert.equal(fresh.list().length, 6);
  assert.equal(existsSync(join(e.dir, 'never-made')), false);
});

test('what the person did here and what the file says: kept, updated on request, never brought back', (t) => {
  const e = newVault(t);
  const db = newDatabase({ name: 'src', now: new Date(NOW) });
  const mk = (title: string, password: string) => { const x = newEntry({ title, username: 'u', password }, { now: new Date(NOW) }); db.root.entries.push(x); return x; };
  const a = mk('Alpha', 'a1'), b = mk('Bravo', 'b1'), c = mk('Charlie', 'c1'), d = mk('Delta', 'd1'), f = mk('Foxtrot', 'f1');
  void f;
  assert.equal(e.vault.importKdbx(db).added, 5);
  e.clock.tick(); e.vault.setField('psss://Bravo/password', 'b-here');           // changed here only
  e.clock.tick(); e.vault.deleteItem('psss://Charlie/password');                           // deleted here
  e.clock.tick(); e.vault.deleteItem('psss://Delta/password'); e.vault.purgeItem('psss://Delta/password');   // deleted for good here
  a.fields.find((x) => x.name === 'Password')!.value = 'a-file';                  // changed in the file only
  b.fields.find((x) => x.name === 'Password')!.value = 'b-file';                  // changed in both ways
  c.fields.find((x) => x.name === 'Password')!.value = 'c-file';
  d.fields.find((x) => x.name === 'Password')!.value = 'd-file';
  e.clock.tick();
  const plain = e.vault.importKdbx(db);
  assert.deepEqual([plain.added, plain.updated, plain.changedInFile, plain.conflicts, plain.skippedDeleted, plain.skippedGone, plain.unchanged], [0, 0, 1, 1, 1, 1, 1]);
  assert.equal((e.vault.get('psss://Alpha/password') as { value: string }).value, 'a1', 'importing does not replace by default');
  assert.equal((e.vault.get('psss://Bravo/password') as { value: string }).value, 'b-here');
  e.clock.tick();
  const upd = e.vault.importKdbx(db, { update: true });
  assert.equal(upd.updated, 1);
  assert.equal((e.vault.get('psss://Alpha/password') as { value: string }).value, 'a-file');
  assert.equal((e.vault.get('psss://Bravo/password') as { value: string }).value, 'b-here', 'a change made here is never replaced');
  assert.equal(e.vault.list({ scope: 'deleted' }).length, 1, 'Charlie is still in Recently Deleted, Delta is gone');
  assert.equal(e.vault.list().some((i) => i.title === 'Delta'), false);
  e.clock.tick();
  assert.equal(e.vault.importKdbx(db, { update: true }).updated, 0, 'and a run after that has nothing to do');
});

test('a very large or odd entry is refused item by item, and the rest still comes in', (t) => {
  const e = newVault(t);
  const db = newDatabase({ name: 'x', now: new Date(NOW) });
  db.root.entries.push(newEntry({ title: 'Huge', username: 'u', password: 'p', notes: 'x'.repeat(300_000) }, { now: new Date(NOW) }));
  db.root.entries.push(newEntry({ title: 'Fine', username: 'u', password: 'p' }, { now: new Date(NOW) }));
  const r = e.vault.importKdbx(db);
  assert.equal(r.added, 2);
  assert.ok(r.issues.some((i) => i.kind === 'tooLarge' && i.item === 'Huge'));
  assert.equal(r.refusedFields, 1);
});

// ---------------------------------------------------------------- exporting, and the round trip

function fill(e: ReturnType<typeof newVault>): void {
  const v = e.vault;
  v.addItem({ title: 'Mail', username: 'ada', password: 'pw-1', url: 'mail.example.com', notes: 'line 1\nline 2', tags: { add: ['personal', 'email'] },
    otp: { secret: base32Decode('JBSWY3DPEHPK3PXP')!, digits: 6, period: 30, algorithm: 1, issuer: 'Mail', account: 'ada' },
    custom: { 'Recovery code': { value: 'abcd-efgh', concealed: true }, Account: { value: '42', concealed: false } } });
  e.clock.tick(); v.setField('psss://Mail/password', 'pw-2');
  e.clock.tick(); v.setField('psss://Mail/password', 'pw-3');
  e.clock.tick(); v.addItem({ type: 2, title: 'Visa', cardholder: 'Ada Lovelace', card: { number: '4111111111111111', year: 2030, month: 8 }, cardCode: '123', cardPin: '4321', custom: { Issuer: { value: 'Bank', concealed: false } } });
  e.clock.tick(); v.addItem({ type: 3, title: 'Wi-Fi', notes: 'the password is on the fridge' });
  e.clock.tick(); v.addItem({ type: 4, title: 'Safe', custom: { Combination: { value: '1-2-3', concealed: true } } });
  e.clock.tick(); v.addItem({ title: '', username: 'nameless', password: 'zzz', url: 'https://www.example.org/login' });
  e.clock.tick(); v.addItem({ title: 'Old', password: 'old' }); e.clock.tick(); v.deleteItem('psss://Old/password');
}

test('export writes a KeePass file that reads back, and importing that file elsewhere gives the same items', (t) => {
  const e = newVault(t);
  fill(e);
  const out = e.vault.exportKdbx();
  assert.equal(out.report.items, 5);
  assert.equal(out.report.deleted, 1);
  const bytes = writeKdbx(out.db, { password: 'export-pw' }, { version: '4.1' });
  const back = readKdbx(bytes, { password: 'export-pw' });
  const titles = back.root.groups.filter((g) => g.name !== 'Recycle Bin').flatMap((g) => g.entries).map((x) => x.fields.find((f) => f.name === 'Title')!.value).sort();
  assert.deepEqual(titles, ['Mail', 'Safe', 'Visa', 'Wi-Fi', 'example.org']);
  assert.equal(back.root.groups.find((g) => g.name === 'Recycle Bin')!.entries.length, 1);

  const other = newVault(t, {}, 'other');
  const r = other.vault.importKdbx(back, { includeTrash: true });
  assert.equal(r.added, 6);
  const same = (ref: string, field: string) => (other.vault.get(`${ref}/${field}`) as { value: string }).value;
  const orig = (ref: string, field: string) => (e.vault.get(`${ref}/${field}`) as { value: string }).value;
  for (const [ref, field] of [['psss://Mail', 'password'], ['psss://Mail', 'username'], ['psss://Mail', 'url'], ['psss://Mail', 'notes'], ['psss://Mail', 'Recovery code'], ['psss://Mail', 'Account'],
    ['psss://Visa', 'card'], ['psss://Visa', 'card_code'], ['psss://Visa', 'cardholder'], ['psss://Wi-Fi', 'notes'], ['psss://Safe', 'Combination']] as const) {
    assert.equal(same(ref, field), orig(ref, field), `${ref}/${field}`);
  }
  const a = e.vault.show('psss://Mail/password'), b = other.vault.show('psss://Mail/password');
  assert.ok(a.kind === 'found' && b.kind === 'found');
  assert.deepEqual(b.item.view.otp, a.item.view.otp, 'the verification code');
  assert.deepEqual(b.item.view.tags.map((x) => x.text), a.item.view.tags.map((x) => x.text));
  assert.deepEqual(b.item.view.previousPasswords.map((p) => p.value), ['pw-2', 'pw-1']);
  assert.deepEqual(b.item.view.card ?? null, a.item.view.card ?? null);
  const visa = other.vault.show('psss://Visa/password'); assert.ok(visa.kind === 'found');
  assert.equal(visa.item.view.card?.year, 2030); assert.equal(visa.item.view.cardPin, '4321'); assert.equal(visa.item.type, 2);
  assert.equal(other.vault.show('psss://Safe/password').kind === 'found' && (other.vault.show('psss://Safe/password') as { item: { type: number } }).item.type, 4);
  assert.equal(other.vault.list({ scope: 'deleted' }).length, 1);
  // the nameless login has no title again, and its host is its name
  assert.ok(other.vault.list().some((i) => i.title === 'https://www.example.org/login' && i.type === 1));
  // importing the export into the vault it came from finds its own items
  e.clock.tick();
  const again = e.vault.importKdbx(back, { includeTrash: true });
  assert.equal(again.added, 0, 'no duplicates in the vault the file came from');
});

test('export keeps attachments and says what does not travel', (t) => {
  const e = newVault(t);
  const src = newDatabase({ name: 'src', now: new Date(NOW) });
  const x = newEntry({ title: 'WithFile', password: 'p' }, { now: new Date(NOW) });
  x.attachments.push({ name: 'a.bin', data: new Uint8Array([1, 2, 3, 4]), protected: false }, { name: 'big.bin', data: new Uint8Array(1_500_000).fill(7), protected: false });
  src.root.entries.push(x);
  e.vault.importKdbx(src);
  const out = e.vault.exportKdbx();
  assert.equal(out.report.attachments, 2);
  assert.deepEqual(out.report.doesNotTravel, [], 'a vault with no other people loses nothing the report lists');
  const entry = out.db.root.groups[0]!.entries[0]!;
  assert.deepEqual(entry.attachments.map((a) => [a.name, a.data.length]), [['a.bin', 4], ['big.bin', 1_500_000]]);
});

test('export refuses a field with characters XML cannot hold, unless asked to strip them', (t) => {
  const e = newVault(t);
  e.vault.addItem({ title: 'Odd', password: 'p', custom: { Note: { value: 'a\u0001b', concealed: false } } });
  const refused = e.vault.exportKdbx();
  assert.equal(refused.report.refusedFields, 1);
  assert.ok(refused.report.issues.some((i) => i.kind === 'fieldRefused' && i.item === 'Odd'));
  const entry = refused.db.root.groups[0]!.entries[0]!;
  assert.equal(entry.fields.some((f) => f.name === 'Note'), false);
  const stripped = e.vault.exportKdbx({ stripInvalid: true });
  assert.equal(stripped.db.root.groups[0]!.entries[0]!.fields.find((f) => f.name === 'Note')!.value, 'ab');
  writeKdbx(stripped.db, { password: 'x' }, { version: '4.1' });
});

test('a field named like a KeePass field is renamed and reported', (t) => {
  const e = newVault(t);
  e.vault.addItem({ title: 'Clash', password: 'p', custom: { Title: { value: 'mine', concealed: false }, PSSS_TYPE: { value: 'x', concealed: false } } });
  const out = e.vault.exportKdbx();
  const names = out.db.root.groups[0]!.entries[0]!.fields.map((f) => f.name);
  assert.equal(names.filter((n) => n === 'Title').length, 1);
  assert.ok(names.includes('Title (field)'));
  assert.equal(out.report.issues.filter((i) => i.kind === 'renamedField').length, 2);
});

test('a vault shared with other people says so', (t) => {
  const e = newVault(t);
  e.vault.addItem({ title: 'One', password: 'p' });
  const out = buildKeepass([], { name: 'x' });
  assert.equal(out.counts.items, 0);
  assert.equal(e.vault.exportKdbx().report.groupsShared, false);
});

// ---------------------------------------------------------------- the real KeePassXC

const CLI = '/opt/homebrew/bin/keepassxc-cli';
const haveCli = existsSync(CLI);
const xc = (args: string[], input: string) => spawnSync(CLI, args, { input, encoding: 'utf8' });

test('keepassxc-cli reads our export: ls, show -s, attachment-export, tags and the verification code', { skip: !haveCli }, (t) => {
  const e = newVault(t);
  fill(e);
  const src = newDatabase({ name: 'src', now: new Date(NOW) });
  const x = newEntry({ title: 'Doc', password: 'p' }, { now: new Date(NOW) });
  x.attachments.push({ name: 'note.txt', data: new TextEncoder().encode('hello attachment'), protected: false });
  src.root.entries.push(x);
  e.vault.importKdbx(src);
  const out = e.vault.exportKdbx();
  const dir = tmp(t);
  const file = join(dir, 'out.kdbx');
  writeFileSync(file, writeKdbx(out.db, { password: 'export-pw' }, { version: '4.1' }));
  const ls = xc(['ls', '-R', '-f', file], 'export-pw\n');
  assert.equal(ls.status, 0, ls.stderr);
  for (const n of ['Mail', 'Visa', 'Wi-Fi', 'Safe', 'Doc']) assert.match(ls.stdout, new RegExp(n));
  const show = xc(['show', '-s', '-a', 'Password', '-a', 'UserName', '-a', 'Recovery code', file, 'Only Me/Mail'], 'export-pw\n');
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(show.stdout.trim().split('\n'), ['pw-3', 'ada', 'abcd-efgh']);
  const totp = xc(['show', '-t', file, 'Only Me/Mail'], 'export-pw\n');
  assert.equal(totp.status, 0, totp.stderr);
  assert.match(totp.stdout.trim().split('\n').pop()!, /^[0-9]{6}$/);
  const att = join(dir, 'att.txt');
  const exp = xc(['attachment-export', file, 'Only Me/Doc', 'note.txt', att], 'export-pw\n');
  assert.equal(exp.status, 0, exp.stderr);
  assert.equal(readFileSync(att, 'utf8'), 'hello attachment');
  const bin = xc(['ls', '-R', '-f', file], 'export-pw\n');
  assert.match(bin.stdout, /Recycle Bin\/[\s\S]*Old/);
});

test('a database made by keepassxc-cli imports: custom attributes, attachment, tags, and again changes nothing', { skip: !haveCli }, (t) => {
  const dir = tmp(t);
  const file = join(dir, 'made.kdbx');
  const run = (args: string[], input: string) => { const r = xc(args, input); assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`); return r; };
  run(['db-create', '-p', file], 'kp-pw\nkp-pw\n');
  run(['add', '-u', 'ada', '--url', 'https://login.example.com', '-p', file, 'Site'], 'kp-pw\nsite-secret\n');
  run(['mkdir', file, 'Work'], 'kp-pw\n');
  run(['add', '-u', 'bob', file, 'Work/Tool'], 'kp-pw\n');
  const att = join(dir, 'in.txt'); writeFileSync(att, 'attached bytes');
  run(['attachment-import', file, 'Site', 'in.txt', att], 'kp-pw\n');
  const db = readKdbx(new Uint8Array(readFileSync(file)), { password: 'kp-pw' });
  // custom attributes and tags: the cli cannot set them on every version, so add them to the model and write the file again
  const site = db.root.entries.find((x) => x.fields.find((f) => f.name === 'Title')?.value === 'Site')!;
  site.fields.push({ name: 'Account', value: 'A-1', protected: false }, { name: 'Recovery', value: 'r-2', protected: true });
  site.tags = ['t1', 't2'];
  const file2 = join(dir, 'made2.kdbx');
  writeFileSync(file2, writeKdbx(db, { password: 'kp-pw' }));
  const check = xc(['show', '-s', '-a', 'Recovery', file2, 'Site'], 'kp-pw\n');
  assert.equal(check.stdout.trim(), 'r-2', 'keepassxc-cli itself reads the file we made');
  const e = newVault(t);
  const db2 = readKdbx(new Uint8Array(readFileSync(file2)), { password: 'kp-pw' });
  const r = e.vault.importKdbx(db2);
  assert.equal(r.added, 2);
  assert.equal(r.attachments, 1);
  assert.equal(r.inFolders, 1);
  const shown = e.vault.show('psss://Site/password');
  assert.ok(shown.kind === 'found');
  assert.equal(shown.item.view.password, 'site-secret');
  assert.deepEqual(shown.item.view.websites.map((w) => w.address), ['https://login.example.com']);
  assert.deepEqual(shown.item.view.customFields.map((f) => [f.label, f.value, f.concealed]), [['Account', 'A-1', false], ['Recovery', 'r-2', true]]);
  assert.deepEqual(shown.item.view.tags.map((x) => x.text), ['t1', 't2']);
  assert.equal(shown.item.view.attachments[0]!.fileName, 'in.txt');
  assert.equal(new TextDecoder().decode(e.vault.readAttachment(shown.item.groupId, shown.item.view.attachments[0]!.attachment)), 'attached bytes');
  e.clock.tick();
  assert.equal(e.vault.importKdbx(db2).unchanged, 2);
});

void [newGroup, execFileSync, WEAK];
