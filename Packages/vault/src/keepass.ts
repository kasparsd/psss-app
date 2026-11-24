// The KeePass mapping (docs/items.md, "KeePass field mapping"; docs/format-schema.md, section 10): a KDBX database to Psss items on the way in,
// Psss items to a KDBX database on the way out. Pure functions over the codec model: no prompts, no output, no files. They return what
// they changed or left out as typed reports. A report names things (an item's title, a kind of field) and never holds a value.
//
// The reading side follows `EntryMapping.item(from:)` in App/Core/KDBX/KeePassEntries.swift case by case (kinds, the PSSS_TYPE hint, a
// field mapping in PSSS_FIELD_MAPPING, canonical roles, custom fields and their protected flags, verification codes in all three
// forms, passkeys, Recycle Bin, previous passwords). Where this file differs from the Swift code, `DEVIATIONS` says so, and the docs repeat it.
import { createHash, createPrivateKey } from 'node:crypto';
import {
  addAttachment, hasInvalidXmlCharacters, newDatabase, newEntry, newGroup, parseTime, stripInvalidXmlCharacters,
} from '../../kdbx/src/index.ts';
import type { KdbxDatabase, KdbxEntry, KdbxField, KdbxGroup, RandomSource } from '../../kdbx/src/index.ts';

export const DEVIATIONS = [
  'Further websites (KP2A_URL, KP2A_URL_1, ...) become websites of the item, as docs/format-schema.md section 10 says; the app shows them as Other fields.',
  'Folders are not kept: the record-log vault has groups and tags and no folders, so an import flattens them and says how many items were in one.',
  'A password history belongs to logins only, as in the app; for other kinds the earlier values are not imported and the report says so.',
  'A Wi-Fi network (PSSS_TYPE wifi) becomes a custom item: the network name is its username, Security and Hidden network are ordinary fields. The record format has four item kinds and none for Wi-Fi, so the kind is not kept, and an export writes such an item as a custom item.',
  'Entries that share one UUID in a file become separate items: the first keeps the UUID, each later one gets an id derived from it and its place among the entries with that UUID. None overwrites another.',
] as const;

// ---------------------------------------------------------------- the names the app reserves

const STANDARD = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
const OTP_KEYS = ['otp', 'TimeOtp-Secret-Base32', 'TOTP Seed', 'TimeOtp-Length', 'TimeOtp-Period', 'TimeOtp-Algorithm'];
const TYPE_KEY = 'PSSS_TYPE';
const MAPPING_KEY = 'PSSS_FIELD_MAPPING';
const PASSKEY_CREATED = 'PSSS_PASSKEY_CREATED';
const PK = { credential: 'KPEX_PASSKEY_CREDENTIAL_ID', key: 'KPEX_PASSKEY_PRIVATE_KEY_PEM', rp: 'KPEX_PASSKEY_RELYING_PARTY', user: 'KPEX_PASSKEY_USERNAME', handle: 'KPEX_PASSKEY_USER_HANDLE' } as const;
const PASSKEY_KEYS: string[] = Object.values(PK);
const SECURITY_CODE = 'Security code', PIN = 'PIN', EXPIRY = 'Expiry', VALID_FROM = 'Valid from', ISSUER = 'Card issuer';
const DELETED_AT = 'PSSS_DELETED_AT', DELETED_FROM = 'PSSS_DELETED_FROM';

/** Strings that are the app's own plumbing, never a field: exactly the ones `EntryMapping.internalStrings` names in the Swift source (the
 *  passkey strings, the type hint and mapping, and two retired names). Any other PSSS_ string is an ordinary field, as in the app. */
const INTERNAL_STRINGS = new Set<string>([...PASSKEY_KEYS, PASSKEY_CREATED, TYPE_KEY, MAPPING_KEY, 'PSSS_SOURCE', 'PSSS_IMPORT_HASHES']);
const isInternal = (key: string): boolean => INTERNAL_STRINGS.has(key);

/** Field names the app recognizes as a role, matched with case, spaces, dashes and punctuation removed. One table for the TS side;
 *  `test/keepass.test.ts` compares it with the text of `FieldRole.aliases` in App/Core/VaultItem.swift. */
export const FIELD_ROLE_ALIASES: Record<string, string[]> = {
  username: ['username', 'loginname', 'accountname', 'email', 'emailaddress', 'user', 'userid', 'login'],
  password: ['password', 'loginpassword', 'currentpassword', 'pass', 'passwd', 'pwd', 'passphrase'],
  oneTimeCode: [],
  cardholder: ['nameoncard', 'cardholder', 'cardholdername', 'ccname', 'owner', 'holder', 'cardowner'],
  cardNumber: ['cardnumber', 'cardno', 'creditcardnumber', 'ccnumber', 'ccnum', 'pan', 'number', 'creditcard', 'creditcardno'],
  expiry: ['expiry', 'expiration', 'expirydate', 'expirationdate', 'validthru', 'validthrough', 'ccexp', 'exp', 'expdate', 'expires', 'validuntil', 'goodthru'],
  securityCode: ['cvv', 'cvv2', 'cvc', 'cvc2', 'csc', 'securitycode', 'cardsecuritycode', 'cccsc', 'cvn', 'cid', 'verificationnumber', 'verificationvalue'],
  loginWebsite: ['url', 'website', 'loginurl', 'site', 'uri', 'link', 'webaddress', 'homepage'],
};
const SENSITIVE_ROLES = ['password', 'cardNumber', 'securityCode', 'oneTimeCode'];
export const normalizedName = (name: string): string => [...name.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('');
/** StoredItemField.concealed: protected in the file, or named like a secret. */
export function concealedField(key: string, isProtected: boolean): boolean {
  if (isProtected) return true;
  const n = normalizedName(key);
  return SENSITIVE_ROLES.some((r) => FIELD_ROLE_ALIASES[r]!.includes(n)) || ['pin', 'otp', 'totpseed', 'timeotpsecretbase32'].includes(n);
}

// ---------------------------------------------------------------- shapes

export interface OtpSpec { secret: Uint8Array; digits: number; period: number; algorithm: 1 | 2 | 3; issuer?: string; account?: string }
export interface PasskeySpec { credentialId: Uint8Array; privateKey: Uint8Array; relyingParty: string; userName: string; userHandle: Uint8Array; created: number }
export interface CustomSpec { label: string; value: string; concealed: boolean }
export interface AttachmentSpec { name: string; data: Uint8Array }

/** An item as the vault stores it, before it has an id: what an import produces and what the vault turns into one record. */
export interface ItemSpec {
  /** the entry's UUID, 32 lowercase hexadecimal digits */
  uuid: string;
  /** `keepass:<uuid>`: the `source` field of the item is kind `keepass`, id the UUID */
  sourceId: string;
  type: 1 | 2 | 3 | 4;
  title?: string;
  username?: string;
  password?: string;
  notes?: string;
  websites: string[];
  otp?: OtpSpec;
  passkey?: PasskeySpec;
  cardholder?: string;
  card?: { number: string; year?: number; month?: number };
  cardCode?: string;
  cardPin?: string;
  custom: CustomSpec[];
  tags: string[];
  attachments: AttachmentSpec[];
  /** earlier passwords, newest first, at most 10 (logins only) */
  previous: { value: string; replaced: number }[];
  created?: number;
  edited?: number;
  /** present for an entry that was in the KeePass Recycle Bin (only read with `includeTrash`) */
  deletedAt?: number;
  /** the groups the entry was in, from below the root down */
  folder: string[];
}

export type IssueKind =
  | 'invalidCharacters' | 'unreadableValue' | 'unreadableCode' | 'extraCode' | 'passkeyKept' | 'attachmentTooLarge' | 'attachmentLimit'
  | 'historyTrimmed' | 'historyOtherFields' | 'historyNotLogin' | 'foldersFlattened' | 'dateMissing' | 'tooMany' | 'tooLarge'
  | 'mappingNeedsReview' | 'protectedKept' | 'trashedInSource' | 'duplicateId'
  // decisions of an import against what the vault holds
  | 'similarLogin' | 'mergeConflict' | 'changedInFile' | 'inRecycleBin' | 'deletedByPerson' | 'itemRefused'
  // export
  | 'renamedField' | 'fieldRefused' | 'charactersStripped' | 'passkeyNotWritten' | 'attachmentUnreadable' | 'unknownFieldsLeft';
export interface ReportIssue {
  kind: IssueKind;
  /** the item's title (or its first website), never a value; cut to `NAME_LENGTH` characters */
  item?: string;
  /** which part of an item the sentence is about (`The title`, `A field`), so that findings are grouped by kind and part and each line says what is true of all of them */
  field?: string;
  /** one plain sentence, never a value */
  detail: string;
}

/** The longest name of an item or a field that a report carries. */
export const NAME_LENGTH = 60;
/** A name cut to `NAME_LENGTH` characters, with an ellipsis, so that one odd title cannot make a report as long as the file. */
export function shortName(text: string): string {
  const chars = [...text];
  return chars.length > NAME_LENGTH ? `${chars.slice(0, NAME_LENGTH - 1).join('')}\u2026` : text;
}
/** The name an item goes by in a report: its title, else its first website or its username. */
export const nameOf = (s: { title?: string; websites: string[]; username?: string }): string => shortName(s.title ?? s.websites[0] ?? s.username ?? '(no name)');

/** Limits of what one item can hold, from the item schema, applied before anything is built. */
export const ITEM_LIMITS = { text: 65_536, notes: 262_144, websites: 64, customFields: 128, tags: 64, attachments: 64, attachmentBytes: 64 * 1024 * 1024, previous: 10 } as const;

export interface ReadOptions {
  /** strip characters XML cannot hold from a field instead of refusing the field */
  stripInvalid?: boolean;
  /** read the entries of the Recycle Bin as deleted items instead of leaving them out */
  includeTrash?: boolean;
  /** the clock, in milliseconds (a deleted entry without evidence is dated now) */
  now: number;
}
export interface ReadResult {
  items: ItemSpec[];
  /** entries in the Recycle Bin that were left out */
  trashed: number;
  /** items whose password history holds more than the ten the format keeps, etc.: see issues */
  issues: ReportIssue[];
  /** entries with no creation date */
  missingDates: number;
  /** items that were in a folder below the root group */
  inFolders: number;
  /** characters removed because the file's value could not be stored (only with stripInvalid) */
  strippedFields: number;
  /** fields that were not imported for their characters, or their size */
  refusedFields: number;
  /** of those, the ones refused for characters a KeePass file cannot hold (`--strip-invalid` brings them in) */
  invalidFields: number;
  /** entries that shared a UUID with an earlier entry of the file: each was read as an item of its own, under an id derived from the UUID */
  duplicates: number;
}

// ---------------------------------------------------------------- small helpers

const nfc = (s: string) => s.normalize('NFC');
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const ms = (d: Date | undefined): number | undefined => (d && Number.isFinite(d.getTime()) ? d.getTime() : undefined);

/** The host of an address, as the app names a login that has no title (SiteMatch.normalizedHost): scheme, user, port, path and leading `www.` dropped. A port of this function without the public suffix list. */
export function hostOf(address: string): string {
  let text = address.trim();
  if (text === '') return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (scheme) {
    const rest = text.slice(scheme[0].length);
    if (rest.startsWith('//')) text = rest.slice(2);
    else if (!/^[0-9]+(?:[/?#]|$)/.test(rest)) return '';
  }
  text = text.split(/[/?#]/, 1)[0]!;
  if (text === '' || /[\s\\%@]/.test(text)) return '';
  text = text.toLowerCase();
  const colons = (text.match(/:/g) ?? []).length;
  if (colons > 1) return '';
  if (colons === 1) { const [h, p] = text.split(':') as [string, string]; if (!/^[0-9]{1,5}$/.test(p)) return ''; text = h; }
  text = text.replace(/\.$/, '');
  if (!/^[a-z0-9_.-]+$/.test(text)) return '';
  const labels = text.split('.');
  if (labels.some((l) => l === '' || l.length > 63)) return '';
  let start = 0;
  while (start + 1 < labels.length && labels[start] === 'www' && labels.length - start > 2) start++;
  return labels.slice(start).join('.');
}

// ---------------------------------------------------------------- Base32 and verification codes (App/Core/TOTP.swift)

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Decode(text: string): Uint8Array | null {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of text) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(out);
}
export function base32Encode(data: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of data) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** TOTP.normalizedSecret: a bare Base32 secret (spaces, dashes and padding allowed) or an otpauth://totp link; the clean secret, or null. At least 10 bytes. */
export function normalizedSecret(input: string): string | null {
  let text = input.trim();
  if (/^otpauth:\/\//i.test(text)) {
    const link = parseOtpLink(text);
    if (!link || link.host !== 'totp') return null;
    const v = link.query.get('secret');
    if (v === undefined) return null;
    text = v;
  }
  const cleaned = text.toUpperCase().replace(/[ \-=]/g, '');
  const key = cleaned === '' ? null : base32Decode(cleaned);
  return key && key.length >= 10 ? cleaned : null;
}

function parseOtpLink(text: string): { host: string; path: string; query: Map<string, string> } | null {
  const m = /^otpauth:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(text);
  if (!m) return null;
  const query = new Map<string, string>();
  const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  for (const pair of (m[3] ?? '').split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const k = dec(eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
    if (!query.has(k)) query.set(k, eq < 0 ? '' : dec(pair.slice(eq + 1)));
  }
  return { host: m[1]!.toLowerCase(), path: dec(m[2]!), query };
}

const ALGORITHMS: Record<string, 1 | 2 | 3> = { SHA1: 1, SHA256: 2, SHA512: 3 };
export type OtpParse = { kind: 'setup'; otp: OtpSpec } | { kind: 'empty' | 'webLink' | 'migration' | 'unsupported' | 'invalidKey' };

/** TOTP.parse: a pasted setup key or an otpauth link (also KeePassXC's `key=...&size=...&step=...` form). Digits 6 to 8, period 1 to 3600. */
export function parseOtp(input: string): OtpParse {
  const text = input.trim();
  const lower = text.toLowerCase();
  if (text === '') return { kind: 'empty' };
  if (lower.startsWith('otpauth-migration://')) return { kind: 'migration' };
  if (lower.startsWith('http://') || lower.startsWith('https://')) return { kind: 'webLink' };
  const legacy = /^(?:key|secret)=/i.test(text) && !lower.startsWith('otpauth://');
  if (legacy) {
    const link = parseOtpLink(`otpauth://totp/?${text}`)!;
    const secret = normalizedSecret(link.query.get('key') ?? link.query.get('secret') ?? '');
    if (!secret) return { kind: 'invalidKey' };
    const digits = link.query.has('size') ? Number(link.query.get('size')) : 6;
    const period = link.query.has('step') ? Number(link.query.get('step')) : 30;
    if (!Number.isInteger(digits) || digits < 6 || digits > 8 || !Number.isInteger(period) || period < 1 || period > 3600) return { kind: 'unsupported' };
    return { kind: 'setup', otp: { secret: base32Decode(secret)!, digits, period, algorithm: 1 } };
  }
  if (!lower.startsWith('otpauth://')) {
    const s = normalizedSecret(text);
    return s ? { kind: 'setup', otp: { secret: base32Decode(s)!, digits: 6, period: 30, algorithm: 1 } } : { kind: 'invalidKey' };
  }
  const link = parseOtpLink(text);
  if (!link || link.host !== 'totp') return { kind: 'unsupported' };
  const secret = normalizedSecret(link.query.get('secret') ?? '');
  if (!secret) return { kind: 'invalidKey' };
  let digits = 6, period = 30, algorithm: 1 | 2 | 3 = 1;
  if (link.query.has('digits')) { digits = Number(link.query.get('digits')); if (!Number.isInteger(digits) || digits < 6 || digits > 8) return { kind: 'unsupported' }; }
  if (link.query.has('period')) { period = Number(link.query.get('period')); if (!Number.isInteger(period) || period < 1 || period > 3600) return { kind: 'unsupported' }; }
  if (link.query.has('algorithm')) {
    const a = ALGORITHMS[link.query.get('algorithm')!.toUpperCase().replace(/-/g, '')];
    if (!a) return { kind: 'unsupported' };
    algorithm = a;
  }
  const label = link.path.replace(/^\/+/, '');
  let issuer = '', account = label;
  const colon = label.indexOf(':');
  if (colon >= 0) { issuer = label.slice(0, colon).trim(); account = label.slice(colon + 1).trim(); }
  const named = link.query.get('issuer');
  if (named) issuer = named;
  const otp: OtpSpec = { secret: base32Decode(secret)!, digits, period, algorithm };
  if (issuer !== '') otp.issuer = issuer;
  if (account !== '') otp.account = account;
  return { kind: 'setup', otp };
}

/** The link authenticator apps and KeePassXC read (TOTP.setupURL): every parameter spelled out. */
export function otpLink(otp: { secret: Uint8Array; digits: number; period: number; algorithm: number; issuer?: string; account?: string }, fallbackIssuer: string, fallbackAccount: string): string {
  const issuer = otp.issuer ?? fallbackIssuer;
  const account = otp.account ?? fallbackAccount;
  const enc = (s: string) => encodeURIComponent(s);
  const label = account === '' ? enc(issuer) : `${enc(issuer)}:${enc(account)}`;
  const alg = ({ 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' } as Record<number, string>)[otp.algorithm] ?? 'SHA1';
  return `otpauth://totp/${label}?secret=${base32Encode(otp.secret)}&issuer=${enc(issuer)}&algorithm=${alg}&digits=${otp.digits}&period=${otp.period}`;
}

// ---------------------------------------------------------------- card values (App/Core/CardNumber.swift)

export const cardDigits = (text: string): string => text.replace(/[^0-9]/g, '');

/** CardExpiry.parse: `08/30`, `0830`, `8/30`, `08/2030`, `2030-08`, `203008` and the same with dots or spaces. Month 1 to 12, year 2000 to 2099. */
export function parseExpiry(text: string): { month: number; year: number } | null {
  const trimmed = text.trim();
  if (trimmed === '' || !/^[0-9/\-. \\]+$/.test(trimmed)) return null;
  const parts = trimmed.split(/[/\-. \\]+/).filter((p) => p !== '');
  const make = (month: string, year: string) => {
    const m = Number(month), y = Number(year);
    if (!(m >= 1 && m <= 12)) return null;
    if (year.length === 2) return { month: m, year: 2000 + y };
    if (year.length === 4) return y >= 2000 && y <= 2099 ? { month: m, year: y } : null;
    return null;
  };
  if (parts.length === 2) {
    const [a, b] = parts as [string, string];
    if (a.length === 4 && (b.length === 1 || b.length === 2)) return make(b, a);
    if (!(a.length === 1 || a.length === 2)) return null;
    return make(a, b);
  }
  if (parts.length === 1) {
    const d = parts[0]!;
    switch (d.length) {
      case 3: return make(d.slice(0, 1), d.slice(-2));
      case 4: return make(d.slice(0, 2), d.slice(-2));
      case 5: return make(d.slice(0, 1), d.slice(-4));
      case 6: return make(d.slice(0, 2), d.slice(-4)) ?? make(d.slice(-2), d.slice(0, 4));
      default: return null;
    }
  }
  return null;
}
export const formatExpiry = (e: { month: number; year: number }): string => `${String(e.month).padStart(2, '0')}/${String(e.year % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------- reading: KDBX to items

interface Row { key: string; value: string; isProtected: boolean }
interface Mapping { kind: string; keys: Record<string, string> }

const MAPPING_ROLES: Record<string, string[]> = {
  creditCard: ['cc-number', 'cc-exp', 'cc-csc', 'cc-name'],
  login: ['username', 'current-password', 'psss:login-website'],
  keePassEntry: [],
};

function readMapping(raw: string | undefined): Mapping | 'bad' | null {
  if (raw === undefined) return null;
  try {
    const m = JSON.parse(raw) as { kind?: unknown; keys?: unknown };
    if (typeof m.kind !== 'string' || typeof m.keys !== 'object' || m.keys === null) return 'bad';
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.keys as Record<string, unknown>)) { if (typeof v !== 'string') return 'bad'; keys[k] = v; }
    return { kind: m.kind, keys };
  } catch { return 'bad'; }
}

/** ItemFieldMapping.validationIssues: the structure of an assignment must hold, or the entry opens as a custom item with every field shown. */
function mappingHolds(m: Mapping, candidates: Row[]): boolean {
  const roles = MAPPING_ROLES[m.kind];
  if (!roles) return false;
  const counts = new Map<string, number>();
  for (const r of candidates) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  const unique = (k: string) => k !== '' && counts.get(k) === 1;
  for (const role of roles) {
    const key = m.keys[role];
    if (key === undefined) { if (role === 'cc-number') return false; continue; }
    if (roles.some((o) => o !== role && m.keys[o] === key)) return false;
    if (!unique(key)) return false;
  }
  return Object.keys(m.keys).every((k) => roles.includes(k));
}

/** The part of an item a sentence is about: a field of the file with its own name is just "A field", so that 72 of them are one finding. */
const partOf = (what: string): string => (/^The field "/.test(what) ? 'A field' : what);
/** "is" or "are": the notes are plural, everything else is not. */
const be = (what: string): string => (what === 'The notes' ? 'are' : 'is');
const have = (what: string): string => (what === 'The notes' ? 'have' : 'has');

class Collector {
  issues: ReportIssue[] = [];
  refused = 0;
  invalid = 0;
  stripped = 0;
  stripInvalid: boolean;
  constructor(stripInvalid: boolean) { this.stripInvalid = stripInvalid; }
  add(kind: IssueKind, item: string | undefined, detail: string, field?: string) {
    this.issues.push({ kind, ...(item === undefined ? {} : { item: shortName(item) }), ...(field === undefined ? {} : { field }), detail });
  }
  /** A value of a field that is not protected: XML cannot hold some characters, so the same value could never be written back to a KeePass file. */
  clean(item: string, what: string, value: string, isProtected: boolean): string | undefined {
    if (isProtected ? value.isWellFormed() : !hasInvalidXmlCharacters(value)) return value;
    const part = partOf(what);
    if (this.stripInvalid) {
      this.stripped++;
      this.add('charactersStripped' as IssueKind, item, `${part} ${have(part)} characters that a KeePass file cannot hold; they were removed because you asked for that.`, part);
      return isProtected ? value.toWellFormed().replace(/\ufffd/g, '') : stripInvalidXmlCharacters(value);
    }
    this.refused++;
    this.invalid++;
    this.add('invalidCharacters', item, `${part} ${have(part)} characters that a KeePass file cannot hold, so ${be(part) === 'are' ? 'they were' : 'it was'} not imported.`, part);
    return undefined;
  }
  /** A text over the size one record can hold. */
  fit(item: string, what: string, value: string, max: number): string | undefined {
    if (bytes(nfc(value)) <= max) return value;
    const part = partOf(what);
    this.refused++;
    this.add('tooLarge', item, `${part} ${be(part)} longer than the ${max.toLocaleString('en-US')} bytes one item can hold, so ${be(part) === 'are' ? 'they were' : 'it was'} not imported.`, part);
    return undefined;
  }
}

function passkeyOf(get: (k: string) => string | undefined, entry: KdbxEntry, now: number): PasskeySpec | null {
  const credential = get(PK.credential), pem = get(PK.key), rp = get(PK.rp);
  if (!credential || !pem || !rp) return null;
  const b64url = (t: string) => { try { return new Uint8Array(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64')); } catch { return null; } };
  const id = b64url(credential);
  if (!id || id.length === 0) return null;
  let der: Uint8Array;
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    der = new Uint8Array(key.export({ type: 'pkcs8', format: 'der' }));
  } catch { return null; }
  const createdText = get(PASSKEY_CREATED);
  const created = (createdText ? ms(parseTime(createdText)) : undefined) ?? ms(entry.times.creation) ?? now;
  return { credentialId: id, privateKey: der, relyingParty: rp, userName: get(PK.user) ?? '', userHandle: b64url(get(PK.handle) ?? '') ?? new Uint8Array(0), created };
}

function otpOf(get: (k: string) => string | undefined): { otp?: OtpSpec; tried: boolean; badLink: boolean } {
  const link = get('otp');
  if (link !== undefined && link !== '') {
    const p = parseOtp(link);
    return p.kind === 'setup' ? { otp: p.otp, tried: true, badLink: false } : { tried: true, badLink: true };
  }
  for (const key of ['TimeOtp-Secret-Base32', 'TOTP Seed']) {
    const v = get(key);
    const s = v === undefined ? null : normalizedSecret(v);
    if (!s) continue;
    const digits = Number(get('TimeOtp-Length') ?? ''), period = Number(get('TimeOtp-Period') ?? '');
    const name = (get('TimeOtp-Algorithm') ?? '').toUpperCase().replace(/HMAC-/g, '').replace(/-/g, '');
    return {
      otp: { secret: base32Decode(s)!, digits: Number.isInteger(digits) && digits >= 6 && digits <= 8 ? digits : 6, period: Number.isInteger(period) && period > 0 ? period : 30, algorithm: ALGORITHMS[name] ?? 1 },
      tried: true, badLink: false,
    };
  }
  return { tried: false, badLink: false };
}

interface EntryInfo { path: string[]; inBin: boolean; binChain: KdbxGroup[] }

/** Every entry of the database, with its folder and whether it is in the Recycle Bin. Parents before children, entries in file order. */
function* entriesOf(db: KdbxDatabase): Generator<{ entry: KdbxEntry } & EntryInfo> {
  const bin = db.meta.recycleBinUuid;
  function* visit(group: KdbxGroup, path: string[], inBin: boolean, chain: KdbxGroup[]): Generator<{ entry: KdbxEntry } & EntryInfo> {
    const here = inBin || (bin !== undefined && group.uuid === bin);
    const next = here ? [...chain, group] : chain;
    for (const entry of group.entries) yield { entry, path, inBin: here, binChain: next };
    for (const g of group.groups) yield* visit(g, [...path, g.name], here, next);
  }
  yield* visit(db.root, [], false, []);
}

const CUSTOM_DATA = (e: KdbxEntry, key: string) => e.customData.find((c) => c.key === key)?.value;

/** The entry's deletion time: the latest of its own LocationChanged, that of every group between the bin and the entry, and PSSS_DELETED_AT. */
function deletionTime(e: KdbxEntry, chain: KdbxGroup[]): number | undefined {
  const times = [ms(e.times.locationChanged), ...chain.map((g) => ms(g.times.locationChanged)), (() => { const t = CUSTOM_DATA(e, DELETED_AT); return t ? ms(parseTime(t)) : undefined; })()]
    .filter((t): t is number => t !== undefined);
  return times.length === 0 ? undefined : Math.max(...times);
}

/** The passwords an entry had before its current one, newest first, each with when it was replaced (KeePassHistory.previousPasswords). */
function previousPasswords(e: KdbxEntry, key: string): { value: string; replaced: number }[] {
  const time = (x: KdbxEntry) => x.times.lastModification?.getTime();
  const ordered = e.history.map((h, i) => ({ h, i })).sort((a, b) => {
    const x = time(a.h) ?? -Infinity, y = time(b.h) ?? -Infinity;
    return x === y ? a.i - b.i : x < y ? -1 : 1;
  }).map((o) => o.h);
  const value = (x: KdbxEntry) => x.fields.find((f) => f.name === key)?.value ?? '';
  const versions = [...ordered, e].map((x) => ({ password: value(x), time: time(x) }));
  const current = versions[versions.length - 1]!.password;
  const rows: { value: string; replaced: number }[] = [];
  let start = 0;
  while (start < versions.length - 1) {
    let end = start;
    while (end + 1 < versions.length && versions[end + 1]!.password === versions[start]!.password) end++;
    const password = versions[start]!.password;
    if (end + 1 < versions.length && password !== '' && password !== current) rows.push({ value: password, replaced: versions[end + 1]!.time ?? versions[end]!.time ?? 0 });
    start = end + 1;
  }
  return rows.reverse();
}

/** Whether any earlier version differs from the current one in something other than the password. */
function historyChangedOther(e: KdbxEntry, passwordKey: string): boolean {
  const view = (x: KdbxEntry) => JSON.stringify([x.fields.filter((f) => f.name !== passwordKey).map((f) => [f.name, f.value]), [...x.tags].sort(), x.attachments.map((a) => [a.name, a.data.length])]);
  const now = view(e);
  return e.history.some((h) => view(h) !== now);
}

function readEntry(db: KdbxDatabase, e: KdbxEntry, info: EntryInfo, o: ReadOptions, c: Collector, out: ReadResult): ItemSpec | null {
  const rows: Row[] = e.fields.filter((f) => !isInternal(f.name)).map((f) => ({ key: f.name, value: f.value, isProtected: f.protected }));
  const first = (k: string): string | undefined => e.fields.find((f) => f.name === k)?.value;
  const rowOf = (k: string) => e.fields.find((f) => f.name === k);
  const candidates = rows.filter((r) => r.key !== 'Title' && r.key !== 'Notes' && !OTP_KEYS.includes(r.key));

  const parsedMapping = readMapping(CUSTOM_DATA(e, MAPPING_KEY));
  const mapping: Mapping | null = parsedMapping !== null && parsedMapping !== 'bad' && mappingHolds(parsedMapping, candidates) ? parsedMapping : null;
  const needsReview = parsedMapping !== null && mapping === null;
  const assigned = mapping && mapping.kind !== 'keePassEntry' ? mapping : null;
  const roleKey = (role: string, fallback: string): string | undefined => (assigned === null ? fallback : assigned.keys[role]);
  const isCardMapped = assigned?.kind === 'creditCard';
  const accountKey = roleKey(isCardMapped ? 'cc-name' : 'username', 'UserName');
  const secretKey = roleKey(isCardMapped ? 'cc-number' : 'current-password', 'Password');
  const websiteKey = roleKey('psss:login-website', 'URL');
  const read = (k: string | undefined) => (k === undefined ? '' : first(k) ?? '');
  const account = read(accountKey), website = read(websiteKey), secret = read(secretKey), notes = read('Notes');
  let title = first('Title') ?? '';
  const otpFound = otpOf(first);
  const passkey = passkeyOf(first, e, o.now);

  if (mapping === null && !needsReview && website !== '' && title !== '' && title === hostOf(website)) title = '';

  let kind: 1 | 2 | 3 | 4;
  if (mapping) kind = ({ login: 1, creditCard: 2, keePassEntry: 4 } as Record<string, 1 | 2 | 4>)[mapping.kind]!;
  else if (needsReview) kind = 4;
  else {
    switch (first(TYPE_KEY)) {
      case 'card': kind = 2; break;
      case 'note': kind = 3; break;
      case 'custom': kind = 4; break;
      case 'wifi': kind = 4; break;
      case 'login': kind = 1; break;
      default:
        if (website !== '' || account !== '' || otpFound.otp || passkey) kind = 1;
        else if (secret === '' && notes !== '') kind = 3;
        else kind = 4;
    }
  }
  const plainCard = kind === 2 && assigned === null;
  const expiryKey = kind === 2 ? roleKey('cc-exp', EXPIRY) : undefined;
  const securityKey = kind === 2 ? roleKey('cc-csc', SECURITY_CODE) : undefined;
  const pinKey = plainCard ? PIN : undefined;

  const uuid = e.uuid;
  const spec: ItemSpec = { uuid, sourceId: `keepass:${uuid}`, type: kind, websites: [], custom: [], tags: [], attachments: [], previous: [], folder: info.path };
  const label = (): string => (title !== '' ? title : hostOf(website) || account || '(no name)');
  const itemName = label();
  const custom: CustomSpec[] = [];
  const put = (what: string, value: string | undefined, max: number = ITEM_LIMITS.text): string | undefined => {
    if (value === undefined || value === '') return undefined;
    const cleaned = c.clean(itemName, what, value, false);
    return cleaned === undefined ? undefined : c.fit(itemName, what, cleaned, max);
  };
  const putSecret = (what: string, value: string): string | undefined => {
    if (value === '') return undefined;
    const cleaned = c.clean(itemName, what, value, true);
    return cleaned === undefined ? undefined : c.fit(itemName, what, cleaned, ITEM_LIMITS.text);
  };

  // slots that Psss shows as plain text: a protected one is kept as a concealed custom field under its own name instead
  const displayed = new Set<string>();
  const slot = (key: string | undefined, what: string, max?: number): string | undefined => {
    if (key === undefined) return undefined;
    const row = rowOf(key);
    if (!row) return undefined;
    displayed.add(key);
    if (row.protected && key !== 'Password' && key !== securityKey && key !== pinKey && key !== secretKey) {
      displayed.delete(key);
      c.add('protectedKept', itemName, `${what} was protected in the file, so it was kept as a hidden field named "${shortName(key)}".`, `${what}:${key}`);
      return undefined;
    }
    return put(what, row.value, max);
  };
  const t = slot('Title', 'The title') !== undefined ? put('The title', title) : undefined;
  if (t !== undefined) spec.title = nfc(t);
  const notesValue = slot('Notes', 'The notes', ITEM_LIMITS.notes);
  if (notesValue !== undefined) spec.notes = notesValue;

  const accountValue = slot(accountKey, kind === 2 ? 'The name on the card' : 'The username');
  if (accountValue !== undefined) { if (kind === 2) spec.cardholder = nfc(accountValue); else spec.username = accountValue; }
  const secretRow = secretKey === undefined ? undefined : rowOf(secretKey);
  if (secretKey !== undefined && secretRow) displayed.add(secretKey);
  const secretValue = secretRow ? putSecret(kind === 2 ? 'The card number' : 'The password', secretRow.value) : undefined;
  if (kind === 2) {
    if (secretValue !== undefined) {
      const digits = cardDigits(secretValue);
      if (digits !== '') spec.card = { number: digits };
      else { custom.push({ label: 'Card number', value: secretValue, concealed: true }); c.add('unreadableValue', itemName, 'The card number holds no digits, so it was kept as a hidden field named "Card number".', 'The card number'); }
    }
  } else if (secretValue !== undefined) spec.password = secretValue;

  // websites: the main address, then KP2A_URL, KP2A_URL_1, ...
  const sites: string[] = [];
  const mainSite = slot(websiteKey, 'The website');
  if (mainSite !== undefined && kind !== 2) sites.push(mainSite);
  const extra = e.fields.filter((f) => f.name === 'KP2A_URL' || /^KP2A_URL_[0-9]+$/.test(f.name))
    .sort((a, b) => (a.name === 'KP2A_URL' ? -1 : b.name === 'KP2A_URL' ? 1 : Number(a.name.slice(9)) - Number(b.name.slice(9))));
  const extraNames = new Set<string>();
  for (const f of extra) {
    extraNames.add(f.name);
    const v = put('A website', f.value);
    if (v !== undefined && !sites.includes(v) && kind !== 2) sites.push(v);
  }
  if (sites.length > ITEM_LIMITS.websites) { c.add('tooMany', itemName, `An item holds at most ${ITEM_LIMITS.websites} websites; the rest were not imported.`, 'websites'); c.refused++; sites.length = ITEM_LIMITS.websites; }
  spec.websites = sites;

  // card extras
  if (kind === 2) {
    const exp = expiryKey === undefined ? undefined : rowOf(expiryKey);
    if (expiryKey !== undefined && exp) {
      displayed.add(expiryKey);
      const parsed = exp.value === '' ? null : parseExpiry(exp.value);
      if (parsed && spec.card) { spec.card.year = parsed.year; spec.card.month = parsed.month; }
      else if (exp.value !== '') {
        displayed.delete(expiryKey);
        c.add('unreadableValue', itemName, `The expiry in "${expiryKey}" is not a month and a year, so it was kept as an ordinary field.`, `The expiry:${expiryKey}`);
      }
    }
    const code = securityKey === undefined ? undefined : rowOf(securityKey);
    if (securityKey !== undefined && code) { displayed.add(securityKey); const v = putSecret('The security code', code.value); if (v !== undefined) spec.cardCode = v; }
    const pin = pinKey === undefined ? undefined : rowOf(pinKey);
    if (pinKey !== undefined && pin) { displayed.add(pinKey); const v = putSecret('The PIN', pin.value); if (v !== undefined) spec.cardPin = v; }
  }

  // verification code (logins only; for other kinds the strings stay as ordinary fields)
  const useOtp = kind === 1 && otpFound.otp !== undefined;
  if (useOtp) {
    spec.otp = otpFound.otp!;
    const own = base32Encode(spec.otp.secret);
    for (const key of ['TimeOtp-Secret-Base32', 'TOTP Seed']) {
      const v = first(key);
      const s = v === undefined ? null : normalizedSecret(v);
      if (s && first('otp') !== undefined && first('otp') !== '' && s !== own) {
        const kept = putSecret('A second verification code', v!);
        if (kept !== undefined) { custom.push({ label: key, value: kept, concealed: true }); c.add('extraCode', itemName, `The file holds a second verification code in "${key}". The item uses one; the other was kept as a hidden field.`, key); }
      }
    }
  } else if (kind === 1 && otpFound.tried && otpFound.badLink) {
    c.add('unreadableCode', itemName, 'The verification code in "otp" is not one Psss can make codes from (a counter-based code, an unusual setting or a link for another kind), so it was kept as a hidden field.');
  }
  if (kind === 1 && passkey) spec.passkey = passkey;
  else if (kind !== 1 && passkey) spec.passkey = passkey;
  if (passkey === null && PASSKEY_KEYS.some((k) => first(k) !== undefined && first(k) !== '')) {
    for (const k of PASSKEY_KEYS) { const row = rowOf(k); if (row && row.value !== '') { const v = putSecret('A passkey field', row.value); if (v !== undefined) custom.push({ label: k, value: v, concealed: true }); } }
    c.add('passkeyKept', itemName, 'The passkey in this entry is incomplete or not a P-256 key, so its fields were kept as hidden fields and it will not sign in.');
  }

  // other fields: every string that is not a slot or plumbing, with its name, order and protected flag
  const usedKeys = new Set<string>();
  const hideOtp = useOtp;
  for (const r of rows) {
    if (extraNames.has(r.key)) continue;
    if (r.value === '' && STANDARD.has(r.key)) continue;
    if (hideOtp && OTP_KEYS.includes(r.key)) continue;
    if (displayed.has(r.key) && usedKeys.add(r.key)) continue;
    if (kind === 2 && plainCard && (r.key === VALID_FROM || r.key === ISSUER) && r.value === '') continue;
    custom.push({ label: r.key, value: r.value, concealed: concealedField(r.key, r.isProtected) });
  }
  // the two custom values that were put aside above (second codes, passkey strings) are already in `custom`; the loop added the rest
  const seen = new Set<string>();
  const cleanedCustom: CustomSpec[] = [];
  for (const f of custom) {
    const id = `${f.label}\u0000${f.value}\u0000${f.concealed}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const lab = c.clean(itemName, 'A field name', f.label, false);
    const val = f.concealed ? putSecretKeepEmpty(c, itemName, `The field "${f.label}"`, f.value) : keepEmpty(c, itemName, `The field "${f.label}"`, f.value);
    if (lab === undefined || val === undefined) continue;
    cleanedCustom.push({ label: nfc(lab), value: val, concealed: f.concealed });
  }
  if (cleanedCustom.length > ITEM_LIMITS.customFields) { c.add('tooMany', itemName, `An item holds at most ${ITEM_LIMITS.customFields} custom fields; the rest were not imported.`, 'custom fields'); c.refused += cleanedCustom.length - ITEM_LIMITS.customFields; cleanedCustom.length = ITEM_LIMITS.customFields; }
  spec.custom = cleanedCustom;

  // tags
  const tags: string[] = [];
  for (const tag of e.tags) { const x = tag.trim(); const v = x === '' ? undefined : c.clean(itemName, 'A tag', x, false); if (v !== undefined && !tags.includes(nfc(v)) && bytes(v) <= ITEM_LIMITS.text) tags.push(nfc(v)); }
  if (tags.length > ITEM_LIMITS.tags) { c.add('tooMany', itemName, `An item holds at most ${ITEM_LIMITS.tags} tags; the rest were not imported.`, 'tags'); tags.length = ITEM_LIMITS.tags; }
  spec.tags = tags;

  // attachments
  for (const a of e.attachments) {
    if (spec.attachments.length >= ITEM_LIMITS.attachments) { c.add('attachmentLimit', itemName, `An item holds at most ${ITEM_LIMITS.attachments} attachments; the rest were not imported.`); break; }
    if (a.data.length > ITEM_LIMITS.attachmentBytes) { c.add('attachmentTooLarge', itemName, `An attachment is larger than ${ITEM_LIMITS.attachmentBytes / 1024 / 1024} MiB, so it was not imported.`); continue; }
    const name = c.clean(itemName, 'An attachment name', a.name, false);
    if (name === undefined || name === '') continue;
    spec.attachments.push({ name: nfc(name), data: a.data });
  }

  // earlier passwords (logins only)
  const passwordKey = assigned?.kind === 'login' ? assigned.keys['current-password'] ?? 'Password' : 'Password';
  const history = e.history.length > 0 ? previousPasswords(e, passwordKey) : [];
  if (kind === 1) {
    let list = history.map((h) => ({ value: putSecret('An earlier password', h.value), replaced: h.replaced })).filter((h): h is { value: string; replaced: number } => h.value !== undefined);
    if (list.length > ITEM_LIMITS.previous) { c.add('historyTrimmed', itemName, `Only the ${ITEM_LIMITS.previous} newest earlier passwords are kept; older ones were not imported.`); list = list.slice(0, ITEM_LIMITS.previous); }
    spec.previous = list;
  } else if (history.length > 0) c.add('historyNotLogin', itemName, 'Earlier passwords are kept for logins only, so the earlier values of this entry were not imported.');
  if (e.history.length > 0 && historyChangedOther(e, passwordKey)) c.add('historyOtherFields', itemName, 'Earlier versions of this entry changed more than the password. Only earlier passwords are imported.');

  // dates
  const created = ms(e.times.creation), edited = ms(e.times.lastModification);
  if (created === undefined) { out.missingDates++; c.add('dateMissing', itemName, 'The entry has no creation date, so the date of the import is used.'); } else spec.created = created;
  if (edited !== undefined && (created === undefined || edited > created)) spec.edited = edited;

  if (info.inBin) spec.deletedAt = deletionTime(e, info.binChain) ?? o.now;
  if (needsReview) c.add('mappingNeedsReview', itemName, 'The file assigns fields to roles in a way that no longer holds, so every field is kept as an ordinary field of a custom item.');
  if (info.path.length > 0) out.inFolders++;
  return spec;
}

const keepEmpty = (c: Collector, item: string, what: string, v: string): string | undefined => {
  if (v === '') return '';
  const x = c.clean(item, what, v, false);
  return x === undefined ? undefined : c.fit(item, what, x, ITEM_LIMITS.text);
};
const putSecretKeepEmpty = (c: Collector, item: string, what: string, v: string): string | undefined => {
  if (v === '') return '';
  const x = c.clean(item, what, v, true);
  return x === undefined ? undefined : c.fit(item, what, x, ITEM_LIMITS.text);
};

/** Maps every entry of a database to an item. Entries in the Recycle Bin are left out unless `includeTrash`. Nothing here touches a vault. */
export function readKeepass(db: KdbxDatabase, options: ReadOptions): ReadResult {
  const c = new Collector(options.stripInvalid === true);
  const out: ReadResult = { items: [], trashed: 0, issues: c.issues, missingDates: 0, inFolders: 0, strippedFields: 0, refusedFields: 0, invalidFields: 0, duplicates: 0 };
  // an entry whose UUID an earlier entry of the file already has (a copied database, a bad merge) must never take that item's place: it is
  // read as an item of its own, under an id made from the UUID and its place among the entries that share it, so the same file gives the same ids
  const seen = new Map<string, number>();
  for (const { entry, ...info } of entriesOf(db)) {
    const nth = seen.get(entry.uuid) ?? 0;
    seen.set(entry.uuid, nth + 1);
    if (info.inBin && !options.includeTrash) { out.trashed++; continue; }
    const spec = readEntry(db, entry, info, options, c, out);
    if (!spec) continue;
    if (nth > 0) {
      spec.uuid = createHash('sha256').update(`psss/keepass-duplicate-id\u0000${entry.uuid}\u0000${nth}`).digest('hex').slice(0, 32);
      spec.sourceId = `keepass:${spec.uuid}`;
      out.duplicates++;
      c.add('duplicateId', nameOf(spec), 'An entry has the same id as another entry in the file, so it was imported as an item of its own.');
    }
    out.items.push(spec);
  }
  out.strippedFields = c.stripped;
  out.refusedFields = c.refused;
  out.invalidFields = c.invalid;
  return out;
}

// ---------------------------------------------------------------- the fingerprints of an item's content (idempotence)

/** The content of an item as named fields, each a canonical string: what an import compares and hashes. The same keys for an `ItemSpec` and for an item of the vault.
 *  A verification code is compared by its secret, digits, period and algorithm, not by its issuer and account label: an export fills the label in
 *  from the title and the username when the item has none, so counting it would make an export read back into the same vault look changed. */
export interface ContentView {
  type: number;
  title?: string; username?: string; password?: string; notes?: string; cardholder?: string; cardCode?: string; cardPin?: string;
  websites: string[];
  otp?: { secret: Uint8Array; digits: number; period: number; algorithm: number; issuer?: string; account?: string };
  passkey?: { credentialId: Uint8Array; privateKey: Uint8Array; relyingParty: string; userName: string; userHandle: Uint8Array };
  card?: { number: string; year?: number; month?: number };
  custom: { label: string; value: string; concealed: boolean }[];
  tags: string[];
  attachments: { name: string; size: number }[];
}
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');
const withScheme = (a: string) => (a.includes('://') ? a : `https://${a}`);

export function contentOf(v: ContentView): Map<string, string> {
  const m = new Map<string, string>();
  m.set('type', String(v.type));
  for (const k of ['title', 'username', 'password', 'notes', 'cardholder', 'cardCode', 'cardPin'] as const) m.set(k, (v[k] ?? '').normalize('NFC'));
  m.set('websites', JSON.stringify(v.websites.map(withScheme)));
  m.set('otp', v.otp ? JSON.stringify([hexOf(v.otp.secret), v.otp.digits, v.otp.period, v.otp.algorithm]) : '');
  m.set('passkey', v.passkey ? JSON.stringify([hexOf(v.passkey.credentialId), hexOf(v.passkey.privateKey), v.passkey.relyingParty, v.passkey.userName, hexOf(v.passkey.userHandle)]) : '');
  m.set('card', v.card ? JSON.stringify([v.card.number, v.card.year ?? '', v.card.month ?? '']) : '');
  const seen = new Map<string, number>();
  for (const f of v.custom) {
    const label = f.label.normalize('NFC');
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    m.set(`f:${label}#${n}`, JSON.stringify([f.value, f.concealed]));
  }
  m.set('tags', JSON.stringify([...new Set(v.tags.map((t) => t.normalize('NFC')))].sort()));
  m.set('attachments', JSON.stringify(v.attachments.map((a) => `${a.name.normalize('NFC')}:${a.size}`).sort()));
  return m;
}
export const specView = (s: ItemSpec): ContentView => ({
  type: s.type, ...(s.title !== undefined ? { title: s.title } : {}), ...(s.username !== undefined ? { username: s.username } : {}), ...(s.password !== undefined ? { password: s.password } : {}),
  ...(s.notes !== undefined ? { notes: s.notes } : {}), ...(s.cardholder !== undefined ? { cardholder: s.cardholder } : {}), ...(s.cardCode !== undefined ? { cardCode: s.cardCode } : {}),
  ...(s.cardPin !== undefined ? { cardPin: s.cardPin } : {}), websites: s.websites, ...(s.otp ? { otp: s.otp } : {}), ...(s.passkey ? { passkey: s.passkey } : {}),
  ...(s.card ? { card: s.card } : {}), custom: s.custom, tags: s.tags, attachments: s.attachments.map((a) => ({ name: a.name, size: a.data.length })),
});

/** The hash of an item's whole content, salted with its source id: 16 bytes. An item imported from a file keeps the hash of what the file said
 *  (the `baseline` of its `source` field). A later import compares three things: the file now, the vault now and this baseline, to tell
 *  "the file did not change", "you changed it here" and "both changed". */
export function contentHash(salt: string, content: ContentView): Uint8Array {
  const h = createHash('sha256').update(`psss/keepass-baseline\u0000${salt}\u0000`);
  for (const [k, v] of [...contentOf(content)].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) h.update(`${k}\u0000${v}\u0000`);
  return new Uint8Array(h.digest().subarray(0, 16));
}

// ---------------------------------------------------------------- writing: items to KDBX

/** An item of the vault as the export needs it: its id, its group, what the schema's view says, and its attachments' bytes. */
export interface ExportItem {
  /** 32 hexadecimal digits: it becomes the entry's UUID. For an item that came from a KeePass file this is the entry's original UUID (so KeePassXC's
   *  merge pairs the entries and an export imported into the same vault finds its own items); for any other item it is the item id. */
  id: string;
  groupName: string;
  groupId: string;
  view: ExportView;
  attachments: AttachmentSpec[];
  /** milliseconds; set for an item in Recently Deleted */
  deletedAt?: number;
}
/** The part of the schema's ItemView the export reads. */
export interface ExportView {
  type: number;
  title?: string; username?: string; password?: string; notes?: string; cardholder?: string; cardCode?: string; cardPin?: string;
  card?: { number: string; year?: number; month?: number };
  otp?: { secret: Uint8Array; digits: number; period: number; algorithm: number; issuer?: string; account?: string };
  passkey?: { credentialId: Uint8Array; privateKey: Uint8Array; relyingParty: string; userName: string; userHandle: Uint8Array; created: number };
  websites: { address: string }[];
  customFields: { label: string; value: string; concealed: boolean }[];
  tags: { text: string }[];
  previousPasswords: { value: string; replaced: number }[];
  added?: number;
  edited?: number;
}

export interface ExportOptions {
  /** the database name, usually the vault's */
  name: string;
  now?: Date;
  random?: RandomSource;
  /** strip characters XML cannot hold from a field instead of leaving the field out */
  stripInvalid?: boolean;
}
export interface ExportCounts { items: number; deleted: number; attachments: number; groups: number }
export interface BuiltExport { db: KdbxDatabase; counts: ExportCounts; issues: ReportIssue[]; refusedFields: number; strippedFields: number }

const RESERVED_EXACT = new Set([...STANDARD, 'otp', 'TOTP Seed', 'TOTP Settings', ...OTP_KEYS, TYPE_KEY, MAPPING_KEY]);
const isReserved = (label: string): boolean =>
  RESERVED_EXACT.has(label) || label === 'KP2A_URL' || /^KP2A_URL_[0-9]+$/.test(label) || isInternal(label) || label.startsWith('KPH:');

const toBase64 = (hexText: string) => Buffer.from(hexText, 'hex').toString('base64');
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The login's title for other KeePass apps: its host when it has none (EntryMapping.apply). */
function exportTitle(v: ExportView): string {
  if (v.title !== undefined && v.title !== '') return v.title;
  if (v.type === 1 && v.websites[0]) return hostOf(v.websites[0].address);
  return '';
}

/** Items to a KDBX database: a group per vault group, an entry per item (its id is the entry's UUID), the Recycle Bin for deleted items. */
export function buildKeepass(items: ExportItem[], options: ExportOptions): BuiltExport {
  const now = options.now ?? new Date();
  const rnd = options.random;
  const db = newDatabase({ name: options.name, now, ...(rnd ? { random: rnd } : {}), generator: 'Psss' });
  const issues: ReportIssue[] = [];
  const counts: ExportCounts = { items: 0, deleted: 0, attachments: 0, groups: 0 };
  let refused = 0, stripped = 0;
  const groups = new Map<string, KdbxGroup>();
  let bin: KdbxGroup | undefined;

  for (const item of items) {
    const v = item.view;
    const name = shortName(exportTitle(v) || (v.websites[0] ? hostOf(v.websites[0].address) : '') || '(no name)');
    const field = (what: string, value: string, isProtected: boolean): string | undefined => {
      if (isProtected ? value.isWellFormed() : !hasInvalidXmlCharacters(value)) return value;
      if (options.stripInvalid) {
        stripped++;
        const part = partOf(what);
        issues.push({ kind: 'charactersStripped', item: name, field: part, detail: `${part} ${have(part)} characters that a KeePass file cannot hold; they were removed because you asked for that.` });
        return isProtected ? value.toWellFormed().replace(/\ufffd/g, '') : stripInvalidXmlCharacters(value);
      }
      refused++;
      const part = partOf(what);
      issues.push({ kind: 'fieldRefused', item: name, field: part, detail: `${part} ${have(part)} characters that a KeePass file cannot hold, so ${be(part) === 'are' ? 'they were' : 'it was'} left out of the file. Add --strip-invalid to write ${be(part) === 'are' ? 'them' : 'it'} without those characters.` });
      return undefined;
    };
    const entry: KdbxEntry = newEntry({ uuid: item.id }, { now, ...(rnd ? { random: rnd } : {}) });
    entry.fields = [];
    const used = new Set<string>();
    const add = (key: string, value: string, isProtected: boolean, what = `The field "${key}"`) => {
      const x = field(what, value, isProtected);
      used.add(key);
      entry.fields.push({ name: key, value: x ?? '', protected: isProtected });
    };
    add('Title', exportTitle(v), false, 'The title');
    add('UserName', (v.type === 2 ? v.cardholder : v.username) ?? '', false, v.type === 2 ? 'The name on the card' : 'The username');
    add('Password', (v.type === 2 ? v.card?.number : v.password) ?? '', true, v.type === 2 ? 'The card number' : 'The password');
    add('URL', v.websites[0]?.address ?? '', false, 'The website');
    add('Notes', v.notes ?? '', false, 'The notes');
    const typeHint = ({ 2: 'card', 3: 'note', 4: 'custom' } as Record<number, string>)[v.type];
    if (typeHint) add(TYPE_KEY, typeHint, false);
    v.websites.slice(1).forEach((w, i) => add(i === 0 ? 'KP2A_URL' : `KP2A_URL_${i}`, w.address, false, 'A website'));

    const extraCustom: { label: string; value: string; concealed: boolean }[] = [];
    if (v.type === 2) {
      if (v.card?.year !== undefined && v.card.month !== undefined) add(EXPIRY, formatExpiry({ month: v.card.month, year: v.card.year }), false, 'The expiry');
      if (v.cardCode !== undefined) add(SECURITY_CODE, v.cardCode, true, 'The security code');
      if (v.cardPin !== undefined) add(PIN, v.cardPin, true, 'The PIN');
    } else {
      // card values on an item that is not a card: ordinary fields, so nothing is lost
      if (v.cardholder !== undefined) extraCustom.push({ label: 'Name on card', value: v.cardholder, concealed: false });
      if (v.card) {
        extraCustom.push({ label: 'Card number', value: v.card.number, concealed: true });
        if (v.card.year !== undefined && v.card.month !== undefined) extraCustom.push({ label: EXPIRY, value: formatExpiry({ month: v.card.month, year: v.card.year }), concealed: false });
      }
      if (v.cardCode !== undefined) extraCustom.push({ label: SECURITY_CODE, value: v.cardCode, concealed: true });
      if (v.cardPin !== undefined) extraCustom.push({ label: PIN, value: v.cardPin, concealed: true });
    }
    if (v.otp) add('otp', otpLink(v.otp, exportTitle(v) || name, v.username ?? v.otp.account ?? ''), true, 'The verification code');
    if (v.passkey) {
      try {
        const pem = createPrivateKey({ key: Buffer.from(v.passkey.privateKey), format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }) as string;
        const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        add(PK.credential, b64(v.passkey.credentialId), false, 'The passkey');
        add(PK.key, pem, true, 'The passkey');
        add(PK.rp, v.passkey.relyingParty, false, 'The passkey');
        add(PK.user, v.passkey.userName, false, 'The passkey');
        add(PK.handle, b64(v.passkey.userHandle), false, 'The passkey');
        add(PASSKEY_CREATED, iso(v.passkey.created), false, 'The passkey');
      } catch {
        issues.push({ kind: 'passkeyNotWritten', item: name, field: 'The passkey', detail: 'The passkey could not be written as a KeePassXC passkey, so it is not in the file.' });
      }
    }
    for (const f of [...v.customFields, ...extraCustom]) {
      let label = f.label;
      if (used.has(label) || isReserved(label)) {
        const base = isInternal(label) ? `Field ${label}` : `${label} (field)`;
        let n = 2, next = base;
        while (used.has(next) || isReserved(next)) next = `${base} ${n++}`;
        issues.push({ kind: 'renamedField', item: name, field: 'A field name', detail: 'A field has the same name as a field KeePass uses, so it was written under another name.' });
        label = next;
      }
      const x = field(`The field "${f.label}"`, f.value, f.concealed);
      const lab = field('A field name', label, false);
      used.add(label);
      if (x === undefined || lab === undefined) continue;
      entry.fields.push({ name: lab, value: x, protected: f.concealed });
    }
    entry.tags = v.tags.map((t) => field('A tag', t.text, false)).filter((t): t is string => t !== undefined && t !== '');
    const attNames = new Set<string>();
    for (const a of item.attachments) {
      let n = a.name, k = 2;
      while (attNames.has(n)) n = `${a.name} (${k++})`;
      attNames.add(n);
      const clean = field('An attachment name', n, false);
      if (clean !== undefined) { addAttachment(entry, clean, a.data); counts.attachments++; }
    }
    const created = v.added !== undefined ? new Date(v.added) : now;
    const modified = v.edited !== undefined ? new Date(v.edited) : created;
    entry.times = { ...entry.times, creation: created, lastModification: modified, lastAccess: modified, locationChanged: created };
    // earlier passwords as KeePass history, oldest first: a version is stamped with when the one before it was replaced
    const previous = v.previousPasswords.filter((p) => p.value !== '' && field('An earlier password', p.value, true) !== undefined);
    if (previous.length > 0 && v.type !== 2) {
      const base = entry.fields;
      const oldestFirst = [...previous].reverse();
      oldestFirst.forEach((p, i) => {
        const when = i === 0 ? created : new Date(oldestFirst[i - 1]!.replaced);
        const copy: KdbxEntry = newEntry({ uuid: item.id }, { now, ...(rnd ? { random: rnd } : {}) });
        copy.fields = base.map((f): KdbxField => (f.name === 'Password' ? { name: 'Password', value: p.value, protected: true } : { ...f }));
        copy.tags = [...entry.tags];
        copy.times = { ...entry.times, creation: created, lastModification: when, lastAccess: when };
        entry.history.push(copy);
      });
    }
    // the group
    if (item.deletedAt !== undefined) {
      if (!bin) {
        bin = newGroup('Recycle Bin', { now, ...(rnd ? { random: rnd } : {}) });
        bin.iconId = 43; bin.isExpanded = false;
        db.root.groups.push(bin);
        db.meta.recycleBinUuid = bin.uuid;
        db.meta.recycleBinEnabled = true;
      }
      const from = groups.get(item.groupId) ?? (() => { const g = newGroup(item.groupName === '' ? 'Group' : item.groupName, { now, ...(rnd ? { random: rnd } : {}) }); db.root.groups.splice(db.root.groups.indexOf(bin!), 0, g); groups.set(item.groupId, g); counts.groups++; return g; })();
      const at = new Date(item.deletedAt);
      entry.customData.push({ key: DELETED_FROM, value: toBase64(from.uuid) }, { key: DELETED_AT, value: iso(item.deletedAt) });
      entry.times = { ...entry.times, locationChanged: at };
      bin.entries.push(entry);
      counts.deleted++;
    } else {
      let g = groups.get(item.groupId);
      if (!g) {
        g = newGroup(item.groupName === '' ? 'Group' : nameOk(item.groupName, options.stripInvalid === true), { now, ...(rnd ? { random: rnd } : {}) });
        if (bin) db.root.groups.splice(db.root.groups.indexOf(bin), 0, g); else db.root.groups.push(g);
        groups.set(item.groupId, g);
        counts.groups++;
      }
      g.entries.push(entry);
      counts.items++;
    }
  }
  for (const g of db.root.groups) if (g !== bin) g.name = nameOk(g.name, true);
  if (db.meta.name !== undefined) db.meta.name = nameOk(db.meta.name, true);
  return { db, counts, issues, refusedFields: refused, strippedFields: stripped };
}

/** A group or database name cannot be left out, so it is always written without the characters XML cannot hold. */
const nameOk = (s: string, strip: boolean): string => (strip && hasInvalidXmlCharacters(s) ? stripInvalidXmlCharacters(s) : hasInvalidXmlCharacters(s) ? stripInvalidXmlCharacters(s) : s);
