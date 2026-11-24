// The adapter from the command line's VaultService port (service.ts) to the real vault library (../../vault).
// It behaves like FakeVaultService (fake-service.ts) for the same situations: same results, same words.
//
// Where things are (docs/cli.md, "Unlocking without an app" and "Device state"):
// - the vault is a folder `<name>.psss`; `--vault` is that folder, a folder that holds one, or a bare name below ~/Psss;
// - the key file is `<configDir>/keys/<name>.key`, or `--key-file` / PSSS_KEY_FILE;
// - device state is `<stateDir>/<name>/` (the library keeps one vault's state in one folder, so each vault gets its own).
//
// Unlock sources, in the order they are tried: the key file named by --key-file or PSSS_KEY_FILE, PSSS_KEY, the default key file,
// then the password in PSSS_PASSWORD_FILE. PSSS_KEY holds the text of a key file (`{"format":"psss-device-key",...}`), or that text
// in base64 so it fits an environment variable without quotes. PSSS_PASSWORD_FILE holds the password; one final line break is dropped.
//
// Rules kept here: nothing is printed, a value leaves only through `get`, and an error never carries a stack trace or a secret.

import { printable } from './text.ts';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hex } from '../../format/src/bytes.ts';
import { slotPath } from '../../format/src/folder.ts';
import { derivePerson } from '../../format/src/keys.ts';
import { DEFAULT_ARGON2, openSlot, sealPasswordSlot } from '../../format/src/slots.ts';
import { KdbxError, readKdbx, writeKdbx } from '../../kdbx/src/index.ts';
import type { KdbxDatabase, KdbxKey } from '../../kdbx/src/index.ts';
import { ImportInterrupted, VaultError, createVault, openVault, parseKeyFile } from '../../vault/src/index.ts';
import type { Unlock, Vault } from '../../vault/src/index.ts';
import { ValidationError } from './errors.ts';
import { nearTitles } from './near.ts';
import { matchesSearch, needsDerivedName, searchTerm, swiftTrim } from './search.ts';
import type { SearchableItem } from './search.ts';
import type {
  Candidate,
  CreateRequest,
  CreatedVault,
  Delivery,
  Failure,
  FieldValue,
  ItemSelector,
  CodeOutcome,
  ExportRequest,
  ExportResult,
  HistoryOutcome,
  HistoryRequest,
  ImportRequest,
  ImportResult,
  ItemSummary,
  KdbxCredentials,
  KeySource,
  ListQuery,
  LocationInfo,
  OpenedVault,
  Result,
  SearchQuery,
  SearchResult,
  ServiceOptions,
  SetOutcome,
  SyncReport,
  VaultInfo,
  VaultService,
  VerifyProblem,
  VerifyReport,
} from './service.ts';

type LibSummary = ReturnType<Vault['list']>[number];
type Scope = 'live' | 'deleted';

const fold = (s: string) => s.normalize('NFC').toLowerCase();
const byTitle = (a: { title: string; id: string }, b: { title: string; id: string }) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id);
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isVaultFolder = (p: string) => existsSync(path.join(p, 'psss.json'));
const nameOf = (folder: string) => path.basename(folder).replace(/\.psss$/, '');
/** The path with symbolic links resolved as far as it exists, so that two spellings of one place compare equal. */
function canonical(p: string): string {
  const rest: string[] = [];
  let at = path.resolve(p);
  while (!existsSync(at) && path.dirname(at) !== at) {
    rest.unshift(path.basename(at));
    at = path.dirname(at);
  }
  try {
    at = realpathSync(at);
  } catch {
    /* keep the plain path */
  }
  return path.join(at, ...rest);
}
const failed = (message: string): Failure => ({ ok: false, kind: 'failed', message });

/** Folders that hold a vault directly below `dir`, sorted. */
function vaultsBelow(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.psss'))
      .map((n) => path.join(dir, n))
      .filter(isVaultFolder)
      .sort();
  } catch {
    return [];
  }
}

/** A folder this account may not list (permission denied), as opposed to one that is missing or empty. */
function cannotList(dir: string): boolean {
  try {
    readdirSync(dir);
    return false;
  } catch (e) {
    return ['EACCES', 'EPERM'].includes((e as NodeJS.ErrnoException).code ?? '');
  }
}

/** The place nothing was found at: with `unreadable` set when the folder, or a vault folder in it, exists but cannot be read. */
function nothingAt(dir: string): { none: string; unreadable?: string } {
  if (cannotList(dir)) return { none: dir, unreadable: dir };
  try {
    const child = readdirSync(dir).filter((n) => n.endsWith('.psss')).map((n) => path.join(dir, n)).find(cannotList);
    if (child) return { none: dir, unreadable: child };
  } catch {
    /* missing: nothing there */
  }
  return { none: dir };
}

function locationLabel(p: string): string {
  if (/[\\/]Mobile Documents[\\/]|[\\/]iCloud/i.test(p)) return 'iCloud Drive';
  if (/[\\/]Dropbox/i.test(p)) return 'Dropbox';
  return 'This computer';
}

/** The text of a key given inline: the key file's text, or that text in base64. */
function keyBytesOf(text: string): string {
  const t = text.trim();
  return t.startsWith('{') ? t : Buffer.from(t, 'base64').toString('utf8');
}

type Attempt = { kind: 'keyFile'; path: string; explicit: boolean } | { kind: 'keyBytes' } | { kind: 'password' };

/** Everything the library throws for the opening step, as the failure the commands know. */
class OpenFailure extends Error {
  failure: Failure;
  constructor(failure: Failure) {
    super('open failure');
    this.failure = failure;
  }
}

export function createVaultService(opts: ServiceOptions): VaultService {
  return new RealVaultService(opts);
}

class RealVaultService implements VaultService {
  private opts: ServiceOptions;
  private vault: Vault | undefined;
  private readOnly = false;
  /** The command that opened the vault will change something, so a refusal says `Nothing was changed.` (see `open`). */
  private changes = false;
  private vaultPath = '';
  private name = '';
  private keyFilePath: string | undefined;
  private headsBefore = new Map<string, number>();
  /** Strings that must never appear in a message: the inline key, and the password given to setPassword. */
  private secrets: string[] = [];

  constructor(opts: ServiceOptions) {
    this.opts = opts;
    if (opts.key) this.secrets.push(opts.key, keyBytesOf(opts.key));
  }

  // ------------------------------------------------------------------ places

  private abs(p: string): string {
    return path.resolve(this.opts.cwd, p);
  }

  private home(): string {
    return this.opts.home;
  }

  private stateFor(name: string): string {
    return path.join(this.opts.stateDir, name);
  }

  private defaultKeyFile(name: string): string {
    return path.join(this.opts.configDir, 'keys', `${name}.key`);
  }

  private show(p: string): string {
    const slash = (s: string) => s.replace(/\\/g, '/');
    const x = slash(p);
    const cwd = slash(this.opts.cwd).replace(/\/+$/, '');
    if (cwd && x.startsWith(`${cwd}/`)) return `./${x.slice(cwd.length + 1)}`;
    const home = slash(this.home()).replace(/\/+$/, '');
    if (home && x === home) return '~';
    if (home && x.startsWith(`${home}/`)) return `~/${x.slice(home.length + 1)}`;
    return p;
  }

  /** Finds the vault folder the options point at. `none` carries the place that was looked at, for the message. */
  private locate(): { path: string } | { none: string; unreadable?: string } | { many: string[]; dir: string } {
    const v = this.opts.vault;
    const fromFolder = (dir: string) => {
      const found = vaultsBelow(dir);
      if (found.length === 1) return { path: found[0] };
      if (found.length > 1) return { many: found, dir };
      return nothingAt(dir);
    };
    if (v === undefined) return fromFolder(path.join(this.home(), 'Psss'));
    const abs = this.abs(v);
    if (isVaultFolder(abs)) return { path: abs };
    const bare = !/[\\/]/.test(v) && !v.startsWith('.') && !v.startsWith('~');
    if (bare) {
      for (const name of [v.endsWith('.psss') ? v : `${v}.psss`]) {
        const candidate = path.join(this.home(), 'Psss', name);
        if (isVaultFolder(candidate)) return { path: candidate };
      }
    }
    if (isDir(abs)) {
      const inside = fromFolder(abs);
      if ('none' in inside && bare) return nothingAt(path.join(this.home(), 'Psss', v.endsWith('.psss') ? v : `${v}.psss`));
      return inside;
    }
    return nothingAt(bare ? path.join(this.home(), 'Psss', v.endsWith('.psss') ? v : `${v}.psss`) : abs);
  }

  // ------------------------------------------------------------------ errors

  private scrub(text: string): string {
    let out = text;
    for (const s of this.secrets) if (s.length >= 4) out = out.split(s).join('[hidden]');
    return out.replace(/\s+/g, ' ').slice(0, 300);
  }

  /** Any throw from the library or the file system, as a short failure with no stack and no secret. */
  private translate(e: unknown): Failure {
    if (e instanceof OpenFailure) return e.failure;
    if (e instanceof ValidationError) throw e;
    const named = e as { name?: string; code?: string; limit?: unknown };
    if (named?.name === 'ValueTooLarge' || named?.code === 'value_too_large' || (named?.name === 'FormatError' && (named.code === 'too_large' || named.code === 'body_too_large'))) {
      const limit = typeof named.limit === 'number' ? ` (limit ${named.limit.toLocaleString('en-US')} bytes)` : '';
      throw new ValidationError(`That value is too large to store${limit}.`);
    }
    if (e instanceof ImportInterrupted) return this.interrupted(e);
    if (e instanceof VaultError) {
      // the library puts its code in front of its message (`no_group: …`): the code is for programs, the sentence is for the person
      const text = this.scrub(e.message.startsWith(`${e.code}: `) ? e.message.slice(e.code.length + 2) : e.message).replace(/[.\s]+$/, '');
      switch (e.code) {
        case 'not_writer':
          return failed('This computer can read the vault but not change it. Nothing was changed.');
        case 'no_group': {
          const named = /^no writable group named (.*)$/.exec(text);
          return failed(named ? `This computer cannot add items to a group called "${printable(named[1])}". Nothing was changed.` : 'This computer cannot add items to any group in this vault. Nothing was changed.');
        }
        case 'ambiguous_group': {
          const named = /^several groups named (.*)$/.exec(text);
          return failed(`More than one group is called ${named ? `"${printable(named[1])}"` : 'that'}. Say which one with --group. Nothing was changed.`);
        }
        case 'group_required':
          return failed('There is more than one group in this vault. Say which one with --group. Nothing was changed.');
        case 'conflict':
          return failed('A file in the vault changed while it was being written. Nothing was lost; try again.');
        case 'state_locked':
          // `Nothing was changed.` only for a command that would have changed something: a read-only one has nothing to say about that
          return failed(
            `${e.what === 'import' ? 'Another psss is importing into this vault right now.' : 'Another psss is working on this vault right now.'} Wait for it to finish and try again.${this.changes ? ' Nothing was changed.' : ''}`,
          );
        default:
          return failed(`Psss could not finish: ${text}. Nothing was changed.`);
      }
    }
    const code = (e as NodeJS.ErrnoException)?.code;
    if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) {
      const where = (e as NodeJS.ErrnoException).path;
      return failed(`Psss could not read or write ${where ? this.show(where) : 'a file'} (${code}).`);
    }
    const why = this.scrub(e instanceof Error ? e.message : String(e));
    return failed(`Psss could not finish${why ? `: ${why}` : ''}. Nothing was changed.`);
  }

  /** An import that stopped part of the way: what was stored stays, and running it again does the rest. */
  private interrupted(e: ImportInterrupted): Failure {
    let why: Failure | undefined;
    try {
      why = this.translate(e.reason);
    } catch {
      /* a usage error from the library has no place here */
    }
    const reason = why?.kind === 'failed' ? why.message.replace(/\s*Nothing was changed\.$/, '') : 'Psss could not finish';
    const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
    if (e.added === 0 && e.updated === 0) return failed(`${reason}\nNothing was changed.`);
    const done = [e.added > 0 ? `added ${count(e.added, 'item', 'items')}` : '', e.updated > 0 ? `updated ${count(e.updated, 'item', 'items')}` : ''].filter(Boolean).join(' and ');
    return failed(`${reason}\nThe import stopped part of the way: it ${done}. Those stay in the vault.\nRun the same command again to finish: items that are already here are left alone.`);
  }

  private async guard<T>(fn: () => T | Failure | Result<T>): Promise<T | Failure | Result<T>> {
    try {
      return fn();
    } catch (e) {
      return this.translate(e);
    }
  }

  // ------------------------------------------------------------------ opening

  private attempts(): Attempt[] {
    const list: Attempt[] = [];
    if (this.opts.keyFile !== undefined) list.push({ kind: 'keyFile', path: this.abs(this.opts.keyFile), explicit: true });
    if (this.opts.key !== undefined) list.push({ kind: 'keyBytes' });
    if (this.opts.keyFile === undefined) list.push({ kind: 'keyFile', path: this.defaultKeyFile(this.name), explicit: false });
    if (this.opts.passwordFile !== undefined) list.push({ kind: 'password' });
    return list;
  }

  /** Opens the vault with the first source that works. A source that is not there is skipped; a key that is there and wrong is reported over one that is missing. */
  private openWith(): Vault {
    const found: Failure[] = [];
    for (const a of this.attempts()) {
      let unlock: Unlock;
      if (a.kind === 'keyFile') {
        if (!existsSync(a.path)) {
          found.push({ ok: false, kind: 'locked', vault: this.name, reason: { why: 'keyFileMissing', keyFile: a.path } });
          continue;
        }
        unlock = { keyFile: a.path };
      } else if (a.kind === 'keyBytes') {
        unlock = { keyBytes: keyBytesOf(this.opts.key!) };
      } else {
        let password: string;
        try {
          password = readFileSync(this.abs(this.opts.passwordFile!), 'utf8').replace(/\r?\n$/, '');
        } catch {
          found.push({ ok: false, kind: 'locked', vault: this.name, reason: { why: 'locked' } });
          continue;
        }
        this.secrets.push(password);
        unlock = { password };
      }
      try {
        const vault = openVault({ locations: [this.vaultPath], unlock, stateDir: this.stateFor(this.name), ...(this.readOnly ? { readOnly: true } : {}) });
        if (a.kind === 'keyFile') this.keyFilePath = a.path;
        return vault;
      } catch (e) {
        if (e instanceof VaultError && ['no_device_slot', 'bad_unlock', 'no_slot', 'bad_slot_parameters'].includes(e.code)) {
          found.push({ ok: false, kind: 'wrongKey', vault: this.name, ...(a.kind === 'keyFile' ? { keyFile: a.path } : {}) });
        } else if (e instanceof VaultError && e.code === 'bad_key_file') {
          found.push(
            a.kind === 'keyFile'
              ? { ok: false, kind: 'locked', vault: this.name, reason: { why: 'keyFileUnreadable', keyFile: a.path } }
              : { ok: false, kind: 'wrongKey', vault: this.name },
          );
        } else if (e instanceof VaultError && e.code === 'no_key_file') {
          found.push({ ok: false, kind: 'locked', vault: this.name, reason: { why: 'keyFileMissing', keyFile: a.kind === 'keyFile' ? a.path : '' } });
        } else if (a.kind === 'keyFile' && ['EACCES', 'EISDIR', 'EPERM'].includes((e as NodeJS.ErrnoException).code ?? '')) {
          found.push({ ok: false, kind: 'locked', vault: this.name, reason: { why: 'keyFileUnreadable', keyFile: a.path } });
        } else if (e instanceof VaultError && e.code === 'not_a_vault') {
          throw new OpenFailure({ ok: false, kind: 'locked', vault: '', reason: { why: 'noVault', path: this.vaultPath } });
        } else {
          throw e;
        }
      }
    }
    throw new OpenFailure(found.find((f) => f.kind === 'wrongKey') ?? found[0] ?? { ok: false, kind: 'locked', vault: this.name, reason: { why: 'noKey' } });
  }

  private use(): Vault | Failure {
    if (this.vault) return this.vault;
    const where = this.locate();
    if ('none' in where) return { ok: false, kind: 'locked', vault: '', reason: { why: 'noVault', path: where.unreadable ?? where.none, ...(where.unreadable !== undefined ? { unreadable: true } : {}) } };
    if ('many' in where) {
      const names = where.many.map((m) => printable(nameOf(m))).join(', ');
      return failed(`There is more than one vault in ${this.show(where.dir)}: ${names}.\nSay which with --vault <name> or PSSS_VAULT.`);
    }
    this.vaultPath = where.path;
    this.name = nameOf(where.path);
    this.headsBefore = this.headsOf();
    try {
      this.vault = this.openWith();
    } catch (e) {
      return this.translate(e);
    }
    return this.vault;
  }

  /** Records this computer remembers per chain of other devices for this vault folder, read from the device state before it is changed. */
  private headsOf(): Map<string, number> {
    const out = new Map<string, number>();
    try {
      const state = JSON.parse(readFileSync(path.join(this.stateFor(this.name), 'state.json'), 'utf8')) as {
        deviceId?: string;
        heads?: Record<string, Record<string, { seq: number }>>;
      };
      const mine = state.deviceId ?? '';
      for (const [chain, h] of Object.entries(state.heads?.[path.resolve(this.vaultPath)] ?? {})) {
        if (chain.split('/')[2] !== mine) out.set(chain, h.seq);
      }
    } catch {
      /* no state yet: everything the location holds is new to this computer */
    }
    return out;
  }

  // ------------------------------------------------------------------ create

  async create(request: CreateRequest): Promise<Result<CreatedVault>> {
    const name = request.name;
    const parent = this.opts.vault !== undefined ? this.abs(this.opts.vault) : path.join(this.home(), 'Psss');
    const folder = path.join(parent, `${name}.psss`);
    const keyFile = this.opts.keyFile !== undefined ? this.abs(this.opts.keyFile) : this.defaultKeyFile(name);
    const rel = path.relative(canonical(folder), canonical(keyFile));
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new ValidationError(
        `The key file ${this.show(keyFile)} is inside the vault folder ${this.show(folder)}.\nA key beside the vault would travel with it. Choose a key file outside the vault folder, or another place for the vault.`,
      );
    }
    if (isVaultFolder(folder)) return failed(`A vault named "${printable(name)}" already exists at ${folder}. Nothing was changed.`);
    if (isDir(folder) && readdirSync(folder).some((n) => n !== '.DS_Store')) {
      return failed(`The folder ${folder} is not empty, so no vault was made there. Nothing was changed.`);
    }
    if (existsSync(keyFile)) {
      return failed(`The key file ${keyFile} already exists, and a key is never overwritten. Nothing was changed.\nChoose another with --key-file.`);
    }
    const stateDir = this.stateFor(name);
    if (existsSync(path.join(stateDir, 'state.json'))) {
      return failed(`This computer already holds device state for a vault named "${printable(name)}" (${stateDir}). Nothing was changed.`);
    }
    try {
      const { vault } = createVault({ name, location: folder, keyFile, stateDir });
      this.vault = vault;
    } catch (e) {
      return this.translate(e);
    }
    this.vaultPath = folder;
    this.name = name;
    this.keyFilePath = keyFile;
    let ownerOnly = true;
    if (process.platform !== 'win32') {
      try {
        ownerOnly = (statSync(keyFile).mode & 0o077) === 0;
      } catch {
        ownerOnly = false;
      }
    }
    return { ok: true, value: { name, path: folder, key: { path: keyFile, ownerOnly, created: true } } };
  }

  async open(options: { readOnly?: boolean; changes?: boolean } = {}): Promise<Result<OpenedVault>> {
    this.readOnly = options.readOnly === true;
    this.changes = options.changes === true;
    const v = this.use();
    if ('ok' in v) return v;
    const raw = (v as unknown as { issues?: Array<{ code: string; location: string | null; detail: string; plain: string }> }).issues;
    const issues = (Array.isArray(raw) ? raw : []).map((i) => ({ code: i.code, location: i.location ?? null, detail: this.scrub(i.detail ?? ''), plain: this.scrub(i.plain ?? '') }));
    const value: OpenedVault = { name: this.name, path: this.vaultPath, issues };
    if (this.keyFilePath !== undefined) {
      let readableByOthers = false;
      if (this.opts.platform !== 'win32') {
        try {
          readableByOthers = (statSync(this.keyFilePath).mode & 0o077) !== 0;
        } catch {
          /* unreadable or gone: the open step already dealt with it */
        }
      }
      value.keyFile = { path: this.keyFilePath, readableByOthers };
    }
    return { ok: true, value };
  }

  // ------------------------------------------------------------------ reading

  private summary(v: Vault, s: LibSummary, scope: Scope): ItemSummary {
    const named = this.fieldNames(v, s.id, scope);
    const out: ItemSummary = { id: s.id, title: s.title, group: s.group, fields: named.names, hasCode: named.hasCode, deleted: s.deleted };
    if (s.username !== undefined) out.username = s.username;
    if (s.url !== undefined) out.url = s.url;
    return out;
  }

  /** Names of the fields an item has, besides the account and the address, which the list shows in their own columns. Never values. */
  private fieldNames(v: Vault, id: string, scope: Scope): { names: string[]; hasCode: boolean } {
    const r = v.show({ item: { id }, field: 'password' }, { scope });
    if (r.kind !== 'found') return { names: [], hasCode: false };
    // only the computed field is a verification code; a stored field that is called "code" is a value
    return { names: r.item.fields.map((f) => f.name).filter((n) => n !== 'username' && !/^url( \d+)?$/.test(n)), hasCode: r.item.fields.some((f) => f.computed === true) };
  }

  /** Why a verification code cannot be made, in the library's own words (`unknown algorithm 7`, `unsupported digits 9`; the setup key is never in them). */
  private codeFailure(title: string, e: unknown): Failure | undefined {
    const text = e instanceof Error ? e.message : '';
    const algorithm = /unknown algorithm (\d+)/.exec(text);
    const digits = /unsupported digits (\d+)/.exec(text);
    if (!algorithm && !digits) return undefined;
    const why = algorithm ? `its setup key asks for an algorithm Psss does not support (${algorithm[1]})` : `its setup key asks for ${digits![1]} digits, and Psss makes codes of 6 to 8`;
    return failed(`The verification code of "${printable(title)}" cannot be made: ${why}.`);
  }

  private candidate(s: LibSummary): Candidate {
    const out: Candidate = { id: s.id, title: s.title, group: s.group };
    if (s.username !== undefined) out.username = s.username;
    return out;
  }

  private groupNamed(v: Vault, name: string): { id: string; name: string } | undefined {
    return v.info().groups.find((g) => fold(g.name) === fold(name));
  }

  private liveTitles(v: Vault, scope: Scope): string[] {
    return v.list({ scope }).map((s) => s.title);
  }

  private missing(v: Vault, name: string, by: 'title' | 'id', scope: Scope): Failure {
    const hints = by === 'title' ? nearTitles(name, this.liveTitles(v, scope)) : [];
    return { ok: false, kind: 'notFound', what: 'item', by, name, vault: this.name, ...(hints.length > 0 ? { hints } : {}) };
  }

  /** The one item a selector names, or the failure; `null` when nothing matches (the caller words that). */
  private pick(v: Vault, selector: ItemSelector, scope: Scope): { item: LibSummary } | { none: true; group?: string } | Failure {
    const wanted = ('group' in selector ? selector.group : undefined) ?? this.opts.group;
    let group: { id: string; name: string } | undefined;
    if (wanted !== undefined) {
      group = this.groupNamed(v, wanted);
      if (!group) return { ok: false, kind: 'notFound', what: 'group', name: wanted, vault: this.name };
    }
    const items = v.list({ scope, ...(group ? { group: `id:${group.id}` } : {}) });
    let hits: LibSummary[];
    if ('id' in selector) {
      const id = selector.id.toLowerCase();
      hits = items.filter((i) => i.id === id || i.id.startsWith(id));
    } else {
      const title = fold(selector.title);
      hits = items.filter((i) => fold(i.title) === title);
    }
    if (hits.length === 1) return { item: hits[0] };
    if (hits.length > 1) {
      const name = 'id' in selector ? selector.id : selector.title;
      return { ok: false, kind: 'ambiguous', name, vault: this.name, candidates: hits.map((h) => this.candidate(h)).sort(byTitle) };
    }
    return { none: true, ...(group ? { group: group.name } : {}) };
  }

  private nameOfSelector(selector: ItemSelector): { name: string; by: 'title' | 'id' } {
    return 'id' in selector ? { name: selector.id, by: 'id' } : { name: selector.title, by: 'title' };
  }

  async info(): Promise<Result<VaultInfo>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<VaultInfo>(() => {
      const i = v.info();
      const source: KeySource = i.unlock.source === 'password' ? 'password' : i.unlock.source === 'keyBytes' ? 'keyEnvironment' : 'keyFile';
      const wayBack: VaultInfo['wayBack'] = [];
      if (i.wayBack.recoveryKit) wayBack.push('recoveryKit');
      if (i.wayBack.password) wayBack.push('password');
      // a location is behind while it lacks a change made here, and nothing is up to date while a change waits in the outbox
      const waiting = v.outbox();
      const lacks = (path: string) => waiting.filter((o) => o.pendingLocations.includes(path)).length;
      const undelivered = Math.max(i.outbox, waiting.length);
      let locations: LocationInfo[] = i.locations.map((l) => ({
        label: locationLabel(l.location),
        path: l.location,
        state: l.status === 'upToDate' && lacks(l.location) === 0 ? 'upToDate' : 'behind',
        ...(lacks(l.location) > 0 ? { pending: lacks(l.location) } : {}),
      }));
      // changes wait but no location is known to lack them (a record that cannot be read, a place that was removed): it cannot be called up to date
      if (undelivered > 0 && locations.every((l) => l.state === 'upToDate')) locations = locations.map((l) => ({ ...l, state: 'behind' as const, pending: undelivered }));
      return {
        ok: true as const,
        value: { name: this.name, path: this.vaultPath, groups: i.groups.map((g) => g.name), itemCount: i.itemCount, keySource: source, wayBack, locations, formatVersion: i.formatVersion, undelivered },
      };
    })) as Result<VaultInfo>;
  }

  async list(query: ListQuery): Promise<Result<ItemSummary[]>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<ItemSummary[]>(() => {
      const wanted = query.group ?? this.opts.group;
      let group: { id: string; name: string } | undefined;
      if (wanted !== undefined) {
        group = this.groupNamed(v, wanted);
        if (!group) return { ok: false, kind: 'notFound', what: 'group', name: wanted, vault: this.name } as Failure;
      }
      const scope: Scope = query.deleted ? 'deleted' : 'live';
      const out = v
        .list({ scope, ...(group ? { group: `id:${group.id}` } : {}) })
        .map((s) => this.summary(v, s, scope))
        .sort(byTitle);
      return { ok: true as const, value: out };
    })) as Result<ItemSummary[]>;
  }

  async find(selector: ItemSelector, scope: { deleted?: boolean } = {}): Promise<Result<ItemSummary>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<ItemSummary>(() => {
      const s: Scope = scope.deleted ? 'deleted' : 'live';
      const r = this.pick(v, selector, s);
      if ('ok' in r) return r;
      if ('none' in r) {
        const n = this.nameOfSelector(selector);
        return this.missing(v, n.name, n.by, s);
      }
      return { ok: true as const, value: this.summary(v, r.item, s) };
    })) as Result<ItemSummary>;
  }

  async get(selector: ItemSelector, field: string): Promise<Result<FieldValue>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<FieldValue>(() => {
      const r = this.pick(v, selector, 'live');
      if ('ok' in r) return r;
      if ('none' in r) {
        const n = this.nameOfSelector(selector);
        return this.missing(v, n.name, n.by, 'live');
      }
      let got: ReturnType<Vault['get']>;
      try {
        got = v.get({ item: { id: r.item.id }, field });
      } catch (e) {
        const why = this.codeFailure(r.item.title, e);
        if (why) return why;
        throw e;
      }
      const item = this.summary(v, r.item, 'live');
      if (got.kind === 'value') return { ok: true as const, value: { item, field: got.field, value: got.value } };
      return { ok: false, kind: 'notFound', what: 'field', name: field, vault: this.name, item: item.title, fields: item.fields } as Failure;
    })) as Result<FieldValue>;
  }

  async search(query: SearchQuery): Promise<Result<SearchResult>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<SearchResult>(() => {
      const wanted = query.group ?? this.opts.group;
      let group: { id: string; name: string } | undefined;
      if (wanted !== undefined) {
        group = this.groupNamed(v, wanted);
        if (!group) return { ok: false, kind: 'notFound', what: 'group', name: wanted, vault: this.name } as Failure;
      }
      const scope: Scope = query.deleted ? 'deleted' : 'live';
      const all = v.list({ scope, ...(group ? { group: `id:${group.id}` } : {}) });
      const term = searchTerm(query.text);
      // an item without a name is searched by the name the apps make for it, which needs its notes or card number
      const searchable = (i: LibSummary): SearchableItem => {
        const text: SearchableItem = { title: i.title, kind: i.type, ...(i.username !== undefined ? { username: i.username } : {}), ...(i.url !== undefined ? { url: i.url } : {}) };
        if (!needsDerivedName(text)) return text;
        const shown = v.show({ item: { id: i.id }, field: 'password' }, { scope });
        if (shown.kind === 'found') {
          if (shown.item.view.notes !== undefined) text.notes = shown.item.view.notes;
          if (shown.item.view.card !== undefined) text.cardNumber = shown.item.view.card.number;
        }
        return text;
      };
      const hits = all.filter((i) => matchesSearch(searchable(i), term)).sort(byTitle);
      const items = hits.map((s) => this.summary(v, s, scope));
      const hints = hits.length === 0 ? nearTitles(swiftTrim(query.text), all.map((i) => i.title)) : [];
      return { ok: true as const, value: { items, hints } };
    })) as Result<SearchResult>;
  }

  async history(selector: ItemSelector, request: HistoryRequest): Promise<Result<HistoryOutcome>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<HistoryOutcome>(() => {
      // a live item first; one that is only in Recently Deleted still has a history
      let scope: Scope = 'live';
      let r = this.pick(v, selector, scope);
      if ('none' in r) {
        scope = 'deleted';
        const again = this.pick(v, selector, scope);
        if ('none' in again) {
          const n = this.nameOfSelector(selector);
          return this.missing(v, n.name, n.by, 'live');
        }
        r = again;
      }
      if ('ok' in r) return r;
      const item = this.summary(v, r.item, scope);
      const ref = { item: { id: r.item.id }, field: request.field ?? 'title' };
      if (request.field === undefined) {
        const got = v.changes(ref);
        if (got.kind !== 'changes') return failed('Psss could not read the history of that item.');
        return { ok: true as const, value: { mode: 'item' as const, item, changes: got.entries.map((c) => ({ at: c.at, kind: c.kind, fields: [...c.fields] })) } };
      }
      // the verification code is computed: it has no earlier values (a stored field that is only called "code" is an ordinary field)
      if (request.field.toLowerCase() === 'code' && item.hasCode === true) {
        return { ok: true as const, value: { mode: 'field' as const, item, field: 'code', earlier: [], computed: true as const } };
      }
      const got = v.history(ref);
      if (got.kind === 'history') {
        const earlier = got.entries.map((h) => ({ replaced: h.replaced, ...(request.show === true ? { value: h.value } : {}) }));
        return { ok: true as const, value: { mode: 'field' as const, item, field: got.field, earlier } };
      }
      return { ok: false, kind: 'notFound', what: 'field', name: request.field, vault: this.name, item: item.title, fields: item.fields } as Failure;
    })) as Result<HistoryOutcome>;
  }

  async code(selector: ItemSelector): Promise<Result<CodeOutcome>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<CodeOutcome>(() => {
      const r = this.pick(v, selector, 'live');
      if ('ok' in r) return r;
      if ('none' in r) {
        const n = this.nameOfSelector(selector);
        return this.missing(v, n.name, n.by, 'live');
      }
      const item = this.summary(v, r.item, 'live');
      let got: ReturnType<Vault['get']>;
      try {
        got = v.get({ item: { id: r.item.id }, field: 'code' });
      } catch (e) {
        return this.codeFailure(item.title, e) ?? failed(`The verification code of "${printable(item.title)}" cannot be made.`);
      }
      // a stored field that happens to be called "code" is a value, not a verification code: only a computed one has seconds left
      if (got.kind === 'value' && got.expiresInSeconds !== undefined && got.period !== undefined) {
        return { ok: true as const, value: { item, code: got.value, period: got.period, remaining: got.expiresInSeconds } };
      }
      return { ok: false, kind: 'notFound', what: 'field', name: 'code', vault: this.name, item: item.title, fields: item.fields } as Failure;
    })) as Result<CodeOutcome>;
  }

  // ------------------------------------------------------------------ writing

  async set(selector: ItemSelector, field: string, value: string, options: { create: boolean }): Promise<Result<SetOutcome>> {
    const v = this.use();
    if ('ok' in v) return v;
    this.secrets.push(value);
    try {
      return await this.setGuarded(v, selector, field, value, options);
    } catch (e) {
      if (e instanceof ValidationError && e.message.startsWith('That value is too large to store')) {
        throw new ValidationError(`${e.message} The value for "${printable(field)}" is ${Buffer.byteLength(value).toLocaleString('en-US')} bytes.`);
      }
      throw e;
    }
  }

  private async setGuarded(v: Vault, selector: ItemSelector, field: string, value: string, options: { create: boolean }): Promise<Result<SetOutcome>> {
    return (await this.guard<SetOutcome>(() => {
      const r = this.pick(v, selector, 'live');
      if ('ok' in r) return r;
      if ('none' in r) {
        if ('id' in selector) return this.missing(v, selector.id, 'id', 'live');
        if (!options.create) return this.missing(v, selector.title, 'title', 'live');
        const group = r.group !== undefined ? this.groupNamed(v, r.group) : v.info().groups.find((g) => g.role !== 'reader');
        if (!group) return failed('This computer has no group it can add items to. Nothing was changed.');
        const added = v.addItem({ title: selector.title, group: `id:${group.id}`, ...this.edits(field, value) });
        return { ok: true as const, value: { item: this.summary(v, added.item, 'live'), field, itemCreated: true, previousKept: false } };
      }
      const had = v.get({ item: { id: r.item.id }, field }).kind === 'value';
      const written = v.setField({ item: { id: r.item.id }, field }, value);
      const after = v.find({ item: { id: r.item.id }, field }) ;
      const item = after.kind === 'found' ? this.summary(v, after.item, 'live') : this.summary(v, r.item, 'live');
      // the item already held this value: nothing was written, so nothing is kept under previous values either
      if (written.unchanged) return { ok: true as const, value: { item, field, itemCreated: false, previousKept: false, unchanged: true } };
      return { ok: true as const, value: { item, field, itemCreated: false, previousKept: had } };
    })) as Result<SetOutcome>;
  }

  /** The new-item form of one field: the built-in fields have their own place, any other name becomes a hidden custom field. */
  private edits(field: string, value: string): Record<string, unknown> {
    switch (field.toLowerCase()) {
      case 'password':
        return { password: value };
      case 'username':
        return { username: value };
      case 'url':
        return { url: value };
      case 'note':
      case 'notes':
        return { notes: value };
      case 'cardholder':
        return { cardholder: value };
      case 'card_code':
        return { cardCode: value };
      case 'card_pin':
        return { cardPin: value };
      case 'card':
      case 'card_number':
        return { type: 2, card: { number: value } };
      default:
        return { custom: { [field]: value } };
    }
  }

  async delete(selector: ItemSelector): Promise<Result<ItemSummary>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<ItemSummary>(() => {
      const r = this.pick(v, selector, 'live');
      if ('ok' in r) return r;
      if ('none' in r) {
        const n = this.nameOfSelector(selector);
        return this.missing(v, n.name, n.by, 'live');
      }
      v.deleteItem({ item: { id: r.item.id }, field: 'password' });
      return { ok: true as const, value: { ...this.summary(v, r.item, 'deleted'), deleted: true } };
    })) as Result<ItemSummary>;
  }

  async restore(selector: ItemSelector): Promise<Result<ItemSummary>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<ItemSummary>(() => {
      const r = this.pick(v, selector, 'deleted');
      if ('ok' in r) return r;
      if ('none' in r) {
        const n = this.nameOfSelector(selector);
        return this.missing(v, n.name, n.by, 'deleted');
      }
      v.restoreItem({ item: { id: r.item.id }, field: 'password' });
      return { ok: true as const, value: { ...this.summary(v, r.item, 'live'), deleted: false } };
    })) as Result<ItemSummary>;
  }

  /**
   * The vault library cannot add a password slot after creation, so this does it from outside with the format's own primitives:
   * it opens a device slot with this computer's key file to get the person secret, seals a password slot and puts the file
   * beside the others. It needs the key file, so it works for the computer that created the vault or opened it with a key file.
   */
  async setPassword(password: string): Promise<Result<null>> {
    this.secrets.push(password);
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<null>(() => {
      if (v.info().wayBack.password) return failed('This vault already has a vault password. Changing it is not built yet. Nothing was changed.');
      if (!this.keyFilePath) return failed('A vault password can only be added with this computer\'s key file. Nothing was changed.');
      const key = parseKeyFile(readFileSync(this.keyFilePath));
      let ps: Uint8Array | undefined;
      const people = path.join(this.vaultPath, 'people');
      for (const pid of readdirSync(people)) {
        const slots = path.join(people, pid, 'slots');
        if (!isDir(slots)) continue;
        for (const file of readdirSync(slots).filter((n) => n.endsWith('.slot'))) {
          try {
            ps = openSlot(new Uint8Array(readFileSync(path.join(slots, file))), { deviceKemSeed: key.kemSeed });
            break;
          } catch {
            /* a slot of another kind, or another device's */
          }
        }
        if (ps) break;
      }
      if (!ps) return { ok: false, kind: 'wrongKey', vault: this.name, keyFile: this.keyFilePath } as Failure;
      const person = derivePerson(ps);
      const slotId = new Uint8Array(randomBytes(16));
      const slot = sealPasswordSlot(ps, person.pid, slotId, new Uint8Array(randomBytes(16)), DEFAULT_ARGON2, password);
      const target = path.join(this.vaultPath, slotPath(hex(person.pid), hex(slotId)));
      mkdirSync(path.dirname(target), { recursive: true });
      const tmp = path.join(path.dirname(target), `.tmp-${randomBytes(6).toString('hex')}.slot`);
      writeFileSync(tmp, slot, { flag: 'wx', mode: 0o644 });
      renameSync(tmp, target);
      return { ok: true as const, value: null };
    })) as Result<null>;
  }

  /** What the writes of this run left undelivered, with the places that refused them and why in plain words. */
  async delivery(): Promise<Result<Delivery>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<Delivery>(() => {
      const d = v.delivery();
      return {
        ok: true as const,
        value: { undelivered: d.pending, locations: d.locations.map((l) => ({ label: locationLabel(l.location), path: l.location, reason: this.plainReason(l.error) })) },
      };
    })) as Result<Delivery>;
  }

  /** Why a location could not be written, in words for a person: the error code or the library's sentence, without paths. */
  private plainReason(error: string): string {
    const code = /\b(E[A-Z0-9]{3,})\b/.exec(error)?.[1];
    switch (code) {
      case 'EACCES':
      case 'EPERM':
        return 'permission denied';
      case 'EROFS':
        return 'the folder is read-only';
      case 'ENOSPC':
        return 'the disk is full';
      case 'EDQUOT':
        return 'the disk quota is used up';
      case 'ENOENT':
      case 'ENOTDIR':
        return 'the folder is missing';
      case 'EIO':
        return 'the disk reported an error';
      case 'EBUSY':
      case 'ETIMEDOUT':
        return 'the place did not answer';
    }
    if (/has not been set up yet/.test(error)) return 'it is not set up yet; psss sync does that';
    if (/not a psss vault/.test(error)) return 'the folder is not a Psss vault';
    if (/not a folder/.test(error)) return 'it is not a folder';
    const clean = this.scrub(error).replace(/'[^']*[\\/][^']*'/g, 'a file').replace(/\s*\(.*$/, '');
    return clean.length > 80 ? `${clean.slice(0, 79)}\u2026` : clean;
  }

  // ------------------------------------------------------------------ sync and verify

  async sync(progress?: (line: string) => void): Promise<Result<SyncReport>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<SyncReport>(() => {
      const places = v.info().locations;
      if (places.length > 1) for (const l of places) progress?.(`Reading ${locationLabel(l.location)}`);
      const report = v.sync();
      const afterHeads = this.headsOf();
      let pulled = 0;
      for (const [chain, seq] of afterHeads) pulled += Math.max(0, seq - (this.headsBefore.get(chain) ?? 0));
      this.headsBefore = afterHeads;
      const locations = report.locations.map((l, i) => ({
        label: locationLabel(l.location),
        path: l.location,
        // heads are remembered per location, and this adapter opens one
        pulled: i === 0 ? pulled : 0,
        pushed: l.wrote,
        ...(l.failed.length > 0 ? { error: this.plainReason(l.failed[0]) } : {}),
      }));
      return { ok: true as const, value: { locations: locations.map((l) => (l.error ? { ...l, pulled: 0, pushed: 0 } : l)) } };
    })) as Result<SyncReport>;
  }

  /** Plain words for a finding when the library gives none: what it means, never ids or chain names. */
  private plainFor(code: string, location: string): string {
    const where = this.show(location);
    switch (code) {
      case 'gap':
        return `A record is missing from the middle of a device's history\nin ${where}. The ones after it wait\nfor it.`;
      case 'prev_mismatch':
      case 'fork':
      case 'contradicts_checkpoint':
        return `Two versions of the same history were found in ${where}.\nNeither is used until the difference is settled.`;
      case 'held_back':
        return `A record in ${where} is dated well in the future,\nso it is held back for now.`;
      case 'no_key':
        return `${where} holds records for a group this computer has no key for.`;
      case 'unreadable_location':
        return `${where} could not be read.`;
      case 'unauthorized_author':
      case 'waiting_for_membership':
        return `A record in ${where} was written by someone who was not\nallowed to write it, so it is ignored.`;
      default:
        return `Something in ${where} does not add up.\nRun psss verify --verbose for the details.`;
    }
  }

  async verify(): Promise<Result<VerifyReport>> {
    const v = this.use();
    if ('ok' in v) return v;
    return (await this.guard<VerifyReport>(() => {
      const r = v.verify();
      const damaged = new Set(['bad_tag', 'bad_signature', 'bad_magic', 'too_short', 'bad_size', 'bad_padding', 'bad_body', 'bad_payload', 'bad_salt', 'bad_author', 'too_large', 'body_too_large', 'bad_body_schema', 'unreadable']);
      const problems: VerifyProblem[] = [];
      const changed = new Map<string, number>();
      for (const p of r.problems) {
        const location = p.location ?? this.vaultPath;
        if (damaged.has(p.code)) changed.set(location, (changed.get(location) ?? 0) + 1);
        else if (p.code === 'rolled_back') problems.push({ kind: 'missing', location });
        else {
          const plain = (p as { plain?: string }).plain;
          problems.push({ kind: 'other', location, message: plain ? this.scrub(plain) : this.plainFor(p.code, location), detail: this.scrub(p.detail) });
        }
      }
      const all: VerifyProblem[] = [...[...changed].map(([location, count]) => ({ kind: 'changed' as const, location, count })), ...problems];
      return { ok: true as const, value: { records: r.checked, locations: r.locations.length, problems: all } };
    })) as Result<VerifyReport>;
  }

  // ------------------------------------------------------------------ KeePass

  /** The key of a KeePass file from what the command gathered. A password is scrubbed from every message from here on. */
  private kdbxKey(file: string, c: KdbxCredentials): KdbxKey | Failure {
    if (c.password) this.secrets.push(c.password);
    const key: KdbxKey = {};
    if (c.password !== undefined && (c.password !== '' || c.keyFile === undefined)) key.password = c.password;
    if (c.keyFile !== undefined) {
      const at = this.abs(c.keyFile);
      try {
        key.keyFile = new Uint8Array(readFileSync(at));
      } catch {
        return { ok: false, kind: 'kdbx', why: 'invalidKey', file, detail: `${this.show(at)} cannot be read` };
      }
    }
    return key;
  }

  /** Any throw from the KeePass codec as the failure the commands know. Never the file's content, never a key. */
  private kdbxFailure(e: unknown, file: string): Failure {
    if (e instanceof KdbxError) {
      switch (e.code) {
        case 'WrongKey':
          return { ok: false, kind: 'kdbx', why: 'wrongKey', file };
        case 'InvalidKey':
          return { ok: false, kind: 'kdbx', why: 'invalidKey', file };
        case 'NotKdbx':
          return { ok: false, kind: 'kdbx', why: 'notKdbx', file };
        case 'LimitExceeded':
          return { ok: false, kind: 'kdbx', why: 'limit', file, ...(e.detail ? { detail: e.detail } : {}) };
        case 'Unsupported':
          return { ok: false, kind: 'kdbx', why: 'unsupported', file, ...(e.detail ? { detail: e.detail } : {}) };
        default:
          return { ok: false, kind: 'kdbx', why: 'corrupt', file };
      }
    }
    return this.translate(e);
  }

  private static readonly MAX_KDBX_BYTES = 512 * 1024 * 1024;

  async importKdbx(request: ImportRequest): Promise<Result<ImportResult>> {
    const v = this.use();
    if ('ok' in v) return v;
    const at = this.abs(request.file);
    const shown = this.show(at);
    let bytes: Uint8Array;
    try {
      const st = statSync(at);
      if (!st.isFile()) return { ok: false, kind: 'kdbx', why: 'unreadable', file: shown };
      if (st.size > RealVaultService.MAX_KDBX_BYTES) return { ok: false, kind: 'kdbx', why: 'tooLarge', file: shown, detail: '512 MiB' };
      bytes = new Uint8Array(readFileSync(at));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return { ok: false, kind: 'kdbx', why: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', file: shown };
    }
    const key = this.kdbxKey(shown, request.credentials);
    if ('ok' in key) return key;
    let db: KdbxDatabase;
    try {
      db = readKdbx(bytes, key);
    } catch (e) {
      return this.kdbxFailure(e, shown);
    }
    return (await this.guard<ImportResult>(() => {
      const r = v.importKdbx(db, {
        ...(this.opts.group !== undefined ? { group: this.opts.group } : {}),
        ...(request.stripInvalid ? { stripInvalid: true } : {}),
        ...(request.includeTrash ? { includeTrash: true } : {}),
        ...(request.update ? { update: true } : {}),
        ...(request.dryRun ? { dryRun: true } : {}),
        ...(request.progress ? { progress: request.progress } : {}),
      });
      const { groupId: _gid, ...rest } = r;
      return { ok: true as const, value: { ...rest, issues: r.issues.map((i) => ({ kind: i.kind, ...(i.item !== undefined ? { item: i.item } : {}), ...(i.field !== undefined ? { field: i.field } : {}), detail: i.detail })) } };
    })) as Result<ImportResult>;
  }

  /** The place of the vault that holds `file` (the file is in it or below it, as the real folders), or undefined. */
  private insideVaultPlace(v: Vault, file: string): string | undefined {
    const target = canonical(file);
    const places = new Set<string>([this.vaultPath, ...v.info().locations.map((l) => l.location)]);
    for (const place of places) {
      const rel = path.relative(canonical(place), target);
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return place;
    }
    return undefined;
  }

  async exportKdbx(request: ExportRequest): Promise<Result<ExportResult>> {
    const v = this.use();
    if ('ok' in v) return v;
    const at = this.abs(request.file);
    const shown = this.show(at);
    // a KeePass file holds every secret in the clear: never in a folder that syncs (a place of the vault), as init refuses for the key file
    const inside = this.insideVaultPlace(v, at);
    if (inside !== undefined) {
      return failed(
        `${shown} is inside ${this.show(inside)}, a place this vault is kept in and shared from.\nA KeePass file holds every secret in the clear, and anything saved there would sync with the vault.\nChoose another place for the file, outside the vault folder.`,
      );
    }
    if (!request.force && existsSync(at)) return { ok: false, kind: 'kdbx', why: 'exists', file: shown };
    const key = this.kdbxKey(shown, request.credentials);
    if ('ok' in key) return key;
    return (await this.guard<ExportResult>(() => {
      const built = v.exportKdbx({ ...(this.opts.group !== undefined ? { group: this.opts.group } : {}), ...(request.stripInvalid ? { stripInvalid: true } : {}) });
      let bytes: Uint8Array;
      try {
        bytes = writeKdbx(built.db, key, { version: '4.1' });
      } catch (e) {
        return this.kdbxFailure(e, shown);
      }
      // read it back before anything is written, and compare what matters: every entry, its password and its attachments
      const want = new Map<string, string>();
      const entriesOf = (db: KdbxDatabase) => {
        const out: Array<{ uuid: string; password: string; attachments: number }> = [];
        const walk = (g: KdbxDatabase['root']) => {
          for (const e of g.entries) out.push({ uuid: e.uuid, password: e.fields.find((f) => f.name === 'Password')?.value ?? '', attachments: e.attachments.length });
          g.groups.forEach(walk);
        };
        walk(db.root);
        return out;
      };
      for (const e of entriesOf(built.db)) want.set(e.uuid, `${e.password}\u0000${e.attachments}`);
      const verify = (written: Uint8Array): boolean => {
        try {
          const back = entriesOf(readKdbx(written, key));
          return back.length === want.size && back.every((e) => want.get(e.uuid) === `${e.password}\u0000${e.attachments}`);
        } catch {
          return false;
        }
      };
      if (!verify(bytes)) return { ok: false, kind: 'kdbx', why: 'verifyFailed', file: shown } as Failure;
      const result: ExportResult = {
        file: at,
        dryRun: request.dryRun,
        items: built.report.items,
        deleted: built.report.deleted,
        attachments: built.report.attachments,
        groups: built.report.groups,
        doesNotTravel: built.report.doesNotTravel.map((d) => d.text),
        issues: built.report.issues.map((i) => ({ kind: i.kind, ...(i.item !== undefined ? { item: i.item } : {}), ...(i.field !== undefined ? { field: i.field } : {}), detail: i.detail })),
        refusedFields: built.report.refusedFields,
        strippedFields: built.report.strippedFields,
      };
      if (request.dryRun) return { ok: true as const, value: result };
      const tmp = path.join(path.dirname(at), `.${path.basename(at)}.${randomBytes(4).toString('hex')}.tmp`);
      try {
        writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 });
        if (!verify(new Uint8Array(readFileSync(tmp)))) {
          rmSync(tmp, { force: true });
          return { ok: false, kind: 'kdbx', why: 'verifyFailed', file: shown } as Failure;
        }
        if (existsSync(at) && !request.force) {
          rmSync(tmp, { force: true });
          return { ok: false, kind: 'kdbx', why: 'exists', file: shown } as Failure;
        }
        renameSync(tmp, at);
      } catch (e) {
        try {
          rmSync(tmp, { force: true });
        } catch {
          /* gone */
        }
        const code = (e as NodeJS.ErrnoException).code;
        return { ok: false, kind: 'kdbx', why: 'notWritable', file: shown, ...(typeof code === 'string' ? { detail: code } : {}) } as Failure;
      }
      return { ok: true as const, value: result };
    })) as Result<ExportResult>;
  }
}
