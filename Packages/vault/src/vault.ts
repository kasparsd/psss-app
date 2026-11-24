// The vault: open, read, write, sync and verify a folder vault over @psss/format. See ../README.md.
//
// How a load works (spec 8.1 and 9): unlock to the person secret, unwrap the group keys from the wraps in every location, read every
// segment, open every frame (spec 9 steps 1 and 2), merge the records of all locations by union together with this device's outbox, and let
// the format's reader fold them (steps 3 and 4). Nothing is repaired and nothing is written while loading except the device's own memory
// of what it accepted from each location.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { concat, eq, fromHex, hex } from '../../format/src/bytes.ts';
import { CborError, decode, isBytes, isMap } from '../../format/src/cbor.ts';
import { frame, initFolder, readFrames, chainDir, segmentName, slotPath, keyPath } from '../../format/src/folder.ts';
import { contentStatus, evaluateGroup, type GroupView } from '../../format/src/group.ts';
import { commitOf, derivePerson, gidOf, makeCard, FormatError, type Person } from '../../format/src/keys.ts';
import { checkLocation, chainOf, type Offered, type Remembered } from '../../format/src/remember.ts';
import { KIND, MEMBERSHIP_KINDS, keyRing, nextClock, openRecord, recordId, sealRecord, type Clock, type KeyRing, type Rec } from '../../format/src/record.ts';
import { ItemChange, SETTINGS_ITEM_ID, SchemaError, positionAtEnd, viewItem, viewSettings, type ItemView, type Otp } from '../../format/src/schema.ts';
import { cmap, encode, type CborValue, type CMap } from '../../format/src/cbor.ts';
import { openAttachment, sealAttachment, chunkId } from '../../format/src/slots.ts';
import { DEFAULT_ARGON2, SLOT_DEVICE, SLOT_KIT, SLOT_PASSWORD, argon2ParamsProblem, kitFromText, kitToText, openSlot,
         sealDeviceSlot, sealKitSlot, sealPasswordSlot, unwrapGroupKey, wrapGroupKey } from '../../format/src/slots.ts';
import type { Argon2Params } from '../../format/src/prims.ts';
import { ImportInterrupted, VaultError, ValueTooLarge, type Candidate } from './errors.ts';
import { limits } from '../../format/src/limits.ts';
import { homedir } from 'node:os';
import { refreshLock, withLock, type LockOptions } from './lock.ts';
import { flushDirectory, putIfAbsent } from './fsutil.ts';
import { generateDeviceKey, keyFileWarning, parseKeyFile, readKeyFile, writeKeyFile, type DeviceKey } from './keyfile.ts';
import { blobPath } from '../../format/src/folder.ts';
import { buildKeepass, contentHash, contentOf, nameOf, readKeepass, specView, type BuiltExport, type ContentView, type ExportItem, type ItemSpec, type ReportIssue } from './keepass.ts';
import type { KdbxDatabase } from '../../kdbx/src/index.ts';
import { listGroupIds, listSlots, listWraps, probe, readSegments, supportFiles, type Probe } from './location.ts';
import { ZERO_ITEM, buildEntries, builtinField, candidateOf, compareEntries, detail, fieldTarget, historyOf, matchesText, summarize, titleOf,
         type GroupCtx, type HistoryEntry, type ItemDetail, type ItemEntry, type ItemSummary } from './model.ts';
import { parseReference, type Reference, type Selector } from './reference.ts';
import { systemRandom, type Random } from './random.ts';
import { DeviceState } from './state.ts';
import { totp } from './totp.ts';

// ---------------------------------------------------------------- public types

export type UnlockSource = 'keyFile' | 'keyBytes' | 'password' | 'recoveryKit';
/** `keyFile`: the path of the device key file. `keyBytes`: the contents of one (for an environment variable). `password`: the vault password
 *  (`testOnlyWeakKdf` lifts the lower Argon2id limits, spec 7.2). `recoveryKit`: the printed text, `RK1-...`. */
export type Unlock =
  | { keyFile: string }
  | { keyBytes: Uint8Array | string }
  | { password: string; testOnlyWeakKdf?: boolean }
  | { recoveryKit: string };

export interface OpenOptions {
  /** one or more folders; the records of all are merged by union */
  locations: string[];
  unlock: Unlock;
  stateDir: string;
  now?: () => number;
  random?: Random;
  /** writes stay in the outbox until sync() (see setOffline) */
  offline?: boolean;
  /** false: never flush to disk (fsync). A power failure can then lose the newest records and the device state. For tests and throwaway vaults only. Default true. */
  durable?: boolean;
  /** how long a write or sync waits for another psss using the same stateDir, in milliseconds. Default 5000. */
  lockWaitMs?: number;
  /** Opens to read and plan only: takes no lock, writes nothing to the device state or the vault, not even what the device remembers, and every write is refused with `read_only`. For a dry run. */
  readOnly?: boolean;
}
export interface CreateOptions {
  name: string;
  location: string;
  keyFile: string;
  stateDir: string;
  now?: () => number;
  random?: Random;
  /** adds a vault password slot (type 1) */
  password?: string;
  argon2?: Argon2Params;
  /** lifts the lower Argon2id limits for tests (spec 7.2) */
  testOnlyWeakKdf?: boolean;
  /** adds a recovery kit slot (type 2) and returns its text */
  recoveryKit?: boolean;
  /** the name of the first group, "Only Me" by default */
  groupName?: string;
  /** as in OpenOptions */
  durable?: boolean;
}

export type Scope = 'live' | 'deleted' | 'all';

export interface ImportOptions {
  /** the group the new items go to, as for `addItem`; the only writable group when left out */
  group?: string;
  /** remove characters that a KeePass file cannot hold from a field instead of leaving the field out */
  stripInvalid?: boolean;
  /** bring in the entries of the file's Recycle Bin as deleted items (they are left out by default) */
  includeTrash?: boolean;
  /** replace an item that was changed in the file since it was imported and not changed here (never replaced by default) */
  update?: boolean;
  /** work out and report everything, write nothing; takes no lock */
  dryRun?: boolean;
  /** called before each entry of the file is dealt with (`done` entries so far of `total`) and once more when all are: for a progress line.
   *  An error thrown from it stops the import like any other failure. */
  progress?: (done: number, total: number) => void;
}
export type ImportAction = 'add' | 'update' | 'unchanged' | 'keptYours' | 'changedInFile' | 'conflict' | 'deleted' | 'gone' | 'refused';
export interface ImportReport {
  group: string;
  groupId: string;
  dryRun: boolean;
  /** new items (with `dryRun`: the items that would be added) */
  added: number;
  attachments: number;
  updated: number;
  /** already here, the same as in the file */
  unchanged: number;
  /** changed here, not in the file: left as they are here */
  keptYours: number;
  /** changed in the file and not here: left alone unless `update` */
  changedInFile: number;
  /** changed in both: the version here was kept */
  conflicts: number;
  /** deleted here (Recently Deleted): not brought back */
  skippedDeleted: number;
  /** deleted for good here: not brought back */
  skippedGone: number;
  /** entries in the file's Recycle Bin that were left out */
  skippedTrash: number;
  inFolders: number;
  /** items that are over a limit of the vault (a record holds 1 MiB) */
  refusedItems: number;
  refusedFields: number;
  /** of `refusedFields`, those refused for characters a KeePass file cannot hold: `stripInvalid` would bring them in */
  invalidFields: number;
  strippedFields: number;
  issues: ReportIssue[];
  /** one line per entry of the file: its name and what happened; never a value */
  items: { title: string; action: ImportAction }[];
}
export interface ExportKdbxOptions { group?: string; stripInvalid?: boolean }
export interface ExportReport {
  /** live items written */
  items: number;
  /** items from Recently Deleted, written into the Recycle Bin */
  deleted: number;
  attachments: number;
  groups: number;
  groupsShared: boolean;
  /** what the file does not carry, as plain words that follow "Not in a KeePass file:" */
  doesNotTravel: { code: string; text: string }[];
  issues: ReportIssue[];
  refusedFields: number;
  strippedFields: number;
}
export interface ExportKdbxResult { db: KdbxDatabase; report: ExportReport }
export type FindResult =
  | { kind: 'found'; item: ItemSummary }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'notFound'; reference: string };
export type ShowResult = { kind: 'found'; item: ItemDetail } | Exclude<FindResult, { kind: 'found' }>;
export type GetResult =
  | { kind: 'value'; value: string; field: string; item: ItemSummary; expiresInSeconds?: number }
  | { kind: 'noField'; field: string; item: ItemSummary }
  | Exclude<FindResult, { kind: 'found' }>;
export type HistoryResult =
  | { kind: 'history'; field: string; item: ItemSummary; entries: HistoryEntry[] }
  | { kind: 'noField'; field: string; item: ItemSummary }
  | Exclude<FindResult, { kind: 'found' }>;

export interface ItemEdits {
  type?: 1 | 2 | 3 | 4;
  title?: string;
  username?: string;
  password?: string;
  /** the primary website: replaces the first one, or adds it */
  url?: string;
  notes?: string;
  cardholder?: string;
  card?: { number: string; year?: number; month?: number };
  cardCode?: string;
  cardPin?: string;
  otp?: Otp;
  tags?: { add?: string[]; remove?: string[] };
  /** by label; `null` removes; a new label is added concealed unless `concealed: false` */
  custom?: Record<string, string | { value: string; concealed?: boolean } | null>;
}
export interface NewItem extends ItemEdits { group?: string }

export interface WriteResult {
  /** the record id, lowercase hexadecimal */
  id: string;
  seq: number;
  group: string;
  /** locations the record was written to */
  delivered: string[];
  failed: { location: string; error: string }[];
  /** true until every location holds it: sync() delivers it */
  inOutbox: boolean;
}

/** What a write, an import or a sync left behind: records sealed on this device that are not yet in every location. See `Vault.delivery()`. */
export interface Delivery {
  /** records in the outbox: stored durably on this device, not in every location */
  pending: number;
  /** the locations the last operation could not write to, each with the library's own words for why (technical: a person-facing layer rewrites them) */
  locations: { location: string; error: string }[];
}

export interface LocationStatus {
  location: string;
  /** `upToDate`: the location holds every record this device holds, which is all a reader can know (spec 4.4). `behind`: it does not, or cannot be read, and `reason` says why. */
  status: 'upToDate' | 'behind';
  reason?: string;
  records: number;
}
export interface GroupSummary { id: string; name: string; role: 'reader' | 'writer' | 'manager'; epoch: number; items: number; deleted: number }
export interface VaultInfo {
  name: string;
  formatVersion: 1;
  deviceId: string;
  person: string;
  groups: GroupSummary[];
  itemCount: number;
  deletedCount: number;
  locations: LocationStatus[];
  unlock: { source: UnlockSource; keyFile?: string };
  /** a way back if every device key is lost: a vault password slot or a recovery kit slot in some location (spec 7.2) */
  wayBack: { password: boolean; recoveryKit: boolean; any: boolean };
  /** records written by this device that are not yet in every location */
  outbox: number;
  /** items a purge request has hidden that no checkpoint has answered yet (spec 5.4; this library does not write the checkpoint) */
  purgesPending: number;
  warnings: string[];
}

export interface SyncReport {
  locations: (LocationStatus & { wrote: number; failed: string[] })[];
  /** locations that offered less than this device remembered (spec 4.4), as found before anything was written */
  rolledBack: { location: string; detail: string }[];
  /** records still waiting for a location */
  outbox: number;
  records: number;
}
/** `plain`: one sentence for a person, without ids or internals; `detail` keeps the technical description. */
export interface Problem { code: string; location: string | null; detail: string; plain: string }
/** What opening found wrong with the vault's files: a Problem that concerns what the vault holds (not an unreachable folder, a key this
 *  device lacks or a clock held back). `verify()` reports these and more, with the same codes. */
export interface Issue { code: string; location: string; detail: string; plain: string }
export interface VerifyReport {
  ok: boolean;
  /** records examined, over all locations and the outbox */
  checked: number;
  locations: { location: string; state: 'vault' | 'empty' | 'unreadable'; records: number; problems: number }[];
  problems: Problem[];
}

// ---------------------------------------------------------------- internals

interface FrameInfo { location: string; rel: string; gid: string; id: string; sealed: Uint8Array; rec?: Rec; err?: FormatError }
interface Diag { code: string; detail: string; location: string | null }
interface LocLoad { path: string; key: string; probe: Probe; frames: FrameInfo[]; diags: Diag[]; ids: Set<string> }
interface Rollback { location: string; chain: string; reason: string; remembered: number; offered: number | null }
interface Loaded {
  locs: LocLoad[];
  union: Map<string, Rec>;
  outboxIds: Set<string>;
  keys: Map<string, Map<number, Uint8Array[]>>;
  groups: Map<string, GroupCtx>;
  diags: Diag[];
  rollbacks: Rollback[];
  problems: Problem[];
}

const ROLES = ['reader', 'reader', 'writer', 'manager'] as const;
const roleName = (r: number): 'reader' | 'writer' | 'manager' => ROLES[Math.max(0, Math.min(3, r))]!;
const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase();
const isMembership = (kind: number) => MEMBERSHIP_KINDS.includes(kind);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (h: string) => h.slice(0, 8);

interface SlotInfo { type: number; kemPk?: Uint8Array }
const BATCH = 100;
const specTitle = (s: ItemSpec): string => nameOf(s);
const refusedWrite = (e: unknown): boolean => e instanceof ValueTooLarge || e instanceof SchemaError;
const plainRefusal = (e: unknown): string => (e instanceof ValueTooLarge ? 'The item is too large for one record (1 MiB), so it was not imported.' : 'The item is over a limit of an item in a Psss vault, so it was not imported.');
function viewContent(v: ItemView): ContentView {
  return {
    type: v.type, title: v.title, username: v.username, password: v.password, notes: v.notes, cardholder: v.cardholder, cardCode: v.cardCode, cardPin: v.cardPin,
    websites: v.websites.map((w) => w.address), ...(v.otp ? { otp: v.otp } : {}), ...(v.passkey ? { passkey: v.passkey } : {}), ...(v.card ? { card: v.card } : {}),
    custom: v.customFields.map((f) => ({ label: f.label, value: f.value, concealed: f.concealed })), tags: v.tags.map((t) => t.text),
    attachments: v.attachments.map((a) => ({ name: a.fileName, size: (a.attachment as CMap).get(2) as number })),
  };
}

function slotInfo(bytes: Uint8Array): SlotInfo | null {
  try {
    const m = decode(bytes);
    if (!isMap(m)) return null;
    const t = m.get(2), p = m.get(5);
    return { type: typeof t === 'number' ? t : -1, ...(isMap(p) && isBytes(p.get(1)) ? { kemPk: p.get(1) as Uint8Array } : {}) };
  } catch (e) { if (e instanceof CborError) return null; throw e; }
}

interface Unlocked { ps: Uint8Array; source: UnlockSource; keyFile?: string; deviceKey?: DeviceKey }

function unlockPerson(readable: string[], unlock: Unlock): Unlocked {
  const slots = readable.flatMap((root) => listSlots(root)).map((s) => ({ ...s, info: slotInfo(s.bytes) })).filter((s) => s.info);
  const tryAll = (type: number, open: (bytes: Uint8Array) => Uint8Array, filter: (i: SlotInfo) => boolean = () => true): Uint8Array | null => {
    let failure: FormatError | null = null;
    for (const s of slots) {
      if (s.info!.type !== type || !filter(s.info!)) continue;
      try { return open(s.bytes); } catch (e) { if (e instanceof FormatError) failure = e; else throw e; }
    }
    if (failure && failure.code.startsWith('argon2')) throw new VaultError('bad_slot_parameters', `the password slot is refused: ${failure.code}`);
    return null;
  };
  if ('keyFile' in unlock || 'keyBytes' in unlock) {
    const key = 'keyFile' in unlock ? readKeyFile(unlock.keyFile) : parseKeyFile(unlock.keyBytes);
    const ps = tryAll(SLOT_DEVICE, (b) => openSlot(b, { deviceKemSeed: key.kemSeed }), (i) => !!i.kemPk && eq(i.kemPk, key.kemPk));
    if (!ps) throw new VaultError('no_device_slot', 'this device key does not open any device slot of the vault');
    return { ps, source: 'keyFile' in unlock ? 'keyFile' : 'keyBytes', ...('keyFile' in unlock ? { keyFile: unlock.keyFile } : {}), deviceKey: key };
  }
  if ('password' in unlock) {
    if (!slots.some((s) => s.info!.type === SLOT_PASSWORD)) throw new VaultError('no_slot', 'this vault has no password slot');
    const ps = tryAll(SLOT_PASSWORD, (b) => openSlot(b, { password: unlock.password }, { testOnly: !!unlock.testOnlyWeakKdf }));
    if (!ps) throw new VaultError('bad_unlock', 'the password does not open this vault');
    return { ps, source: 'password' };
  }
  let kit: Uint8Array;
  try { kit = kitFromText(unlock.recoveryKit); } catch (e) { throw new VaultError('bad_recovery_kit', e instanceof FormatError ? e.code : message(e)); }
  if (!slots.some((s) => s.info!.type === SLOT_KIT)) throw new VaultError('no_slot', 'this vault has no recovery kit slot');
  const ps = tryAll(SLOT_KIT, (b) => openSlot(b, { kit }));
  if (!ps) throw new VaultError('bad_unlock', 'the recovery kit does not open this vault');
  return { ps, source: 'recoveryKit' };
}

export function openVault(opts: OpenOptions): Vault {
  const readable = opts.locations.filter((l) => probe(l).state === 'vault');
  if (readable.length === 0) throw new VaultError('not_a_vault', `no location is a psss vault: ${opts.locations.map((l) => `${l} (${describe(probe(l))})`).join('; ')}`);
  const u = unlockPerson(readable, opts.unlock);
  const random = opts.random ?? systemRandom;
  const durable = opts.durable ?? true;
  const lock: LockOptions = opts.lockWaitMs !== undefined ? { waitMs: opts.lockWaitMs } : {};
  if (opts.readOnly) {
    const state = DeviceState.ephemeral(opts.stateDir, basename(opts.locations[0]!).replace(/\.psss$/, ''), random(16));
    const v = new Vault(derivePerson(u.ps), u, state, [...opts.locations], opts.now ?? Date.now, random, true, false);
    v.lockOptions = lock;
    v.load(false);
    return v;
  }
  return withLock(opts.stateDir, () => {
    const state = DeviceState.load(opts.stateDir, durable) ?? DeviceState.create(opts.stateDir, basename(opts.locations[0]!).replace(/\.psss$/, ''), random(16), durable);
    const v = new Vault(derivePerson(u.ps), u, state, [...opts.locations], opts.now ?? Date.now, random, !!opts.offline, durable);
    v.lockOptions = lock;
    v.load(true);
    return v;
  }, lock);
}

const describe = (p: Probe): string => (p.state === 'unreadable' ? p.reason : p.state);

/** Makes a vault in `location` (spec 8.1) with one person, this device let in through a device slot, the first group key and one group, "Only
 *  Me". Everything that must be known before anything leaves the device is stored first: the key file (mode 0600) and the device state with
 *  the two first records in its outbox. Then the folder is written and the vault is opened. */
export function createVault(opts: CreateOptions): { vault: Vault; recoveryKit?: string } {
  const random = opts.random ?? systemRandom;
  const now = opts.now ?? Date.now;
  if (probe(opts.location).state !== 'empty') throw new VaultError('location_not_empty', `${opts.location} already holds something; a new vault needs an empty folder`);
  if (existsSync(opts.keyFile)) throw new VaultError('key_file_exists', `${opts.keyFile} exists; a device key is never overwritten`);
  if (existsSync(`${opts.stateDir}/state.json`)) throw new VaultError('state_exists', `${opts.stateDir} already holds device state`);
  const argon = opts.argon2 ?? DEFAULT_ARGON2;
  if (opts.password !== undefined) {
    const problem = argon2ParamsProblem(argon, !!opts.testOnlyWeakKdf);
    if (problem) throw new VaultError('bad_slot_parameters', `the Argon2id parameters are refused: ${problem}`);
  }

  const person = derivePerson(random(32));
  const device = generateDeviceKey(random);
  const deviceId = random(16);
  const k0 = random(32);
  const nonce = random(32);
  const gid = gidOf(person.pid, nonce, k0, 1);
  const gidHex = hex(gid);

  // slots (7.2) and the wrap of the first key (7.1)
  const slots: [string, Uint8Array][] = [];
  const addSlot = (slotId: Uint8Array, bytes: Uint8Array) => slots.push([slotPath(hex(person.pid), hex(slotId)), bytes]);
  const deviceSlotId = random(16);
  addSlot(deviceSlotId, sealDeviceSlot(person.ps, person.pid, deviceSlotId, device.kemPk));
  if (opts.password !== undefined) {
    const id = random(16);
    addSlot(id, sealPasswordSlot(person.ps, person.pid, id, random(16), argon, opts.password));
  }
  let kitText: string | undefined;
  if (opts.recoveryKit) {
    const kit = random(20), id = random(16);
    addSlot(id, sealKitSlot(person.ps, person.pid, id, kit));
    kitText = kitToText(kit);
  }
  const wrap = wrapGroupKey(gid, 0, k0, person.pid, person.kemPk);
  const wrapPath = keyPath(gidHex, 0, hex(person.pid), hex(random(8)));

  // the first two records: genesis (6.1) and the group's name (schema 8)
  const t0 = now();
  const genesis = sealRecord(person, gid, 0, k0, {
    author: person.pid, device: deviceId, seq: 1, prev: null, clock: [t0, 0], kind: KIND.genesis,
    payload: cmap([[1, nonce], [2, makeCard(person)], [3, commitOf(gid, 0, k0)], [4, 1]]),
  });
  const genesisId = recordId(genesis);
  const named = sealRecord(person, gid, 0, k0, {
    author: person.pid, device: deviceId, seq: 2, prev: genesisId, clock: nextClock(t0, [[t0, 0]]), kind: KIND.item, mhead: genesisId,
    payload: new ItemChange().groupName(opts.groupName ?? 'Only Me').payload(SETTINGS_ITEM_ID),
  });

  writeKeyFile(opts.keyFile, device.kemSeed);
  const durable = opts.durable ?? true;
  const state = DeviceState.create(opts.stateDir, opts.name, deviceId, durable);
  state.putOutbox(gidHex, 1, genesis);
  state.advance(gidHex, 1, hex(genesisId));
  state.putOutbox(gidHex, 2, named);
  state.advance(gidHex, 2, hex(recordId(named)));

  initFolder(opts.location);
  for (const [rel, bytes] of slots) putIfAbsent(opts.location, rel, bytes, durable);
  putIfAbsent(opts.location, wrapPath, wrap, durable);

  const vault = openVault({ locations: [opts.location], unlock: { keyFile: opts.keyFile }, stateDir: opts.stateDir, now, random, durable });
  vault.sync();
  return { vault, ...(kitText ? { recoveryKit: kitText } : {}) };
}

// ---------------------------------------------------------------- the vault

export class Vault {
  private person: Person;
  private unlocked: Unlocked;
  private state: DeviceState;
  private locations: string[];
  private now: () => number;
  private random: Random;
  private offline: boolean;
  private durable: boolean;
  private loaded!: Loaded;
  private dirty = false;
  private warnings: string[] = [];
  private recCache = new Map<string, Rec>();
  /** the records of an import in progress: sealed and stored in the outbox, not yet delivered (see `queueRecord`) */
  private batch: { clock: Clock | null; pending: { rec: Rec; sealed: Uint8Array }[] } | null = null;
  private beatAt = 0;
  /** the locations the current or last operation could not write to, and why; cleared at the start of each write, import or sync. A location in
   *  here gets nothing more from the same operation, so that its copy of this device's chain never has a gap. */
  private failures = new Map<string, string>();
  private swept = false;
  /** @internal for tests: called just before records are written to a location, to stand in for a slow one */
  beforeLocationWrite?: (location: string) => void;
  private wrapCache = new Map<string, Uint8Array | null>();
  /** @internal set by openVault */
  lockOptions: LockOptions = {};

  /** Use openVault or createVault. */
  constructor(person: Person, unlocked: Unlocked, state: DeviceState, locations: string[], now: () => number, random: Random, offline: boolean, durable = true) {
    this.person = person; this.unlocked = unlocked; this.state = state; this.locations = locations; this.now = now; this.random = random; this.offline = offline; this.durable = durable;
  }

  /** While offline, a write is sealed and stored in the outbox and goes to no location; sync() delivers it. */
  setOffline(offline: boolean): void { this.offline = offline; }

  addLocation(path: string): void {
    if (!this.locations.includes(path)) this.locations.push(path);
    this.load(false);
  }
  removeLocation(path: string): void {
    this.locations = this.locations.filter((l) => l !== path);
    this.load(false);
  }

  /** What opening found wrong with the files: records discarded (tag, signature, salt), moved or swapped, a gap or fork in a chain, records of
   *  non-members, a rollback against remembered heads. Found while the vault was read, not by a second pass; empty when nothing is wrong.
   *  `verify()` gives the full report. Refreshed by every load (open, sync, verify, addLocation, removeLocation). */
  get issues(): Issue[] { return this.loaded.problems.filter(isIssue).map((p) => ({ code: p.code, location: p.location ?? '', detail: p.detail, plain: p.plain })); }

  /** Runs `fn` holding the exclusive lock of the device-state directory (see lock.ts), with the device state re-read from disk first. When
   *  another process changed it since this one last looked, `refresh` also re-reads the vault, so that nothing built from before the lock is
   *  used for the write. */
  private locked<T>(fn: () => T, refresh = false, what?: string): T {
    if (this.state.memory) throw new VaultError('read_only', 'this vault was opened to read only, so nothing can be written');
    if (this.batch) return fn(); // inside an import, which holds the lock and has the state in hand
    const options: LockOptions = what === undefined ? this.lockOptions : { ...this.lockOptions, what, waitMs: this.lockOptions.waitMs ?? 30_000 };
    return withLock(this.state.dir, () => {
      const changed = this.state.reload();
      if (changed && refresh) this.load(true);
      if (!this.swept) {
        // a process killed while it wrote an outbox file leaves a `.tmp-*.sealed` behind: remove those of dead or long gone writers
        this.swept = true;
        this.state.sweepOutbox(this.lockOptions.staleMs ?? 120_000, (this.lockOptions.clock ?? Date.now)());
        this.state.sweepLockTemps(this.lockOptions.staleMs ?? 120_000, (this.lockOptions.clock ?? Date.now)());
      }
      return fn();
    }, options);
  }

  /** Tells the others that the lock is still held. Unless `force`, at most once in a quarter of the time after which a lock counts as abandoned.
   *  Called for every entry and record of a long job, and (forced) before and after each write to a location, which may be slow. */
  private beat(force = false): void {
    const t = (this.lockOptions.clock ?? Date.now)();
    if (!force && t - this.beatAt < (this.lockOptions.staleMs ?? 120_000) / 4) return;
    this.beatAt = t;
    refreshLock(this.state.dir, this.lockOptions);
  }

  /** Where this device stands after the last write, import or sync: how many records wait in the outbox, and which locations refused them. */
  delivery(): Delivery {
    return { pending: this.state.outboxCount(), locations: [...this.failures].map(([location, error]) => ({ location, error })) };
  }

  /** Writes to one location, with the lock refreshed before and after: a slow disk or share must not make the lock look abandoned. */
  private toLocation(location: string, write: () => void): void {
    this.beat(true);
    this.beforeLocationWrite?.(location);
    try { write(); } finally { this.beat(true); }
  }

  // ------------------------------------------------------------ loading

  private tryOpen(sealed: Uint8Array, ring: KeyRing): { rec: Rec } | { err: FormatError } {
    const id = hex(recordId(sealed));
    const hit = this.recCache.get(id);
    if (hit) return { rec: hit };
    try {
      const rec = openRecord(sealed, ring);
      this.recCache.set(id, rec);
      return { rec };
    } catch (e) {
      return { err: e instanceof FormatError ? e : new FormatError('unreadable', 'discard', message(e)) };
    }
  }

  private unwrap(gid: string, epoch: number, wrap: Uint8Array): Uint8Array | null {
    const k = `${gid}/${epoch}/${hex(recordId(wrap))}`;
    if (this.wrapCache.has(k)) return this.wrapCache.get(k)!;
    let key: Uint8Array | null = null;
    try { key = unwrapGroupKey(fromHex(gid), epoch, this.person.pid, this.person.kemSeed, wrap); } catch { /* not for us or damaged: the commitment decides, a wrap proves nothing (7.1) */ }
    this.wrapCache.set(k, key);
    return key;
  }

  /** Re-reads every location and the outbox and re-folds. `persist`: remember what was accepted from each location (and take a new device id
   *  if the state is behind this device's own chain, spec 3.2); verify() reads without. */
  load(persist: boolean): Loaded {
    const pidHex = hex(this.person.pid);
    const locs: LocLoad[] = this.locations.map((p) => ({ path: p, key: resolve(p), probe: probe(p), frames: [], diags: [], ids: new Set<string>() }));
    const readable = locs.filter((l) => l.probe.state === 'vault');

    // group keys: every wrap this person can open, in every location (7.1: several per epoch are possible; the commitment decides which is right)
    const keys = new Map<string, Map<number, Uint8Array[]>>();
    const addKey = (gid: string, epoch: number, key: Uint8Array): boolean => {
      const byEpoch = keys.get(gid) ?? keys.set(gid, new Map()).get(gid)!;
      const list = byEpoch.get(epoch) ?? byEpoch.set(epoch, []).get(epoch)!;
      if (list.some((k) => eq(k, key))) return false;
      list.push(key);
      return true;
    };
    for (const l of readable) for (const gid of listGroupIds(l.path)) for (const w of listWraps(l.path, gid, pidHex)) {
      const k = this.unwrap(gid, w.epoch, w.bytes);
      if (k) addKey(gid, w.epoch, k);
    }

    const outbox = this.state.outbox();
    const union = new Map<string, Rec>();
    const outboxIds = new Set<string>();
    const diags: Diag[] = [];
    for (let pass = 0; pass < 16; pass++) {
      const ring = keyRing([...keys].flatMap(([gid, byEpoch]) => [...byEpoch].flatMap(([epoch, list]) => list.map((k) => [fromHex(gid), epoch, k] as [Uint8Array, number, Uint8Array]))));
      union.clear(); outboxIds.clear(); diags.length = 0;
      for (const l of readable) {
        l.frames = []; l.diags = []; l.ids = new Set();
        for (const gid of listGroupIds(l.path)) if (keys.has(gid)) this.walk(l, gid, ring);
        for (const f of l.frames) if (f.rec) union.set(f.id, f.rec);
      }
      for (const o of outbox) {
        const r = this.tryOpen(o.sealed, ring);
        if ('rec' in r) { union.set(hex(r.rec.id), r.rec); outboxIds.add(hex(r.rec.id)); }
        else if (r.err.disposition !== 'wait') diags.push({ code: 'bad_outbox_record', location: null, detail: `outbox record ${o.gid.slice(0, 8)}/${o.seq}: ${r.err.message}` });
      }
      // an epoch record carries the previous key (6.3, 6.4): a member who can read epoch e can read everything before it
      let added = false;
      for (const r of union.values()) {
        const prevKey = r.kind === KIND.epoch ? r.payload.get(4) : r.kind === KIND.remove ? r.payload.get(6) : r.kind === KIND.replace ? r.payload.get(7) : undefined;
        if (isBytes(prevKey, 32) && keys.has(hex(r.gid)) && addKey(hex(r.gid), r.epoch - 1, prevKey)) added = true;
      }
      if (!added) break;
    }

    // this device's own chain against its state (3.2)
    const devHex = hex(this.state.deviceId);
    const behind = new Set<string>();
    for (const r of union.values()) {
      if (!eq(r.author, this.person.pid) || hex(r.device) !== devHex) continue;
      const gid = hex(r.gid);
      if (r.seq > (this.state.chain(gid)?.seq ?? 0)) behind.add(gid);
    }
    for (const gid of behind) {
      const own = [...union.values()].filter((r) => hex(r.gid) === gid && eq(r.author, this.person.pid) && hex(r.device) === devHex && r.seq > (this.state.chain(gid)?.seq ?? 0));
      if (own.every((r) => outboxIds.has(hex(r.id)))) {
        // stopped between storing the record and advancing the sequence number: the outbox is the proof
        const top = own.reduce((a, b) => (b.seq > a.seq ? b : a));
        if (persist) this.state.advance(gid, top.seq, hex(top.id));
      } else if (persist) {
        this.state.takeNewDevice(this.random(16));
        this.warnings.push('The device state was behind this device\'s own records in the vault (restored from a backup?). This device took a new device id and starts a new chain (spec 3.2).');
        break;
      } else {
        diags.push({ code: 'device_state_behind', location: null, detail: 'the vault holds records of this device\'s chain newer than the device state remembers; the next open takes a new device id' });
      }
    }

    this.loaded = { locs, union, outboxIds, keys, groups: new Map(), diags, rollbacks: [], problems: [] };
    this.evaluate();
    this.checkLocations(persist);
    this.loaded.problems = this.findProblems(this.loaded);
    this.dirty = false;
    return this.loaded;
  }

  /** Read one group's log in one location: frames, in file order, with what is wrong with the files themselves (spec 8.1). */
  private walk(l: LocLoad, gid: string, ring: KeyRing): void {
    for (const seg of readSegments(l.path, gid)) {
      const { frames, stopped } = readFrames(seg.data, (s) => { const o = this.tryOpen(s, ring); return 'rec' in o ? o.rec.seq : null; });
      if (stopped === 'oversized') l.diags.push({ code: 'bad_frame', location: l.path, detail: `${seg.rel}: a frame is longer than the largest sealed record; the rest of the file is not read` });
      if (stopped === 'out_of_sequence') l.diags.push({ code: 'swapped_record', location: l.path, detail: `${seg.rel}: records are out of sequence; the file is read up to the first one out of place` });
      const opened: Rec[] = [];
      for (const f of frames) {
        const id = hex(recordId(f));
        const o = this.tryOpen(f, ring);
        if ('rec' in o) { opened.push(o.rec); l.ids.add(id); l.frames.push({ location: l.path, rel: seg.rel, gid, id, sealed: f, rec: o.rec }); }
        else l.frames.push({ location: l.path, rel: seg.rel, gid, id, sealed: f, err: o.err });
      }
      // names are a convenience (8.1), but a writer always names a file for what it holds: a mismatch means files or records were moved
      if (opened.length === frames.length && opened.length > 0) {
        const m = /^([0-9]{10})-([0-9]{10})\.m?seg$/.exec(seg.name);
        const first = opened[0]!.seq, last = opened[opened.length - 1]!.seq;
        if (!m || Number(m[1]) !== first || Number(m[2]) !== last) l.diags.push({ code: 'swapped_record', location: l.path, detail: `${seg.rel}: the file is named for other records than the ones it holds (records ${first} to ${last})` });
        for (const r of opened) if (`${hex(r.author)}-${hex(r.device)}` !== seg.chain) { l.diags.push({ code: 'swapped_record', location: l.path, detail: `${seg.rel}: holds a record of chain ${short(hex(r.author))}/${short(hex(r.device))}, which belongs in another folder` }); break; }
      }
    }
  }

  /** Fold every group from the records held (spec 6.6). */
  private evaluate(): void {
    const L = this.loaded;
    const byGid = new Map<string, Rec[]>();
    for (const r of L.union.values()) { const g = hex(r.gid); (byGid.get(g) ?? byGid.set(g, []).get(g)!).push(r); }
    const now = this.now();
    L.groups = new Map();
    for (const [gid, recs] of byGid) {
      if (!L.keys.has(gid)) continue;
      const gidBytes = fromHex(gid);
      const view = evaluateGroup(gidBytes, recs, now);
      const m = view.membership;
      const epoch = m.epoch;
      const commit = m.commits.get(epoch);
      const writeKey = commit ? (L.keys.get(gid)!.get(epoch) ?? []).find((k) => eq(commitOf(gidBytes, epoch, k), commit)) ?? null : null;
      const settings = view.state.get(ZERO_ITEM);
      let cache: ItemEntry[] | null = null;
      const g: GroupCtx = {
        gid, gidBytes, view, name: (settings ? viewSettings(settings).name : undefined) ?? '', role: m.roles.get(hex(this.person.pid)) ?? 0, epoch, writeKey,
        entries: () => cache ?? (cache = buildEntries(g)),
      };
      L.groups.set(gid, g);
    }
  }

  /** Spec 4.4 "Remembering": compare what each location offers with the heads this device remembers, then remember what was accepted. */
  private checkLocations(persist: boolean): void {
    const L = this.loaded;
    const accepted = new Set<string>();
    const covered = new Map<string, number>();
    for (const g of L.groups.values()) {
      for (const r of g.view.chains.accepted) accepted.add(hex(r.id));
      for (const [chain, c] of g.view.covered) covered.set(`${g.gid}/${chain}`, c.seq);
    }
    for (const l of L.locs) {
      if (l.probe.state !== 'vault') continue;
      const offered: Offered = new Map();
      const next: Remembered = new Map(this.state.remembered(l.key));
      for (const f of l.frames) {
        if (!f.rec) continue;
        const k = `${f.gid}/${chainOf(f.rec.author, f.rec.device)}`;
        (offered.get(k) ?? offered.set(k, []).get(k)!).push({ seq: f.rec.seq, id: f.rec.id });
        const cur = next.get(k);
        if (accepted.has(f.id) && (!cur || f.rec.seq > cur.seq)) next.set(k, { seq: f.rec.seq, id: f.rec.id });
      }
      for (const r of checkLocation(this.state.remembered(l.key), offered, covered)) {
        L.rollbacks.push({ location: l.path, chain: r.chain, reason: r.reason, remembered: r.remembered, offered: r.offered });
      }
      if (persist) this.state.setRemembered(l.key, next);
    }
    if (persist) this.state.save();
  }

  /** Where each location stands against what this device holds. */
  statuses(): LocationStatus[] {
    const L = this.fresh();
    return L.locs.map((l): LocationStatus => {
      const records = l.ids.size;
      if (l.probe.state === 'unreadable') return { location: l.path, status: 'behind', reason: `cannot be read: ${l.probe.reason}`, records };
      if (l.probe.state === 'empty') return { location: l.path, status: 'behind', reason: 'nothing has been written here yet; sync fills it', records };
      const rolled = L.rollbacks.filter((r) => r.location === l.path);
      if (rolled.length > 0) return { location: l.path, status: 'behind', reason: `rolled back: it offers less than this device accepted from it before (${rolled.map(describeRollback).join('; ')})`, records };
      const missing = [...L.union.keys()].filter((id) => !l.ids.has(id)).length;
      if (missing > 0) return { location: l.path, status: 'behind', reason: `${missing} record${missing === 1 ? '' : 's'} this device holds ${missing === 1 ? 'is' : 'are'} not here`, records };
      return { location: l.path, status: 'upToDate', records };
    });
  }

  private fresh(): Loaded {
    if (this.dirty) { this.evaluate(); this.dirty = false; }
    return this.loaded;
  }

  // ------------------------------------------------------------ reading

  info(): VaultInfo {
    const L = this.fresh();
    const groups = [...L.groups.values()].filter((g) => g.role > 0).map((g): GroupSummary => {
      const entries = g.entries();
      return { id: g.gid, name: g.name, role: roleName(g.role), epoch: g.epoch, items: entries.filter((e) => !e.view.deleted).length, deleted: entries.filter((e) => e.view.deleted).length };
    });
    const pid = hex(this.person.pid);
    const slotTypes = new Set<number>();
    for (const l of L.locs) if (l.probe.state === 'vault') for (const s of listSlots(l.path)) if (s.pid === pid) { const i = slotInfo(s.bytes); if (i) slotTypes.add(i.type); }
    const warnings = [...this.warnings];
    if (this.unlocked.keyFile) { const w = keyFileWarning(this.unlocked.keyFile); if (w) warnings.push(w); }
    const hidden = [...L.groups.values()].reduce((n, g) => n + g.view.hidden.length, 0);
    return {
      name: this.state.name, formatVersion: 1, deviceId: hex(this.state.deviceId), person: pid, groups,
      itemCount: groups.reduce((n, g) => n + g.items, 0), deletedCount: groups.reduce((n, g) => n + g.deleted, 0),
      locations: this.statuses(),
      unlock: { source: this.unlocked.source, ...(this.unlocked.keyFile ? { keyFile: this.unlocked.keyFile } : {}) },
      wayBack: { password: slotTypes.has(SLOT_PASSWORD), recoveryKit: slotTypes.has(SLOT_KIT), any: slotTypes.has(SLOT_PASSWORD) || slotTypes.has(SLOT_KIT) },
      outbox: this.outbox().length, purgesPending: hidden, warnings,
    };
  }

  groups(): GroupSummary[] { return this.info().groups; }

  private visibleGroups(): GroupCtx[] { return [...this.fresh().groups.values()].filter((g) => g.role > 0).sort((a, b) => (a.gid < b.gid ? -1 : 1)); }

  private inScope(e: ItemEntry, scope: Scope): boolean { return scope === 'all' || (scope === 'deleted') === e.view.deleted; }

  list(opts: { group?: string; scope?: Scope } = {}): ItemSummary[] {
    return this.visibleGroups().filter((g) => !opts.group || groupMatches(parseGroup(opts.group), g)).flatMap((g) => g.entries())
      .filter((e) => this.inScope(e, opts.scope ?? 'live')).sort(compareEntries).map(summarize);
  }

  /** Items in Recently Deleted. */
  deleted(): ItemSummary[] { return this.list({ scope: 'deleted' }); }

  search(text: string, opts: { group?: string; scope?: Scope } = {}): ItemSummary[] {
    return this.visibleGroups().filter((g) => !opts.group || groupMatches(parseGroup(opts.group), g)).flatMap((g) => g.entries())
      .filter((e) => this.inScope(e, opts.scope ?? 'live') && matchesText(e, text)).sort(compareEntries).map(summarize);
  }

  private matching(ref: Reference, scope: Scope): ItemEntry[] {
    const all = this.visibleGroups().filter((g) => !ref.group || groupMatches(ref.group, g)).flatMap((g) => g.entries()).filter((e) => this.inScope(e, scope));
    if ('id' in ref.item) { const id = ref.item.id; return all.filter((e) => e.id.startsWith(id)); }
    const title = ref.item.title;
    const exact = all.filter((e) => titleOf(e.view) === title);
    return exact.length > 0 ? exact : all.filter((e) => fold(titleOf(e.view)) === fold(title));
  }

  private resolve(reference: string | Reference, scope: Scope): { kind: 'found'; entry: ItemEntry; ref: Reference } | Exclude<FindResult, { kind: 'found' }> {
    const ref = typeof reference === 'string' ? parseReference(reference) : reference;
    const text = typeof reference === 'string' ? reference : `psss://${'id' in ref.item ? `id:${ref.item.id}` : ref.item.title}/${ref.field}`;
    const found = this.matching(ref, scope);
    if (found.length === 0) return { kind: 'notFound', reference: text };
    if (found.length > 1) return { kind: 'ambiguous', candidates: found.map(candidateOf) };
    return { kind: 'found', entry: found[0]!, ref };
  }

  /** Exactly one item, or `ambiguous` with the candidates by id, or `notFound`. The field of the reference is not looked at. */
  find(reference: string | Reference, opts: { scope?: Scope } = {}): FindResult {
    const r = this.resolve(reference, opts.scope ?? 'live');
    return r.kind === 'found' ? { kind: 'found', item: summarize(r.entry) } : r;
  }

  /** The item with its fields. Secrets are in it: the caller decides what to show. */
  show(reference: string | Reference, opts: { scope?: Scope } = {}): ShowResult {
    const r = this.resolve(reference, opts.scope ?? 'live');
    return r.kind === 'found' ? { kind: 'found', item: detail(r.entry, this.now()) } : r;
  }

  /** One field of one item. `code` is computed from the item's verification-code secret at the injected time. */
  get(reference: string | Reference, opts: { scope?: Scope } = {}): GetResult {
    const r = this.resolve(reference, opts.scope ?? 'live');
    if (r.kind !== 'found') return r;
    const { entry, ref } = r;
    const item = summarize(entry);
    if (ref.field.toLowerCase() === 'code' && entry.view.otp) {
      if (ref.previous !== undefined) return { kind: 'noField', field: ref.field, item };
      const c = totp(entry.view.otp, this.now());
      return { kind: 'value', value: c.code, field: 'code', item, expiresInSeconds: c.expiresInSeconds };
    }
    const target = fieldTarget(entry.view, ref.field);
    if (!target) return { kind: 'noField', field: ref.field, item };
    if (ref.previous !== undefined) {
      const h = historyOf(entry, target)[ref.previous - 1];
      return h ? { kind: 'value', value: h.value, field: target.label, item } : { kind: 'noField', field: ref.field, item };
    }
    return { kind: 'value', value: target.value, field: target.label, item };
  }

  /** Earlier values of a field with the dates they were replaced, newest first. `password`: Previous Passwords of the item schema. Other
   *  fields: every earlier write still held (a checkpoint would drop them). */
  history(reference: string | Reference, opts: { scope?: Scope } = {}): HistoryResult {
    const r = this.resolve(reference, opts.scope ?? 'all');
    if (r.kind !== 'found') return r;
    const item = summarize(r.entry);
    const target = fieldTarget(r.entry.view, r.ref.field);
    if (!target) return { kind: 'noField', field: r.ref.field, item };
    return { kind: 'history', field: target.label, item, entries: historyOf(r.entry, target) };
  }

  /** What every device must agree on after syncing: the folded items with every field's winner and earlier writes. For tests and `doctor`. */
  snapshot(): unknown {
    return this.visibleGroups().map((g) => ({
      group: g.gid, name: g.name,
      items: [...g.view.state].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, fields]) => ({
        id,
        fields: [...fields].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, list]) => ({
          name, writes: list.map((w) => [w.cleared ? null : hex(encode(w.value)), w.key[0], w.key[1], hex(w.key[2]), hex(w.key[3]), w.key[4]]),
        })),
      })),
    }));
  }

  // ------------------------------------------------------------ writing

  private pickGroup(name?: string): GroupCtx {
    const writable = this.visibleGroups().filter((g) => g.role >= 2 && g.writeKey);
    if (name !== undefined) {
      const sel = parseGroup(name);
      const found = writable.filter((g) => groupMatches(sel, g));
      if (found.length !== 1) throw new VaultError(found.length === 0 ? 'no_group' : 'ambiguous_group', `${found.length === 0 ? 'no writable group' : 'several groups'} named ${name}`);
      return found[0]!;
    }
    if (writable.length === 1) return writable[0]!;
    throw new VaultError(writable.length === 0 ? 'no_group' : 'group_required', writable.length === 0 ? 'this device cannot write to any group' : 'there is more than one group: say which');
  }

  private resolveForWrite(reference: string | Reference, scope: Scope): { entry: ItemEntry; ref: Reference } {
    const r = this.resolve(reference, scope);
    if (r.kind === 'notFound') throw new VaultError('not_found', `no item matches ${r.reference}`);
    if (r.kind === 'ambiguous') throw new VaultError('ambiguous', 'more than one item matches; use psss://id:<id>/field', r.candidates);
    return r;
  }

  /** One record: built, sealed once, stored in the outbox, the sequence number advanced, then written to every location with put-if-absent
   *  (spec 4.1, 4.4). A location that fails does not lose the record: it stays in the outbox. */
  private writeRecord(g: GroupCtx, kind: number, payload: CMap): WriteResult {
    return this.locked(() => { this.drainOutbox(); return this.writeRecordLocked(g, kind, payload); }, true);
  }

  /** Before a write or an import: sends what an earlier run left in the outbox (a failed delivery, a killed import) to the locations that lack
   *  it. The stored bytes go out exactly as they are, never sealed again (spec 4.1), in sequence order and a hundred records to a file, as an
   *  import writes them. A location that fails is noted in `failures` and gets nothing more from this operation; what is held by every
   *  location leaves the outbox. Does nothing while offline. */
  private drainOutbox(): void {
    this.failures.clear();
    if (this.offline) return;
    const entries = this.state.outbox();
    if (entries.length === 0) return;
    const L = this.loaded;
    const todo: { gid: string; id: string; rec: Rec; sealed: Uint8Array; seq: number; seg: boolean }[] = [];
    for (const o of entries) {
      const id = hex(recordId(o.sealed));
      const rec = L.union.get(id);
      if (rec) todo.push({ gid: o.gid, id, rec, sealed: o.sealed, seq: o.seq, seg: !isMembership(rec.kind) });
    }
    for (const l of L.locs) {
      const p = probe(l.path);
      if (p.state !== 'vault') { this.failures.set(l.path, p.state === 'empty' ? 'the location has not been set up yet; sync does that' : p.reason); continue; }
      const missing = todo.filter((t) => !l.ids.has(t.id));
      for (let i = 0; i < missing.length && !this.failures.has(l.path);) {
        // a run: consecutive records of one chain that go in one file (membership records are always a file each)
        let j = i + 1;
        const first = missing[i]!;
        while (first.seg && j < missing.length && j - i < BATCH && missing[j]!.seg && missing[j]!.gid === first.gid && missing[j]!.rec.seq === missing[j - 1]!.rec.seq + 1
               && eq(missing[j]!.rec.author, first.rec.author) && eq(missing[j]!.rec.device, first.rec.device)) j++;
        const run = missing.slice(i, j), last = run[run.length - 1]!;
        i = j;
        const rel = join(chainDir(first.gid, hex(first.rec.author), hex(first.rec.device)), segmentName(first.rec.seq, last.rec.seq, isMembership(first.rec.kind)));
        try {
          this.toLocation(l.path, () => {
            putIfAbsent(l.path, rel, concat(...run.map((r) => frame(r.sealed))), this.durable);
            if (this.durable) flushDirectory(join(l.path, dirname(rel)));
          });
        } catch (e) { this.failures.set(l.path, message(e)); break; }
        for (const r of run) l.ids.add(r.id);
        this.remember(l, first.gid, last.rec);
      }
    }
    const done = todo.filter((t) => L.locs.every((l) => l.ids.has(t.id)));
    if (done.length > 0) {
      this.state.flush();
      for (const t of done) { this.state.removeOutbox(t.gid, t.seq); L.outboxIds.delete(t.id); }
    }
    this.state.save();
  }

  /** Remembers that `l` holds this chain up to `rec` (the rollback check of spec 4.4). */
  private remember(l: LocLoad, gid: string, rec: Rec): void {
    const remembered = this.state.remembered(l.key);
    const k = `${gid}/${chainOf(rec.author, rec.device)}`;
    if (!remembered.has(k) || remembered.get(k)!.seq < rec.seq) { remembered.set(k, { seq: rec.seq, id: rec.id }); this.state.setRemembered(l.key, remembered); }
  }

  private writeRecordLocked(g: GroupCtx, kind: number, payload: CMap): WriteResult {
    this.fresh();
    g = this.loaded.groups.get(g.gid)!;
    if (g.role < 2) throw new VaultError('not_writer', `this person is a ${roleName(g.role)} in ${g.name || g.gid.slice(0, 8)} and cannot write`);
    if (!g.writeKey) throw new VaultError('no_key', 'this device holds no key for the current epoch of the group');
    const m = g.view.membership;
    const head = this.state.chain(g.gid);
    const seq = head ? head.seq + 1 : 1;
    let sealed: Uint8Array, rec: Rec;
    try {
      sealed = sealRecord(this.person, g.gidBytes, g.epoch, g.writeKey, {
        author: this.person.pid, device: this.state.deviceId, seq, prev: head ? fromHex(head.id) : null,
        clock: nextClock(this.now(), g.view.accepted.map((r) => [r.wall, r.counter])), kind, payload, mhead: m.chain[m.chain.length - 1]!.id,
      });
      rec = openRecord(sealed, keyRing([[g.gidBytes, g.epoch, g.writeKey]]));
    } catch (e) {
      if (e instanceof FormatError && (e.code === 'too_large' || e.code === 'body_too_large')) throw new ValueTooLarge('record', limits.maxBody, undefined, 'The change is too large for one record: a record holds at most 1 MiB.');
      throw e;
    }
    const id = hex(rec.id);
    this.state.putOutbox(g.gid, seq, sealed); // durable before the record leaves the device (4.1)
    this.state.advance(g.gid, seq, id);
    this.recCache.set(id, rec);
    this.loaded.union.set(id, rec);
    this.loaded.outboxIds.add(id);
    this.dirty = true;
    const result: WriteResult = { id, seq, group: g.gid, delivered: [], failed: [], inOutbox: true };
    if (!this.offline) this.deliver(g.gid, rec, sealed, result);
    return result;
  }

  private deliver(gid: string, rec: Rec, sealed: Uint8Array, result: WriteResult): void {
    const rel = join(chainDir(gid, hex(rec.author), hex(rec.device)), segmentName(rec.seq, rec.seq, isMembership(rec.kind)));
    for (const l of this.loaded.locs) {
      // a location that refused earlier records of this operation would get this one with a gap before it: it keeps it in the outbox instead
      const earlier = this.failures.get(l.path);
      if (earlier !== undefined) { result.failed.push({ location: l.path, error: earlier }); continue; }
      const p = probe(l.path);
      if (p.state !== 'vault') {
        const error = p.state === 'empty' ? 'the location has not been set up yet; sync does that' : p.reason;
        this.failures.set(l.path, error);
        result.failed.push({ location: l.path, error });
        continue;
      }
      try {
        this.toLocation(l.path, () => { putIfAbsent(l.path, rel, frame(sealed), this.durable); });
        l.ids.add(result.id);
        result.delivered.push(l.path);
        this.remember(l, gid, rec);
      } catch (e) {
        this.failures.set(l.path, message(e));
        result.failed.push({ location: l.path, error: message(e) });
      }
    }
    if (result.failed.length === 0 && result.delivered.length === this.loaded.locs.length) { this.state.flush(); this.state.removeOutbox(gid, rec.seq); this.loaded.outboxIds.delete(result.id); result.inOutbox = false; }
    this.state.save();
  }

  private change(entry: ItemEntry | null): ItemChange {
    const v = entry?.view;
    return new ItemChange(v ? { websites: v.websites, customFields: v.customFields, attachments: v.attachments, tags: v.tags.flatMap((t) => t.fields.map((field) => ({ field }))) } : undefined);
  }

  private newId(): string { return hex(this.random(8)); }

  private applyEdits(c: ItemChange, entry: ItemEntry | null, e: ItemEdits): void {
    const v = entry?.view ?? viewItem(new Map());
    checkSizes(e);
    if (e.type !== undefined) c.type(e.type);
    if (e.title !== undefined) c.title(e.title);
    if (e.username !== undefined) c.username(e.username);
    if (e.password !== undefined) c.password(e.password, v.passwordPlace);
    if (e.url !== undefined) {
      const first = v.websites[0];
      if (first) c.website(first.field.slice('web/'.length), e.url, first.pos); else c.website(this.newId(), e.url, positionAtEnd([]));
    }
    if (e.notes !== undefined) c.notes(e.notes);
    if (e.cardholder !== undefined) c.cardholder(e.cardholder);
    if (e.card !== undefined) c.card(e.card);
    if (e.cardCode !== undefined) c.cardCode(e.cardCode);
    if (e.cardPin !== undefined) c.cardPin(e.cardPin);
    if (e.otp !== undefined) c.otp(e.otp);
    const positions = v.customFields.map((f) => f.pos);
    for (const [label, spec] of Object.entries(e.custom ?? {})) {
      const existing = v.customFields.find((f) => f.label === nfc(label));
      if (spec === null) { if (existing) c.remove(existing.field); continue; }
      const value = typeof spec === 'string' ? spec : spec.value;
      const concealed = typeof spec === 'string' ? (existing ? existing.concealed : true) : spec.concealed ?? (existing ? existing.concealed : true);
      if (existing) c.customField(existing.field.slice('f/'.length), label, value, concealed, existing.pos);
      else { const pos = positionAtEnd(positions); positions.push(pos); c.customField(this.newId(), label, value, concealed, pos); }
    }
    for (const t of e.tags?.add ?? []) if (!v.tags.some((x) => x.text === nfc(t))) c.tag(this.newId(), t);
    for (const t of e.tags?.remove ?? []) c.removeTag(v, t);
  }

  /** Sets one field of one item: `psss://item/field` and the new value. A label that is not a built-in field name makes (or rewrites) a custom
   *  field, concealed unless `concealed: false`. `code` cannot be set. One record. */
  setField(reference: string | Reference, value: string, opts: { concealed?: boolean } = {}): WriteResult {
    const { entry, ref } = this.resolveForWrite(reference, 'live');
    if (ref.previous !== undefined) throw new VaultError('bad_reference', '?previous= names an earlier value and cannot be set');
    const edits: ItemEdits = {};
    if (ref.field.toLowerCase() === 'code' && entry.view.otp) throw new VaultError('read_only_field', 'code is computed from the item\'s verification-code secret and cannot be set');
    switch (builtinField(ref.field)) {
      case 'title': edits.title = value; break;
      case 'username': edits.username = value; break;
      case 'password': edits.password = value; break;
      case 'url': edits.url = value; break;
      case 'notes': edits.notes = value; break;
      case 'cardholder': edits.cardholder = value; break;
      case 'card_code': edits.cardCode = value; break;
      case 'card_pin': edits.cardPin = value; break;
      case 'card': edits.card = { number: value, ...(entry.view.card?.year !== undefined ? { year: entry.view.card.year, month: entry.view.card.month! } : {}) }; break;
      default: {
        const t = fieldTarget(entry.view, ref.field);
        const label = t?.custom ? t.label : ref.field;
        edits.custom = { [label]: opts.concealed === undefined ? value : { value, concealed: opts.concealed } };
      }
    }
    const c = this.change(entry);
    this.applyEdits(c, entry, edits);
    return this.writeRecord(entry.group, KIND.item, c.payload(entry.bytes));
  }

  /** A new item in one record (its first record sets `created`, schema 5). */
  addItem(spec: NewItem): { id: string; item: ItemSummary; write: WriteResult } {
    const g = this.pickGroup(spec.group);
    const c = this.change(null);
    c.created(this.now());
    c.type(spec.type ?? 1);
    this.applyEdits(c, null, { ...spec, type: undefined });
    const id = this.random(16);
    const write = this.writeRecord(g, KIND.item, c.payload(id));
    const entry = this.fresh().groups.get(g.gid)!.entries().find((e) => e.id === hex(id))!;
    return { id: hex(id), item: summarize(entry), write };
  }

  /** Several fields of one item in one record. */
  editItem(reference: string | Reference, edits: ItemEdits): WriteResult {
    const { entry } = this.resolveForWrite(reference, 'live');
    const c = this.change(entry);
    this.applyEdits(c, entry, edits);
    return this.writeRecord(entry.group, KIND.item, c.payload(entry.bytes));
  }

  /** Moves an item to Recently Deleted (spec 5.1: sets `deleted`). */
  deleteItem(reference: string | Reference): WriteResult {
    const { entry } = this.resolveForWrite(reference, 'live');
    return this.writeRecord(entry.group, KIND.item, this.change(entry).deleted(this.now()).payload(entry.bytes));
  }

  /** Takes an item out of Recently Deleted (clears `deleted`). */
  restoreItem(reference: string | Reference): WriteResult {
    const { entry } = this.resolveForWrite(reference, 'deleted');
    return this.writeRecord(entry.group, KIND.item, this.change(entry).remove('deleted').payload(entry.bytes));
  }

  /** The permanent-delete request of spec 5.4 (kind 33). Every reader hides the item's writes at once. A manager's device answers with a
   *  checkpoint that purges them and removes the records; this library does not write checkpoints yet. */
  purgeItem(reference: string | Reference): WriteResult {
    const { entry } = this.resolveForWrite(reference, 'all');
    // an imported item is remembered as gone (schema 8), so that importing the same file again does not bring it back
    const src = entry.view.carry.get('source');
    if (isMap(src) && typeof src.get(1) === 'string' && typeof src.get(2) === 'string') {
      this.writeRecord(entry.group, KIND.item, new ItemChange().gone(src.get(1) as string, src.get(2) as string, this.now()).payload(SETTINGS_ITEM_ID));
    }
    return this.writeRecord(entry.group, KIND.purge, cmap([[1, [entry.bytes]]]));
  }


// ------------------------------------------------------------ attachments

  /** Seals a file for `gid` (spec 5.2: a fresh key, chunks of 1 MiB named by their hash) and puts the chunks in every location that is a
   *  vault, before any record refers to them. Chunks never change and are copied by sync like the wraps. Returns what a record stores. */
  private storeAttachment(gid: string, data: Uint8Array): CborValue {
    const { ref, chunks } = sealAttachment(this.random(32), data);
    for (const l of this.loaded.locs) {
      if (probe(l.path).state !== 'vault') continue;
      for (const c of chunks) putIfAbsent(l.path, blobPath(gid, hex(chunkId(c))), c, this.durable);
    }
    return cmap([[1, ref.key], [2, ref.size], [3, ref.chunkIds]]);
  }

  /** The bytes of an attachment of an item, from the first location that holds each chunk. Throws `missing_blob` when none does. */
  readAttachment(groupId: string, attachment: CborValue): Uint8Array {
    const m = attachment as CMap;
    const ids = (m.get(3) as Uint8Array[]).map((i) => hex(i));
    const chunks = ids.map((id) => {
      for (const l of this.locations) {
        const p = join(l, blobPath(groupId, id));
        if (existsSync(p)) return new Uint8Array(readFileSync(p));
      }
      throw new VaultError('missing_blob', 'a part of an attachment is not in any location');
    });
    try { return openAttachment({ key: m.get(1) as Uint8Array, size: m.get(2) as number, chunkIds: ids.map((i) => fromHex(i)) }, chunks); }
    catch (e) { if (e instanceof FormatError) throw new VaultError('bad_blob', 'an attachment is damaged'); throw e; }
  }

  // ------------------------------------------------------------ KeePass

  /** Brings the entries of a KeePass database in as items, in one group (`options.group`, or the only one this device can write to).
   *  An item is recognized by its source: the entry's UUID, kept in the item's `source` field with a hash of what the file said. The same file
   *  imported again adds nothing; an item the person changed here is never replaced; an item they deleted (or deleted for good) is not
   *  brought back. With `dryRun` nothing is written, no lock is taken, and the vault should have been opened with `readOnly`.
   *
   *  A real import holds the lock of the device state from the moment it reads what the vault holds until its last record is stored, and reads
   *  the vault again after taking the lock: two imports of one file at once cannot both decide that an entry is new. Records are sealed one
   *  after another, each stored in the outbox before it is delivered, and delivered together in batches of `BATCH` records (one segment file
   *  per batch, which the format allows), so the cost of an import is linear in its size. If it stops part of the way, what was stored stays
   *  and an `ImportInterrupted` says how much; running it again does the rest. */
  importKdbx(db: KdbxDatabase, options: ImportOptions = {}): ImportReport {
    const now = this.now();
    const read = readKeepass(db, { now, ...(options.stripInvalid ? { stripInvalid: true } : {}), ...(options.includeTrash ? { includeTrash: true } : {}) });
    if (options.dryRun) return this.importRead(read, options, now);
    return this.locked(() => this.importRead(read, options, now), true, 'import');
  }

  private importRead(read: ReturnType<typeof readKeepass>, options: ImportOptions, now: number): ImportReport {
    const dry = options.dryRun === true;
    if (!dry) this.drainOutbox(); // records an earlier, failed or killed run left in the outbox go out first, as stored
    const target = this.pickGroup(options.group);
    const groups = this.visibleGroups();
    const bySource = new Map<string, { entry: ItemEntry; baseline: Uint8Array | null }>();
    const byId = new Map<string, ItemEntry>();
    const gone = new Set<string>();
    for (const g of groups) {
      for (const e of g.entries()) {
        byId.set(e.id, e);
        const src = e.view.carry.get('source');
        if (isMap(src) && src.get(1) === 'keepass' && typeof src.get(2) === 'string') bySource.set(src.get(2) as string, { entry: e, baseline: isBytes(src.get(3)) ? (src.get(3) as Uint8Array) : null });
      }
      const settings = g.view.state.get(ZERO_ITEM);
      if (settings) for (const x of viewSettings(settings).gone) if (x.kind === 'keepass') gone.add(x.id);
    }
    const r: ImportReport = {
      group: target.name, groupId: target.gid, dryRun: dry,
      added: 0, attachments: 0, updated: 0, unchanged: 0, keptYours: 0, changedInFile: 0, conflicts: 0,
      skippedDeleted: 0, skippedGone: 0, skippedTrash: read.trashed, inFolders: read.inFolders, refusedItems: 0,
      refusedFields: read.refusedFields, invalidFields: read.invalidFields, strippedFields: read.strippedFields, issues: [...read.issues], items: [],
    };
    const note = (spec: ItemSpec, action: ImportAction) => r.items.push({ title: specTitle(spec), action });
    const same = (a: Uint8Array | null, b: Uint8Array) => a !== null && Buffer.compare(a, b) === 0;
    if (!dry) this.batch = { clock: null, pending: [] };
    try {
      let done = 0;
      for (const spec of read.items) {
        options.progress?.(done++, read.items.length);
        this.beat(); // also for an entry that writes nothing: a long run of those must not let the lock go stale
        const view = specView(spec);
        const fileHash = contentHash(spec.sourceId, view);
        if (gone.has(spec.uuid)) { r.skippedGone++; note(spec, 'gone'); continue; }
        const known = bySource.get(spec.uuid) ?? (byId.has(spec.uuid) ? { entry: byId.get(spec.uuid)!, baseline: null } : undefined);
        if (known) {
          const v = known.entry.view;
          if (v.deleted) { r.skippedDeleted++; note(spec, 'deleted'); continue; }
          const vaultHash = contentHash(spec.sourceId, viewContent(v));
          if (Buffer.compare(vaultHash, fileHash) === 0) { r.unchanged++; note(spec, 'unchanged'); continue; }
          if (same(known.baseline, fileHash)) { r.keptYours++; note(spec, 'keptYours'); continue; }
          if (!same(known.baseline, vaultHash)) { r.conflicts++; note(spec, 'conflict'); r.issues.push({ kind: 'mergeConflict', item: specTitle(spec), detail: 'Changed here and in the file since it was imported, so the version here was kept.' }); continue; }
          if (!options.update) { r.changedInFile++; note(spec, 'changedInFile'); r.issues.push({ kind: 'changedInFile', item: specTitle(spec), detail: 'Changed in the file since it was imported. Add --update to bring in the file\'s version.' }); continue; }
          if (dry) { r.updated++; note(spec, 'update'); continue; }
          try { this.updateFromSpec(known.entry, spec, fileHash, now); r.updated++; note(spec, 'update'); }
          catch (e) { if (!refusedWrite(e)) throw e; r.refusedItems++; note(spec, 'refused'); r.issues.push({ kind: 'itemRefused', item: specTitle(spec), detail: plainRefusal(e) }); }
          continue;
        }
        if (dry) { r.added++; r.attachments += spec.attachments.length; note(spec, 'add'); continue; }
        try { this.createFromSpec(target, spec, fileHash, now); r.added++; r.attachments += spec.attachments.length; note(spec, 'add'); }
        catch (e) { if (!refusedWrite(e)) throw e; r.refusedItems++; note(spec, 'refused'); r.issues.push({ kind: 'itemRefused', item: specTitle(spec), detail: plainRefusal(e) }); }
      }
      this.flushBatch();
      options.progress?.(read.items.length, read.items.length);
    } catch (e) {
      if (dry) throw e;
      // what was stored stays: deliver it if possible, and say how much it was
      try { this.flushBatch(); } catch { /* the outbox holds it; the next sync delivers it */ }
      throw new ImportInterrupted(r.added, r.updated, e);
    } finally {
      this.batch = null;
      this.dirty = true;
    }
    return r;
  }

  /** One record of an import: sealed, stored in the outbox (the file is flushed now, the folder with the batch), the sequence number advanced in
   *  memory. It is delivered by `flushBatch` together with the others. Nothing here re-reads the vault: the group's state from before the import
   *  is enough, because an import changes each item once and never reads another item's new state. */
  private queueRecord(g: GroupCtx, kind: number, payload: CMap): void {
    const b = this.batch!;
    if (g.role < 2) throw new VaultError('not_writer', `this person is a ${roleName(g.role)} in ${g.name || g.gid.slice(0, 8)} and cannot write`);
    if (!g.writeKey) throw new VaultError('no_key', 'this device holds no key for the current epoch of the group');
    const m = g.view.membership;
    const head = this.state.chain(g.gid);
    const seq = head ? head.seq + 1 : 1;
    const clock = nextClock(this.now(), b.clock ? [b.clock] : g.view.accepted.map((r): Clock => [r.wall, r.counter]));
    let sealed: Uint8Array, rec: Rec;
    try {
      sealed = sealRecord(this.person, g.gidBytes, g.epoch, g.writeKey, {
        author: this.person.pid, device: this.state.deviceId, seq, prev: head ? fromHex(head.id) : null, clock, kind, payload, mhead: m.chain[m.chain.length - 1]!.id,
      });
      rec = openRecord(sealed, keyRing([[g.gidBytes, g.epoch, g.writeKey]]));
    } catch (e) {
      if (e instanceof FormatError && (e.code === 'too_large' || e.code === 'body_too_large')) throw new ValueTooLarge('record', limits.maxBody, undefined, 'The change is too large for one record: a record holds at most 1 MiB.');
      throw e;
    }
    const id = hex(rec.id);
    this.state.putOutbox(g.gid, seq, sealed, false); // durable before the record leaves the device (4.1); the folder entry is flushed with the batch
    this.state.advanceInMemory(g.gid, seq, id);
    b.clock = clock;
    this.recCache.set(id, rec);
    this.loaded.union.set(id, rec);
    this.loaded.outboxIds.add(id);
    b.pending.push({ rec, sealed });
    this.beat();
    if (b.pending.length >= BATCH) this.flushBatch();
  }

  /** Delivers the records queued by `queueRecord` as one segment file (spec 8.1: a file holds a run of consecutive records, named for the first and
   *  the last) to every location, then, when every location has it, flushes the device state and removes the outbox files. A location that fails
   *  is left alone and the records stay in the outbox for sync, as with a single write. */
  private flushBatch(): void {
    const b = this.batch;
    if (!b || b.pending.length === 0) return;
    const pending = b.pending;
    b.pending = [];
    this.state.flushOutboxFolder(); // every outbox file is on disk before anything is delivered
    this.state.save();
    if (this.offline) return;
    const first = pending[0]!.rec, last = pending[pending.length - 1]!.rec;
    const gid = hex(first.gid);
    const rel = join(chainDir(gid, hex(first.author), hex(first.device)), segmentName(first.seq, last.seq, false));
    const data = concat(...pending.map((p) => frame(p.sealed)));
    let delivered = 0;
    for (const l of this.loaded.locs) {
      if (this.failures.has(l.path)) continue; // it refused an earlier batch: no gap in its copy of the chain, the outbox keeps the rest for sync
      const p = probe(l.path);
      if (p.state !== 'vault') { this.failures.set(l.path, p.state === 'empty' ? 'the location has not been set up yet; sync does that' : p.reason); continue; }
      try {
        this.toLocation(l.path, () => {
          putIfAbsent(l.path, rel, data, this.durable);
          if (this.durable) flushDirectory(join(l.path, dirname(rel)));
        });
        for (const p of pending) l.ids.add(hex(p.rec.id));
        delivered++;
        this.remember(l, gid, last);
      } catch (e) { this.failures.set(l.path, message(e)); /* this location keeps what it has; the outbox still holds the records */ }
    }
    if (delivered === this.loaded.locs.length) {
      this.state.flush();
      for (const p of pending) { this.state.removeOutbox(gid, p.rec.seq); this.loaded.outboxIds.delete(hex(p.rec.id)); }
    }
    this.state.save();
  }

  private applySpec(c: ItemChange, spec: ItemSpec, gid: string, now: number): void {
    const pos = { sites: [] as string[], fields: [] as string[], files: [] as string[] };
    const add = (list: string[]) => { const p = positionAtEnd(list); list.push(p); return p; };
    if (spec.title !== undefined) c.title(spec.title);
    if (spec.username !== undefined) c.username(spec.username);
    if (spec.password !== undefined) c.password(spec.password, null);
    if (spec.notes !== undefined) c.notes(spec.notes);
    if (spec.cardholder !== undefined) c.cardholder(spec.cardholder);
    if (spec.card) c.card(spec.card);
    if (spec.cardCode !== undefined) c.cardCode(spec.cardCode);
    if (spec.cardPin !== undefined) c.cardPin(spec.cardPin);
    if (spec.otp) c.otp(spec.otp);
    if (spec.passkey) c.passkey(spec.passkey);
    for (const w of spec.websites) c.website(this.newId(), w, add(pos.sites));
    for (const f of spec.custom) c.customField(this.newId(), f.label, f.value, f.concealed, add(pos.fields));
    for (const t of spec.tags) c.tag(this.newId(), t);
    for (const a of spec.attachments) c.attachment(this.newId(), a.name, this.storeAttachment(gid, a.data), add(pos.files), now);
    if (spec.previous.length > 0) c.passwordHistory(spec.previous.map((p) => [p.value, p.replaced] as [string, number]));
  }

  private createFromSpec(g: GroupCtx, spec: ItemSpec, baseline: Uint8Array, now: number): void {
    const c = new ItemChange();
    c.created(spec.created ?? now);
    c.type(spec.type);
    this.applySpec(c, spec, g.gid, now);
    if (spec.edited !== undefined) c.edited(spec.edited);
    c.source({ kind: 'keepass', id: spec.uuid, baseline });
    if (spec.deletedAt !== undefined) c.deleted(spec.deletedAt);
    this.queueRecord(g, KIND.item, c.payload(this.random(16)));
  }

  private updateFromSpec(entry: ItemEntry, spec: ItemSpec, baseline: Uint8Array, now: number): void {
    const v = entry.view;
    const c = new ItemChange();
    const before = contentOf(viewContent(v)), after = contentOf(specView(spec));
    const differs = (k: string) => before.get(k) !== after.get(k);
    c.type(spec.type);
    const scalar: [string, string, string | undefined, (s: string) => unknown][] = [
      ['title', 'title', spec.title, (s) => c.title(s)], ['username', 'username', spec.username, (s) => c.username(s)], ['notes', 'notes', spec.notes, (s) => c.notes(s)],
      ['cardholder', 'cardholder', spec.cardholder, (s) => c.cardholder(s)], ['cardCode', 'card_code', spec.cardCode, (s) => c.cardCode(s)], ['cardPin', 'card_pin', spec.cardPin, (s) => c.cardPin(s)],
    ];
    for (const [key, name, value, set] of scalar) if (differs(key)) { if (value === undefined) c.remove(name); else set(value); }
    if (differs('password')) { if (spec.password === undefined) c.remove('password'); else c.password(spec.password, v.passwordPlace); }
    if (differs('card')) { if (spec.card) c.card(spec.card); else c.remove('card'); }
    if (differs('otp')) { if (spec.otp) c.otp(spec.otp); else c.remove('otp'); }
    if (differs('passkey')) { if (spec.passkey) c.passkey(spec.passkey); else c.remove('passkey'); }
    const pos = { sites: [] as string[], fields: [] as string[], files: [] as string[] };
    const add = (list: string[]) => { const p = positionAtEnd(list); list.push(p); return p; };
    if (differs('websites')) { for (const w of v.websites) c.remove(w.field); for (const w of spec.websites) c.website(this.newId(), w, add(pos.sites)); }
    if ([...after.keys()].some((k) => k.startsWith('f:') && differs(k)) || [...before.keys()].some((k) => k.startsWith('f:') && differs(k))) {
      for (const f of v.customFields) c.remove(f.field);
      for (const f of spec.custom) c.customField(this.newId(), f.label, f.value, f.concealed, add(pos.fields));
    }
    if (differs('tags')) { for (const t of v.tags) for (const f of t.fields) c.remove(f); for (const t of spec.tags) c.tag(this.newId(), t); }
    if (differs('attachments')) { for (const a of v.attachments) c.remove(a.field); for (const a of spec.attachments) c.attachment(this.newId(), a.name, this.storeAttachment(entry.group.gid, a.data), add(pos.files), now); }
    if (spec.previous.length > 0) c.passwordHistory(spec.previous.map((p) => [p.value, p.replaced] as [string, number]));
    if (spec.edited !== undefined) c.edited(spec.edited);
    c.source({ kind: 'keepass', id: spec.uuid, baseline });
    this.queueRecord(entry.group, KIND.item, c.payload(entry.bytes));
  }

  /** Every item of every group this person can read (the ones in Recently Deleted too), as a KeePass database. The entry's UUID is the UUID of the
   *  KeePass entry the item was imported from, when it came from a file and no other item to export has that UUID, so that KeePassXC's merge pairs
   *  the entries with the original database and this file imported into this vault again finds its own items; any other item's UUID is its id.
   *  Reads the attachments' chunks; writes nothing. */
  exportKdbx(options: ExportKdbxOptions = {}): ExportKdbxResult {
    const items: ExportItem[] = [];
    const issues: ReportIssue[] = [];
    let shared = false, unknown = 0;
    const sel = options.group === undefined ? null : parseGroup(options.group);
    const visible = this.visibleGroups().filter((g) => !sel || groupMatches(sel, g));
    const sourceOf = (e: ItemEntry): string | undefined => {
      const src = e.view.carry.get('source');
      return isMap(src) && src.get(1) === 'keepass' && typeof src.get(2) === 'string' && /^[0-9a-f]{32}$/.test(src.get(2) as string) ? (src.get(2) as string) : undefined;
    };
    const taken = new Map<string, number>(); // how often each UUID would be used: item ids, and source UUIDs of the items that have one
    for (const g of visible) for (const e of g.entries()) { const u = sourceOf(e) ?? e.id; taken.set(u, (taken.get(u) ?? 0) + 1); }
    const ids = new Set<string>();
    for (const g of visible) for (const e of g.entries()) ids.add(e.id);
    const uuidOf = (e: ItemEntry): string => {
      const src = sourceOf(e);
      return src !== undefined && taken.get(src) === 1 && (src === e.id || !ids.has(src)) ? src : e.id;
    };
    for (const g of visible) {
      if (g.view.membership.roles.size > 1) shared = true;
      for (const e of g.entries()) {
        const attachments: { name: string; data: Uint8Array }[] = [];
        for (const a of e.view.attachments) {
          try { attachments.push({ name: a.fileName, data: this.readAttachment(g.gid, a.attachment) }); }
          catch (err) {
            if (!(err instanceof VaultError)) throw err;
            issues.push({ kind: 'attachmentUnreadable', item: titleOf(e.view) || '(no name)', detail: 'An attachment could not be read from any location, so it is not in the file.' });
          }
        }
        if (e.view.unknown.length > 0 || e.view.invalid.length > 0) unknown++;
        items.push({ id: uuidOf(e), groupName: g.name, groupId: g.gid, view: e.view, attachments, ...(e.view.deleted ? { deletedAt: e.view.deletedAt ?? this.now() } : {}) });
      }
    }
    const built = buildKeepass(items, { name: this.state.name, now: new Date(this.now()), random: this.random, ...(options.stripInvalid ? { stripInvalid: true } : {}) });
    const doesNotTravel: { code: string; text: string }[] = [];
    if (shared) doesNotTravel.push({ code: 'people', text: 'the people in shared groups' });
    if (built.issues.some((i) => i.kind === 'passkeyNotWritten')) doesNotTravel.push({ code: 'passkeys', text: 'passkeys that could not be written as KeePassXC passkeys' });
    if (unknown > 0) doesNotTravel.push({ code: 'unknownFields', text: `fields of ${unknown} item${unknown === 1 ? '' : 's'} that this version of Psss does not know` });
    return { db: built.db, report: { ...built.counts, groupsShared: shared, issues: [...issues, ...built.issues], doesNotTravel, refusedFields: built.refusedFields, strippedFields: built.strippedFields } };
  }

  // ------------------------------------------------------------ devices

  /** Lets another device in with the person secret wrapped to its public key (a device slot, spec 7.2), written to every location. How the
   *  public key reaches this device and how the person approves is not specified (spec 10) and not built: this is the primitive. */
  admitDevice(kemPk: Uint8Array): { slotId: string; locations: string[] } {
    const id = this.random(16);
    const slot = sealDeviceSlot(this.person.ps, this.person.pid, id, kemPk);
    const done: string[] = [];
    for (const l of this.loaded.locs) {
      if (l.probe.state !== 'vault') continue;
      putIfAbsent(l.path, slotPath(hex(this.person.pid), hex(id)), slot, this.durable);
      done.push(l.path);
    }
    if (done.length === 0) throw new VaultError('no_location', 'no location could take the slot');
    return { slotId: hex(id), locations: done };
  }

  // ------------------------------------------------------------ sync

  /** Records sealed here and not yet in every location. */
  outbox(): { gid: string; seq: number; id: string; pendingLocations: string[] }[] {
    const L = this.fresh();
    return this.state.outbox().flatMap((o) => {
      const id = hex(recordId(o.sealed));
      return [{ gid: o.gid, seq: o.seq, id, pendingLocations: L.locs.filter((l) => !l.ids.has(id)).map((l) => l.path) }];
    });
  }

  /** Re-reads every location, then gives each one what it lacks: the files of spec 8.1 that never change (psss.json, slots, wraps, chunks) and
   *  every record this device holds that the location does not, in sequence order, with put-if-absent. A location that fails is left alone
   *  and reported, and the record stays in the outbox. This includes records of other devices and writes made while offline. The report
   *  says `upToDate` only for a location that holds every record this device holds (spec 4.4: a reader can only say "behind"). */
  sync(): SyncReport { return this.locked(() => this.syncLocked()); }

  private syncLocked(): SyncReport {
    this.failures.clear();
    const before = this.load(true);
    const rolledBack = before.rollbacks.map((r) => ({ location: r.location, detail: describeRollback(r) }));
    const sources = new Map<string, string>();
    for (const l of before.locs) if (l.probe.state === 'vault') for (const rel of supportFiles(l.path)) if (!sources.has(rel)) sources.set(rel, l.path);
    const records = [...before.union.values()].sort((a, b) => (hex(a.gid) < hex(b.gid) ? -1 : hex(a.gid) > hex(b.gid) ? 1 : a.seq - b.seq));
    const wrote = new Map<string, number>();
    const failures = new Map<string, string[]>();
    const fail = (l: LocLoad, why: string) => failures.set(l.path, [...(failures.get(l.path) ?? []), why]);
    for (const l of before.locs) {
      if (l.probe.state === 'unreadable') { fail(l, `cannot be read: ${l.probe.reason}`); continue; }
      let n = 0;
      try {
        if (l.probe.state === 'empty') initFolder(l.path);
        for (const [rel, from] of sources) {
          if (from === l.path) continue;
          this.beat();
          try { n += putIfAbsent(l.path, rel, new Uint8Array(readFileSync(join(from, rel))), this.durable) === 'written' ? 1 : 0; } catch (e) { fail(l, `${rel}: ${message(e)}`); }
        }
        for (const r of records) {
          if (l.ids.has(hex(r.id))) continue;
          this.beat(); // a long sync is a long time under the lock
          try {
            putIfAbsent(l.path, join(chainDir(hex(r.gid), hex(r.author), hex(r.device)), segmentName(r.seq, r.seq, isMembership(r.kind))), frame(r.sealed), this.durable);
            n++;
          } catch (e) { fail(l, `record ${short(hex(r.gid))}/${r.seq}: ${message(e)}`); break; } // later records would leave a gap
        }
      } catch (e) { fail(l, message(e)); }
      wrote.set(l.path, n);
    }
    for (const [path, f] of failures) this.failures.set(path, f[0]!);
    const after = this.load(true);
    this.state.flush();
    for (const o of this.state.outbox()) {
      const id = hex(recordId(o.sealed));
      if (after.locs.length > 0 && after.locs.every((l) => l.probe.state === 'vault' && l.ids.has(id))) this.state.removeOutbox(o.gid, o.seq);
    }
    const left = new Set(this.state.outbox().map((o) => hex(recordId(o.sealed))));
    after.outboxIds = new Set([...after.outboxIds].filter((id) => left.has(id)));
    return {
      locations: this.statuses().map((s) => {
        const f = failures.get(s.location) ?? [];
        return { ...s, ...(f.length > 0 && s.status === 'upToDate' ? { status: 'behind' as const, reason: f.join('; ') } : f.length > 0 ? { reason: `${s.reason ?? ''}${s.reason ? '; ' : ''}${f.join('; ')}` } : {}), wrote: wrote.get(s.location) ?? 0, failed: f };
      }),
      rolledBack, outbox: this.state.outbox().length, records: after.union.size,
    };
  }

  // ------------------------------------------------------------ verify

  /** Reads every location afresh and reports everything wrong that a reader of spec 9 can see. Writes nothing and repairs nothing, and does not
   *  update what the device remembers. */
  verify(): VerifyReport {
    const L = this.load(false);
    const problems = L.problems;
    let checked = L.outboxIds.size;
    for (const l of L.locs) checked += l.frames.length;
    return {
      ok: problems.length === 0, checked,
      locations: L.locs.map((l) => ({ location: l.path, state: l.probe.state, records: l.ids.size, problems: problems.filter((p) => p.location === l.path).length })),
      problems,
    };
  }

  /** Everything wrong that a reader of spec 9 can see in what `load` read and folded. Called once by every load: `issues` and `verify` share it. */
  private findProblems(L: Loaded): Problem[] {
    const problems: Problem[] = [];
    const add = (code: string, location: string | null, detail: string) => problems.push({ code, location, detail, plain: plainOf(code, location) });
    const where = (id: string) => L.locs.filter((l) => l.ids.has(id)).map((l) => l.path);
    const addAt = (id: string, code: string, detail: string) => { const w = where(id); if (w.length === 0) add(code, null, detail); else for (const l of w) add(code, l, detail); };
    for (const l of L.locs) {
      if (l.probe.state === 'unreadable') add('unreadable_location', l.path, l.probe.reason);
      for (const f of l.frames) if (f.err) add(f.err.disposition === 'wait' ? 'no_key' : f.err.code, l.path, `${f.rel}: ${f.err.message}${f.err.disposition === 'wait' ? ' (a key this device does not hold)' : ''}`);
      for (const d of l.diags) add(d.code, d.location, d.detail);
    }
    for (const d of L.diags) add(d.code, d.location, d.detail);
    for (const g of L.groups.values()) {
      const v: GroupView = g.view;
      const label = `group ${short(g.gid)}`;
      if (v.unsupported) add('unsupported_group', null, `${label}: its genesis names a newer lowest reader version than this implementation supports (6.1)`);
      if (v.membership.chain.length === 0) add('no_genesis', null, `${label}: no valid genesis record (6.1)`);
      // chains (4.4): a gap is "storage is behind" or a dropped record; a reader cannot tell which, so it says so
      const accepted = new Map<string, number>();
      for (const r of v.chains.accepted) { const k = chainOf(r.author, r.device); accepted.set(k, Math.max(accepted.get(k) ?? 0, r.seq)); }
      const first = new Map<string, { rec: Rec; reason: string }>();
      for (const w of v.chains.waiting) { const k = chainOf(w.rec.author, w.rec.device); const cur = first.get(k); if (!cur || w.rec.seq < cur.rec.seq) first.set(k, { rec: w.rec, reason: w.reason }); }
      for (const [k, w] of first) {
        const have = Math.max(accepted.get(k) ?? 0, v.covered.get(k)?.seq ?? 0);
        const chain = `${short(k.split('/')[0]!)}/${short(k.split('/')[1]!)}`;
        if (w.reason === 'gap') addAt(hex(w.rec.id), 'gap', `${label}, chain ${chain}: record${w.rec.seq - have > 2 ? 's' : ''} ${have + 1}${w.rec.seq - 1 > have + 1 ? ` to ${w.rec.seq - 1}` : ''} missing, so record ${w.rec.seq} and later wait: a record was dropped, or storage is behind`);
        else addAt(hex(w.rec.id), 'prev_mismatch', `${label}, chain ${chain}: record ${w.rec.seq} does not follow the record held at ${w.rec.seq - 1}: that record was replaced or belongs to a fork`);
      }
      for (const [k, f] of v.chains.forks) for (const id of f.ids) addAt(hex(id), 'fork', `${label}, chain ${short(k.split('/')[0]!)}/${short(k.split('/')[1]!)}: two different records at seq ${f.seq}; neither is accepted (4.4)`);
      for (const r of v.chains.mismatches) addAt(hex(r.id), 'contradicts_checkpoint', `${label}: a record at seq ${r.seq} differs from the record a checkpoint says was last covered`);
      for (const r of v.held) addAt(hex(r.id), 'held_back', `${label}: record ${r.seq} has a clock more than 10 minutes ahead and is held back (4.5)`);
      // who may write (5, 6)
      const status = (r: Rec, st: string) => {
        const [kind, why] = st.split(':');
        if (kind === 'accepted') return;
        const code = kind === 'waits' ? 'waiting_for_membership' : why === 'not_writer' || why === 'not_manager' ? 'unauthorized_author' : why!;
        addAt(hex(r.id), code, `${label}: ${describeStatus(why!)} (record ${short(hex(r.author))}/${short(hex(r.device))} seq ${r.seq})`);
      };
      for (const c of v.content) status(c.rec, c.status);
      for (const r of v.accepted) if (r.kind === KIND.checkpoint && !v.checkpoints.includes(r)) status(r, contentStatus(v.membership, r, true));
      for (const [id, why] of v.membership.ignored) {
        const code = why === 'lost_fork' ? 'membership_fork' : why === 'off_chain' ? 'membership_off_chain' : why === 'unreached' ? 'membership_unreached' : 'membership_refused';
        addAt(id, code, `${label}: a membership record is not on the accepted chain (${why})`);
      }
      for (const f of v.membership.forks) add('membership_fork', null, `${label}: several membership records follow ${short(f.mprev)}; ${short(f.winner)} wins by ${f.rule} (6.5)`);
    }
    for (const r of L.rollbacks) add('rolled_back', r.location, `${describeRollback(r)} (4.4)`);
    return problems;
  }
}

// ---------------------------------------------------------------- small helpers

function parseGroup(text: string): Selector {
  const m = /^id:([0-9a-f]{4,64})$/.exec(text);
  return m ? { id: m[1]! } : { title: nfc(text) };
}
const groupMatches = (sel: Selector, g: GroupCtx): boolean => ('id' in sel ? g.gid.startsWith(sel.id) : g.name === sel.title || fold(g.name) === fold(sel.title));

// ---- issues: the problems that concern what the vault holds, each with a sentence for a person

/** Problems that are not about the integrity of the records: a folder that cannot be read, a key this device does not hold, a clock held back, the state. */
const NOT_ISSUES = new Set(['unreadable_location', 'no_key', 'held_back', 'device_state_behind']);
const isIssue = (p: Problem): boolean => !NOT_ISSUES.has(p.code);

const showPath = (p: string): string => { const h = homedir(); return h && (p === h || p.startsWith(`${h}/`)) ? `~${p.slice(h.length)}` : p; };

function plainOf(code: string, location: string | null): string {
  const at = location === null ? (code === 'bad_outbox_record' ? 'this computer\'s pending records' : 'the vault') : showPath(location);
  switch (code) {
    case 'bad_tag': case 'bad_signature': case 'bad_salt': return `A record in ${at} was changed after it was written and is ignored.`;
    case 'swapped_record': return `A record in ${at} is stored under the wrong name or in the wrong place, so it was moved or swapped after it was written.`;
    case 'gap': return `A record is missing from the middle of a device's history in ${at}. The ones after it wait for it.`;
    case 'prev_mismatch': return `A record in ${at} does not follow the one before it in that device's history, so it and the ones after it wait.`;
    case 'fork': return `Two different records in ${at} claim the same place in one device's history, so neither is trusted.`;
    case 'unauthorized_author': return `A record in ${at} was written by someone who is not allowed to write to this vault and is ignored.`;
    case 'rolled_back': return `${at} is missing records this computer saw before. It may have been rolled back.`;
    case 'unreadable_location': return `${at} cannot be read.`;
    case 'no_key': return `A record in ${at} needs a key this computer does not have.`;
    case 'held_back': return `A record in ${at} is dated too far in the future and is held back.`;
    case 'bad_frame': return `A file in ${at} is damaged, and the records after the damage are not read.`;
    case 'waiting_for_membership': return `A record in ${at} depends on a change of members this computer has not seen, so it waits.`;
    default: return `Something in ${at} does not check out and is ignored.`;
  }
}

/** The text limits of the item schema, checked before anything is built, so that a value too large says so and says the limit. */
function checkSizes(e: ItemEdits): void {
  const size = (s: string) => Buffer.byteLength(nfc(s), 'utf8');
  const one = (field: string, value: string | undefined, max: number) => {
    if (value === undefined) return;
    const n = size(value);
    if (n > max) throw new ValueTooLarge(field, max, n);
  };
  const t = limits.textBytes;
  one('title', e.title, t); one('username', e.username, t); one('password', e.password, t); one('url', e.url, t);
  one('notes', e.notes, limits.notesBytes);
  one('cardholder', e.cardholder, t); one('card', e.card?.number, t); one('card code', e.cardCode, t); one('card pin', e.cardPin, t);
  for (const [label, spec] of Object.entries(e.custom ?? {})) if (spec !== null) one(label, typeof spec === 'string' ? spec : spec.value, t);
  for (const tag of e.tags?.add ?? []) one('tag', tag, t);
}

const describeRollback = (r: { chain: string; reason: string; remembered: number; offered: number | null }): string => {
  const [gid, author, device] = r.chain.split('/');
  const c = `chain ${short(author ?? '')}/${short(device ?? '')} of group ${short(gid ?? '')}`;
  return r.reason === 'less' ? `${c}: this device accepted up to record ${r.remembered}, the location offers ${r.offered ?? 'none'}` : `${c}: the record at ${r.remembered} is not the one this device accepted`;
};

function describeStatus(why: string): string {
  switch (why) {
    case 'not_writer': return 'the author is not a writer as of the membership record it names';
    case 'not_manager': return 'the author is not a manager as of the membership record it names';
    case 'beyond_cut': return 'the author was lowered or removed and this record is beyond the cut (6.2)';
    case 'wrong_epoch': return 'the record is sealed under an epoch other than the one it names';
    case 'wrong_epoch_key': return 'the record is sealed under a key its epoch does not commit to';
    case 'mhead_not_on_chain': return 'the membership record it names is not on the accepted chain';
    case 'mhead_unknown': return 'the membership record it names is not held yet; storage may be behind';
    default: return why;
  }
}

export type { Candidate };
