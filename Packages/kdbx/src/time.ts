// KeePass times. KDBX 3 writes ISO 8601 text in UTC; KDBX 4 writes base64 of an 8-byte little-endian count of seconds
// since 0001-01-01T00:00:00Z. Both are read, whatever the file version (other writers mix them). Whole seconds are kept
// on write. The reader returns undefined for what it cannot read; it never throws.

const EPOCH_OFFSET = 62_135_596_800; // seconds from 0001-01-01 to 1970-01-01
const LATEST = 253_402_300_799; // 9999-12-31T23:59:59Z as Unix seconds

function parseIso(value: string): Date | undefined {
  const len = value.length;
  if (len < 20 || len >= 200) return undefined;
  const digit = (i: number) => {
    const c = value.charCodeAt(i);
    return c >= 48 && c <= 57 ? c - 48 : -1;
  };
  // Exactly `count` ASCII digits at `at`, as a number; at most nine, so nothing overflows.
  const number = (at: number, count: number): number | undefined => {
    if (at < 0 || count <= 0 || count > 9 || at + count > len) return undefined;
    let v = 0;
    for (let i = at; i < at + count; i++) {
      const d = digit(i);
      if (d < 0) return undefined;
      v = v * 10 + d;
    }
    return v;
  };
  const sep = (i: number, ch: string) => value[i] === ch;
  if (!sep(4, '-') || !sep(7, '-') || !sep(10, 'T') || !sep(13, ':') || !sep(16, ':')) return undefined;
  const y = number(0, 4), m = number(5, 2), d = number(8, 2), hh = number(11, 2), mm = number(14, 2), ss = number(17, 2);
  if (y === undefined || m === undefined || d === undefined || hh === undefined || mm === undefined || ss === undefined) return undefined;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || hh >= 24 || mm >= 60 || ss >= 61) return undefined;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const monthLength = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  if (d < 1 || d > monthLength) return undefined;

  let pos = 19;
  let fraction = 0;
  if (value[pos] === '.') {
    pos++;
    const start = pos;
    while (pos < len && digit(pos) >= 0) pos++;
    const digits = pos - start;
    if (digits === 0) return undefined;
    const used = Math.min(digits, 9);
    fraction = number(start, used)! / 10 ** used;
  }
  let offset = 0;
  if (pos >= len) return undefined;
  if (value[pos] === 'Z') {
    pos++;
  } else if (value[pos] === '+' || value[pos] === '-') {
    const sign = value[pos] === '+' ? 1 : -1;
    const oh = number(pos + 1, 2);
    if (oh === undefined) return undefined;
    let next = pos + 3;
    if (next < len && value[next] === ':') next++;
    const om = number(next, 2);
    if (om === undefined || oh >= 24 || om >= 60) return undefined;
    offset = sign * (oh * 3600 + om * 60);
    pos = next + 2;
  } else {
    return undefined;
  }
  if (pos !== len) return undefined;
  // Days from civil date (proleptic Gregorian), Howard Hinnant's algorithm.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146_097 + doe - 719_468;
  const seconds = days * 86_400 + hh * 3600 + mm * 60 + ss - offset;
  if (seconds < -EPOCH_OFFSET || seconds > LATEST + 1) return undefined;
  return new Date(Math.round((seconds + fraction) * 1000));
}

/** Reads both forms. Returns undefined when the text is neither, or names a date outside years 1 to 9999. */
export function parseTime(text: string): Date | undefined {
  const value = text.trim();
  const iso = parseIso(value);
  if (iso) return iso;
  if (/^[A-Za-z0-9+/]{11}=$/.test(value)) {
    const b = Buffer.from(value, 'base64');
    if (b.length === 8) {
      const seconds = b.readBigUInt64LE(0);
      if (seconds > BigInt(LATEST + EPOCH_OFFSET)) return undefined;
      return new Date((Number(seconds) - EPOCH_OFFSET) * 1000);
    }
  }
  return undefined;
}

/** Whether the text is the ISO form rather than the base64 ticks. */
export function isIsoTime(text: string): boolean {
  return parseIso(text.trim()) !== undefined;
}

function clampedSeconds(date: Date): number {
  let v = Math.floor(date.getTime() / 1000);
  if (!Number.isFinite(v)) v = 0;
  return Math.min(Math.max(v, -EPOCH_OFFSET), LATEST);
}

/** The KDBX 4 form: base64 of the little-endian seconds since year 1. Rounded down; clamped to years 1 to 9999. */
export function formatTimeTicks(date: Date): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(clampedSeconds(date) + EPOCH_OFFSET));
  return b.toString('base64');
}

/** The KDBX 3 form: `YYYY-MM-DDTHH:MM:SSZ`. */
export function formatTimeIso(date: Date): string {
  return new Date(clampedSeconds(date) * 1000).toISOString().slice(0, 19) + 'Z';
}
