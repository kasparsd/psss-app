// Shared helpers for the tests: a seeded random source, the sample database, key kinds, a builder for hand-made
// containers (so hostile files can be made with valid headers), and keepassxc-cli access.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addAttachment, newDatabase, newEntry, newGroup, xml,
} from '../src/index.ts';
import type { KdbxDatabase, KdbxKey, RandomSource } from '../src/index.ts';
import { concat, le16, le32, le64 } from '../src/bytes.ts';
import { aesCbcRaw, chacha20, hmacSha256, innerStream, pkcs7Pad, sha256, sha512 } from '../src/ciphers.ts';
import { writeHashedBlocks, writeHmacBlocks, hmacBlockKey } from '../src/blocks.ts';
import { transformKey, VariantDictionary, kdfToDictionary } from '../src/kdf.ts';
import { keyFileHash as keyFileHashForTests } from '../src/key.ts';
import { defaultLimits } from '../src/limits.ts';
import { gzipSync } from 'node:zlib';

export const fixtureDir = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures');
export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(fixtureDir, name)));

/** A deterministic random source: SHA-256 in counter mode. */
export function seeded(seed: string): RandomSource {
  let counter = 0;
  return (n) => {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const block = createHash('sha256').update(`${seed}:${counter++}`).digest();
      const take = Math.min(32, n - o);
      out.set(block.subarray(0, take), o);
      o += take;
    }
    return out;
  };
}

// ------------------------------------------------------------------ keepassxc-cli

export const CLI = '/opt/homebrew/bin/keepassxc-cli';
export const haveCli = existsSync(CLI);
export const cliSkip = haveCli ? false : 'keepassxc-cli is not installed at /opt/homebrew/bin/keepassxc-cli; interop tests skipped';

export function cli(args: string[], input = ''): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(CLI, args, { input, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kdbx-test-'));
}

// ------------------------------------------------------------------ keys

const keyBytes = createHash('sha256').update('psss-kdbx test key').digest();
export const keyFiles = {
  v2: new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data Hash="${
      createHash('sha256').update(keyBytes).digest('hex').slice(0, 8).toUpperCase()}">${Buffer.from(keyBytes).toString('hex').toUpperCase()}</Data></Key></KeyFile>`),
  v1: new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n<KeyFile><Meta><Version>1.00</Version></Meta><Key><Data>${Buffer.from(keyBytes).toString('base64')}</Data></Key></KeyFile>`),
  raw32: new Uint8Array(keyBytes),
  hex64: new TextEncoder().encode(Buffer.from(keyBytes).toString('hex')),
  other: new TextEncoder().encode('This is not a key file in any special format.\n'),
};

export const keyKinds: { name: string; key: KdbxKey }[] = [
  { name: 'password', key: { password: 'correct horse ünï 日本' } },
  { name: 'empty password', key: { password: '' } },
  { name: 'key file xml v2', key: { keyFile: keyFiles.v2 } },
  { name: 'key file xml v1', key: { keyFile: keyFiles.v1 } },
  { name: 'key file raw 32 bytes', key: { keyFile: keyFiles.raw32 } },
  { name: 'key file 64 hex digits', key: { keyFile: keyFiles.hex64 } },
  { name: 'key file any other file', key: { keyFile: keyFiles.other } },
  { name: 'password and key file', key: { password: 'both', keyFile: keyFiles.v2 } },
];

// ------------------------------------------------------------------ the sample database

const T = (iso: string) => new Date(iso);

/** A database that uses everything the model holds. Whole-second times, so a round trip is exact. */
export function sampleDatabase(): KdbxDatabase {
  const db = newDatabase({ name: 'Sample ☕', description: 'A "sample" & <test>', defaultUserName: 'sam', now: T('2022-01-02T03:04:05Z'), random: seeded('db') });
  db.meta.customData = [
    { key: 'plain', value: 'value' },
    { key: 'dated', value: 'with time', lastModified: T('2022-02-03T04:05:06Z') },
  ];
  db.meta.unknown.push(
    xml('Color', '#112233'),
    xml('Unmodelled', '', [['flavour', 'odd']], [xml('Inner', 'text & more < than >', [['n', '1']]), xml('Empty')]),
  );
  db.meta.attributes.push(['metaAttr', 'kept']);
  db.meta.historyMaxItems = 5;
  db.unknown.push(xml('TopLevelUnknown', 'top'));
  db.rootUnknown.push(xml('RootUnknown', '', [], [xml('A', 'b')]));
  db.publicCustomData = publicCustomDataBytes();

  const rnd = seeded('entries');
  const login = newEntry({
    title: 'Login', username: 'alice@example.com', password: 'p@ss<word>&"1" ü 漢', url: 'https://example.com/login',
    notes: 'line one\nline two\r\nline three & <b>bold</b>\ttab', tags: ['work', 'email'],
    fields: [{ name: 'Account', value: '12345' }, { name: 'PIN', value: '9876', protected: true }, { name: 'Empty protected', value: '', protected: true }],
    uuid: '11'.repeat(16),
  }, { now: T('2021-03-04T05:06:07Z'), random: rnd });
  login.iconId = 12;
  login.customIconUuid = '99'.repeat(16);
  login.foregroundColor = '#FF0000';
  login.backgroundColor = '#00FF00';
  login.times = {
    creation: T('2021-03-04T05:06:07Z'), lastModification: T('2021-05-06T07:08:09Z'), lastAccess: T('2021-06-07T08:09:10Z'),
    expiry: T('2030-01-02T03:04:05Z'), expires: true, usageCount: 7, locationChanged: T('2021-03-04T05:06:07Z'),
  };
  login.autoType = xml('AutoType', '', [], [xml('Enabled', 'True'), xml('DefaultSequence', '{USERNAME}{TAB}{PASSWORD}'),
    xml('Association', '', [], [xml('Window', 'Example*'), xml('KeystrokeSequence', '{PASSWORD}')])]);
  login.customData = [{ key: 'entry-key', value: 'entry-value', lastModified: T('2021-01-01T00:00:00Z') }];
  login.unknown.push(xml('OverrideURL', 'cmd://x'), xml('QualityCheck', 'True'), xml('EntryUnknown', 'u', [['k', 'v']]));
  login.attributes.push(['entryAttr', 'kept']);
  const blob = new Uint8Array(3000).map((_, i) => (i * 31 + 7) & 0xff);
  addAttachment(login, 'blob.bin', blob);
  addAttachment(login, 'secret.bin', new Uint8Array([0, 1, 2, 255]), { protected: true });
  addAttachment(login, 'empty.txt', new Uint8Array(0));
  // Two history versions, oldest first, as KeePass writes them.
  for (const [pw, when] of [['first', '2021-03-04T05:06:07Z'], ['second', '2021-04-04T05:06:07Z']] as const) {
    const h = newEntry({ title: 'Login', username: 'alice@example.com', password: pw, fields: [{ name: 'Account', value: '12345' }], uuid: login.uuid }, { now: T(when), random: rnd });
    h.times.lastModification = T(when);
    addAttachment(h, 'blob.bin', blob);
    login.history.push(h);
  }
  db.root.entries.push(login);

  const unicode = newEntry({ title: 'Unicode 😀 é', username: 'ünï', password: 'пароль', notes: '' }, { now: T('2021-01-01T00:00:00Z'), random: rnd });
  addAttachment(unicode, 'same.bin', blob); // the same bytes as login's attachment: stored once in the pool
  db.root.entries.push(unicode);

  const work = newGroup('Work', { now: T('2021-01-01T00:00:00Z'), random: rnd });
  work.notes = 'work notes';
  work.iconId = 5;
  work.isExpanded = false;
  work.tags = ['grp'];
  work.customData = [{ key: 'g', value: 'v' }];
  work.unknown.push(xml('EnableSearching', 'null'), xml('GroupUnknown', '', [], [xml('X', '1')]));
  work.attributes.push(['groupAttr', 'kept']);
  const clients = newGroup('Clients', { now: T('2021-01-01T00:00:00Z'), random: rnd });
  const portal = newEntry({ title: 'Portal', username: 'carol', password: 'portal', tags: ['a'] }, { now: T('2021-01-01T00:00:00Z'), random: rnd });
  clients.entries.push(portal);
  work.groups.push(clients);
  db.root.groups.push(work);

  const bin = newGroup('Recycle Bin', { now: T('2021-01-01T00:00:00Z'), random: rnd });
  bin.iconId = 43;
  const gone = newEntry({ title: 'Gone', password: 'gone' }, { now: T('2021-01-01T00:00:00Z'), random: rnd });
  gone.previousParentGroup = work.uuid;
  bin.entries.push(gone);
  db.root.groups.push(bin);
  db.meta.recycleBinUuid = bin.uuid;
  db.deletedObjects = [{ uuid: 'ab'.repeat(16), time: T('2022-03-04T05:06:07Z') }, { uuid: 'cd'.repeat(16) }];
  return db;
}

/** Public custom data (a variant dictionary) with one of each simple type. */
function publicCustomDataBytes(): Uint8Array {
  const d = new VariantDictionary();
  d.setBytes('blob', new Uint8Array([1, 2, 3]));
  d.setU32('n', 42);
  d.setU64('big', 2n ** 40n);
  return d.encode();
}

/** The database as plain JSON-able data for deep comparison: dates as ISO text, bytes as hex, no `format`. */
export function normalize(db: KdbxDatabase, options: { publicCustomData?: boolean } = {}): unknown {
  const copy = { ...db } as Partial<KdbxDatabase>;
  delete copy.format;
  if (options.publicCustomData === false) delete copy.publicCustomData;
  return JSON.parse(JSON.stringify(copy, (_k, v) => (v instanceof Uint8Array ? `bytes:${Buffer.from(v).toString('hex')}` : v)));
}

// ------------------------------------------------------------------ a builder for hand-made KDBX 4 and 3.1 files

export class Protector {
  stream;
  constructor(streamKey: Uint8Array, id = 3) {
    this.stream = innerStream(id, streamKey);
  }
  /** The text of a protected value as the file stores it. Call in document order. */
  enc(text: string): string {
    return Buffer.from(this.stream.process(new TextEncoder().encode(text))).toString('base64');
  }
}

export interface Build4 {
  password?: string;
  keyFile?: Uint8Array;
  cipher?: 'aes256' | 'chacha20';
  compress?: boolean;
  streamKey?: Uint8Array;
  streamId?: number;
  rounds?: number;
  /** Replaces the KDF dictionary and the transformed key (so a hostile dictionary needs no real KDF). */
  kdf?: { dict: VariantDictionary; transformed: Uint8Array };
  /** Extra or replacement outer header fields, [id, bytes]. */
  headerFields?: [number, Uint8Array][];
  /** The cipher UUID bytes, to name an unsupported one. */
  cipherId?: Uint8Array;
  major?: number;
  /** The block stream bytes, instead of the HMAC blocks of the encrypted payload. */
  blocks?: (hmacKey: Uint8Array) => Uint8Array;
  /** Inner header binaries (each: flags byte then data). */
  binaries?: Uint8Array[];
}

const CIPHERS = { aes256: '31c1f2e6bf714350be5805216afc5aff', chacha20: 'd6038a2b8b6f4cb5a524339a31dbb59a' };
const fixed = (n: number, v: number) => new Uint8Array(n).fill(v);

/** A KDBX 4 container around arbitrary XML bytes, with a valid header hash and HMAC. */
export function buildKdbx4(xmlBytes: Uint8Array | string, o: Build4 = {}): Uint8Array {
  const body = typeof xmlBytes === 'string' ? new TextEncoder().encode(xmlBytes) : xmlBytes;
  const cipher = o.cipher ?? 'chacha20';
  const masterSeed = fixed(32, 0xa1);
  const iv = fixed(cipher === 'aes256' ? 16 : 12, 0xb2);
  const streamKey = o.streamKey ?? fixed(64, 0xc3);
  let dict = o.kdf?.dict;
  let transformed = o.kdf?.transformed;
  if (!dict) {
    const params = { type: 'aes' as const, seed: fixed(32, 0xd4), rounds: BigInt(o.rounds ?? 10) };
    dict = kdfToDictionary(params);
    const composite = compositeFor(o);
    transformed = transformKey(composite, params, defaultLimits);
  }
  const fields: [number, Uint8Array][] = [
    [2, o.cipherId ?? new Uint8Array(Buffer.from(CIPHERS[cipher], 'hex'))], [3, le32(o.compress === false ? 0 : 1)], [4, masterSeed],
    [7, iv], [11, dict.encode()], ...(o.headerFields ?? []),
  ];
  const header = concat(le32(0x9aa2d903), le32(0xb54bfb67), le16(1), le16(o.major ?? 4),
    ...fields.flatMap(([id, v]) => [Uint8Array.of(id), le32(v.length), v]), Uint8Array.of(0), le32(4), Uint8Array.of(13, 10, 13, 10));
  const hmacKey = sha512(masterSeed, transformed!, Uint8Array.of(1));
  const inner = concat(Uint8Array.of(1), le32(4), le32(o.streamId ?? 3), Uint8Array.of(2), le32(streamKey.length), streamKey,
    ...(o.binaries ?? []).flatMap((b) => [Uint8Array.of(3), le32(b.length), b]), Uint8Array.of(0), le32(0), body);
  let payload: Uint8Array = o.compress === false ? inner : new Uint8Array(gzipSync(inner));
  const masterKey = sha256(masterSeed, transformed!);
  const encrypted = cipher === 'aes256' ? aesCbcRaw(pkcs7Pad(payload), masterKey, iv, true) : chacha20(masterKey, iv).process(payload);
  payload = new Uint8Array(0);
  return concat(header, sha256(header), hmacSha256(hmacBlockKey(hmacKey, 0xffffffffffffffffn), header),
    o.blocks ? o.blocks(hmacKey) : writeHmacBlocks(encrypted, hmacKey));
}

function compositeFor(o: { password?: string; keyFile?: Uint8Array }): Uint8Array {
  const parts: Uint8Array[] = [];
  if (o.password !== undefined) parts.push(sha256(new TextEncoder().encode(o.password)));
  if (o.keyFile !== undefined) parts.push(keyFileHashForTests(o.keyFile));
  if (parts.length === 0) parts.push(sha256(new TextEncoder().encode('default test password')));
  return sha256(...parts);
}


/** The default key of `buildKdbx4` when no credentials are given. */
export const BUILD_KEY: KdbxKey = { password: 'default test password' };

export interface Build3 {
  password?: string;
  rounds?: bigint | number;
  /** The plaintext after the start bytes, instead of the hashed block stream of the XML (for damage tests). */
  rawBody?: Uint8Array;
  streamId?: number;
  streamKey?: Uint8Array;
  compress?: boolean;
}

/** A KDBX 3.1 container around arbitrary XML bytes. */
export function buildKdbx3(xmlBytes: Uint8Array | string, o: Build3 = {}): { file: Uint8Array; header: Uint8Array } {
  const body = typeof xmlBytes === 'string' ? new TextEncoder().encode(xmlBytes) : xmlBytes;
  const masterSeed = fixed(32, 0x11), seed = fixed(32, 0x22), iv = fixed(16, 0x33), streamKey = o.streamKey ?? fixed(32, 0x44), start = fixed(32, 0x55);
  const params = { type: 'aes' as const, seed, rounds: BigInt(o.rounds ?? 10) };
  const transformed = (o.rounds !== undefined && BigInt(o.rounds) > 1000n)
    ? fixed(32, 0) // an absurd round count is never run by the reader
    : transformKey(compositeFor(o), params, defaultLimits);
  const field = (id: number, v: Uint8Array) => concat(Uint8Array.of(id), le16(v.length), v);
  const header = concat(le32(0x9aa2d903), le32(0xb54bfb67), le16(1), le16(3),
    field(2, new Uint8Array(Buffer.from(CIPHERS.aes256, 'hex'))), field(3, le32(o.compress === false ? 0 : 1)), field(4, masterSeed),
    field(5, seed), field(6, le64(params.rounds)), field(7, iv), field(8, streamKey), field(9, start), field(10, le32(o.streamId ?? 2)),
    field(0, Uint8Array.of(13, 10, 13, 10)));
  const payload = o.compress === false ? body : new Uint8Array(gzipSync(body));
  const plain = pkcs7Pad(concat(start, o.rawBody ?? writeHashedBlocks(payload)));
  return { file: concat(header, aesCbcRaw(plain, sha256(masterSeed, transformed), iv, true)), header };
}

export const BUILD3_KEY: KdbxKey = { password: 'default test password' };

/** Minimal valid XML for a database, with extra markup spliced in at the places named. */
export function minimalXml(o: { meta?: string; root?: string; top?: string } = {}): string {
  const zero = Buffer.alloc(16).toString('base64');
  const id = Buffer.alloc(16, 7).toString('base64');
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<KeePassFile><Meta><Generator>test</Generator><DatabaseName>X</DatabaseName>${o.meta ?? ''}` +
    `</Meta><Root><Group><UUID>${id}</UUID><Name>Root</Name>${o.root ?? ''}</Group><DeletedObjects/></Root>${o.top ?? ''}</KeePassFile>`;
}
