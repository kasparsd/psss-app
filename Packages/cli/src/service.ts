// The port the commands call. Plain data, async, named by what the command line needs and not by format internals.
// A later step writes the adapter to the real @psss/vault; the tests use FakeVaultService (fake-service.ts).
//
// Rules for an implementation:
// - A call never prints, prompts or reads standard input. The command does that.
// - An expected failure is returned as data (a Failure), never thrown. A throw is a bug or an I/O error and exits 1.
// - Only `get`, `code` (a computed code), `history` with `show` set and `readFile` return stored content. Nothing else may put one in a result, a message or a log.

/** What the command resolved from flags, environment and config files. Secrets are only ever here, never in arguments. */
export interface ServiceOptions {
  /** `--vault`: a vault folder, or a name. `create` treats it as the folder to create the vault in. */
  vault?: string;
  group?: string;
  keyFile?: string;
  /** PSSS_KEY: a key given inline, the weakest source. */
  key?: string;
  /** PSSS_PASSWORD_FILE: a file holding the vault password. */
  passwordFile?: string;
  cwd: string;
  home: string;
  platform: string;
  /** The user config folder, `<config base>/psss`. A vault's key file defaults to `<configDir>/keys/<vault name>.key`. */
  configDir: string;
  /** Device state (sequence numbers, remembered chain heads, the outbox): `~/.local/state/psss`, or `%LOCALAPPDATA%\psss`. */
  stateDir: string;
}

/** Names one item: by its id (or the start of one), or by its title, optionally inside one group. A title matches exactly, ignoring case, for every command. */
export type ItemSelector = { id: string } | { title: string; group?: string };

export interface ItemSummary {
  id: string;
  title: string;
  username?: string;
  url?: string;
  group: string;
  /** Names of the fields that hold secrets or notes (never values), such as `password`, `token`, `code`. */
  fields: string[];
  /** The item has a real verification code (a setup key that makes one), not just a field that is called `code`. */
  hasCode?: boolean;
  deleted: boolean;
}

export interface Candidate {
  id: string;
  title: string;
  username?: string;
  group: string;
}

export interface NotFound {
  ok: false;
  kind: 'notFound';
  /** `item` and `field` for a name that matches nothing, `group` for an unknown group. */
  what: 'item' | 'field' | 'group' | 'file';
  /** What was asked for: a title, an id, a field name or a group name. */
  name: string;
  /** For `item`: whether `name` was an id or a title. */
  by?: 'title' | 'id';
  vault: string;
  /** For `item` by title: titles that are close to the name asked for (see near.ts). Text for a person, never a result. */
  hints?: string[];
  /** For `field` and `file`: the item's title and the fields (or files) it does have. */
  item?: string;
  fields?: string[];
}

export interface Ambiguous {
  ok: false;
  kind: 'ambiguous';
  name: string;
  vault: string;
  candidates: Candidate[];
}

export type LockedReason =
  | { why: 'keyFileMissing'; keyFile: string }
  | { why: 'keyFileUnreadable'; keyFile: string }
  | { why: 'noKey' }
  | { why: 'noVault'; path?: string; unreadable?: boolean }
  | { why: 'locked' };

/** The vault cannot be opened: no key, no vault, nothing to unlock with. Exit 4. */
export interface Locked {
  ok: false;
  kind: 'locked';
  /** Empty when the vault could not even be found. */
  vault: string;
  reason: LockedReason;
}

/** A key was found and it does not open the vault. Exit 4. Must not say whether a vault password exists. */
export interface WrongKey {
  ok: false;
  kind: 'wrongKey';
  vault: string;
  keyFile?: string;
}

/** Anything else that went wrong, already in plain words. Exit 1. */
export interface Failed {
  ok: false;
  kind: 'failed';
  message: string;
}

/** A KeePass file that cannot be used, or a place that cannot be written. `wrongKey` and `invalidKey` exit 4 (nothing unlocked it); the rest exit 1. */
export interface KdbxProblem {
  ok: false;
  kind: 'kdbx';
  why: 'missing' | 'unreadable' | 'notKdbx' | 'wrongKey' | 'invalidKey' | 'corrupt' | 'limit' | 'unsupported' | 'tooLarge' | 'exists' | 'notWritable' | 'verifyFailed';
  /** The file as the person gave it, never a value. */
  file: string;
  /** For `unsupported`: the feature, in plain words. For `limit` and `tooLarge`: what was exceeded. */
  detail?: string;
}

export type Failure = NotFound | Ambiguous | Locked | WrongKey | Failed | KdbxProblem;
export type Result<T> = { ok: true; value: T } | Failure;

export interface CreateRequest {
  /** The vault's name. Also the folder name, `<name>.psss`. */
  name: string;
}

export interface CreatedVault {
  name: string;
  /** Absolute path of the vault folder. */
  path: string;
  key: {
    /** Absolute path of this computer's key file. */
    path: string;
    /** True when only the owner can read it (mode 0600). */
    ownerOnly: boolean;
    /** True when this call wrote the key file; false when an existing one was reused. */
    created: boolean;
  };
}

/** A problem the vault found when it was opened: a record that fails its checks, a gap, a location that looks rolled back. */
export interface VaultIssue {
  code: string;
  location: string | null;
  /** The library's technical words. Shown only under --verbose and in --json, never in the plain text. */
  detail: string;
  /** What it means, in plain words. */
  plain: string;
}

export interface OpenedVault {
  name: string;
  path: string;
  /** Problems found while opening. Empty (or absent) when nothing is wrong. Reading never refuses because of them. */
  issues?: VaultIssue[];
  /** The key file this run unlocked with, when one was used. `readableByOthers` is true when group or others can read it (never set on Windows). */
  keyFile?: { path: string; readableByOthers: boolean };
}

export type KeySource = 'keyFile' | 'keyEnvironment' | 'password';

export interface LocationInfo {
  /** The name a person gave it: "This computer", "iCloud Drive". */
  label: string;
  path: string;
  /** "Behind" means this computer has not seen everything the location holds, or the location lacks changes this computer has made. */
  state: 'upToDate' | 'behind';
  /** Changes made on this computer that this location does not hold yet. Absent or 0: none. */
  pending?: number;
}

export interface VaultInfo {
  name: string;
  path: string;
  groups: string[];
  itemCount: number;
  keySource: KeySource;
  /** Ways back besides the device key. Empty means the device key is the only way in. */
  wayBack: Array<'recoveryKit' | 'password'>;
  locations: LocationInfo[];
  formatVersion: number;
  /** Changes sealed on this computer and not yet in every location. While this is not 0, no location is reported up to date. Absent: 0. */
  undelivered?: number;
}

/** A location a write could not reach. */
export interface UndeliveredLocation {
  label: string;
  path: string;
  /** Why, in plain words (`permission denied`, `the disk is full`). Never a value. */
  reason: string;
}

/** What is kept on this computer only after a write, an import or a sync: stored safely, not yet in every place the vault lives. */
export interface Delivery {
  /** Changes sealed here that some location does not hold yet. 0: everything is delivered. */
  undelivered: number;
  /** The locations the last operation could not write to. May be empty while `undelivered` is not 0 (nothing says why). */
  locations: UndeliveredLocation[];
}

export interface ListQuery {
  group?: string;
  /** List Recently Deleted instead of live items. */
  deleted?: boolean;
}

export interface SearchQuery {
  /** The text to find, as typed (the service trims it). Never empty. */
  text: string;
  group?: string;
  /** Search Recently Deleted instead of live items. */
  deleted?: boolean;
}

export interface SearchResult {
  /** The items whose title, username or website holds the text, by title. Never a value. */
  items: ItemSummary[];
  /** When nothing matched: titles that are close to the text, for a "Did you mean" line. Text for a person, never a result. */
  hints: string[];
}

/** One change of an item: when, and which fields. Never a value. */
export interface ChangeEvent {
  /** Milliseconds since 1970. */
  at: number;
  kind: 'added' | 'changed' | 'deleted' | 'restored';
  /** The fields the change touched, named as a reference names them; empty for `deleted` and `restored`. */
  fields: string[];
}

/** An earlier value of one field and when it was replaced. `value` is only there when `show` was asked for. */
export interface EarlierValue {
  replaced: number;
  value?: string;
}

export type HistoryOutcome =
  | { mode: 'item'; item: ItemSummary; changes: ChangeEvent[] }
  | { mode: 'field'; item: ItemSummary; field: string; earlier: EarlierValue[]; /** The field is the computed verification code: made fresh each time, so it has no earlier values. */ computed?: true };

export interface HistoryRequest {
  /** One field: its earlier values. Absent: the changes of the whole item. */
  field?: string;
  /** Put the earlier values in the result. Only with a field. */
  show?: boolean;
}

export interface CodeOutcome {
  item: ItemSummary;
  /** The current verification code. The setup key behind it never leaves the service. */
  code: string;
  /** Seconds a code lasts. */
  period: number;
  /** Seconds this code is still valid, 1 to `period`. */
  remaining: number;
}

export interface FieldValue {
  item: ItemSummary;
  field: string;
  /** The stored value. The only place a value leaves the service. */
  value: string;
}

export interface SetOutcome {
  item: ItemSummary;
  field: string;
  /** The item did not exist and was created. */
  itemCreated: boolean;
  /** The field had a value before, and it is kept under previous values. */
  previousKept: boolean;
  /** The field already held this value: nothing was written, there is no new record, no history row and nothing to deliver. */
  unchanged?: boolean;
  /** `onlyIfEmpty` was asked for and the field already has a value: nothing was written. */
  refusedExisting?: boolean;
}

export type ItemKind = 'login' | 'card' | 'note' | 'custom';

/** One field of an item as `item show` draws it. A hidden field has no `value`; `detail` is what may be said about it (the last four digits of a card, the length of a note). */
export interface ItemField {
  name: string;
  hidden: boolean;
  value?: string;
  detail?: string;
  /** An extra field the person added (its name is a label, not one of the item's own fields, even when it reads the same). */
  custom?: boolean;
}

/** An item with everything but its protected values. */
export interface ItemDetails {
  item: ItemSummary;
  kind: ItemKind;
  websites: string[];
  tags: string[];
  fields: ItemField[];
  files: Array<{ name: string; size: number }>;
  hasCode: boolean;
  /** The passkey the item holds, as much as may be said: never its key. `created` is milliseconds since 1970. */
  passkey?: { site: string; name: string; created: number };
  /** Milliseconds since 1970. */
  created?: number;
  edited?: number;
  deletedAt?: number;
}

/** Everything `item add` and `item edit` can set. A field that is absent is left alone (edit) or empty (add). Secrets are values the command read from standard input. */
export interface ItemFields {
  title?: string;
  username?: string;
  password?: string;
  /** The whole list of websites (add), or the new list (edit). */
  websites?: string[];
  notes?: string;
  cardholder?: string;
  cardNumber?: string;
  /** Four-digit year and month 1 to 12. */
  expiry?: { year: number; month: number };
  cardCode?: string;
  cardPin?: string;
  /** Stored as the custom fields `Valid from` and `Card issuer`, as the KeePass mapping does. */
  validFrom?: string;
  issuer?: string;
  /** Custom fields by label: a plain value, a concealed one, or `null` to remove it (edit). */
  custom?: Array<{ label: string; value: string | null; concealed: boolean }>;
  addTags?: string[];
  removeTags?: string[];
}

export interface AddRequest extends ItemFields {
  kind: ItemKind;
}

export interface AddOutcome {
  item: ItemSummary;
  kind: ItemKind;
}

export interface EditOutcome {
  item: ItemSummary;
  /** Names of the fields that changed, as a reference names them. Empty: nothing was written. */
  changed: string[];
}

export interface PurgeOutcome {
  item: ItemSummary;
  /** Milliseconds since 1970: when it was moved to Recently Deleted, if the vault knows. */
  deletedAt?: number;
  /** Attachments of the item. */
  files: number;
  dryRun: boolean;
}

export interface FileList {
  item: ItemSummary;
  files: Array<{ name: string; size: number }>;
}

export interface FileContent {
  item: ItemSummary;
  name: string;
  data: Uint8Array;
}

export interface FilePut {
  item: ItemSummary;
  name: string;
  size: number;
  replaced: boolean;
}

export interface SyncLocationReport {
  label: string;
  path: string;
  /** Records this computer took from the location. */
  pulled: number;
  /** Records this computer wrote to the location. */
  pushed: number;
  /** Set when the location could not be reached. The other fields are then zero. */
  error?: string;
}

export interface SyncReport {
  locations: SyncLocationReport[];
}

export type VerifyProblem =
  /** Records that no longer match their signature. They are ignored. */
  | { kind: 'changed'; location: string; count: number }
  /** A location lacks records this computer saw before: it may have been rolled back. */
  | { kind: 'missing'; location: string }
  /** Anything else the check found, in plain words. */
  | { kind: 'other'; location: string; message: string; /** The library's technical words: shown under --verbose and in --json only. */ detail?: string };

export interface VerifyReport {
  records: number;
  locations: number;
  problems: VerifyProblem[];
}

/** The credentials of a KeePass file. A password is typed, piped or read from a file by the command; it never comes from an argument. */
export interface KdbxCredentials {
  /** Empty or absent means no password (only with a key file). */
  password?: string;
  /** The path of a key file. */
  keyFile?: string;
}

export interface ImportRequest {
  /** The KeePass file, as the person gave it (relative paths are against the working folder). */
  file: string;
  credentials: KdbxCredentials;
  /** Work out and report everything, write nothing, not even device state. */
  dryRun: boolean;
  /** Remove characters a KeePass file cannot hold from a field instead of leaving the field out. */
  stripInvalid: boolean;
  /** Bring in the file's Recycle Bin as deleted items. */
  includeTrash: boolean;
  /** Replace items changed in the file since they were imported and not changed here. */
  update: boolean;
  /** Called with how many entries of the file are dealt with so far, and how many there are, as the import goes. Absent: no progress. */
  progress?: (done: number, total: number) => void;
}

export interface ImportIssue {
  kind: string;
  /** The item's name, never a value. Cut to 60 characters, but not cleaned of control characters: whoever prints it must. */
  item?: string;
  /** Which part of an item the sentence is about; findings are grouped by kind and part. */
  field?: string;
  detail: string;
}

export interface ImportResult {
  group: string;
  dryRun: boolean;
  added: number;
  attachments: number;
  updated: number;
  unchanged: number;
  keptYours: number;
  changedInFile: number;
  conflicts: number;
  skippedDeleted: number;
  skippedGone: number;
  skippedTrash: number;
  inFolders: number;
  refusedItems: number;
  refusedFields: number;
  /** Of `refusedFields`, the ones refused for characters a KeePass file cannot hold: `--strip-invalid` brings those in. */
  invalidFields: number;
  strippedFields: number;
  issues: ImportIssue[];
  items: Array<{ title: string; action: string }>;
}

export interface ExportRequest {
  /** The KeePass file to write. */
  file: string;
  credentials: KdbxCredentials;
  /** Build and check the file, write nothing. */
  dryRun: boolean;
  /** Replace a file that is already there. */
  force: boolean;
  stripInvalid: boolean;
}

export interface ExportResult {
  /** The absolute path written (or that would be). */
  file: string;
  dryRun: boolean;
  items: number;
  deleted: number;
  attachments: number;
  groups: number;
  /** What the file does not carry, in words that follow "Not in a KeePass file:". */
  doesNotTravel: string[];
  issues: ImportIssue[];
  refusedFields: number;
  strippedFields: number;
}

export interface VaultService {
  /** Creates a vault and this computer's key. */
  create(request: CreateRequest): Promise<Result<CreatedVault>>;
  /** Opens the vault the options point at, or says why not. Called first by every command except `init`. */
  open(options?: { readOnly?: boolean; changes?: boolean }): Promise<Result<OpenedVault>>;
  info(): Promise<Result<VaultInfo>>;
  list(query: ListQuery): Promise<Result<ItemSummary[]>>;
  /** Resolves a selector to exactly one item. `deleted` looks in Recently Deleted instead. */
  find(selector: ItemSelector, scope?: { deleted?: boolean }): Promise<Result<ItemSummary>>;
  get(selector: ItemSelector, field: string): Promise<Result<FieldValue>>;
  /** Items whose title, username or website holds the text (case, accents and Unicode form ignored), as the apps' search does. Notes, tags and secrets are never searched. */
  search(query: SearchQuery): Promise<Result<SearchResult>>;
  /** The changes of one live item, or of one field with its earlier values, newest first. An item that is only in Recently Deleted is found there. */
  history(selector: ItemSelector, request: HistoryRequest): Promise<Result<HistoryOutcome>>;
  /** The current verification code of one live item. `notFound` (field `code`) when it has none. */
  code(selector: ItemSelector): Promise<Result<CodeOutcome>>;
  /** What the writes of this run left undelivered. Called by every command that writes, after it has written. */
  delivery(): Promise<Result<Delivery>>;
  /** Writes one field. A title that does not exist is `notFound` unless `create` is true, which adds the item. */
  set(selector: ItemSelector, field: string, value: string, options: { create: boolean; onlyIfEmpty?: boolean }): Promise<Result<SetOutcome>>;
  /** One item with every field but the protected values. `deleted` looks in Recently Deleted. */
  show(selector: ItemSelector, scope?: { deleted?: boolean }): Promise<Result<ItemDetails>>;
  /** Adds an item in one record. With `dryRun`, checks it and writes nothing. */
  add(request: AddRequest, options?: { dryRun?: boolean }): Promise<Result<AddOutcome>>;
  /** Changes several fields of a live item in one record; fields that already hold the value are not rewritten. */
  edit(selector: ItemSelector, fields: ItemFields): Promise<Result<EditOutcome>>;
  /** Deletes an item that is in Recently Deleted for good (the permanent-delete request). An item that is not there is `failed`. */
  purge(selector: ItemSelector, options: { dryRun: boolean }): Promise<Result<PurgeOutcome>>;
  /** The files attached to an item. Never the bytes. */
  files(selector: ItemSelector, scope?: { deleted?: boolean }): Promise<Result<FileList>>;
  /** The bytes of one attachment. The only other place besides `get` where stored content leaves the service. */
  readFile(selector: ItemSelector, name: string, scope?: { deleted?: boolean }): Promise<Result<FileContent>>;
  /** The place the vault is kept in (a folder it lives in or syncs from) that holds this path, or null when the path is outside every one. For files psss must not write there. */
  vaultPlaceOf(file: string): Promise<Result<string | null>>;
  /** Attaches a file. The name is already the base name. `replace` writes over a file of that name. */
  putFile(selector: ItemSelector, name: string, data: Uint8Array, options: { replace: boolean }): Promise<Result<FilePut>>;
  /** Adds the vault password as another way in. Called by `init` when the person chooses it. */
  setPassword(password: string): Promise<Result<null>>;
  /** Moves an item to Recently Deleted. */
  delete(selector: ItemSelector): Promise<Result<ItemSummary>>;
  restore(selector: ItemSelector): Promise<Result<ItemSummary>>;
  /** Merges with every location. `progress` gets one plain line per location as the work reaches it. */
  sync(progress?: (line: string) => void): Promise<Result<SyncReport>>;
  /** Checks every record and reports. Never repairs. */
  verify(): Promise<Result<VerifyReport>>;
  /** Brings a KeePass file in. Items are recognized by the entry's UUID: importing the same file again adds nothing. */
  importKdbx(request: ImportRequest): Promise<Result<ImportResult>>;
  /** Writes every item as a KeePass file, reads it back and checks it, then reports what the file does not carry. */
  exportKdbx(request: ExportRequest): Promise<Result<ExportResult>>;
}
