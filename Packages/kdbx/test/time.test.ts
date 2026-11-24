// KeePass time parsing and formatting: both forms, and the edge cases the app's Swift parser learned (Tests/KDBX/TimeFuzz.swift).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTimeIso, formatTimeTicks, isIsoTime, parseTime } from '../src/index.ts';
import { seeded } from './support.ts';

const base = 1_614_834_367; // 2021-03-04T05:06:07Z
const seconds = (text: string) => { const d = parseTime(text); return d ? d.getTime() / 1000 : undefined; };

test('time: plain ISO text is read as UTC', () => {
  assert.equal(seconds('2021-03-04T05:06:07Z'), base);
});

test('time: fractional seconds are read (first nine digits count, the rest are ignored)', () => {
  assert.equal(seconds('2021-03-04T05:06:07.250Z'), base + 0.25);
  assert.ok(Math.abs(seconds('2021-03-04T05:06:07.12345678901234567890Z')! - (base + 0.123)) < 0.002);
  const many = '2021-03-04T05:06:07.' + '9'.repeat(5000) + 'Z';
  assert.doesNotThrow(() => parseTime(many), 'thousands of fractional digits must not throw');
  assert.equal(seconds('2021-03-04T05:06:07.Z'), undefined, 'a dot with no digits is not a time');
});

test('time: zone offsets with and without a colon are applied; an offset out of range is not a time', () => {
  assert.equal(seconds('2021-03-04T07:06:07+02:00'), base);
  assert.equal(seconds('2021-03-03T23:36:07-0530'), base);
  assert.equal(seconds('2021-03-04T07:06:07+24:00'), undefined);
  assert.equal(seconds('2021-03-04T07:06:07+02:60'), undefined);
});

test('time: a calendar date that does not exist is not a time (30 February is not 2 March)', () => {
  assert.equal(seconds('2021-02-30T00:00:00Z'), undefined);
  assert.equal(seconds('2020-02-30T00:00:00Z'), undefined);
  assert.notEqual(seconds('2020-02-29T00:00:00Z'), undefined, 'leap day of a leap year');
  assert.notEqual(seconds('2000-02-29T00:00:00Z'), undefined, '2000 is a leap year');
  assert.equal(seconds('2021-02-29T00:00:00Z'), undefined);
  assert.equal(seconds('2100-02-29T00:00:00Z'), undefined, '2100 is not a leap year');
});

test('time: 31 April, month 13, day 0, hour 24 and minute 60 are not times', () => {
  for (const t of ['2021-04-31T00:00:00Z', '2021-13-01T00:00:00Z', '2021-01-00T00:00:00Z', '2021-01-01T24:00:00Z', '2021-01-01T00:60:00Z']) {
    assert.equal(seconds(t), undefined, t);
  }
});

test('time: year 0 is not a time; year 1 and year 9999 are, and year 1 equals base64 zero', () => {
  assert.equal(seconds('0000-01-01T00:00:00Z'), undefined);
  assert.equal(parseTime('0001-01-01T00:00:00Z')!.getTime(), parseTime('AAAAAAAAAAA=')!.getTime());
  assert.equal(seconds('9999-12-31T23:59:59Z'), 253_402_300_799);
});

test('time: no zone, a stray tail, empty text and a lone Z are not times', () => {
  for (const t of ['2021-03-04T05:06:07', '2021-03-04T05:06:07Zx', '2021-03-04T05:06:07Z ZZ', '', 'Z']) assert.equal(seconds(t), undefined, JSON.stringify(t));
});

test('time: an embedded NUL is not a time', () => {
  assert.equal(seconds('2021-03-04T05:06:\u00007Z'), undefined);
  assert.equal(seconds('\u0000'), undefined);
});

test('time: 8 bytes of base64 are read, and those beyond year 9999 are not a time', () => {
  assert.equal(parseTime('v2HS1w4AAAA=')!.getTime(), base * 1000);
  assert.equal(seconds('//////////8='), undefined);
});

test('time: base64 of another length is not a time, and isIsoTime tells the two forms apart', () => {
  assert.equal(seconds('v2HS1w4A'), undefined);
  assert.ok(isIsoTime('2021-03-04T05:06:07Z'));
  assert.ok(!isIsoTime('v2HS1w4AAAA='));
});

test('time: formatting to the KDBX 4 form gives the values the app pinned (Tests/KDBX/main.swift)', () => {
  assert.equal(formatTimeTicks(new Date(base * 1000)), 'v2HS1w4AAAA=');
  assert.equal(formatTimeTicks(new Date('2022-11-23T12:34:56Z')), 'cAoQ2w4AAAA=');
  assert.equal(formatTimeTicks(new Date(0)), 'APeRdw4AAAA=', 'the Unix epoch');
  assert.equal(formatTimeTicks(new Date(-62_135_596_800_000)), 'AAAAAAAAAAA=', 'year 1 is zero');
  assert.equal(formatTimeTicks(new Date(base * 1000 + 900)), 'v2HS1w4AAAA=', 'rounds down to the second');
});

test('time: a time that is not a number or is beyond years 1 to 9999 is clamped, never thrown', () => {
  assert.equal(formatTimeTicks(new Date(Number.NaN)), 'APeRdw4AAAA=', 'an invalid date becomes the epoch, as in the app');
  assert.equal(formatTimeTicks(new Date(8.64e15)), 'fziGd0kAAAA=', 'the far future is the end of year 9999');
  assert.equal(formatTimeTicks(new Date(-8.64e15)), 'AAAAAAAAAAA=', 'the far past is year 1');
  assert.equal(formatTimeIso(new Date(Number.NaN)), '1970-01-01T00:00:00Z');
  assert.equal(formatTimeIso(new Date(8.64e15)), '9999-12-31T23:59:59Z');
  assert.equal(formatTimeIso(new Date(-8.64e15)), '0001-01-01T00:00:00Z');
});

test('time: the ISO form is whole seconds with a Z, and it parses back', () => {
  assert.equal(formatTimeIso(new Date(base * 1000 + 999)), '2021-03-04T05:06:07Z');
  assert.equal(parseTime(formatTimeIso(new Date('1999-12-31T23:59:59Z')))!.toISOString(), '1999-12-31T23:59:59.000Z');
  assert.equal(parseTime(formatTimeTicks(new Date('1999-12-31T23:59:59Z')))!.toISOString(), '1999-12-31T23:59:59.000Z');
});

test('time: 7,000 random and adversarial strings return without throwing, and no date outside years 1 to 9999 comes back', () => {
  const random = seeded('time-fuzz');
  const next = () => new DataView(random(8).buffer).getUint32(0, true);
  const pick = <T>(items: T[]): T => items[next() % items.length]!;
  const pieces = ['2021', '0000', '9999', '99999999999999999999', '-', '+', ':', 'T', 'Z', '.', ' ', '\u0000', '٢٠٢١', '０１', 'ÿ', 'e', '03', '04', '05', '06', '07',
    '60', '61', '24', '12345678901234567890', '7'.repeat(400), '\n', '=', 'A', '/', '+02:00'];
  const strings: string[] = [];
  for (let i = 0; i < 4000; i++) strings.push(Array.from({ length: next() % 14 }, () => pick(pieces)).join(''));
  const valid = '2021-03-04T05:06:07.5Z';
  for (let i = 0; i < 2000; i++) {
    const c = Array.from(valid);
    const at = next() % c.length;
    switch (next() % 3) {
      case 0: c[at] = pick(Array.from('0123456789-:TZ.+ \u0000９')); break;
      case 1: c.splice(at, 0, pick(pieces)); break;
      default: c.splice(at, 1 + (next() % 4));
    }
    strings.push(c.join(''));
  }
  for (let i = 0; i < 1000; i++) {
    const bytes = Buffer.from(random(8)).toString('base64');
    strings.push(bytes, bytes.slice(0, next() % 13));
  }
  strings.push('9'.repeat(10_000), '+'.repeat(1000), '2021-03-04T05:06:07.' + '0'.repeat(100_000) + 'Z', '2021-03-04T05:06:07Z'.repeat(1000),
    '9999999999999999999-01-01T00:00:00Z', '-99999-01-01T00:00:00Z');
  let outOfRange = 0;
  for (const text of strings) {
    const d = parseTime(text);
    if (d && (d.getTime() < -62_135_596_800_000 || d.getTime() > 253_402_300_800_000)) outOfRange++;
    isIsoTime(text);
  }
  assert.equal(outOfRange, 0);
});
