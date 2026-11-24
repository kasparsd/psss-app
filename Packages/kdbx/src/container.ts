// The KDBX container: signature, outer header, key transform, header checks, block streams, outer cipher, compression,
// the inner header (KDBX 4) and the protected-value stream, around the XML database.
import { gunzipSync, gzipSync } from 'node:zlib';
import { concat, equal, le16, le32, le64, hex, Reader, uintLE } from './bytes.ts';
import { aesCbcRaw, chacha20, hmacSha256, innerStream, pkcs7Pad, pkcs7Unpad, sha256, sha512 } from './ciphers.ts';
import type { StreamCipher } from './ciphers.ts';
import { databaseToXml, newPool, xmlToDatabase } from './convert.ts';
import type { PoolItem } from './convert.ts';
import {
  hmacBlockKey, readHashedBlocks, readHmacBlocks, writeHashedBlocks, writeHmacBlocks,
} from './blocks.ts';
import { findInvalidCharacters, stripLoneSurrogates } from './characters.ts';
import { Corrupt, InvalidArgument, LimitExceeded, NotKdbx, Unsupported, WrongKey, typed } from './errors.ts';
import { checkKdfLimits, kdfFormat, kdfFromDictionary, kdfToDictionary, transformKey, VariantDictionary } from './kdf.ts';
import type { KdfFormat, KdfParams } from './kdf.ts';
import { compositeKey } from './key.ts';
import type { KdbxKey } from './key.ts';
import { resolveLimits } from './limits.ts';
import type { Limits } from './limits.ts';
import { systemRandom } from './model.ts';
import type { KdbxDatabase, KdbxFormat, KdbxVersion, RandomSource } from './model.ts';
import { attr, child, childrenNamed, isProtected, parseXml, serializeXml, walkXml } from './xml.ts';
import type { XmlNode } from './xml.ts';

const SIG1 = 0x9aa2d903;
const SIG2 = 0xb54bfb67;
const SIG2_KDB = 0xb54bfb65; // KeePass 1.x
const CIPHER_AES = '31c1f2e6bf714350be5805216afc5aff';
const CIPHER_CHACHA20 = 'd6038a2b8b6f4cb5a524339a31dbb59a';
const CIPHER_TWOFISH = 'ad68f29f576f4bb9a36ad47af965346c';
const END_OF_HEADER = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);

export interface ReadOptions {
  limits?: Partial<Limits>;
}

export interface WriteOptions {
  /** Default "4.1". */
  version?: KdbxVersion;
  /** Default: what the database was read with, else ChaCha20. KDBX 3.1 is AES only. */
  cipher?: 'aes256' | 'chacha20';
  /** Default: what the database was read with, else gzip. */
  compression?: 'gzip' | 'none';
  /** Default: what the database was read with, else Argon2id with 64 MiB, 3 passes and 2 lanes. KDBX 3.1 is AES-KDF only. */
  kdf?: KdfFormat;
  /** Where salts, IVs and stream keys come from. Default: node:crypto. Tests inject a seeded one. */
  random?: RandomSource;
  limits?: Partial<Limits>;
  /**
   * What to do with characters XML 1.0 cannot hold: control characters other than tab, line feed and carriage return,
   * U+FFFE, U+FFFF and lone surrogates. "throw" (default): `writeKdbx` throws `InvalidArgument` naming the entry and field
   * (never the value). "strip": they are dropped on write; the database object is not changed. Protected values keep
   * everything UTF-8 can hold (controls included); only lone surrogates in them count. See `findInvalidCharacters` and
   * `stripInvalidCharacters` to report or clean a database before writing.
   */
  invalidCharacters?: 'throw' | 'strip';
}

export interface HeaderInfo {
  format: KdbxFormat;
}

interface RawHeader {
  major: number;
  minor: number;
  /** field id -> bytes (the last one wins) */
  fields: Map<number, Uint8Array>;
  /** The header bytes, from the signature through the end-of-header field. */
  bytes: Uint8Array;
  /** Offset of the first byte after the header. */
  end: number;
}

function readRawHeader(file: Uint8Array, limits: Limits): RawHeader {
  if (file.length < 8) throw new NotKdbx();
  const r = new Reader(file);
  if (r.u32() !== SIG1) throw new NotKdbx();
  const sig2 = r.u32();
  if (sig2 === SIG2_KDB) throw new Unsupported('KeePass 1.x (KDB) database', 'Unsupported: this is a KeePass 1.x (KDB) file, not KDBX');
  if (sig2 !== SIG2) throw new NotKdbx();
  const minor = r.u16();
  const major = r.u16();
  if (major !== 3 && major !== 4) throw new Unsupported(`KDBX ${major}.${minor}`, `Unsupported: KDBX version ${major}.${minor} (reads 3.x and 4.x)`);
  const fields = new Map<number, Uint8Array>();
  for (;;) {
    const id = r.u8();
    const size = major === 3 ? r.u16() : r.u32();
    if (size > limits.maxHeaderFieldBytes) {
      throw new LimitExceeded('maxHeaderFieldBytes', `a header field of ${size} bytes (limit ${limits.maxHeaderFieldBytes})`);
    }
    const value = r.bytes(size);
    if (id === 0) break;
    fields.set(id, value);
  }
  return { major, minor, fields, bytes: file.subarray(0, r.pos), end: r.pos };
}

function cipherFromId(id: Uint8Array | undefined): 'aes256' | 'chacha20' {
  const h = id ? hex(id) : '';
  if (h === CIPHER_AES) return 'aes256';
  if (h === CIPHER_CHACHA20) return 'chacha20';
  if (h === CIPHER_TWOFISH) throw new Unsupported('Twofish cipher', 'Unsupported: the Twofish outer cipher (re-save the database with AES-256 or ChaCha20)');
  throw new Unsupported('outer cipher', id ? `Unsupported: the outer cipher ${h}` : 'The header names no outer cipher');
}

interface Parsed {
  raw: RawHeader;
  format: KdbxFormat;
  kdf: KdfParams;
  masterSeed: Uint8Array;
  iv: Uint8Array;
  compressed: boolean;
}

function parseHeader(file: Uint8Array, limits: Limits): Parsed {
  const raw = readRawHeader(file, limits);
  if (raw.major === 4) {
    // The header hash comes first: a flipped bit in the header is damage, not an unsupported feature.
    const r = new Reader(file, raw.end);
    const stored = r.bytes(32);
    if (!equal(sha256(raw.bytes), stored)) throw new Corrupt('the header does not match its hash');
  }
  const cipher = cipherFromId(raw.fields.get(2));
  const compressionField = raw.fields.get(3);
  if (!compressionField || compressionField.length !== 4) throw new Corrupt('the header has no compression flag');
  const compression = uintLE(compressionField);
  if (compression > 1n) throw new Corrupt('the header names an unknown compression');
  const masterSeed = raw.fields.get(4);
  const iv = raw.fields.get(7);
  if (!masterSeed || masterSeed.length !== 32) throw new Corrupt('the header has no valid master seed');
  if (!iv || iv.length !== (cipher === 'aes256' ? 16 : 12)) throw new Corrupt('the header has no valid cipher IV');
  let kdf: KdfParams;
  if (raw.major === 4) {
    const dict = raw.fields.get(11);
    if (!dict) throw new Corrupt('the header has no key derivation parameters');
    kdf = kdfFromDictionary(VariantDictionary.parse(dict));
  } else {
    if (cipher !== 'aes256') throw new Unsupported('KDBX 3 with a cipher other than AES');
    const seed = raw.fields.get(5);
    const roundsField = raw.fields.get(6);
    if (!seed || seed.length !== 32 || !roundsField || roundsField.length !== 8) throw new Corrupt('the header has no valid AES-KDF parameters');
    const rounds = uintLE(roundsField);
    if (rounds === 0n) throw new Corrupt('the header asks for zero AES-KDF rounds');
    kdf = { type: 'aes', seed, rounds };
  }
  return {
    raw, kdf, masterSeed, iv, compressed: compression === 1n,
    format: { version: `${raw.major}.${raw.minor}`, cipher, compression: compression === 1n ? 'gzip' : 'none', kdf: kdfFormat(kdf) },
  };
}

/** The outer header's settings, with no key. Throws the same errors `readKdbx` throws for the header (NotKdbx, Unsupported, Corrupt). */
export function readKdbxFormat(file: Uint8Array, options: ReadOptions = {}): KdbxFormat {
  return typed(() => parseHeader(file, resolveLimits(options.limits)).format);
}

/**
 * A small attachment is copied, so it does not keep the whole decompressed payload alive and does not expose it through
 * `.buffer`; a large one stays a view of that payload, because a second copy of hundreds of MiB is what the limit guards.
 */
function ownBytes(view: Uint8Array): Uint8Array {
  return view.length <= 1024 * 1024 ? view.slice() : view;
}

function inflate(data: Uint8Array, limits: Limits): Uint8Array {
  try {
    // A view of the buffer zlib returns, not a copy: at hundreds of MiB a second copy is the difference that matters.
    const out = gunzipSync(data, { maxOutputLength: limits.maxDecompressedBytes });
    return new Uint8Array(out.buffer, out.byteOffset, out.length);
  } catch (e) {
    if (e instanceof Error && (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new LimitExceeded('maxDecompressedBytes', `the data expands beyond ${limits.maxDecompressedBytes} bytes`);
    }
    throw new Corrupt('the compressed data is damaged');
  }
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decrypts every protected leaf in document order with the one inner stream, as KeePass does. */
function decryptProtected(root: XmlNode, stream: StreamCipher): void {
  walkXml(root, (node, parent) => {
    if (node.children.length > 0 || !isProtected(node)) return;
    const text = node.text.replace(/\s+/g, '');
    if (!B64.test(text) || text.length % 4 !== 0) throw new Corrupt('a protected value is not valid base64');
    const plain = stream.process(new Uint8Array(Buffer.from(text, 'base64')));
    const asBytes = node.name === 'Binary' || (node.name === 'Value' && parent?.name === 'Binary');
    // ignoreBOM: a value that starts with U+FEFF must keep it (TextDecoder drops a leading BOM by default).
    node.text = asBytes ? Buffer.from(plain).toString('base64') : new TextDecoder('utf-8', { ignoreBOM: true }).decode(plain);
  });
}

function encryptProtected(stream: StreamCipher, invalid: 'throw' | 'strip') {
  return (node: XmlNode, parent: XmlNode | undefined): string => {
    const asBytes = node.name === 'Binary' || (node.name === 'Value' && parent?.name === 'Binary');
    let text = node.text;
    if (!asBytes && !text.isWellFormed()) {
      // UTF-8 cannot hold a lone surrogate: it would silently turn into U+FFFD.
      if (invalid === 'throw') throw new InvalidArgument('a protected value holds a lone surrogate, which cannot be stored');
      text = stripLoneSurrogates(text);
    }
    const plain = asBytes ? new Uint8Array(Buffer.from(text, 'base64')) : new TextEncoder().encode(text);
    return Buffer.from(stream.process(plain)).toString('base64');
  };
}

function parseDatabaseXml(bytes: Uint8Array, limits: Limits): XmlNode {
  const text = new TextDecoder('utf-8').decode(bytes);
  const root = parseXml(text, { maxDepth: limits.maxXmlDepth, maxNodes: limits.maxXmlNodes });
  if (root.name !== 'KeePassFile') throw new Corrupt('the XML root is not KeePassFile');
  return root;
}

/** Reads a KDBX 3.x or 4.x file. Synchronous: the key derivation runs on this thread, so Argon2 blocks for its duration. */
export function readKdbx(file: Uint8Array, key: KdbxKey, options: ReadOptions = {}): KdbxDatabase {
  return typed(() => {
    const limits = resolveLimits(options.limits);
    const h = parseHeader(file, limits);
    // Cheap limit check before the key is even combined, so an absurd file costs nothing.
    checkKdfLimits(h.kdf, limits);
    const composite = compositeKey(key);
    const transformed = transformKey(composite, h.kdf, limits);
    return h.raw.major === 4 ? readV4(file, h, transformed, limits) : readV3(file, h, transformed, limits);
  });
}

function readV4(file: Uint8Array, h: Parsed, transformed: Uint8Array, limits: Limits): KdbxDatabase {
  const r = new Reader(file, h.raw.end + 32);
  const mac = r.bytes(32);
  const hmacKey = sha512(h.masterSeed, transformed, Uint8Array.of(1));
  const expected = hmacSha256(hmacBlockKey(hmacKey, 0xffffffffffffffffn), h.raw.bytes);
  if (!equal(mac, expected)) throw new WrongKey();

  const encrypted = readHmacBlocks(r, hmacKey, limits);
  const masterKey = sha256(h.masterSeed, transformed);
  let payload: Uint8Array;
  if (h.format.cipher === 'aes256') {
    const padded = aesCbcRaw(encrypted, masterKey, h.iv, false);
    const unpadded = pkcs7Unpad(padded);
    if (!unpadded) throw new Corrupt('the decrypted payload has invalid padding');
    payload = unpadded;
  } else {
    payload = chacha20(masterKey, h.iv).process(encrypted);
  }
  if (h.compressed) payload = inflate(payload, limits);

  // Inner header.
  const inner = new Reader(payload);
  let streamId = 0;
  let streamKey = new Uint8Array(0);
  const pool: PoolItem[] = [];
  for (;;) {
    const id = inner.u8();
    const size = inner.u32();
    const value = inner.bytes(size);
    if (id === 0) break;
    if (id === 1) {
      if (value.length !== 4) throw new Corrupt('the inner header has a bad stream id');
      streamId = Number(uintLE(value));
    } else if (id === 2) streamKey = value;
    else if (id === 3) {
      if (value.length < 1) throw new Corrupt('the inner header has an empty binary');
      pool.push({ data: ownBytes(value.subarray(1)), protected: (value[0]! & 1) === 1 });
    }
  }
  const stream = innerStream(streamId, streamKey);
  const root = parseDatabaseXml(inner.rest(), limits);
  decryptProtected(root, stream);
  const db = xmlToDatabase(root, (ref) => (/^\d{1,9}$/.test(ref) ? pool[Number(ref)] : undefined));
  db.format = h.format;
  const custom = h.raw.fields.get(12);
  if (custom) db.publicCustomData = custom.slice();
  return db;
}

function readV3(file: Uint8Array, h: Parsed, transformed: Uint8Array, limits: Limits): KdbxDatabase {
  const startBytes = h.raw.fields.get(9);
  const streamKey = h.raw.fields.get(8);
  const streamIdField = h.raw.fields.get(10);
  if (!startBytes || startBytes.length !== 32 || !streamKey || !streamIdField || streamIdField.length !== 4) {
    throw new Corrupt('the header lacks the stream start bytes or the protected-value stream');
  }
  const ciphertext = file.subarray(h.raw.end);
  if (ciphertext.length < 32) throw new Corrupt('the encrypted payload is too short');
  const masterKey = sha256(h.masterSeed, transformed);
  const plain = aesCbcRaw(ciphertext, masterKey, h.iv, false);
  // KDBX 3 can only tell a wrong key from damage by these 32 bytes: a mismatch is reported as WrongKey, though damage to
  // the header's seeds or to the first two cipher blocks looks the same.
  if (!equal(plain.subarray(0, 32), startBytes)) throw new WrongKey();
  const body = pkcs7Unpad(plain);
  if (!body) throw new Corrupt('the decrypted payload has invalid padding');
  let payload = readHashedBlocks(new Reader(body, 32), limits);
  if (h.compressed) payload = inflate(payload, limits);

  const root = parseDatabaseXml(payload, limits);
  const stored = child(child(root, 'Meta'), 'HeaderHash')?.text.trim();
  if (stored !== undefined && stored !== '' && stored !== Buffer.from(sha256(h.raw.bytes)).toString('base64')) {
    throw new Corrupt('the header does not match the hash stored in the database');
  }
  decryptProtected(root, innerStream(Number(uintLE(streamIdField)), streamKey));

  // The attachment pool of KDBX 3 lives in Meta/Binaries.
  const pool = new Map<string, PoolItem>();
  for (const b of childrenNamed(child(child(root, 'Meta'), 'Binaries'), 'Binary')) {
    const id = attr(b, 'ID');
    if (id === undefined) continue;
    const text = b.text.replace(/\s+/g, '');
    if (!B64.test(text)) throw new Corrupt('an attachment is not valid base64');
    let data: Uint8Array = new Uint8Array(Buffer.from(text, 'base64'));
    if (attr(b, 'Compressed')?.toLowerCase() === 'true') data = inflate(data, limits);
    pool.set(id, { data, protected: attr(b, 'Protected')?.toLowerCase() === 'true' });
  }
  const db = xmlToDatabase(root, (ref) => pool.get(ref));
  db.format = h.format;
  return db;
}

// ---------------------------------------------------------------- writing

function resolveWrite(db: KdbxDatabase, o: WriteOptions): { version: KdbxVersion; cipher: 'aes256' | 'chacha20'; compression: 'gzip' | 'none'; kdf: KdfFormat } {
  const version = o.version ?? '4.1';
  if (version !== '3.1' && version !== '4.0' && version !== '4.1') throw new InvalidArgument(`cannot write KDBX ${String(version)} (writes 3.1, 4.0 and 4.1)`);
  const prev = db.format;
  let cipher = o.cipher ?? prev?.cipher ?? 'chacha20';
  let kdf = o.kdf ?? prev?.kdf ?? { type: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 2 };
  if (version === '3.1') {
    if (o.cipher === 'chacha20') throw new InvalidArgument('KDBX 3.1 supports only the AES-256 cipher');
    if (o.kdf && o.kdf.type !== 'aes') throw new InvalidArgument('KDBX 3.1 supports only AES-KDF');
    cipher = 'aes256';
    if (kdf.type !== 'aes') kdf = { type: 'aes', rounds: 600_000 };
  }
  return { version, cipher, compression: o.compression ?? prev?.compression ?? 'gzip', kdf };
}

function kdfParamsFor(f: KdfFormat, random: RandomSource): KdfParams {
  if (f.type === 'aes') {
    if (!Number.isSafeInteger(f.rounds) || f.rounds < 1) throw new InvalidArgument('AES-KDF rounds must be a positive integer');
    return { type: 'aes', seed: random(32), rounds: BigInt(f.rounds) };
  }
  if (![f.memoryKiB, f.iterations, f.parallelism].every((n) => Number.isSafeInteger(n) && n >= 1)) {
    throw new InvalidArgument('Argon2 memory, passes and lanes must be positive integers');
  }
  return {
    type: f.type, salt: random(32), memoryBytes: BigInt(f.memoryKiB) * 1024n, iterations: BigInt(f.iterations), parallelism: f.parallelism,
    version: 0x13, secret: new Uint8Array(0), associatedData: new Uint8Array(0),
  };
}

const gzip = (data: Uint8Array) => new Uint8Array(gzipSync(data));

/**
 * Writes a database. The inner stream key, master seed, IV and KDF salt are fresh on every call. Protected values are
 * encrypted as the XML is written; no plaintext of them is kept anywhere. Synchronous (the KDF runs on this thread).
 */
export function writeKdbx(db: KdbxDatabase, key: KdbxKey, options: WriteOptions = {}): Uint8Array {
  return typed(() => {
    const limits = resolveLimits(options.limits);
    const random = options.random ?? systemRandom;
    const w = resolveWrite(db, options);
    const invalid = options.invalidCharacters ?? 'throw';
    if (invalid !== 'throw' && invalid !== 'strip') throw new InvalidArgument(`invalidCharacters must be "throw" or "strip", not ${String(invalid)}`);
    if (invalid === 'throw') {
      const found = findInvalidCharacters(db);
      if (found.length > 0) {
        const list = found.slice(0, 5).map((r) => r.where).join('; ');
        const more = found.length > 5 ? ` and ${found.length - 5} more` : '';
        throw new InvalidArgument(
          `${found.length} value${found.length === 1 ? '' : 's'} hold characters a KeePass file cannot store (control characters other than tab, line feed and carriage return, U+FFFE, U+FFFF, lone surrogates): ${list}${more}. ` +
          'Remove them, or write with { invalidCharacters: "strip" }.',
        );
      }
    }
    const kdf = kdfParamsFor(w.kdf, random);
    checkKdfLimits(kdf, limits);
    const composite = compositeKey(key);
    const masterSeed = random(32);
    const iv = random(w.cipher === 'aes256' ? 16 : 12);
    const transformed = transformKey(composite, kdf, limits);
    const pool = newPool();
    const compress = w.compression === 'gzip';
    const cipherId = new Uint8Array(Buffer.from(w.cipher === 'aes256' ? CIPHER_AES : CIPHER_CHACHA20, 'hex'));
    const xmlBytes = (root: XmlNode, stream: StreamCipher) =>
      new TextEncoder().encode(serializeXml(root, { maxDepth: limits.maxXmlDepth, invalidCharacters: invalid, protect: encryptProtected(stream, invalid) }));
    const sig = [le32(SIG1), le32(SIG2)];

    if (w.version === '3.1') {
      const streamKey = random(32);
      const startBytes = random(32);
      const field = (id: number, v: Uint8Array) => concat(Uint8Array.of(id), le16(v.length), v);
      const header = concat(
        ...sig, le16(1), le16(3),
        field(2, cipherId), field(3, le32(compress ? 1 : 0)), field(4, masterSeed),
        field(5, (kdf as { seed: Uint8Array }).seed), field(6, le64((kdf as { rounds: bigint }).rounds)), field(7, iv),
        field(8, streamKey), field(9, startBytes), field(10, le32(2)), field(0, END_OF_HEADER),
      );
      const root = databaseToXml(db, { timeFormat: 'iso', pool, headerHash: sha256(header) });
      let payload = xmlBytes(root, innerStream(2, streamKey));
      if (compress) payload = gzip(payload);
      const body = pkcs7Pad(concat(startBytes, writeHashedBlocks(payload)));
      return concat(header, aesCbcRaw(body, sha256(masterSeed, transformed), iv, true));
    }

    const streamKey = random(64);
    const fields: Uint8Array[] = [];
    const field = (id: number, v: Uint8Array) => fields.push(Uint8Array.of(id), le32(v.length), v);
    field(2, cipherId);
    field(3, le32(compress ? 1 : 0));
    field(4, masterSeed);
    field(7, iv);
    field(11, kdfToDictionary(kdf).encode());
    if (db.publicCustomData) field(12, db.publicCustomData);
    field(0, END_OF_HEADER);
    const header = concat(...sig, le16(w.version === '4.1' ? 1 : 0), le16(4), ...fields);
    const hmacKey = sha512(masterSeed, transformed, Uint8Array.of(1));

    const root = databaseToXml(db, { timeFormat: 'ticks', pool });
    const innerParts: Uint8Array[] = [Uint8Array.of(1), le32(4), le32(3), Uint8Array.of(2), le32(streamKey.length), streamKey];
    // The pool was filled while the model was converted to XML above, so it is complete here.
    for (const p of pool.items) innerParts.push(Uint8Array.of(3), le32(p.data.length + 1), Uint8Array.of(p.protected ? 1 : 0), p.data);
    innerParts.push(Uint8Array.of(0), le32(0));
    let payload = concat(...innerParts, xmlBytes(root, innerStream(3, streamKey)));
    if (compress) payload = gzip(payload);
    const masterKey = sha256(masterSeed, transformed);
    const encrypted = w.cipher === 'aes256' ? aesCbcRaw(pkcs7Pad(payload), masterKey, iv, true) : chacha20(masterKey, iv).process(payload);
    return concat(
      header, sha256(header), hmacSha256(hmacBlockKey(hmacKey, 0xffffffffffffffffn), header), writeHmacBlocks(encrypted, hmacKey),
    );
  });
}

