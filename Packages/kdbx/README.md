# @psss/kdbx

A KeePass database (KDBX 3.1, 4.0, 4.1) reader and writer for Node 24.
It is meant for the `psss` command's import and export.
Mapping entries to Psss items is not part of this package.

No dependencies, no build step: `node:` standard library only, ES modules, erasable TypeScript syntax and `.ts` import extensions.
The API is synchronous.

## Use

```ts
import { readKdbx, writeKdbx, newDatabase, newEntry, setField, walkEntries, getField } from '@psss/kdbx';

const db = readKdbx(fileBytes, { password: 'secret', keyFile: keyFileBytes });
for (const { entry, group } of walkEntries(db)) console.log(group.name, getField(entry, 'Title'));

const out = newDatabase({ name: 'Export' });
out.root.entries.push(newEntry({ title: 'Mail', username: 'me', password: 'pw' }));
const bytes = writeKdbx(out, { password: 'secret' });                 // 4.1, ChaCha20, Argon2id 64 MiB
const old = writeKdbx(out, { password: 'secret' }, { version: '3.1' }); // AES-256 and AES-KDF
```

Key: `KdbxKey = { password?, keyFile?: Uint8Array, challengeResponse? }`.
At least one of password and key file is required (`InvalidKey` otherwise).
An empty-string password counts as no password when a key file is given (as in KeePassXC), so `{ password: '', keyFile }` opens a key-file-only database, on read and on write.
On its own, `{ password: '' }` is the empty password (KeePassXC opens such a database).

Core signatures:

```ts
readKdbx(file: Uint8Array, key: KdbxKey, options?: { limits?: Partial<Limits> }): KdbxDatabase
writeKdbx(db: KdbxDatabase, key: KdbxKey, options?: WriteOptions): Uint8Array
readKdbxFormat(file: Uint8Array, options?): KdbxFormat      // version, cipher, compression, KDF; no key needed
WriteOptions = { version?: '3.1'|'4.0'|'4.1'; cipher?: 'aes256'|'chacha20'; compression?: 'gzip'|'none';
                 kdf?: KdfFormat; random?: RandomSource; limits?: Partial<Limits>;
                 invalidCharacters?: 'throw'|'strip' }    // default 'throw'
```

Also exported: `newDatabase`, `newEntry`, `newGroup`; field and attachment helpers (`getField`, `setField`, `removeField`, `addAttachment`, ...);
tree helpers (`walkGroups`, `walkEntries`, `findEntry`, `findGroup`); history rules (`updateEntry`, `pushHistory`, `trimHistory`, `orderedHistory`);
recycle bin (`moveToRecycleBin`, `restoreFromRecycleBin`, `deletePermanently`); time (`parseTime`, `formatTimeTicks`, `formatTimeIso`); `compositeKey`, `keyFileHash`; `findInvalidCharacters`, `stripInvalidCharacters` (see below).
`random` is injectable for deterministic output in tests.

Model notes: UUIDs are exactly 32 lowercase hex characters (`isUuid`; `newEntry` and `newGroup` throw `InvalidArgument` for anything else, and so does `writeKdbx` for every UUID it writes: entries, history entries, groups, custom icons, previous parent groups, deleted objects, the recycle bin), times are `Date` (whole seconds on write), fields are ordered with a `protected` flag.
Unknown XML in Meta, groups and entries is kept and written back, including protected values inside it.
Auto-type is opaque.

## Supported

- Versions 3.1, 4.0, 4.1 (read and write).
- Composite key: password, key file, or both.
  Key files: XML v1, XML v2 (hash checked), 32 raw bytes, 64 hex digits, or any other file hashed whole.
  XML key data follows KeePassXC (checked against `keepassxc-cli` 2.8): valid base64 (v1) or hex with a matching `Hash` (v2) that is not 32 bytes is zero-padded or cut to 32 bytes;
  an XML key file with empty or no data is hashed whole; invalid base64 (v1), invalid hex or a failing checksum (v2) are `InvalidKey`, as KeePassXC refuses them too.
- KDFs: AES-KDF, Argon2d, Argon2id.
- Ciphers: AES-256-CBC, ChaCha20.
- Header hash and HMAC checks, HMAC and hashed block streams, gzip or none, inner header, Salsa20 and ChaCha20 inner streams.

Not supported (typed `Unsupported`, `error.detail` names it): Twofish, challenge-response keys, KDB (KeePass 1.x), other KDBX major versions, ArcFour and other inner streams, other KDFs.

## Errors and safety

Every failure is a `KdbxError` with a stable `code`:
`NotKdbx`, `Unsupported`, `WrongKey`, `Corrupt`, `LimitExceeded`, `InvalidKey`, `InvalidArgument`.
Nothing else escapes; unexpected failures become `Corrupt`.
In KDBX 4 a flipped header bit is `Corrupt` (header hash) and a wrong key is `WrongKey` (header HMAC).
In 3.1 the format cannot tell damage from a wrong key in the encrypted part, so both are `WrongKey`.

Limits (`defaultLimits`, override per call): decompressed size 256 MiB, Argon2 memory 1 GiB, iterations 256, parallelism 64,
AES-KDF rounds 200 million (about 30 million rounds a second here, so roughly 7 seconds), block size 256 MiB, header field 1 MiB, XML depth 128, XML nodes 5 million.
Limits are checked before allocating or looping.
Memory: reading holds the decompressed payload and, for the XML, its string, so a file that inflates to N bytes peaks at roughly two to three times N
(measured on Node 24: a 1 MiB gzip that inflates to 480 MiB of XML peaks at 1.6 GB, one that inflates to 480 MiB of attachment at 1.1 GB, down from 2.1 GB before the copies were removed).
`zlib.gunzipSync` itself needs two copies while it joins its output chunks, which this package cannot avoid with a synchronous API.
That is why the default limit is 256 MiB (a worst-case file then peaks near 0.9 GB); raise it per call for a bigger vault.
Attachments over 1 MiB are views into the decompressed payload (no copy) and keep it alive; smaller ones are copied.

The XML parser is our own: no DTD (a DOCTYPE is rejected), only the five predefined entities and character references.

## Characters XML cannot store, and logging

Unprotected strings (titles, notes, group names, tags, custom data, field names, ...) are written as XML text, and XML 1.0 cannot hold control characters other than tab, line feed and carriage return, U+FFFE, U+FFFF or lone surrogates.
`writeKdbx` never drops them silently: by default it throws `InvalidArgument` naming the entry (or group) and the field, never the value.
Pass `{ invalidCharacters: 'strip' }` to drop them on write (the database object is not changed).
`findInvalidCharacters(db)` lists them (`{ where, count, protected }`, no values) and `stripInvalidCharacters(db)` removes them in place and returns the same list, so an import can tell the person what it altered; `hasInvalidXmlCharacters` and `stripInvalidXmlCharacters` work on one string.
Protected values are encrypted as UTF-8 and base64-encoded, so they keep every character UTF-8 can hold, controls, U+FFFE/U+FFFF and a leading U+FEFF included, and read back exactly.
Only lone surrogates, which UTF-8 cannot represent, are refused in a protected value (or stripped with `'strip'`).
Other programs may reject a protected control character when they read the file; that is their limit, not the format's.

The database object is plain data and holds every secret in clear text, protected values included.
Never log it, `JSON.stringify` it or hand it to `util.inspect` outside tests: nothing redacts it.
(Redaction was not added because the model is deliberately plain, cloneable data that the tests and callers compare and serialize.)

## Fixtures

`npm run fixtures` (`scripts/make-fixtures.ts`) drives `keepassxc-cli` (tested with 2.8) to create the files in `fixtures/` (password `fixture-password`):
3.1 and 4.1 databases, Argon2d and Argon2id, AES and ChaCha20, an attachment, a recycled entry and each key file kind.
They are committed so tests run without KeePassXC.
`test/interop.test.ts` runs both ways against `keepassxc-cli` and is skipped when it is absent.
KeePassXC quirks we meet: it writes tags comma-joined and sorted.

## Tests

`scripts/test-kdbx-node.sh` from the repository root (or with test file names as arguments).
Known-answer tests (Argon2 RFC 9106, Salsa20, ChaCha20, AES-KDF, HMAC blocks), round trips, fixtures, interop, hostile input, unknown-XML preservation, times, and regression tests for validated defects (`test/defects.test.ts`: character loss, UUID validation, key-file and empty-password compatibility).
Argon2 test parameters stay at 64 MiB or less.

## Differences from the Swift codec

- Also reads and writes 3.1 and 4.0; Argon2d is supported.
- Unknown XML is preserved in Meta, groups and entries.
- Typed errors with stable codes and configurable safety limits.
- Header hash is checked before the header is interpreted.
- Times are `Date`, whole seconds.
- Attachment pool deduplicates by SHA-256 and protected flag.
