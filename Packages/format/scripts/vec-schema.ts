// Vectors for the item schema (docs/format-schema.md, draft 1): vectors/schema.json. Every expectation below is written by hand from the
// schema's own sentences; `Out.add` asserts that the library agrees (a disagreement means a mistake here or a bug there).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fromHex } from '../src/bytes.ts';
import { cmap, type CborValue } from '../src/cbor.ts';
import { ItemChange } from '../src/schema.ts';
import type { OrderKey } from '../src/record.ts';
import { toNotation } from '../test/notation.ts';
import { H, Out, file } from './vec-common.ts';
import type { J } from './vec-common.ts';

const AUTH = { A: 'aa'.repeat(32), B: 'bb'.repeat(32) };
const DEV = { 1: '11'.repeat(16), 2: '22'.repeat(16), 3: '33'.repeat(16) } as const;
type Who = 'A' | 'B';
type Dev = 1 | 2 | 3;
/** What a spec writes: `at(n)` is the place in the order of spec number `n` (an earlier one), `self` is this spec's own number. */
type Writes = (c: ItemChange, at: (n: number) => OrderKey, self: number) => void;
type Spec = [who: Who, dev: Dev, wall: number, f: Writes, counter?: number] | J;

/** Changes of one item, readable: each spec is (author, device, wall_ms, what to write); `seq` counts per author and device. */
const L = (...specs: Spec[]): J[] => {
  const seq = new Map<string, number>();
  const places: OrderKey[] = [];
  const at = (n: number) => { assert(places[n], `spec ${n} is not an earlier one`); return places[n]!; };
  return specs.map((s, self) => {
    if (!Array.isArray(s)) { places.push([s.clock[0], s.clock[1], bytes(s.author), bytes(s.device), s.seq]); return s; } // a change written out in full
    const [who, dev, wall, f, counter = 0] = s;
    const k = `${who}${dev}`, n = (seq.get(k) ?? 0) + 1;
    seq.set(k, n);
    places.push([wall, counter, bytes(AUTH[who]), bytes(DEV[dev]), n]);
    const c = new ItemChange();
    f(c, at, self);
    return { clock: [wall, counter], author: AUTH[who], device: DEV[dev], seq: n, set: [...c.set].map(([name, v]) => [name, toNotation(v)]), clear: [...c.clear].sort() };
  });
};
/** A change that sets one text of `n` bytes (written as a repeat so that the vector stays small). */
const bigText = (who: Who, dev: Dev, wall: number, name: string, n: number, seq = 1): J =>
  ({ clock: [wall, 0], author: AUTH[who], device: DEV[dev], seq, set: [[name, { text_repeat: ['a', n] }]], clear: [] });

/** The id of gone/id, worked out here without the library: SHA-256 of the CBOR array [kind, id] (0x82, then the two short texts), first 8 bytes. */
const cborText = (t: string) => { const u = Buffer.from(t, 'utf8'); assert(u.length < 24); return Buffer.concat([Buffer.from([0x60 | u.length]), u]); };
const sha = (a: string, b: string) => createHash('sha256').update(Buffer.concat([Buffer.from([0x82]), cborText(a), cborText(b)])).digest('hex').slice(0, 16);
const goneField = sha;
const id = (n: number) => n.toString(16).padStart(16, '0');
const bytes = (h: string) => fromHex(h);
const B32 = bytes('0a'.repeat(32)), CH = bytes('0c'.repeat(32));
const GID1 = '51'.repeat(32), GID2 = '52'.repeat(32), GID3 = '53'.repeat(32);
const att = cmap([[1, B32], [2, 5], [3, [CH]]]);
const place = (wall: number, counter: number, who: Who, dev: Dev, seq: number): CborValue => [wall, counter, bytes(AUTH[who]), bytes(DEV[dev]), seq];

export function schemaVectors(): J {
  const o = new Out();
  const add = (name: string, description: string, type: string, input: J, expected?: J) => o.add(`schema/${name}`, description, type, input, expected);
  /** Adds a vector and asserts only the keys of `part` against what the library computed (for outputs with long values, such as hashes). */
  const addPart = (name: string, description: string, type: string, input: J, part: J) => {
    const v = o.add(`schema/${name}`, description, type, input);
    for (const [k, x] of Object.entries(part)) assert.deepEqual(v.expected[k], x, `${name}: ${k}`);
    return v;
  };
  const view = (name: string, description: string, changes: J[], show: string[], want: J, extra: J = {}) =>
    add(name, description, 'schema.view', { changes, show, ...extra }, { view: want });

  // ------------------------------------------------------------------ section 2 and 3: each field's shape, accepted and wrong
  interface Row { f: string; ok: CborValue; bad: CborValue; main: string[]; wantOk: J; wantBad: J; carried?: boolean; why: string }
  const rows: Row[] = [
    { f: 'type', ok: 2, bad: 'x', main: ['type', 'type_raw'], wantOk: { type: 2, type_raw: 2 }, wantBad: { type: 4, type_raw: null }, why: 'text instead of a number' },
    { f: 'title', ok: 'T', bad: 5, main: ['title'], wantOk: { title: 'T' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'username', ok: 'u', bad: 5, main: ['username'], wantOk: { username: 'u' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'password', ok: 'p', bad: 5, main: ['password'], wantOk: { password: 'p' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'password_over', ok: place(5000, 0, 'A', 1, 1), bad: 5, main: [], wantOk: {}, wantBad: {}, why: 'a number instead of a place or null' },
    { f: 'password_rules', ok: 'r', bad: 5, main: ['password_rules'], wantOk: { password_rules: 'r' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'otp', ok: cmap([[1, bytes('0102')], [2, 6], [3, 30], [4, 1], [5, 'Iss'], [6, 'acct']]), bad: cmap([[1, bytes('0102')], [2, 6], [3, 30], [4, 9]]),
      main: ['otp'], wantOk: { otp: { secret: '0102', digits: 6, period: 30, algorithm: 1, issuer: 'Iss', account: 'acct' } }, wantBad: {}, why: 'an algorithm that is not 1, 2 or 3' },
    { f: 'passkey', ok: cmap([[1, bytes('01')], [2, bytes('02')], [3, 'rp'], [4, 'ann'], [5, bytes('03')], [6, 1000]]), bad: cmap([[1, bytes('01')], [2, bytes('02')], [3, 'rp'], [4, 'ann'], [5, bytes('03')]]),
      main: ['passkey'], wantOk: { passkey: { credential_id: '01', private_key: '02', relying_party: 'rp', user_name: 'ann', user_handle: '03', created: 1000 } }, wantBad: {}, why: 'no creation time' },
    { f: 'cardholder', ok: 'H', bad: 5, main: ['cardholder'], wantOk: { cardholder: 'H' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'card', ok: cmap([[1, '4111111111111111'], [2, 2030], [3, 12]]), bad: cmap([[1, '4111111111111111'], [2, 2030]]),
      main: ['card'], wantOk: { card: { number: '4111111111111111', year: 2030, month: 12 } }, wantBad: {}, why: 'a year without a month' },
    { f: 'card_code', ok: '123', bad: 5, main: ['card_code'], wantOk: { card_code: '123' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'card_pin', ok: '4321', bad: 5, main: ['card_pin'], wantOk: { card_pin: '4321' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'notes', ok: 'N', bad: 5, main: ['notes'], wantOk: { notes: 'N' }, wantBad: {}, why: 'a number instead of text' },
    { f: 'created', ok: 1000, bad: 'x', main: ['added'], wantOk: { added: 1000 }, wantBad: { added: 5000 }, why: 'text instead of a time (Added falls back to the earliest write, at 5000)' },
    { f: 'edited', ok: 7000, bad: 'x', main: ['edited'], wantOk: { edited: 7000 }, wantBad: {}, why: 'text instead of a time (and no content field was written, so no date is shown)' },
    { f: 'source', ok: cmap([[1, 'kdbx'], [2, 'abc'], [3, bytes('0b')]]), bad: cmap([[1, 'kdbx'], [2, 'abc']]), main: [], wantOk: {}, wantBad: {}, why: 'no baseline' },
    { f: 'password_history', ok: [['old', 1]], bad: [['old']], main: ['previous'], wantOk: { previous: [{ value: 'old', replaced: 1, from: 'import' }] }, wantBad: { previous: [] }, why: 'an entry without a time' },
    { f: 'history_hidden', ok: place(5000, 0, 'A', 1, 1), bad: [5000, 0], main: [], wantOk: {}, wantBad: {}, why: 'two numbers instead of an order key of five' },
    { f: 'moved', ok: cmap([[1, bytes(GID2)], [2, 1000]]), bad: cmap([[1, bytes(GID2)]]), main: ['shown', 'moved'], wantOk: { shown: false, moved: { gid: GID2, when: 1000 } }, wantBad: { shown: true }, why: 'no time' },
    { f: 'moved_from', ok: cmap([[1, bytes(GID2)], [2, 1000]]), bad: cmap([[1, bytes(GID2)]]), main: ['moved_from'], wantOk: { moved_from: { gid: GID2, when: 1000 } }, wantBad: {}, why: 'no time' },
    { f: 'deleted', ok: 9000, bad: 'x', main: ['deleted', 'deleted_at'], wantOk: { deleted: true, deleted_at: 9000 }, wantBad: { deleted: false }, why: 'text instead of a time' },
    { f: `web/${id(1)}`, ok: cmap([[1, 'https://a.example'], [2, 'a']]), bad: cmap([[1, 'https://a.example'], [2, 'a0']]), main: ['websites'],
      wantOk: { websites: [{ field: `web/${id(1)}`, address: 'https://a.example' }] }, wantBad: { websites: [] }, why: 'a position that ends in 0' },
    { f: `f/${id(1)}`, ok: cmap([[1, 'Label'], [2, 'Value'], [3, false], [4, 'a']]), bad: cmap([[1, 'Label'], [2, 'Value'], [3, 'no'], [4, 'a']]), main: ['custom_fields'],
      wantOk: { custom_fields: [{ field: `f/${id(1)}`, label: 'Label', value: 'Value', concealed: false }] }, wantBad: { custom_fields: [] }, why: 'text instead of a true or false' },
    { f: `a/${id(1)}`, ok: cmap([[1, 'f.txt'], [2, att], [3, 'a'], [4, 1]]), bad: cmap([[1, 'f.txt'], [2, cmap([[1, B32], [2, 'five'], [3, [CH]]])], [3, 'a'], [4, 1]]), main: ['attachments'],
      wantOk: { attachments: [{ field: `a/${id(1)}`, file_name: 'f.txt' }] }, wantBad: { attachments: [] }, why: 'an attachment map whose size is text' },
    { f: `t/${id(1)}`, ok: 'work', bad: 5, main: ['tags'], wantOk: { tags: ['work'] }, wantBad: { tags: [] }, why: 'a number instead of text' },
  ];
  for (const r of rows) {
    const slug = r.f.includes('/') ? r.f.split('/')[0]! : r.f;
    const carried = r.carried === false ? [] : [r.f];
    const show = [...r.main, 'invalid', 'carried'];
    const single = (v: CborValue) => L(['A', 1, 5000, (c) => c.raw(r.f, v)]);
    view(`field/${slug}/shape-accepted`, `${r.f}: a value of the right shape is used and is not listed as invalid.`, single(r.ok), show, { ...r.wantOk, invalid: [], carried });
    view(`field/${slug}/wrong-shape-is-cleared-and-kept`, `${r.f}: ${r.why}. The field is treated as cleared (nothing shown from it) and listed as invalid, and the value is kept, so that a move carries it.`,
      single(r.bad), show, { ...r.wantBad, invalid: [r.f], carried });
  }
  view('field/title/wrong-shape-later-does-not-fall-back', 'title: a valid write and then a later write of the wrong shape: the winning write is the wrong one, the field counts as cleared, and the earlier valid value is not shown again.',
    L(['A', 1, 1000, (c) => c.title('first')], ['B', 2, 2000, (c) => c.raw('title', 5)]), ['title', 'invalid'], { invalid: ['title'] });
  view('field/title/cleared-then-set', 'title: a clear and then a later set: the later write wins.',
    L(['A', 1, 1000, (c) => c.remove('title')], ['B', 2, 2000, (c) => c.title('back')]), ['title', 'invalid'], { title: 'back', invalid: [] });
  view('field/type/unknown-type-is-a-custom-item', 'type: a number the schema does not know is shown as a custom item (4); the stored number is still reported.',
    L(['A', 1, 1000, (c) => c.raw('type', 9)]), ['type', 'type_raw', 'invalid'], { type: 4, type_raw: 9, invalid: [] });
  view('field/type/absent-is-a-custom-item', 'type: an item with no type is shown as a custom item (4).', L(['A', 1, 1000, (c) => c.title('x')]), ['type', 'type_raw'], { type: 4, type_raw: null });
  view('field/title/login-without-title-shows-first-website', 'A login with no title is shown under its first website (the schema does not say what an untitled login is called; this is the reading).',
    L(['A', 1, 1000, (c) => c.type(1).website(id(1), 'example.com', 'a')]), ['display_title', 'websites'], { display_title: 'https://example.com', websites: [{ field: `web/${id(1)}`, address: 'https://example.com' }] });

  // shapes with ranges (schema 2)
  const shape = (name: string, description: string, field: string, value: CborValue, ok: boolean, settings = false) =>
    add(`shape/${name}`, description, 'schema.shape', { name: field, value: toNotation(value), ...(settings ? { settings: true } : {}) }, { ok });
  const otp = (over: [number, CborValue][]) => cmap([[1, bytes('01')], [2, 6], [3, 30], [4, 1], ...over]);
  shape('otp-algorithm-3', 'otp: algorithm 3 is allowed.', 'otp', otp([[4, 3]]), true);
  shape('otp-algorithm-0', 'otp: algorithm 0 is not 1, 2 or 3.', 'otp', otp([[4, 0]]), false);
  const digits = (n: number) => otp([[2, n]]), period = (n: number) => otp([[3, n]]);
  shape('otp-digits-3', 'otp: 3 digits is below 4.', 'otp', digits(3), false);
  shape('otp-digits-4', 'otp: 4 digits is the least.', 'otp', digits(4), true);
  shape('otp-digits-10', 'otp: 10 digits is the most.', 'otp', digits(10), true);
  shape('otp-digits-11', 'otp: 11 digits is above 10.', 'otp', digits(11), false);
  shape('otp-period-0', 'otp: a period of zero seconds is below 1.', 'otp', period(0), false);
  shape('otp-period-1', 'otp: a period of 1 second is the least.', 'otp', period(1), true);
  shape('otp-period-86400', 'otp: a period of 86,400 seconds (a day) is the most.', 'otp', period(86_400), true);
  shape('otp-period-86401', 'otp: a period above 86,400 seconds.', 'otp', period(86_401), false);
  shape('otp-issuer-not-text', 'otp: issuer, when present, is text.', 'otp', otp([[5, 7]]), false);
  shape('otp-without-issuer-and-account', 'otp: issuer and account are optional.', 'otp', otp([]), true);
  shape('otp-unknown-key-ignored', 'otp: a map key the schema does not define is ignored (the schema does not say).', 'otp', otp([[9, 'x']]), true);
  shape('card-without-expiry', 'card: the number alone is allowed: year and month are absent together.', 'card', cmap([[1, '4111']]), true);
  shape('card-month-without-year', 'card: a month without a year.', 'card', cmap([[1, '4111'], [3, 5]]), false);
  shape('card-month-13', 'card: month 13.', 'card', cmap([[1, '4111'], [2, 2030], [3, 13]]), false);
  shape('card-month-0', 'card: month 0.', 'card', cmap([[1, '4111'], [2, 2030], [3, 0]]), false);
  shape('card-year-999', 'card: a year of three digits.', 'card', cmap([[1, '4111'], [2, 999], [3, 1]]), false);
  shape('card-year-10000', 'card: a year of five digits.', 'card', cmap([[1, '4111'], [2, 10000], [3, 1]]), false);
  shape('card-number-with-space', 'card: the number is digits only.', 'card', cmap([[1, '4111 1111']]), false);
  shape('password-history-10-entries', 'password_history: ten entries is the most.', 'password_history', Array.from({ length: 10 }, (_, n) => [`p${n}`, n]), true);
  shape('password-history-11-entries', 'password_history: eleven entries is a wrong shape (the schema says at most 10).', 'password_history', Array.from({ length: 11 }, (_, n) => [`p${n}`, n]), false);
  shape('password-history-empty', 'password_history: an empty list.', 'password_history', [], true);
  shape('history-hidden-author-of-31-bytes', 'history_hidden: an order key whose author is not 32 bytes.', 'history_hidden', [5000, 0, bytes('aa'.repeat(31)), bytes(DEV[1]), 1], false);
  shape('web-position-empty', 'web/id: a position is never empty.', `web/${id(1)}`, cmap([[1, 'https://a'], [2, '']]), false);
  shape('web-position-uppercase', 'web/id: a position is of 0-9 and a-z.', `web/${id(1)}`, cmap([[1, 'https://a'], [2, 'A']]), false);
  shape('web-position-digits-only', 'web/id: a position of digits is fine.', `web/${id(1)}`, cmap([[1, 'https://a'], [2, '15']]), true);
  shape('gone-id-is-the-hash', 'gone/id (settings): the id in the name must be the first 8 bytes of the SHA-256 of kind and id.', `gone/${goneField('kdbx', 'abc')}`, cmap([[1, 'kdbx'], [2, 'abc'], [3, 1000]]), true, true);
  shape('password-over-null', 'password_over: null is the place of no write.', 'password_over', null, true);
  shape('password-over-place', 'password_over: a place in the order.', 'password_over', place(1000, 0, 'A', 1, 1), true);
  shape('password-over-short-place', 'password_over: two numbers are not a place.', 'password_over', [1000, 0], false);
  shape('moved-from-ok', 'moved_from: the group the item came from and when.', 'moved_from', cmap([[1, bytes(GID1)], [2, 5]]), true);
  shape('gone-id-is-not-the-hash', 'gone/id (settings): an id that is not the hash.', `gone/${id(7)}`, cmap([[1, 'kdbx'], [2, 'abc'], [3, 1000]]), false, true);
  shape('name-in-settings', 'name (settings): text.', 'name', 'Family', true, true);
  shape('name-in-settings-not-text', 'name (settings): a number is a wrong shape.', 'name', 5, false, true);

  // ------------------------------------------------------------------ section 1: names
  const nm = (name: string, description: string, field: string, want: J, settings = false) => add(`name/${name}`, description, 'schema.name', { name: field, ...(settings ? { settings: true } : {}) }, want);
  nm('fixed-known', 'A known fixed field.', 'title', { class: 'fixed', known: true });
  nm('fixed-unknown', 'A fixed name the schema does not know is a field of a later version: kept.', 'colour', { class: 'fixed', known: false });
  nm('fixed-64-bytes', 'A name of exactly 64 bytes is allowed.', 'k'.repeat(64), { class: 'fixed', known: false });
  nm('fixed-65-bytes', 'A name of 65 bytes is not a field name.', 'k'.repeat(65), { class: 'invalid' });
  nm('repeated-64-bytes', 'A repeated name of exactly 64 bytes (47, the slash, 16).', `${'x'.repeat(47)}/${id(1)}`, { class: 'repeated', family: 'x'.repeat(47), id: id(1), known: false });
  nm('repeated-65-bytes', 'A repeated name of 65 bytes.', `${'x'.repeat(48)}/${id(1)}`, { class: 'invalid' });
  nm('repeated-known', 'web/ with an id of 16 lowercase hexadecimal digits.', `web/${id(255)}`, { class: 'repeated', family: 'web', id: id(255), known: true });
  nm('repeated-unknown-family', 'An unknown family with a good id is kept, never shown.', `z/${id(1)}`, { class: 'repeated', family: 'z', id: id(1), known: false });
  nm('uppercase-letter', 'An uppercase letter is not allowed.', 'Title', { class: 'invalid' });
  nm('uppercase-in-id', 'An uppercase hexadecimal digit in an id is not allowed.', `web/${'A'.repeat(16)}`, { class: 'invalid' });
  nm('id-too-short', 'An id of 15 digits.', `web/${'a'.repeat(15)}`, { class: 'invalid' });
  nm('id-too-long', 'An id of 17 digits.', `web/${'a'.repeat(17)}`, { class: 'invalid' });
  nm('id-not-hex', 'An id of 16 characters that are not all hexadecimal.', `web/${'g'.repeat(16)}`, { class: 'invalid' });
  nm('two-slashes', 'More than one slash.', `web/${id(1)}/x`, { class: 'invalid' });
  nm('empty-family', 'An empty family before the slash.', `/${id(1)}`, { class: 'invalid' });
  nm('empty-id', 'An empty id after the slash.', 'web/', { class: 'invalid' });
  nm('empty-name', 'An empty name.', '', { class: 'invalid' });
  nm('non-ascii', 'A name with a letter outside ASCII.', 'tïtle', { class: 'invalid' });
  nm('space', 'A name with a space.', 'a b', { class: 'invalid' });
  nm('digits-underscore-hyphen', 'Digits, underscore and hyphen are allowed.', 'a_1-b', { class: 'fixed', known: false });
  nm('settings-name', 'In the settings item, name is a known field.', 'name', { class: 'fixed', known: true }, true);
  nm('settings-title-unknown', 'In the settings item, an item field is not known.', 'title', { class: 'fixed', known: false }, true);
  nm('settings-gone-known', 'In the settings item, gone/id is a known family.', `gone/${id(3)}`, { class: 'repeated', family: 'gone', id: id(3), known: true }, true);
  nm('settings-web-unknown', 'In the settings item, web/id is not known.', `web/${id(3)}`, { class: 'repeated', family: 'web', id: id(3), known: false }, true);
  add('name/gone-id-hash', 'The id of gone/id is the first 8 bytes, in hexadecimal, of the SHA-256 of the deterministic CBOR array [kind, id] (draft 2). Worked out in the generator without the library.',
    'schema.gone_name', { kind: 'kdbx', id: 'abc' }, { field: `gone/${sha('kdbx', 'abc')}` });
  add('name/gone-id-hash-different-pairs-differ', 'The array keeps the two texts apart: ("kdb", "xabc") does not give the name of ("kdbx", "abc") (it did in draft 1).',
    'schema.gone_name', { kind: 'kdb', id: 'xabc' }, { field: `gone/${sha('kdb', 'xabc')}` });
  assert.notEqual(sha('kdb', 'xabc'), sha('kdbx', 'abc'));

  // a bad id in a known family, in a view
  view('name/repeated-bad-id-is-kept-not-shown', 'A write of web/ with a bad id (15 digits) is not a field: not shown, listed as invalid, and kept.',
    L(['A', 1, 1000, (c) => c.rawAnyName(`web/${'a'.repeat(15)}`, cmap([[1, 'https://a'], [2, 'a']])).rawAnyName('Title', 'x').rawAnyName('k'.repeat(65), 'x')]), ['websites', 'title', 'invalid', 'carried'],
    { websites: [], invalid: ['Title', 'k'.repeat(65), `web/${'a'.repeat(15)}`].sort(), carried: ['Title', 'k'.repeat(65), `web/${'a'.repeat(15)}`].sort() });

  // writer side: names
  const build = (name: string, description: string, ops: J[], extra: J = {}) => add(`build/${name}`, description, 'schema.build', { ops, ...extra });
  const buildPart = (name: string, description: string, ops: J[], part: J, extra: J = {}) => addPart(`build/${name}`, description, 'schema.build', { ops, ...extra }, part);
  const err = (code: string) => ({ error: { code } });
  const refuse = (name: string, description: string, ops: J[], code: string, extra: J = {}) => add(`build/${name}`, description, 'schema.build', { ops, ...extra }, err(code));
  buildPart('field-name-64-bytes-accepted', 'A writer may write a name of exactly 64 bytes.', [{ m: 'raw', a: ['k'.repeat(64), 'x'] }], { set_names: ['k'.repeat(64)] }, { brief: true });
  refuse('field-name-65-bytes-refused', 'A writer does not write a name of 65 bytes.', [{ m: 'raw', a: ['k'.repeat(65), 'x'] }], 'bad_field_name');
  refuse('field-name-uppercase-refused', 'A writer does not write an uppercase name.', [{ m: 'raw', a: ['Title', 'x'] }], 'bad_field_name');
  refuse('repeated-field-with-bad-id-refused', 'A writer does not write web/ with an id that is not 16 hexadecimal digits.', [{ m: 'website', a: ['xyz', 'a.example', 'a'] }], 'bad_field_name');
  refuse('repeated-field-id-uppercase-refused', 'A writer does not write an id with an uppercase digit.', [{ m: 'raw', a: ['t/ABCDEF0123456789', 'work'] }], 'bad_field_name');

  // ------------------------------------------------------------------ builders: what each produces
  const setOf = (name: string, description: string, ops: J[], set: J, extra: J = {}, clear: string[] = []) =>
    add(`build/${name}`, description, 'schema.build', { ops, ...extra }, undefined) && (() => {
      const v = o.list[o.list.length - 1]!;
      assert.deepEqual(v.expected.set, set, `${name}: set`);
      assert.deepEqual(v.expected.clear, clear, `${name}: clear`);
    })();
  const T = (s: string) => ({ text: s }), U = (n: number) => ({ uint: String(n) }), Bz = (h: string) => ({ bytes: h });
  setOf('title-is-normalised', 'A title is normalised to NFC before it is written ("e" and a combining acute become one letter).', [{ m: 'title', a: ['é'] }], { title: T('é') });
  setOf('password-is-not-normalised-or-trimmed', 'A secret is written exactly as typed: not normalised, not trimmed.', [{ m: 'password', a: [' é '] }], { password_over: { null: true }, password: T(' é ') });
  const PLACE = { array: [U(1000), U(0), Bz('aa'.repeat(32)), Bz('11'.repeat(16)), U(1)] };
  setOf('password-names-the-write-it-replaced', 'Every change of password sets password_over in the same record: the place of the write this device saw as the current password.', [{ m: 'password', a: ['new', PLACE] }], { password: T('new'), password_over: PLACE });
  setOf('restore-password-names-the-write-it-replaced', 'Restoring a previous password is a change of password: it names the write it replaced.', [{ m: 'restorePassword', a: ['old', PLACE] }], { password: T('old'), password_over: PLACE });
  setOf('first-record-of-an-item-sets-created', 'The first record of an item sets created (draft 2).', [{ m: 'newItem', a: [1234] }, { m: 'title', a: ['x'] }], { created: U(1234), title: T('x') });
  setOf('moved-from', 'moved_from: the group the item came from and when.', [{ m: 'movedFrom', a: [Bz(GID1), 7] }], { moved_from: { map: [[U(1), Bz(GID1)], [U(2), U(7)]] } });
  setOf('username-is-not-normalised', 'A username is a secret-like value and is written as typed.', [{ m: 'username', a: ['é'] }], { username: T('é') });
  setOf('type', 'type is a number from 1 to 4.', [{ m: 'type', a: [3] }], { type: U(3) });
  setOf('password-rules', 'password_rules is text.', [{ m: 'passwordRules', a: ['minlength: 8;'] }], { password_rules: T('minlength: 8;') });
  setOf('otp', 'otp: secret, digits, period, algorithm, issuer, account.', [{ m: 'otp', a: [{ secret: '0102', digits: 6, period: 30, algorithm: 1, issuer: 'Iss', account: 'acct' }] }],
    { otp: { map: [[U(1), Bz('0102')], [U(2), U(6)], [U(3), U(30)], [U(4), U(1)], [U(5), T('Iss')], [U(6), T('acct')]] } });
  refuse('otp-bad-algorithm-refused', 'A writer does not write an otp the reader would refuse.', [{ m: 'otp', a: [{ secret: '01', digits: 6, period: 30, algorithm: 9 }] }], 'bad_value');
  setOf('cardholder-is-normalised', 'cardholder is normalised to NFC.', [{ m: 'cardholder', a: ['é'] }], { cardholder: T('é') });
  setOf('card', 'card: number, year, month.', [{ m: 'card', a: [{ number: '4111', year: 2030, month: 5 }] }], { card: { map: [[U(1), T('4111')], [U(2), U(2030)], [U(3), U(5)]] } });
  refuse('card-month-without-year-refused', 'A writer does not write a month without a year.', [{ m: 'card', a: [{ number: '4111', month: 5 }] }], 'bad_value');
  setOf('card-code-and-pin', 'card_code and card_pin are written as typed.', [{ m: 'cardCode', a: ['012'] }, { m: 'cardPin', a: ['0042'] }], { card_code: T('012'), card_pin: T('0042') });
  setOf('notes-are-normalised', 'notes are normalised to NFC.', [{ m: 'notes', a: ['é'] }], { notes: T('é') });
  setOf('created-and-edited', 'created and edited are times in milliseconds.', [{ m: 'created', a: [1000] }, { m: 'edited', a: [2000] }], { created: U(1000), edited: U(2000) });
  setOf('source', 'source: kind, id and the baseline.', [{ m: 'source', a: [{ kind: 'kdbx', id: 'abc', baseline: '0b' }] }], { source: { map: [[U(1), T('kdbx')], [U(2), T('abc')], [U(3), Bz('0b')]] } });
  setOf('password-history', 'password_history: pairs of text and time.', [{ m: 'passwordHistory', a: [[['old', 5], ['older', 3]]] }],
    { password_history: { array: [{ array: [T('old'), U(5)] }, { array: [T('older'), U(3)] }] } });
  setOf('moved', 'moved: the group it went to and the time.', [{ m: 'moved', a: [Bz(GID2), 1000] }], { moved: { map: [[U(1), Bz(GID2)], [U(2), U(1000)]] } });
  setOf('deleted', 'deleted is a time.', [{ m: 'deleted', a: [1000] }], { deleted: U(1000) });
  setOf('website-gets-a-scheme', 'A website typed without a scheme is written with https://.', [{ m: 'website', a: [id(1), 'example.com', 'a'] }], { [`web/${id(1)}`]: { map: [[U(1), T('https://example.com')], [U(2), T('a')]] } });
  setOf('website-keeps-its-scheme', 'A website with a scheme is written as typed.', [{ m: 'website', a: [id(1), 'ftp://example.com', 'a'] }], { [`web/${id(1)}`]: { map: [[U(1), T('ftp://example.com')], [U(2), T('a')]] } });
  setOf('custom-field', 'A custom field is one value: label, value, concealed and position together. The label is normalised, the value is not.', [{ m: 'customField', a: [id(2), 'é', ' v ', true, 'b'] }],
    { [`f/${id(2)}`]: { map: [[U(1), T('é')], [U(2), T(' v ')], [U(3), { bool: true }], [U(4), T('b')]] } });
  setOf('attachment', 'An attachment: file name, the attachment map of specification 5.2, position, time added.', [{ m: 'attachment', a: [id(3), 'f.txt', { map: [[U(1), Bz('0a'.repeat(32))], [U(2), U(5)], [U(3), { array: [Bz('0c'.repeat(32))] }]] }, 'c', 99] }],
    { [`a/${id(3)}`]: { map: [[U(1), T('f.txt')], [U(2), { map: [[U(1), Bz('0a'.repeat(32))], [U(2), U(5)], [U(3), { array: [Bz('0c'.repeat(32))] }]] }], [U(3), T('c')], [U(4), U(99)]] } });
  setOf('tag-is-normalised', 'A tag is text, normalised to NFC.', [{ m: 'tag', a: [id(4), 'é'] }], { [`t/${id(4)}`]: T('é') });
  setOf('removing-a-field-is-clearing-it', 'Removing a field is a clear, not a set, and a field is never in both.', [{ m: 'title', a: ['x'] }, { m: 'remove', a: ['title'] }, { m: 'remove', a: ['notes'] }, { m: 'notes', a: ['n'] }],
    { notes: T('n') }, {}, ['title']);
  setOf('clear-list-is-sorted', 'The clear list is in order, so that the payload is one byte string for one change.', [{ m: 'remove', a: ['title'] }, { m: 'remove', a: ['notes'] }, { m: 'remove', a: ['a_field'] }], {}, {}, ['a_field', 'notes', 'title']);
  setOf('group-name', 'Settings item: name is text, normalised to NFC.', [{ m: 'groupName', a: ['Famıly'] }], { name: T('Famıly') }, { item: '00'.repeat(16) });
  setOf('gone', 'Settings item: gone/id with the hash as its id.', [{ m: 'gone', a: ['kdbx', 'abc', 1000] }], { [`gone/${sha('kdbx', 'abc')}`]: { map: [[U(1), T('kdbx')], [U(2), T('abc')], [U(3), U(1000)]] } }, { item: '00'.repeat(16) });
  build('payload-is-sorted-and-deterministic', 'The payload of one change: the same writes in another order give the same bytes (hash listed).', [{ m: 'notes', a: ['n'] }, { m: 'title', a: ['t'] }]);

  // size limits, writer side (schema 1)
  buildPart('title-65536-bytes-accepted', 'A text of exactly 65,536 bytes is accepted by a writer.', [{ m: 'title', a: [{ text_repeat: ['a', 65_536] }] }], { set_names: ['title'] }, { brief: true });
  refuse('title-65537-bytes-refused', 'A text of 65,537 bytes is not written.', [{ m: 'title', a: [{ text_repeat: ['a', 65_537] }] }], 'text_too_long');
  buildPart('notes-262144-bytes-accepted', 'Notes of exactly 262,144 bytes are accepted by a writer.', [{ m: 'notes', a: [{ text_repeat: ['a', 262_144] }] }], { set_names: ['notes'] }, { brief: true });
  refuse('notes-262145-bytes-refused', 'Notes of 262,145 bytes are not written.', [{ m: 'notes', a: [{ text_repeat: ['a', 262_145] }] }], 'notes_too_long');
  buildPart('notes-longer-than-text-limit-accepted', 'Notes may be longer than the limit for other texts.', [{ m: 'notes', a: [{ text_repeat: ['a', 65_537] }] }], { set_names: ['notes'] }, { brief: true });
  refuse('title-multibyte-counts-bytes-not-characters', 'The limit counts bytes: 32,769 two-byte characters are 65,538 bytes.', [{ m: 'title', a: [{ text_repeat: ['é', 32_769] }] }], 'text_too_long');
  const counts = (kind: string, op: (n: number) => J, limit: number, plural: string, code: string) => {
    buildPart(`${plural}-last-allowed-accepted`, `With ${limit - 1} ${plural} the ${limit}th is accepted.`, [op(1)], { clear: [] }, { existing: { [kind]: limit - 1 }, brief: true });
    refuse(`${plural}-one-over-refused`, `With ${limit} ${plural} one more is refused (${code}).`, [op(2)], code, { existing: { [kind]: limit } });
  };
  counts('websites', (n) => ({ m: 'website', a: [id(n + 100), 'a.example', 'a'] }), limit('websites'), 'websites', 'too_many_websites');
  counts('customFields', (n) => ({ m: 'customField', a: [id(n + 100), 'L', 'V', false, 'a'] }), limit('customFields'), 'custom-fields', 'too_many_custom_fields');
  counts('attachments', (n) => ({ m: 'attachment', a: [id(n + 100), 'f', { map: [[U(1), Bz('0a'.repeat(32))], [U(2), U(1)], [U(3), { array: [] }]] }, 'a', 1] }), limit('attachments'), 'attachments', 'too_many_attachments');
  counts('tags', (n) => ({ m: 'tag', a: [id(n + 100), 'work'] }), limit('tags'), 'tags', 'too_many_tags');
  function limit(k: string) { return ({ websites: 64, customFields: 128, attachments: 64, tags: 64 } as Record<string, number>)[k]!; }
  buildPart('website-edit-at-the-limit-accepted', 'Changing a website that already exists is not adding one: allowed at 64.', [{ m: 'website', a: [id(1), 'b.example', 'a'] }], { set_names: [`web/${id(1)}`] },
    { brief: true, changes: L(...Array.from({ length: 64 }, (_, n) => ['A', 1, 1000 + n, (c: ItemChange) => c.website(id(n + 1), 'a.example', 'a')] as Spec)) });

  // ------------------------------------------------------------------ positions
  const pos = (name: string, description: string, input: J, expected: J) => add(`position/${name}`, description, 'schema.position', input, expected);
  const between = { valid: true, between: true };
  pos('between-nothing', 'A first position: between nothing and nothing.', {}, between);
  pos('between-a-and-b', 'Between two positions that differ by one in the first digit.', { a: 'a', b: 'b' }, between);
  pos('between-a-and-a1', 'Between a and a1 (a longer position that starts with the shorter).', { a: 'a', b: 'a1' }, between);
  pos('between-az-and-b', 'Between az and b.', { a: 'az', b: 'b' }, between);
  pos('before-everything', 'Before the first position, 1.', { b: '1' }, between);
  pos('after-everything', 'After a position, with no upper bound.', { a: 'i' }, between);
  pos('between-adjacent-digits-deep', 'Between 1zzz and 2: the result is longer than both.', { a: '1zzz', b: '2' }, between);
  pos('lower-after-upper-refused', 'The lower position must sort before the upper one.', { a: 'b', b: 'a' }, err('bad_position'));
  pos('equal-refused', 'Equal positions have nothing between them.', { a: 'b', b: 'b' }, err('bad_position'));
  pos('lower-ends-in-zero-refused', 'A position never ends in 0.', { a: 'a0', b: 'b' }, err('bad_position'));
  pos('lower-uppercase-refused', 'A position is of 0-9 and a-z.', { a: 'A', b: 'b' }, err('bad_position'));
  pos('at-end-of-nothing', 'The position at the end of an empty list is a valid first position.', { existing: [] }, { valid: true, after_all: true });
  pos('at-end-unsorted-list', 'The position at the end is after every existing one, however they are listed.', { existing: ['m', 'a', 'z', 'b'] }, { valid: true, after_all: true });

  // ------------------------------------------------------------------ repeated fields in a view
  const web = (n: number, address: string, p: string) => (c: ItemChange) => c.website(id(n), address, p);
  view('web/two-devices-add-offline-both-survive', 'Two devices each add a website while offline, with different ids: after both sync, both are there, in position order.',
    L(['A', 1, 1000, web(1, 'https://one.example', 'i')], ['B', 2, 1000, web(2, 'https://two.example', 'j')]), ['websites'],
    { websites: [{ field: `web/${id(1)}`, address: 'https://one.example' }, { field: `web/${id(2)}`, address: 'https://two.example' }] });
  view('web/two-devices-add-offline-same-position', 'Two devices each add a website at the same position: both survive, ordered by field name (the smaller id first), whatever order the writes arrive in.',
    L(['B', 2, 1000, web(2, 'https://two.example', 'i')], ['A', 1, 1000, web(1, 'https://one.example', 'i')]), ['websites'],
    { websites: [{ field: `web/${id(1)}`, address: 'https://one.example' }, { field: `web/${id(2)}`, address: 'https://two.example' }] });
  view('web/same-position-three-entries-by-field-name', 'Three websites at one position are shown in order of field name.',
    L(['A', 1, 1000, web(3, 'https://three', 'a')], ['A', 1, 1001, web(1, 'https://one', 'a')], ['A', 1, 1002, web(2, 'https://two', 'a')]), ['websites'],
    { websites: [1, 2, 3].map((n) => ({ field: `web/${id(n)}`, address: `https://${['one', 'two', 'three'][n - 1]}` })) });
  view('web/reorder-by-position', 'Moving one website between two others is one write of that website with a new position; the others are not written.',
    L(['A', 1, 1000, web(1, 'https://a', 'a')], ['A', 1, 1001, web(2, 'https://b', 'b')], ['A', 1, 1002, web(3, 'https://c', 'c')], ['A', 1, 2000, web(3, 'https://c', 'ai')]), ['websites'],
    { websites: [{ field: `web/${id(1)}`, address: 'https://a' }, { field: `web/${id(3)}`, address: 'https://c' }, { field: `web/${id(2)}`, address: 'https://b' }] });
  view('web/reorder-on-two-devices-later-write-wins', 'The same website moved on two devices: the later write of the whole value wins, address and position together.',
    L(['A', 1, 1000, web(1, 'https://a', 'a')], ['A', 1, 1001, web(2, 'https://b', 'b')], ['A', 1, 2000, web(1, 'https://a', 'c')], ['B', 2, 3000, web(1, 'https://a2', 'bi')]), ['websites'],
    { websites: [{ field: `web/${id(2)}`, address: 'https://b' }, { field: `web/${id(1)}`, address: 'https://a2' }] });
  view('web/removed-on-one-device-edited-on-another', 'One device removes a website while another edits it: the later write wins, as for any field.',
    L(['A', 1, 1000, web(1, 'https://a', 'a')], ['A', 1, 2000, (c) => c.remove(`web/${id(1)}`)], ['B', 2, 3000, web(1, 'https://a-edited', 'a')]), ['websites'],
    { websites: [{ field: `web/${id(1)}`, address: 'https://a-edited' }] });
  view('tag/added-twice-with-the-same-text-shows-once', 'Two devices add the same tag text: two fields, one tag.',
    L(['A', 1, 1000, (c) => c.tag(id(1), 'work')], ['B', 2, 1000, (c) => c.tag(id(2), 'work')]), ['tags'], { tags: ['work'] });
  view('tag/removed-after-two-adds-clears-both-fields', 'Removing a tag clears every field that holds its text: the tag is gone.',
    L(['A', 1, 1000, (c) => c.tag(id(1), 'work')], ['B', 2, 1000, (c) => c.tag(id(2), 'work')], ['A', 1, 2000, (c) => c.remove(`t/${id(1)}`).remove(`t/${id(2)}`)]), ['tags'], { tags: [] });
  view('tag/remove-sees-only-one-of-two-fields', 'A device that had only one of the two fields clears that one: the other still holds the text, and the tag is shown (a limit of the schema, in the findings).',
    L(['A', 1, 1000, (c) => c.tag(id(1), 'work')], ['A', 1, 2000, (c) => c.remove(`t/${id(1)}`)], ['B', 2, 1500, (c) => c.tag(id(2), 'work')]), ['tags'], { tags: ['work'] });
  view('tag/order-is-bytewise-by-text', 'Tags have no position: they are shown in order of their text, bytewise (the schema says nothing).',
    L(['A', 1, 1000, (c) => c.tag(id(1), 'b').tag(id(2), 'a').tag(id(3), 'B')]), ['tags'], { tags: ['B', 'a', 'b'] });
  view('field/f/label-and-value-change-on-two-devices-one-unit', 'A custom field is one value. One device changes its label and another, later, changes its value: the later write is the whole field and the label change is lost.',
    L(['A', 1, 1000, (c) => c.customField(id(1), 'PIN', '1111', true, 'a')], ['A', 1, 2000, (c) => c.customField(id(1), 'Door PIN', '1111', true, 'a')], ['B', 2, 3000, (c) => c.customField(id(1), 'PIN', '2222', true, 'a')]), ['custom_fields'],
    { custom_fields: [{ field: `f/${id(1)}`, label: 'PIN', value: '2222', concealed: true }] });
  view('field/f/later-label-change-wins-over-earlier-value-change', 'The same two writes the other way round: the later one is the label change.',
    L(['A', 1, 1000, (c) => c.customField(id(1), 'PIN', '1111', true, 'a')], ['B', 2, 2000, (c) => c.customField(id(1), 'PIN', '2222', true, 'a')], ['A', 1, 3000, (c) => c.customField(id(1), 'Door PIN', '1111', true, 'a')]), ['custom_fields'],
    { custom_fields: [{ field: `f/${id(1)}`, label: 'Door PIN', value: '1111', concealed: true }] });
  view('attachment/removed', 'Removing an attachment is a clear of its field.',
    L(['A', 1, 1000, (c) => c.attachment(id(1), 'f.txt', att, 'a', 1)], ['A', 1, 2000, (c) => c.remove(`a/${id(1)}`)]), ['attachments'], { attachments: [] });

  // ------------------------------------------------------------------ card reissued
  const cardOld = (c: ItemChange) => c.type(2).title('Visa').cardholder('A Person').card({ number: '4111111111111111', year: 2025, month: 1 }).cardCode('123').cardPin('4321');
  const cardNew = (c: ItemChange) => c.card({ number: '5500000000000004', year: 2029, month: 6 }).cardCode('987');
  const reissued = L(['A', 1, 1000, cardOld], ['A', 1, 2000, cardNew]);
  const v = add('card/reissued-new-number-and-code', 'A reissued card: the number, expiry and code are written again. The old number is not shown anywhere, and a checkpoint carries one write of card and none of the old (only password keeps history).', 'schema.view',
    { changes: reissued, show: ['card', 'card_code', 'card_pin', 'cardholder', 'previous'], checkpoints: [{ include: [0, 1] }], runs: [{ changes: [0, 1], checkpoints: [] }, { changes: [], checkpoints: [0] }] });
  assert.deepEqual(v.expected.views[0], { card: { number: '5500000000000004', year: 2029, month: 6 }, card_code: '987', card_pin: '4321', cardholder: 'A Person', previous: [] });
  assert.deepEqual(v.expected.views[1], v.expected.views[0]);
  assert.equal(v.expected.carries[0].card, 1); assert.equal(v.expected.carries[0].card_code, 1);
  view('card/reissued-code-cleared', 'A reissued card with no printed code: the code is cleared.', L(['A', 1, 1000, cardOld], ['A', 1, 2000, (c) => c.card({ number: '5500000000000004' }).remove('card_code')]), ['card', 'card_code'],
    { card: { number: '5500000000000004' } });

  // ------------------------------------------------------------------ section 4: previous passwords (draft 2)
  /** A change of password: `back` is how many specs earlier the write it replaces is (its `password_over`), or null when it saw none. */
  const pwc = (s: string, back: number | null = 1): Writes => (c, at, self) => c.password(s, back === null ? null : at(self - back));
  /** n sequential changes p<from>, p<from+1>, ... one device, 1000 ms apart; the first of the vector sees nothing. */
  const chain = (n: number): Spec[] => Array.from({ length: n }, (_, k) => ['A', 1, 1000 * (k + 1), pwc(`p${k}`, k === 0 ? null : 1)] as Spec);
  const all = (n: number) => Array.from({ length: n }, (_, k) => k);
  const prevList = (hi: number, lo: number) => Array.from({ length: hi - lo + 1 }, (_, n) => ({ value: `p${hi - n}`, replaced: 1000 * (hi - n + 2), from: 'writes' }));
  const twelve = L(...chain(13));
  const expectTen = prevList(11, 2);
  view('password/twelve-changes-show-ten', 'Thirteen writes of password (twelve changes): the current one is p12, and the ten newest earlier ones are shown newest first, each dated by the write that replaced it. p1 and p0 are not shown. Each change names the write it replaced, so there is no note.',
    twelve, ['password', 'previous', 'password_note'], { password: 'p12', previous: expectTen });
  const w = add('password/checkpoint-keeps-ten-earlier-writes', 'A checkpoint of those thirteen writes carries the winner and the writes the first ten entries need: here the ten entries themselves (11 writes with the winner). A reader of the checkpoint alone shows the same ten previous passwords as a reader of every record.', 'schema.view',
    { changes: twelve, show: ['password', 'previous', 'password_note'], checkpoints: [{ include: all(13) }], runs: [{ changes: all(13), checkpoints: [] }, { changes: [], checkpoints: [0] }] });
  assert.deepEqual(w.expected.carries, [{ password: 11, password_over: 1 }]);
  assert.deepEqual(w.expected.views, [{ password: 'p12', previous: expectTen }, { password: 'p12', previous: expectTen }]);
  const w2 = add('password/checkpoint-then-two-more-changes', 'A checkpoint of the first thirteen writes and then two more records: the view is the one of all fifteen records (ten newest previous: p13 down to p4).', 'schema.view',
    { changes: L(...chain(15)), show: ['password', 'previous', 'password_note'], checkpoints: [{ include: all(13) }], runs: [{ changes: all(15), checkpoints: [] }, { changes: [13, 14], checkpoints: [0] }] });
  assert.deepEqual(w2.expected.views, [{ password: 'p14', previous: prevList(13, 4) }, { password: 'p14', previous: prevList(13, 4) }]);
  view('password/previous-must-differ', 'The same password written again is not a previous password: p1, p1, p2 shows p1 once: the first write is followed by the same value and is not an entry; the second is, and is dated by the write that replaced it (3000).',
    L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, pwc('p1')], ['A', 1, 3000, pwc('p2')]), ['password', 'previous'], { password: 'p2', previous: [{ value: 'p1', replaced: 3000, from: 'writes' }] });
  view('password/entry-equal-to-a-newer-entry-is-left-out', 'p1, p2, p1, p3: the oldest p1 equals a newer entry and is left out; newest first the list is p1 (replaced at 4000) and p2 (replaced at 3000).',
    L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, pwc('p2')], ['A', 1, 3000, pwc('p1')], ['A', 1, 4000, pwc('p3')]), ['password', 'previous'],
    { password: 'p3', previous: [{ value: 'p1', replaced: 4000, from: 'writes' }, { value: 'p2', replaced: 3000, from: 'writes' }] });
  view('password/restore-is-a-new-write', 'Restoring a previous password sets password to that value. The password it replaces becomes the newest previous one; the restored value is the current password, so it is not listed again.',
    L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, pwc('p2')], ['A', 1, 3000, (c, at, self) => c.restorePassword('p1', at(self - 1))]), ['password', 'previous', 'password_note'],
    { password: 'p1', previous: [{ value: 'p2', replaced: 3000, from: 'writes' }] });
  view('password/cleared-write-is-not-an-entry', 'A cleared password in between is not an entry; the write before it is dated by the clear that replaced it (2000), and there is no note: the second change names the clear as the write it replaced.',
    L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, (c) => c.remove('password')], ['A', 1, 3000, pwc('p2')]), ['password', 'previous', 'password_note'], { password: 'p2', previous: [{ value: 'p1', replaced: 2000, from: 'writes' }] });
  const cl = add('password/checkpoint-keeps-the-write-that-dates-an-entry', 'The same, through a checkpoint: it carries the cleared write too (it dates p1 and is the write the winner replaced), so the list and the absence of a note do not change.', 'schema.view',
    { changes: L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, (c) => c.remove('password')], ['A', 1, 3000, pwc('p2')]), show: ['password', 'previous', 'password_note'], checkpoints: [{ include: [0, 1, 2] }],
      runs: [{ changes: [], checkpoints: [0] }, { changes: [0, 1, 2], checkpoints: [] }] });
  assert.deepEqual(cl.expected.views[0], { password: 'p2', previous: [{ value: 'p1', replaced: 2000, from: 'writes' }] }); assert.deepEqual(cl.expected.views[1], cl.expected.views[0]);
  assert.deepEqual(cl.expected.carries, [{ password: 3, password_over: 1 }]);
  view('password/history-from-an-import-follows-the-writes', 'password_history (from an import) follows the entries from writes.',
    L(['A', 1, 1000, (c) => c.passwordHistory([['imp2', 700], ['imp1', 500]]).password('p1')], ['A', 1, 2000, pwc('p2')]), ['password', 'previous'],
    { password: 'p2', previous: [{ value: 'p1', replaced: 2000, from: 'writes' }, { value: 'imp2', replaced: 700, from: 'import' }, { value: 'imp1', replaced: 500, from: 'import' }] });
  view('password/import-entry-equal-to-a-write-is-left-out', 'An entry of password_history equal to an entry from writes (or to the current password) is left out.',
    L(['A', 1, 1000, (c) => c.passwordHistory([['p1', 5], ['x', 4]]).password('p1')], ['A', 1, 2000, pwc('p2')]), ['previous'],
    { previous: [{ value: 'p1', replaced: 2000, from: 'writes' }, { value: 'x', replaced: 4, from: 'import' }] });
  view('password/import-history-and-writes-limited-to-ten', 'Eight entries from writes and four entries of password_history: ten are shown, the writes first, then two from the import.',
    L(['A', 1, 500, (c) => c.passwordHistory([['i4', 4], ['i3', 3], ['i2', 2], ['i1', 1]])], ...Array.from({ length: 9 }, (_, k) => ['A', 1, 1000 * (k + 1), pwc(`p${k}`, k === 0 ? null : 1)] as Spec)), ['previous'],
    { previous: [...Array.from({ length: 8 }, (_, n) => ({ value: `p${7 - n}`, replaced: 1000 * (7 - n + 2), from: 'writes' })), { value: 'i4', replaced: 4, from: 'import' }, { value: 'i3', replaced: 3, from: 'import' }] });
  // Clear Previous Passwords: history_hidden = place of the current winning write of password (spec 2), password_history cleared (spec 4).
  const base3: Spec[] = [['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, pwc('p2')], ['A', 1, 3000, pwc('p3')], ['A', 1, 4000, (c) => c.passwordHistory([['imp', 5]])]];
  view('password/shown-before-clearing', 'Three writes and an imported entry: the control for the next vector.', L(...base3), ['previous'],
    { previous: [{ value: 'p2', replaced: 3000, from: 'writes' }, { value: 'p1', replaced: 2000, from: 'writes' }, { value: 'imp', replaced: 5, from: 'import' }] });
  const clearSpec: Spec = ['A', 1, 5000, (c, at) => c.historyHidden(at(2)).remove('password_history')];
  const cleared = L(...base3, clearSpec);
  view('password/after-clear-previous-passwords', 'Clear Previous Passwords sets history_hidden to the place of the current winning write of password (p3) and clears password_history: writes before that place are left out, and the current password is not, so nothing is listed. The earlier writes are still in the records.',
    cleared, ['password', 'previous'], { password: 'p3', previous: [] });
  const afterChange: Spec[] = [...base3, clearSpec, ['A', 1, 6000, (c, at) => c.password('p4', at(2))]];
  view('password/change-after-clear-shows-the-current-one-of-the-time', 'A change after clearing: the password that was current when the history was cleared is now replaced and is listed (draft 2); the ones before it stay hidden.',
    L(...afterChange), ['password', 'previous', 'password_note'], { password: 'p4', previous: [{ value: 'p3', replaced: 6000, from: 'writes' }] });
  const afterTwo: Spec[] = [...afterChange, ['A', 1, 7000, (c, at) => c.password('p5', at(5))]];
  view('password/second-change-after-clear', 'A second change after clearing: p4 and p3 are listed, p2 and p1 are not.', L(...afterTwo), ['password', 'previous'],
    { password: 'p5', previous: [{ value: 'p4', replaced: 7000, from: 'writes' }, { value: 'p3', replaced: 6000, from: 'writes' }] });
  const w3 = add('password/checkpoint-after-clear-no-longer-carries-hidden-writes', 'A checkpoint written after Clear Previous Passwords carries only the writes in force: p5, p4 and p3. The earlier writes leave storage with the records the checkpoint covers; the view does not change.', 'schema.view',
    { changes: L(...afterTwo), show: ['password', 'previous', 'password_note'], checkpoints: [{ include: all(afterTwo.length) }], runs: [{ changes: [], checkpoints: [0] }, { changes: all(afterTwo.length), checkpoints: [] }] });
  assert.deepEqual(w3.expected.carries, [{ password: 3, password_over: 1, password_history: 1, history_hidden: 1 }]);
  assert.deepEqual(w3.expected.views[0], w3.expected.views[1]);
  view('password/restore-after-clear', 'Restoring a hidden password writes it again after the place: it is current, and the one it replaces (p3) is listed.',
    L(...base3, clearSpec, ['A', 1, 6000, (c, at) => c.restorePassword('p1', at(2))]), ['password', 'previous', 'password_note'], { password: 'p1', previous: [{ value: 'p3', replaced: 6000, from: 'writes' }] });
  // the note
  const two = (more: Spec[] = []) => L(['A', 1, 1000, pwc('base', null)], ['A', 1, 2000, pwc('from-a', 1)], ['B', 2, 2500, (c, at) => c.password('from-b', at(0))], ...more);
  view('password/two-devices-from-the-same-base-note', 'Two devices change the password from the same base: the later write wins and the other is the newest previous password. The winner names the base as the write it replaced, but the write just before it in the order is the other change: the note.',
    two(), ['password', 'previous', 'password_note'],
    { password: 'from-b', previous: [{ value: 'from-a', replaced: 2500, from: 'writes' }, { value: 'base', replaced: 2000, from: 'writes' }], password_note: 'changed_on_two_devices' });
  view('password/sequential-changes-no-note', 'Three sequential changes: each names the write just before it. No note.', L(...chain(3)), ['password_note'], {});
  view('password/third-change-after-both-were-seen-no-note', 'A third change made after both of the two were seen names the winner of the two as the write it replaced: no note.',
    two([['A', 1, 3000, (c, at) => c.password('merged', at(2))]]), ['password', 'password_note'], { password: 'merged' });
  view('password/null-over-with-an-earlier-write-note', 'A device that saw no password writes one (over null) while another write already exists before it in the order: the note.',
    L(['A', 1, 1000, pwc('base', null)], ['B', 2, 2000, pwc('other', null)]), ['password', 'password_note'], { password: 'other', password_note: 'changed_on_two_devices' });
  view('password/first-write-over-null-no-note', 'The first write of password has nothing before it: no note.', L(['A', 1, 1000, pwc('base', null)]), ['password_note'], {});
  view('password/record-without-password-over-no-note', 'A record that changes password without password_over (an older writer): the reader cannot tell what that device had seen and shows no note.',
    L(['A', 1, 1000, pwc('base', null)], ['A', 1, 2000, (c) => c.raw('password', 'x')]), ['password', 'password_note'], { password: 'x' });
  view('password/password-over-of-an-earlier-record-no-note', 'A later write of password without password_over, after one that had it: the winning password_over is not from the same record, so it says nothing about this write.',
    L(['A', 1, 1000, pwc('base', null)], ['A', 1, 2000, pwc('p2')], ['B', 2, 3000, (c) => c.raw('password', 'x')]), ['password', 'password_note'], { password: 'x' });
  view('password/password-over-of-the-wrong-shape-no-note', 'password_over of the wrong shape counts as cleared: no note.',
    L(['A', 1, 1000, pwc('base', null)], ['B', 2, 2000, (c) => c.raw('password', 'x').raw('password_over', 5)]), ['password', 'password_note', 'invalid'], { password: 'x', invalid: ['password_over'] });
  view('password/two-devices-note-after-a-cleared-write-needs-the-clear', 'base, a clear, then a change that names the clear: no note (the write just before the winner is the clear).',
    L(['A', 1, 1000, pwc('base', null)], ['A', 1, 2000, (c) => c.remove('password')], ['A', 1, 3000, pwc('p2')]), ['password_note'], {});
  const wn = add('password/two-devices-note-through-a-checkpoint', 'The two-devices case, and the sequential case, through a checkpoint alone and through a checkpoint and the records after it: the same note or none. A checkpoint keeps password_over (the winner of every field) and the write just before the winner.', 'schema.view',
    { changes: two([['A', 1, 3000, (c, at) => c.password('merged', at(2))]]), show: ['password', 'previous', 'password_note'], checkpoints: [{ include: [0, 1, 2] }],
      runs: [{ changes: [0, 1, 2], checkpoints: [] }, { changes: [], checkpoints: [0] }, { changes: [3], checkpoints: [0] }, { changes: [0, 1, 2, 3], checkpoints: [] }] });
  const noteView = { password: 'from-b', previous: [{ value: 'from-a', replaced: 2500, from: 'writes' }, { value: 'base', replaced: 2000, from: 'writes' }], password_note: 'changed_on_two_devices' };
  const mergedView = { password: 'merged', previous: [{ value: 'from-b', replaced: 3000, from: 'writes' }, { value: 'from-a', replaced: 2500, from: 'writes' }, { value: 'base', replaced: 2000, from: 'writes' }] };
  assert.deepEqual(wn.expected.views, [noteView, noteView, mergedView, mergedView]);
  const wq = add('password/sequential-note-through-a-checkpoint-with-a-write-before-the-winner-that-is-no-entry', 'p1, then p2 three times in a row, each naming the one before: the write just before the winner is not an entry (it repeats the winner) and dates no entry, yet a checkpoint keeps it, so there is still no note.', 'schema.view',
    { changes: L(['A', 1, 1000, pwc('p1', null)], ['A', 1, 2000, pwc('p2')], ['A', 1, 3000, pwc('p2')], ['A', 1, 4000, pwc('p2')]), show: ['password', 'previous', 'password_note'], checkpoints: [{ include: [0, 1, 2, 3] }],
      runs: [{ changes: [0, 1, 2, 3], checkpoints: [] }, { changes: [], checkpoints: [0] }] });
  assert.deepEqual(wq.expected.views[0], { password: 'p2', previous: [{ value: 'p1', replaced: 2000, from: 'writes' }] }); assert.deepEqual(wq.expected.views[1], wq.expected.views[0]);

  // ------------------------------------------------------------------ section 5: dates (draft 2)
  const made = L(['A', 1, 1000, (c) => c.created(1000).title('Mine').password('p')], ['A', 1, 3000, (c) => c.title('Mine 2')]);
  view('dates/made-here', 'An item made here: Added is created, Edited is the wall time of the latest write to a content field.', made, ['added', 'added_estimated', 'edited'], { added: 1000, added_estimated: false, edited: 3000 });
  view('dates/no-created-added-is-the-earliest-write-held', 'An item without created (an old writer): Added is the wall time of the earliest write the reader holds, and the view says it is an estimate: it can drift once a checkpoint has dropped older writes.',
    L(['A', 1, 2000, (c) => c.title('x')], ['B', 2, 1500, (c) => c.notes('n')]), ['added', 'added_estimated', 'edited'], { added: 1500, added_estimated: true, edited: 2000 });
  const imported = (extra: Spec[] = []) => L(['A', 1, 9000, (c) => c.created(100).edited(200).source({ kind: 'kdbx', id: 'abc', baseline: bytes('0b') }).title('Imported').password('p')], ...extra);
  view('dates/imported-untouched', 'An imported item untouched: the source\'s dates are shown, although every write was made at import time (9000).', imported(), ['added', 'edited'], { added: 100, edited: 200 });
  view('dates/imported-edited-later', 'An imported item edited later here: Edited is the time of that write.', imported([['B', 2, 12_000, (c) => c.title('Renamed')]]), ['added', 'edited'], { added: 100, edited: 12_000 });
  view('dates/imported-then-source-set-again', 'A second import that sets source and edited again does not make the item newer than the source says: edited is the value of edited when no content field was written later.',
    imported([['A', 1, 20_000, (c) => c.source({ kind: 'kdbx', id: 'abc', baseline: bytes('0c') }).edited(200)]]), ['added', 'edited'], { added: 100, edited: 200 });
  view('dates/imported-without-dates-shows-added-alone', 'An item imported from a source with no dates: created is the import time and there is no edited. The latest content write is the import itself, which is not later than Added, so Edited is not shown (draft 2).',
    L(['A', 1, 9000, (c) => c.created(9000).title('Undated')]), ['added', 'edited', 'edited_raw'], { added: 9000, edited_raw: 9000 });
  view('dates/edited-equal-to-added-is-not-shown', 'Edited is shown only when later than Added: a content write at the same time as created shows no Edited.', L(['A', 1, 1000, (c) => c.created(1000).title('x')]), ['added', 'edited'], { added: 1000 });
  view('dates/edited-older-than-added-is-not-shown', 'An imported edited date older than created (an inconsistent source) is not shown.', L(['A', 1, 9000, (c) => c.created(500).edited(200).title('x')]), ['added', 'edited', 'edited_raw'], { added: 500, edited_raw: 200 });
  view('dates/only-non-content-writes', 'An item with only created, edited, source: no content write, so edited stands and Added is created.',
    L(['A', 1, 9000, (c) => c.created(100).edited(200).source({ kind: 'k', id: 'i', baseline: bytes('0b') })]), ['added', 'edited'], { added: 100, edited: 200 });
  const dated = (f: Writes): Spec[] => [['A', 1, 1000, (c) => c.created(500).title('x')], ['A', 1, 5000, f]];
  view('dates/unknown-fixed-field-is-not-content', 'An unknown fixed field written later is not a content field: it does not change Edited.', L(...dated((c) => c.raw('colour', 'red'))), ['edited', 'unknown'], { edited: 1000, unknown: ['colour'] });
  view('dates/unknown-repeated-field-is-not-content', 'Nor is an unknown repeated field (draft 2: the content fields are listed): Edited does not change.', L(...dated((c) => c.raw(`z/${id(1)}`, 'v'))), ['edited', 'unknown'], { edited: 1000, unknown: [`z/${id(1)}`] });
  view('dates/bookkeeping-fields-are-not-content', 'password_over, moved_from, history_hidden, source, edited and created written later do not change Edited.',
    L(...dated((c) => c.passwordOver(null).movedFrom(bytes(GID1), 5000).historyHidden([1, 0, bytes(AUTH.A), bytes(DEV[1]), 1]).source({ kind: 'k', id: 'i', baseline: bytes('0b') }))), ['edited'], { edited: 1000 });
  view('dates/a-clear-is-a-write-to-a-content-field', 'A clear of a content field is a write to it.', L(['A', 1, 1000, (c) => c.created(500).title('x').notes('n')], ['A', 1, 4000, (c) => c.remove('notes')]), ['edited'], { edited: 4000 });
  view('dates/wrong-shape-edited-falls-back', 'edited of the wrong shape counts as cleared: Edited is the latest content write.', L(['A', 1, 1000, (c) => c.created(500).title('x').raw('edited', 'soon')]), ['edited', 'invalid'], { edited: 1000, invalid: ['edited'] });

  // ------------------------------------------------------------------ section 6: deleting (draft 2: the explicit list of content fields)
  const del = [['A', 1, 1000, (c: ItemChange) => c.title('x').password('p')], ['A', 1, 2000, (c: ItemChange) => c.deleted(2000)]] as Spec[];
  view('deleted/control-no-later-write', 'deleted after every other write: the item is in Recently Deleted.', L(...del), ['deleted', 'deleted_at'], { deleted: true, deleted_at: 2000 });
  view('deleted/second-import-sets-source-stays-deleted', 'A second import sets source again after the item was deleted: source is not a content field, so the item stays deleted.',
    L(...del, ['B', 2, 3000, (c) => c.source({ kind: 'kdbx', id: 'abc', baseline: bytes('0c') })]), ['deleted', 'deleted_at'], { deleted: true, deleted_at: 2000 });
  view('deleted/second-import-sets-edited-and-created-stays-deleted', 'A later write of edited and created does not bring the item back.', L(...del, ['B', 2, 3000, (c) => c.edited(5).created(4)]), ['deleted'], { deleted: true });
  view('deleted/history-hidden-later-stays-deleted', 'Clear Previous Passwords (history_hidden) after the delete does not bring the item back.',
    L(...del, ['B', 2, 3000, (c) => c.historyHidden([1000, 0, bytes(AUTH.A), bytes(DEV[1]), 1])]), ['deleted'], { deleted: true });
  view('deleted/password-over-and-moved-from-later-stay-deleted', 'password_over and moved_from are not content fields.', L(...del, ['B', 2, 3000, (c) => c.passwordOver(null).movedFrom(bytes(GID1), 3000)]), ['deleted'], { deleted: true });
  view('deleted/content-edit-brings-it-back', 'A later write to a content field brings the item back.', L(...del, ['B', 2, 3000, (c) => c.title('x2')]), ['deleted', 'title'], { deleted: false, title: 'x2' });
  view('deleted/clear-of-content-field-brings-it-back', 'A later clear of a content field is an edit too.', L(...del, ['B', 2, 3000, (c) => c.remove('password')]), ['deleted'], { deleted: false });
  view('deleted/edit-before-the-delete-stays-deleted', 'A content write earlier than deleted in the order does not bring the item back.', L(['B', 2, 1500, (c) => c.title('x')], ['A', 1, 2000, (c) => c.deleted(2000)]), ['deleted'], { deleted: true });
  view('deleted/unknown-fixed-field-later-stays-deleted', 'An unknown fixed field written after the delete is not a content field: the item stays deleted, and Edited does not change.',
    L(['A', 1, 1000, (c) => c.created(500).title('x')], ['A', 1, 2000, (c) => c.deleted(2000)], ['B', 2, 3000, (c) => c.raw('colour', 'red')]), ['deleted', 'edited'], { deleted: true, edited: 1000 });
  view('deleted/unknown-repeated-field-later-stays-deleted', 'An unknown repeated field written after the delete is not a content field either (draft 2): the item stays deleted, and Edited does not change.',
    L(['A', 1, 1000, (c) => c.created(500).title('x')], ['A', 1, 2000, (c) => c.deleted(2000)], ['B', 2, 3000, (c) => c.raw(`z/${id(1)}`, 'v')]), ['deleted', 'edited'], { deleted: true, edited: 1000 });
  view('deleted/deleted-cleared', 'Clearing deleted restores the item.', L(...del, ['A', 1, 3000, (c) => c.remove('deleted')]), ['deleted'], { deleted: false });

  // ------------------------------------------------------------------ unknown fields
  const withUnknown = L(['A', 1, 1000, (c) => c.title('x').raw('colour', 'red').raw(`z/${id(5)}`, cmap([[1, 'v']])).password('p')]);
  const u = add('unknown/kept-through-a-checkpoint', 'A field of a later version (a fixed name and a repeated one) is never shown, never cleared by this version, and kept: a checkpoint carries one write of each, and the view of the checkpoint alone lists them.', 'schema.view',
    { changes: withUnknown, show: ['title', 'unknown', 'carried'], checkpoints: [{ include: [0] }], runs: [{ changes: [0], checkpoints: [] }, { changes: [], checkpoints: [0] }] });
  const wantU = { title: 'x', unknown: ['colour', `z/${id(5)}`], carried: ['colour', 'password', 'password_over', 'title', `z/${id(5)}`] };
  assert.deepEqual(u.expected.views, [wantU, wantU]);
  assert.deepEqual(u.expected.carries, [{ colour: 1, password: 1, password_over: 1, title: 1, [`z/${id(5)}`]: 1 }]);
  view('unknown/other-keys-in-a-known-map-are-kept-and-ignored', 'A known field whose map has keys the schema does not define keeps working: the extra key is kept and ignored.',
    L(['A', 1, 1000, (c) => c.raw(`web/${id(1)}`, cmap([[1, 'https://a'], [2, 'a'], [9, 'later version']]))]), ['websites', 'invalid'], { websites: [{ field: `web/${id(1)}`, address: 'https://a' }], invalid: [] });

  // ------------------------------------------------------------------ moving (schema 7, draft 2)
  const login = L(['A', 1, 1000, (c) => c.created(1000).type(1).title('Bank').username('ann').password('p1').website(id(1), 'https://bank.example', 'a').customField(id(2), 'PIN', '1234', true, 'a').tag(id(3), 'money')
    .raw('colour', 'red').raw(`z/${id(5)}`, cmap([[1, 'v']])).raw('notes', 5).passwordHistory([['imp', 9]]).historyHidden([1, 0, bytes(AUTH.A), bytes(DEV[1]), 1])],
    ['A', 1, 2000, (c, at) => c.password('p2', at(0)).remove('username')]);
  const moveIn = (name: string, description: string, changes: J[], show: string[], extra: J = {}) =>
    add(`move/${name}`, description, 'schema.move', { changes, from_gid: GID1, to_gid: GID2, now: 50_000, by: { author: AUTH.A, device: DEV[1] }, show, ...extra });
  const movedFromValue = { map: [[{ uint: '1' }, { bytes: GID1 }], [{ uint: '2' }, { uint: '50000' }]] };
  const m1 = moveIn('carries-the-list-of-schema-7', 'The first record sets every content field (here with a field of the wrong shape, notes) and every unknown field; created and edited from Added and Edited; moved_from; password_over null; clears moved and deleted (the item is not deleted); a cleared field (username), password_history and history_hidden are not carried. The second record, in the old group, sets moved. Earlier writes of password are not copied, so nothing is previous.',
    login, ['title', 'password', 'previous', 'password_note', 'added', 'edited', 'websites', 'custom_fields', 'tags', 'unknown', 'invalid', 'username', 'moved_from', 'deleted'], { values: ['created', 'edited', 'moved_from', 'password_over'] });
  assert.deepEqual(m1.expected.target_set, ['colour', 'created', 'edited', `f/${id(2)}`, 'moved_from', 'notes', 'password', 'password_over', `t/${id(3)}`, 'title', 'type', `web/${id(1)}`, `z/${id(5)}`].sort());
  assert.deepEqual(m1.expected.target_clear, ['deleted', 'moved']);
  assert.deepEqual(m1.expected.target_values, { created: { uint: '1000' }, edited: { uint: '2000' }, moved_from: movedFromValue, password_over: { null: true } });
  assert.deepEqual(m1.expected.source_set, { moved: { map: [[{ uint: '1' }, { bytes: GID2 }], [{ uint: '2' }, { uint: '50000' }]] } });
  assert.deepEqual(m1.expected.target_view, { title: 'Bank', password: 'p2', previous: [], added: 1000, edited: 2000, websites: [{ field: `web/${id(1)}`, address: 'https://bank.example' }],
    custom_fields: [{ field: `f/${id(2)}`, label: 'PIN', value: '1234', concealed: true }], tags: ['money'], unknown: ['colour', `z/${id(5)}`], invalid: ['notes'], moved_from: { gid: GID1, when: 50_000 }, deleted: false });
  assert.deepEqual(m1.expected.source_view, { shown: false, moved: { gid: GID2, when: 50_000 } });
  const imp = moveIn('imported-item-keeps-dates-and-source', 'An imported item moved: created and edited are the source\'s dates (shown as before), and source is carried so that a second import still finds the item.',
    imported(), ['added', 'edited', 'title'], { values: ['created', 'edited', 'source'] });
  assert.deepEqual(imp.expected.target_set, ['created', 'edited', 'moved_from', 'password', 'password_over', 'source', 'title']);
  assert.deepEqual(imp.expected.target_values.source, { map: [[{ uint: '1' }, { text: 'kdbx' }], [{ uint: '2' }, { text: 'abc' }], [{ uint: '3' }, { bytes: '0b' }]] });
  assert.deepEqual(imp.expected.target_view, { added: 100, edited: 200, title: 'Imported' });
  const dm = moveIn('deleted-item-stays-deleted', 'An item that is in Recently Deleted when moved: deleted is set in the first record, and the item arrives deleted (nothing in that record is later than it). It is not cleared.',
    L(['A', 1, 1000, (c) => c.title('x')], ['A', 1, 2000, (c) => c.deleted(2000)]), ['title', 'deleted', 'deleted_at'], { values: ['deleted'] });
  assert.deepEqual(dm.expected.target_clear, ['moved']); assert.deepEqual(dm.expected.target_values, { deleted: { uint: '2000' } });
  assert.deepEqual(dm.expected.target_view, { title: 'x', deleted: true, deleted_at: 2000 });
  const em = moveIn('deleted-then-edited-arrives-not-deleted', 'An item deleted, then edited (so it is back), then moved: deleted is still a field of the item, but the item is not in Recently Deleted, so it is cleared in the first record and the item arrives not deleted.',
    L(['A', 1, 1000, (c) => c.title('x')], ['A', 1, 2000, (c) => c.deleted(2000)], ['A', 1, 3000, (c) => c.title('x2')]), ['title', 'deleted'], {});
  assert.deepEqual(em.expected.target_clear, ['deleted', 'moved']); assert(!em.expected.target_set.includes('deleted'));
  assert.deepEqual(em.expected.target_view, { title: 'x2', deleted: false });
  const back = moveIn('back-clears-moved-and-the-fields-the-copy-lacks', 'Moving it back to the group it left (which still holds the old copy, marked moved): the first record also clears moved (draft 2). The old copy has a field (notes) the item no longer has: the schema does not say, and a stale field would reappear, so it is cleared too (given the old copy).',
    L(['A', 1, 1500, (c) => c.created(1000).title('Bank 2')]), ['title', 'notes', 'shown', 'moved_from'],
    { from_gid: GID2, to_gid: GID1, now: 60_000, target_changes: L(['A', 1, 1000, (c) => c.created(1000).title('Bank').notes('old')], ['A', 1, 2000, (c) => c.moved(bytes(GID2), 1500)]) });
  assert.deepEqual(back.expected.target_clear, ['deleted', 'moved', 'notes']);
  assert.deepEqual(back.expected.target_view, { title: 'Bank 2', shown: true, moved_from: { gid: GID2, when: 60_000 } });

  // classifying the same item_id in two groups
  const orig = (wall = 1000): Spec => ['A', 1, wall, (c) => c.created(1000).title('Bank').password('p')];
  const arrival = (wall: number, from: string): Spec => ['A', 1, wall, (c) => c.created(1000).title('Bank').password('p').movedFrom(bytes(from), wall).passwordOver(null)];
  const marked = (wall: number, to: string, at: number): Spec => ['A', 1, wall, (c) => c.moved(bytes(to), at)];
  const classify = (name: string, description: string, a: Spec[], b: Spec[], want: J) =>
    add(`classify/${name}`, description, 'schema.classify', { a: { gid: GID1, changes: L(...a) }, b: { gid: GID2, changes: L(...b) } }, want);
  classify('moved-completed', 'Group 2 holds the arrived copy (moved_from names group 1) and group 1 has moved, naming group 2, later than that: the move is complete.', [orig(), marked(4000, GID2, 3500)], [arrival(3000, GID1)], { kind: 'moved', from: GID1, to: GID2 });
  classify('interrupted-after-the-first-write', 'Group 2 holds the arrived copy and group 1 has no moved: the first record was written and the second was not. The device that wrote the first finishes with moved in group 1.', [orig()], [arrival(3000, GID1)],
    { kind: 'move_in_progress', from: GID1, to: GID2, mark_on: GID1 });
  classify('interrupted-and-edited-in-the-target', 'The arrived copy was edited before the second record: still an interrupted move (the rule does not look at the content).', [orig()], [arrival(3000, GID1), ['B', 2, 3500, (c) => c.title('Bank 2')]],
    { kind: 'move_in_progress', from: GID1, to: GID2, mark_on: GID1 });
  classify('an-older-moved-is-no-completion', 'Group 1 carries a moved from an earlier trip that is older than the arrival: it is not the second record of this move: in progress.', [orig(), marked(2000, GID2, 1500)], [arrival(3000, GID1)],
    { kind: 'move_in_progress', from: GID1, to: GID2, mark_on: GID1 });
  classify('moved-to-a-third-group-is-no-completion', 'Group 1 moved the item later, but to a third group: not the second record of the move to group 2.', [orig(), marked(4000, GID3, 3500)], [arrival(3000, GID1)],
    { kind: 'move_in_progress', from: GID1, to: GID2, mark_on: GID1 });
  classify('same-item-id-without-moved-from-is-separate', 'The same item_id and the same content in two groups, and no moved_from from one to the other: two separate items.', [orig()], [orig(3000)], { kind: 'separate' });
  classify('moved-from-names-a-third-group-is-separate', 'The copy in group 2 came from a third group: not from group 1: two separate items.', [orig()], [arrival(3000, GID3)], { kind: 'separate' });
  classify('moved-without-moved-from-is-separate', 'Group 1 is marked moved towards group 2 but the copy there has no moved_from (written by something else): no move is recognised.', [orig(), marked(4000, GID2, 3500)], [orig(3000)], { kind: 'separate' });
  const back1: Spec[] = [orig(), marked(2000, GID2, 1500), ['A', 1, 5000, (c) => c.created(1000).title('Bank').password('p').movedFrom(bytes(GID2), 5000).passwordOver(null).remove('moved')]];
  classify('there-and-back-completed', 'Moved to group 2 and back: both copies carry moved_from naming the other; the later one (group 1, which also cleared moved) says the item last went to group 1, and group 2 has moved, naming group 1, later: complete, from group 2 to group 1.',
    back1, [arrival(3000, GID1), marked(6000, GID1, 5500)], { kind: 'moved', from: GID2, to: GID1 });
  classify('back-interrupted-after-the-first-write', 'The same, and the device stopped after the first record of the way back: group 2 is not marked: in progress from group 2 to group 1.', back1, [arrival(3000, GID1)],
    { kind: 'move_in_progress', from: GID2, to: GID1, mark_on: GID2 });

  // ------------------------------------------------------------------ section 8: settings
  const Z = '00'.repeat(16);
  const settings = (name: string, description: string, changes: J[], want: J) => add(`settings/${name}`, description, 'schema.view', { item: Z, as: 'settings', changes }, { view: want });
  const goneField1 = `gone/${sha('kdbx', 'abc')}`;
  settings('name-and-gone-entry', 'The settings item holds the group\'s name and gone/id entries for imported items deleted for good.',
    L(['A', 1, 1000, (c) => c.groupName('Family').gone('kdbx', 'abc', 900)]), { name: 'Family', gone: [{ field: goneField1, kind: 'kdbx', id: 'abc', when: 900 }], invalid: [], unknown: [] });
  settings('name-written-on-two-devices-later-wins', 'The name merges like any field: the later write wins.',
    L(['A', 1, 1000, (c) => c.groupName('Family')], ['B', 2, 2000, (c) => c.groupName('Home')]), { name: 'Home', gone: [], invalid: [], unknown: [] });
  settings('gone-entry-cleared', 'A gone entry can be cleared (the person imports the item again on purpose).',
    L(['A', 1, 1000, (c) => c.gone('kdbx', 'abc', 900)], ['A', 1, 2000, (c) => c.remove(goneField1)]), { gone: [], invalid: [], unknown: [] });
  settings('gone-entry-with-the-wrong-id-is-invalid', 'A gone/id whose id is not the hash of its kind and id is of the wrong shape: treated as cleared and kept.',
    L(['A', 1, 1000, (c) => c.raw(`gone/${id(7)}`, cmap([[1, 'kdbx'], [2, 'abc'], [3, 900]]))]), { gone: [], invalid: [`gone/${id(7)}`], unknown: [] });
  settings('name-of-the-wrong-shape', 'name that is not text counts as cleared.', L(['A', 1, 1000, (c) => c.raw('name', 5)]), { gone: [], invalid: ['name'], unknown: [] });
  settings('unknown-fields-and-item-fields-are-kept-not-shown', 'In the settings item, a field the schema does not define for it (an item field such as title, a later version\'s field) is kept and not shown.',
    L(['A', 1, 1000, (c) => c.raw('title', 'x').raw('colour', 'red').raw(`web/${id(1)}`, cmap([[1, 'https://a'], [2, 'a']]))]), { gone: [], invalid: [], unknown: ['colour', 'title', `web/${id(1)}`] });
  settings('two-gone-entries-in-order', 'gone entries are listed in order of their field names.',
    L(['A', 1, 1000, (c) => c.gone('kdbx', 'b', 1).gone('kdbx', 'a', 2)]), (() => {
      const l = [['kdbx', 'a', 2], ['kdbx', 'b', 1]].map(([k, i2, w2]) => ({ field: `gone/${sha(k as string, i2 as string)}`, kind: k, id: i2, when: w2 })).sort((x, y) => (x.field < y.field ? -1 : 1));
      return { gone: l, invalid: [], unknown: [] };
    })());
  add('settings/name-is-not-normalised-by-the-reader', 'The reader shows the name as written: a writer normalises, a reader does not change what it finds.', 'schema.view',
    { item: Z, as: 'settings', changes: L({ clock: [1000, 0], author: AUTH.A, device: DEV[1], seq: 1, set: [['name', { text: 'é' }]], clear: [] }) }, { view: { name: 'é', gone: [], invalid: [], unknown: [] } });

  // ------------------------------------------------------------------ sizes, reader side: what a reader finds it shows
  const big = (name: string, description: string, change: J, show: string[], want: J) => view(name, description, [change], show, want);
  big('size/reader-shows-a-title-over-the-limit', 'A reader shows a text of 65,537 bytes it finds: the limit binds the writer only.', bigText('A', 1, 1000, 'title', 65_537), ['title_bytes', 'invalid'], { title_bytes: 65_537, invalid: [] });
  big('size/reader-shows-notes-over-the-limit', 'A reader shows notes of 262,145 bytes.', bigText('A', 1, 1000, 'notes', 262_145), ['notes_bytes', 'invalid'], { notes_bytes: 262_145, invalid: [] });
  const many = add('size/reader-shows-65-websites-count', 'A reader shows all 65 websites it finds: sixty-five entries in the view.', 'schema.view',
    { changes: L(...Array.from({ length: 65 }, (_, n) => ['A', 1, 1000 + n, web(n + 1, 'https://a', 'a')] as Spec)), show: ['websites'] });
  assert.equal(many.expected.view.websites.length, 65);
  const manyTags = add('size/reader-shows-65-tags', 'And 65 tags.', 'schema.view', { changes: L(...Array.from({ length: 65 }, (_, n) => ['A', 1, 1000 + n, (c: ItemChange) => c.tag(id(n + 1), `tag${String(n).padStart(2, '0')}`)] as Spec)), show: ['tags'] });
  assert.equal(manyTags.expected.view.tags.length, 65);

  return file('The item schema (docs/format-schema.md, draft 1): field names and shapes, positions, builders, the view (previous passwords, dates, deleting), unknown fields, moving an item, and the settings item. Expectations are written by hand from the schema\'s sentences; where a sentence leaves a choice, the description of the vector says which reading was taken.', o);
}
