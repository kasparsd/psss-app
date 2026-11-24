# @psss/vault

Opens and writes a Psss folder vault without the app: no Keychain, no network, no prompts, no output.
It is the library under the command line (see [command line](../../docs/cli.md), part 1).
It sits on `@psss/format` (the byte format and the reader) and adds what a device needs on top: unlocking, device state, a read model, writes with an outbox, sync and verify.

Node 24, TypeScript run directly (erasable syntax only), no dependencies, no build step.
Imports are relative (`../../format/src/*.ts`).

## Layout

```
src/vault.ts     createVault, openVault, the Vault class (load, reads, writes, sync, verify)
src/model.ts     read model: items, search, field lookup, history
src/reference.ts parseReference, formatReference (psss://group/item/field)
src/state.ts     device state in stateDir: state.json and outbox/
src/lock.ts      the exclusive lock on stateDir (withLock)
src/location.ts  reading a folder: slots, wraps, segments
src/fsutil.ts    atomic writes and put-if-absent
src/keyfile.ts   the device key file
src/totp.ts      RFC 4226 and 6238 codes for the one-time-password field
src/random.ts    systemRandom and seededRandom (tests)
test/            node:test suites; run with `sh scripts/test-vault.sh`
```

## API

```ts
createVault(o: { name; location; keyFile; stateDir; now?; random?; password?; recoveryKit?; argon2?; testOnlyWeakKdf?; groupName?; durable? }): { vault: Vault; recoveryKit?: string }
openVault(o: { locations: string[]; unlock: {keyFile}|{keyBytes}|{password}|{recoveryKit}; stateDir: string; now?; random?; offline?; durable?; lockWaitMs? }): Vault

vault.info(): VaultInfo
vault.list({group?, scope?}): ItemSummary[]            // scope: 'live' | 'deleted' | 'all'
vault.search(text, {group?, scope?}): ItemSummary[]    // title, username, urls, tags, custom labels; never values
vault.find(ref): FindResult                            // found | ambiguous (with candidates) | missing
vault.show(ref): ShowResult                            // the item, concealed values left out
vault.get(ref): GetResult                              // one field's value, or a TOTP code
vault.history(ref): HistoryResult                      // earlier values, newest first
vault.setField(ref, value, {concealed?}): WriteResult
vault.addItem(spec): { id; item; write }
vault.editItem(ref, edits): WriteResult
vault.deleteItem(ref) / restoreItem(ref) / purgeItem(ref): WriteResult
vault.sync(): SyncReport                               // each location: upToDate | behind, with a reason
vault.verify(): { ok; checked; locations; problems: { code; location; detail; plain }[] }
vault.issues: { code: string; location: string; detail: string; plain: string }[]   // read-only; what opening found wrong
vault.admitDevice(kemPk): { slotId; locations }
vault.addLocation(path) / removeLocation(path)
withLock<T>(dir: string, fn: () => T, o?: { waitMs?; staleMs? }): T   // the state lock, exported for tests and tools
ValueTooLarge extends VaultError   // { code: 'value_too_large'; field: string; limit: number; size?: number }
parseReference(s): Reference
formatReference(r): string
```

```ts
import { createVault, openVault } from '@psss/vault';

const { vault } = createVault({ name: 'Home', location: '/Users/me/Vault.psss', keyFile: '/Users/me/.psss/key', stateDir: '/Users/me/.psss/state' });
vault.addItem({ title: 'GitHub', username: 'me', password: 'hunter2' });
vault.setField('psss://GitHub/password', 'correct horse');

const again = openVault({ locations: ['/Users/me/Vault.psss'], unlock: { keyFile: '/Users/me/.psss/key' }, stateDir: '/Users/me/.psss/state' });
const r = again.get('psss://GitHub/password');   // { kind: 'found', value: 'correct horse', ... }
again.verify().ok;                               // true; verify never repairs anything
```

References: `psss://item/field`, `psss://group/item/field`, `psss://id:<hex>/field`, and `?previous=n` for an earlier password.
Characters `% / ? #` in a title are percent-escaped. A reference that names two items is `ambiguous` and lists the candidates; one that names none is `missing`.

### Writes

Each write seals its record once, puts the sealed bytes in the outbox, advances the sequence number, and only then writes to the locations with put-if-absent (a file is never replaced).
If a location fails the record stays in the outbox and `WriteResult.inOutbox` is true; `sync()` resends the same bytes.
`setOffline(true)` or `offline: true` keeps every write in the outbox until `sync()`.

Delivery is never silent. `vault.delivery()` returns `{ pending, locations }` after any write, import or sync: how many records wait in the outbox (a count of files) and the locations the last operation could not write to, each with the error (technical words; the command line rewrites them). It is cleared at the start of each write, import and sync.
Before every write and every real import (not offline, not a dry run) the vault first sends what an earlier run left in the outbox: the stored bytes of each record, never sealed again (spec 4.1), in sequence order and a hundred records to a file, to each location that lacks them, and then removes what every location holds. A location that fails in this step, or in an earlier batch of an import, is skipped for the rest of the operation, so its copy of this device's chain never has a gap; the records wait for `sync()` or the next write.
A killed writer can leave `outbox/.tmp-<pid>-<random>-….sealed`. The first write, import or sync of a process (with the lock held) removes those whose process is gone or that are older than `staleMs`; a young file of a live process and the real entries stay (`DeviceState.sweepOutbox`).

One record carries at most 1 MiB, and the item schema limits a text value (password, username, custom field and so on) to 64 KiB and notes to 256 KiB.
A larger value throws `ValueTooLarge` (`code` `value_too_large`, with `field`, `limit` and `size` in bytes) before anything is sealed or stored; values are never split over records.

### Import, export and attachments

```ts
vault.importKdbx(db: KdbxDatabase, { group?, stripInvalid?, includeTrash?, update?, dryRun?, progress?(done, total) }): ImportReport   // throws ImportInterrupted when it stops part of the way
vault.exportKdbx({ group?, stripInvalid? }): { db: KdbxDatabase, report: ExportReport }
vault.readAttachment(groupId, attachment): Uint8Array            // from the first location that holds each chunk
openVault({ ..., readOnly: true })                               // no lock, no write of any kind: for a dry run
readKeepass(db, { now, stripInvalid?, includeTrash? }) / buildKeepass(items, { name, ... })   // the pure mapping in src/keepass.ts
```

`importKdbx` takes a database read by [`@psss/kdbx`](../kdbx/README.md). Each entry becomes one item written in one record, recognized later by its `source` field (the entry's UUID and a hash of its content), so importing the same file again writes nothing; see [items](../../docs/items.md#keepass-import-and-export-in-the-record-log-vault) for what a second run does with items that changed. Attachments are sealed in 1 MiB chunks with a key of their own and written to every location before the record that names them. The reports hold names and counts, never a value. `exportKdbx` makes the entry UUID the UUID of the KeePass entry the item was imported from (when no other item would use it; the item id otherwise) and reads each attachment back from the locations.

A real import holds the state lock from the moment it reads what the vault holds until its last record is stored, and reads the vault again after taking it, so two imports of one file at once add each entry once. It refreshes the lock while it runs (`refreshLock`: for every entry it reads, at most once in a quarter of `staleMs`, so a long run of entries that write nothing cannot let it go stale; and always before and after each write to a location, which may be slow), and tells whoever waits that an import is running (`VaultError.what`). Records are sealed one after another, each stored in the outbox before it is delivered, and delivered a hundred at a time as one segment file; the cost is linear (20,000 entries in about three minutes on a laptop, 190 MB of memory). When it stops part of the way it throws `ImportInterrupted` (`added`, `updated`, `reason`): what was stored stays, and running the import again does the rest. A dry run (`readOnly` vault) takes no lock and writes nothing. Entries of one file that share a UUID become separate items under derived ids (see [items](../../docs/items.md#keepass-import-and-export-in-the-record-log-vault)). `ImportReport.invalidFields` counts the fields refused for their characters, a part of `refusedFields`; names in reports are cut to 60 characters (`shortName`).

### Locking

Every write, `sync()` and every open take an exclusive lock on `stateDir` (the file `<stateDir>/lock`), so that several processes of one device (a shell script running `psss set` in parallel, say) cannot read the same sequence number and outbox and seal two records at one place.
The lock file holds a pid, a time and a token and is created whole (written under a temporary name, then linked into place), with `node:fs` only.
A lock whose process is gone, or that is older than two minutes, is stolen; a crash while holding it costs nothing, because the state files are written atomically.
Others wait with a short randomised backoff for `lockWaitMs` (default 5000), then fail with `VaultError` `state_locked`, whose message names the lock file and says another psss is running; when the holder said what it is doing, `err.what` is set (`import`).
A long job calls `refreshLock(dir)` now and then (an import and a sync do, and every write to a location is bracketed by a refresh), which rewrites the lock with a new time and the same token, so that it is not taken for an abandoned one.
`LockOptions.clock` replaces `Date.now` for the times in the lock and the staleness check (tests use it to prove a gap of over two minutes does not make a lock stale); `Vault.beforeLocationWrite` is an internal hook that lets a test stand in for a slow location.
The device state is read again after the lock is taken, and when it changed the vault is read again before the record is built; nothing from before the lock is trusted.
Within one process the lock is re-entrant.

### Sync and verify

`sync()` reads every location, merges, writes what a location lacks (including other devices' records, with identical file names) and reports `upToDate` or `behind` per location.
`vault.issues` is the part of that report that opening already knows: records discarded for a failed tag, signature or salt, records stored under the wrong name or place, a gap or fork in a chain, records of non-members, a rollback against the remembered heads and the like.
It is a byproduct of the one pass that opens the vault (no second pass), empty when nothing is wrong, and refreshed by every open, `sync()` and `verify()`.
Every issue has `plain`, one sentence for a person (for example "A record in ~/Psss/Personal.psss was changed after it was written and is ignored."), and keeps the technical text in `detail`.
An unreachable folder, a key this device lacks and a clock held back are in `verify()` only.
The codes of the issues are always among the codes of `verify()`.
`verify()` reports, per problem, a `code`, the `location`, a `detail` and a `plain`: bit flips (`bad_tag`), dropped records (`gap`), swapped or misplaced records (`swapped_record`), records of non-members (`unauthorized_author`) and a rolled-back location (`rolled_back`), among others.

## Device state and key file

`stateDir` holds `state.json` (vault name, device id, per group the last sequence number and record id of this device's chain, and per location the newest remembered head of every chain, for the rollback check of spec 4.4) and `outbox/<group>-<seq>.sealed` (sealed records not yet in every location).
Files are written to a temporary name and renamed; the state advance is not flushed to disk, the outbox record is, and on open the state is rebuilt from the outbox and the records found (spec 3.2: if the state is behind the device's own records, a new device id is taken).

The key file is `{"format":"psss-device-key","version":1,"kem_seed":"<64 hex>"}`, mode 0600, created exclusively.
The file format is this library's own choice: the spec (7.2) does not define one.

## Determinism and tests

With `now` and `random` given, ids, keys and record bodies are deterministic. HPKE encapsulation (wraps, device slots) still uses platform randomness, because Node cannot take ML-KEM randomness.
Tests use the spec 7.2 test-only switch to lower Argon2id, never the 1 GiB vector.
The parallel-writer test starts six real child processes (`test/child-writer.ts`) on one vault, key and state directory; it takes about 2 seconds, 1.5 of them a fixed wait for the children to start.
The concurrency test uses `durable: false` (no fsync) and runs 200 rounds; `ROUNDS=n` shortens it (its conflict-count assertion then may fail).

## What is not built

- The device-admission exchange is not specified (spec section 10). `admitDevice` is only the primitive: it writes a device slot for a given public key. Nothing carries the key or approves it.
- Checkpoints and purge answers (purge requests are written; nothing answers them), sharing and several people, groups beyond the first. Attachment chunks are written by import and never removed after a purge.
- The lock is for processes on one machine: a `stateDir` shared between machines (a sync folder) is not supported, and a lock held by a hung process is only taken over after two minutes. A value larger than one record is refused, not chunked (attachments would carry it).
- The OS keyring, an otpauth URI parser, adding a password slot after creation.
