// The port the commands call. Plain data, async, named by what the command line needs and not by format internals.
// A later step writes the adapter to the real @psss/vault; the tests use FakeVaultService (fake-service.ts).
//
// Rules for an implementation:
// - A call never prints, prompts or reads standard input. The command does that.
// - An expected failure is returned as data (a Failure), never thrown. A throw is a bug or an I/O error and exits 1.
// - Only `get` returns a stored value. Nothing else may put one in a result, a message or a log.

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
  what: 'item' | 'field' | 'group';
  /** What was asked for: a title, an id, a field name or a group name. */
  name: string;
  /** For `item`: whether `name` was an id or a title. */
  by?: 'title' | 'id';
  vault: string;
  /** For `item` by title: titles that are close to the name asked for (see near.ts). Text for a person, never a result. */
  hints?: string[];
  /** For `field`: the item's title and the fields it does have. */
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
  | { why: 'noVault'; path?: string }
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

export type Failure = NotFound | Ambiguous | Locked | WrongKey | Failed;
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
  /** "Behind" means this computer has not seen everything the location holds. */
  state: 'upToDate' | 'behind';
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
}

export interface ListQuery {
  group?: string;
  /** List Recently Deleted instead of live items. */
  deleted?: boolean;
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

export interface VaultService {
  /** Creates a vault and this computer's key. */
  create(request: CreateRequest): Promise<Result<CreatedVault>>;
  /** Opens the vault the options point at, or says why not. Called first by every command except `init`. */
  open(): Promise<Result<OpenedVault>>;
  info(): Promise<Result<VaultInfo>>;
  list(query: ListQuery): Promise<Result<ItemSummary[]>>;
  /** Resolves a selector to exactly one item. `deleted` looks in Recently Deleted instead. */
  find(selector: ItemSelector, scope?: { deleted?: boolean }): Promise<Result<ItemSummary>>;
  get(selector: ItemSelector, field: string): Promise<Result<FieldValue>>;
  /** Writes one field. A title that does not exist is `notFound` unless `create` is true, which adds the item. */
  set(selector: ItemSelector, field: string, value: string, options: { create: boolean }): Promise<Result<SetOutcome>>;
  /** Adds the vault password as another way in. Called by `init` when the person chooses it. */
  setPassword(password: string): Promise<Result<null>>;
  /** Moves an item to Recently Deleted. */
  delete(selector: ItemSelector): Promise<Result<ItemSummary>>;
  restore(selector: ItemSelector): Promise<Result<ItemSummary>>;
  /** Merges with every location. `progress` gets one plain line per location as the work reaches it. */
  sync(progress?: (line: string) => void): Promise<Result<SyncReport>>;
  /** Checks every record and reports. Never repairs. */
  verify(): Promise<Result<VerifyReport>>;
}
