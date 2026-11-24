// A deterministic in-memory VaultService for tests and for trying the commands before the real library is wired in.
// Holds no crypto and no files. It keeps one flat list of items; ids and the clock are fixed, so output is stable.

import path from 'node:path';
import { nearTitles } from './near.ts';
import type {
  Candidate,
  CreateRequest,
  CreatedVault,
  Failure,
  ExportRequest,
  ExportResult,
  FieldValue,
  ImportIssue,
  ImportRequest,
  ImportResult,
  ItemSelector,
  KdbxProblem,
  ItemSummary,
  KeySource,
  ListQuery,
  LocationInfo,
  OpenedVault,
  Result,
  ServiceOptions,
  SetOutcome,
  SyncReport,
  VaultInfo,
  VaultService,
  VaultIssue,
  VerifyReport,
} from './service.ts';

export interface FakeItem {
  id: string;
  title: string;
  username?: string;
  url?: string;
  group?: string;
  /** Field name to value. `username` and `url` are separate properties and are also readable as fields. */
  fields?: Record<string, string>;
  deleted?: boolean;
}

export interface FakeScenario {
  /** Home and working folder the paths in results are built from. */
  home: string;
  cwd: string;
  vaultName?: string;
  groups?: string[];
  items?: FakeItem[];
  /** Overrides the number `info` reports, for a vault that is larger than the items listed. */
  itemCount?: number;
  /** Where `create` writes the key by default, and where `open` looks when no key file is given. */
  keyFile?: string;
  /** What `open` finds. Default `ok`. */
  keyState?: 'ok' | 'keyFileMissing' | 'keyFileUnreadable' | 'wrong' | 'noKey' | 'noVault' | 'locked';
  keySource?: KeySource;
  wayBack?: Array<'recoveryKit' | 'password'>;
  locations?: LocationInfo[];
  sync?: SyncReport;
  verify?: VerifyReport;
  formatVersion?: number;
  /** Problems `open` reports, as `vault.issues` would. */
  issues?: VaultIssue[];
  /** `open` reports the key file at this path as readable by group or others. */
  keyFileReadableByOthers?: boolean;
  /** KeePass files by absolute path. A path that is not here is a file that does not exist. */
  kdbxFiles?: Record<string, FakeKdbxFile>;
  /** What an export finds and reports. */
  kdbxExport?: { items?: number; deleted?: number; attachments?: number; groups?: number; doesNotTravel?: string[]; issues?: ImportIssue[]; existing?: string[] };
}

export interface FakeKdbxFile {
  /** The password that opens it; none means any. */
  password?: string;
  /** Read fails with this, before any key is tried. */
  problem?: KdbxProblem['why'];
  items?: number;
  attachments?: number;
  /** Entries in the file's Recycle Bin. */
  trashed?: number;
  inFolders?: number;
  issues?: ImportIssue[];
}

const HEX = '0123456789abcdef';

interface Row {
  id: string;
  title: string;
  username?: string;
  url?: string;
  group: string;
  fields: Record<string, string>;
  deleted: boolean;
  previous: Record<string, string[]>;
}

export class FakeVaultService implements VaultService {
  /** What the command passed when it made this service, for tests. */
  options: ServiceOptions;
  /** Names of the methods called, in order, with no values in them. */
  readonly calls: string[] = [];
  private scenario: FakeScenario;
  private items: Row[];
  private nextId = 1;
  private vaultName: string;
  private vaultPath: string;

  constructor(scenario: FakeScenario) {
    this.scenario = scenario;
    this.options = { cwd: scenario.cwd, home: scenario.home, platform: 'linux', configDir: path.join(scenario.home, '.config', 'psss'), stateDir: path.join(scenario.home, '.local', 'state', 'psss') };
    this.vaultName = scenario.vaultName ?? 'Personal';
    this.vaultPath = path.join(scenario.home, 'Psss', `${this.vaultName}.psss`);
    this.items = (scenario.items ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      username: i.username,
      url: i.url,
      group: i.group ?? this.groups()[0],
      fields: { ...(i.fields ?? {}) },
      deleted: i.deleted ?? false,
      previous: {},
    }));
  }

  /** Binds the options the command resolved; returns this, so it can be the service factory's result. */
  withOptions(options: ServiceOptions): this {
    this.options = options;
    return this;
  }

  /** The tests read a stored value back through this, never through a result. */
  peek(title: string, field: string): string | undefined {
    return this.rows().find((i) => i.title === title)?.fields[field];
  }

  private rows(): Row[] {
    return this.items;
  }

  private groups(): string[] {
    return this.scenario.groups ?? ['Only Me'];
  }

  private summary(i: Row): ItemSummary {
    const out: ItemSummary = { id: i.id, title: i.title, group: i.group, fields: Object.keys(i.fields), deleted: i.deleted };
    if (i.username !== undefined) out.username = i.username;
    if (i.url !== undefined) out.url = i.url;
    return out;
  }

  private candidate(i: Row): Candidate {
    const out: Candidate = { id: i.id, title: i.title, group: i.group };
    if (i.username !== undefined) out.username = i.username;
    return out;
  }

  private locked(): Failure | null {
    const state = this.scenario.keyState ?? 'ok';
    const keyFile = this.options.keyFile ?? this.scenario.keyFile ?? path.join(this.options.configDir ?? path.join(this.scenario.home, '.config', 'psss'), 'keys', `${this.vaultName}.key`);
    switch (state) {
      case 'ok':
        return null;
      case 'keyFileMissing':
        return { ok: false, kind: 'locked', vault: this.vaultName, reason: { why: 'keyFileMissing', keyFile } };
      case 'keyFileUnreadable':
        return { ok: false, kind: 'locked', vault: this.vaultName, reason: { why: 'keyFileUnreadable', keyFile } };
      case 'noKey':
        return { ok: false, kind: 'locked', vault: this.vaultName, reason: { why: 'noKey' } };
      case 'noVault':
        return { ok: false, kind: 'locked', vault: '', reason: { why: 'noVault', path: this.options.vault } };
      case 'locked':
        return { ok: false, kind: 'locked', vault: this.vaultName, reason: { why: 'locked' } };
      case 'wrong':
        return { ok: false, kind: 'wrongKey', vault: this.vaultName, keyFile };
    }
  }

  private newId(): string {
    const n = this.nextId++;
    let s = '';
    for (let k = 0; k < 8; k++) s = HEX[(n >> (k * 4)) & 15] + s;
    return s;
  }

  private resolve(
    selector: ItemSelector,
    scope: { deleted?: boolean },
  ): Result<Row> | { ok: true; value: null; title: string; group?: string } {
    const group = 'group' in selector ? selector.group : undefined;
    const wantedGroup = group ?? this.options.group;
    if (wantedGroup !== undefined && !this.groups().includes(wantedGroup)) {
      return { ok: false, kind: 'notFound', what: 'group', name: wantedGroup, vault: this.vaultName };
    }
    const live = this.rows().filter((i) => i.deleted === (scope.deleted ?? false) && (wantedGroup === undefined || i.group === wantedGroup));
    if ('id' in selector) {
      const hit = live.find((i) => i.id === selector.id || i.id.startsWith(selector.id));
      return hit
        ? { ok: true, value: hit }
        : { ok: false, kind: 'notFound', what: 'item', by: 'id', name: selector.id, vault: this.vaultName };
    }
    const wanted = selector.title.toLowerCase();
    const hits = live.filter((i) => i.title.toLowerCase() === wanted);
    if (hits.length === 1) return { ok: true, value: hits[0] };
    if (hits.length > 1) {
      const candidates = hits.map((i) => this.candidate(i)).sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
      return { ok: false, kind: 'ambiguous', name: selector.title, vault: this.vaultName, candidates };
    }
    return { ok: true, value: null, title: selector.title, group: wantedGroup };
  }

  private missing(name: string, by: 'title' | 'id' = 'title'): Failure {
    const hints = by === 'title' ? nearTitles(name, this.rows().filter((i) => !i.deleted).map((i) => i.title)) : [];
    return { ok: false, kind: 'notFound', what: 'item', by, name, vault: this.vaultName, ...(hints.length > 0 ? { hints } : {}) };
  }

  async create(request: CreateRequest): Promise<Result<CreatedVault>> {
    this.calls.push('create');
    const parent = this.options.vault ? path.resolve(this.options.cwd, this.options.vault) : path.join(this.scenario.home, 'Psss');
    const vaultPath = path.join(parent, `${request.name}.psss`);
    if (this.created.has(vaultPath)) {
      return { ok: false, kind: 'failed', message: `A vault named "${request.name}" already exists at ${vaultPath}. Nothing was changed.` };
    }
    this.created.add(vaultPath);
    this.vaultName = request.name;
    this.vaultPath = vaultPath;
    const keyPath = this.options.keyFile
      ? path.resolve(this.options.cwd, this.options.keyFile)
      : path.join(this.options.configDir ?? path.join(this.scenario.home, '.config', 'psss'), 'keys', `${request.name}.key`);
    return { ok: true, value: { name: request.name, path: vaultPath, key: { path: keyPath, ownerOnly: true, created: true } } };
  }

  private created = new Set<string>();

  async open(options: { readOnly?: boolean } = {}): Promise<Result<OpenedVault>> {
    this.calls.push(options.readOnly ? 'open:readOnly' : 'open');
    const problem = this.locked();
    if (problem) return problem;
    const keyFile = this.options.keyFile ?? this.scenario.keyFile ?? path.join(this.options.configDir ?? path.join(this.scenario.home, '.config', 'psss'), 'keys', `${this.vaultName}.key`);
    return {
      ok: true,
      value: {
        name: this.vaultName,
        path: this.vaultPath,
        issues: this.scenario.issues ?? [],
        keyFile: { path: keyFile, readableByOthers: this.scenario.keyFileReadableByOthers === true },
      },
    };
  }

  async info(): Promise<Result<VaultInfo>> {
    this.calls.push('info');
    const problem = this.locked();
    if (problem) return problem;
    const live = this.rows().filter((i) => !i.deleted).length;
    return {
      ok: true,
      value: {
        name: this.vaultName,
        path: this.vaultPath,
        groups: this.groups(),
        itemCount: this.scenario.itemCount ?? live,
        keySource: this.scenario.keySource ?? 'keyFile',
        wayBack: this.scenario.wayBack ?? [],
        locations: this.scenario.locations ?? [{ label: 'This computer', path: this.vaultPath, state: 'upToDate' }],
        formatVersion: this.scenario.formatVersion ?? 1,
      },
    };
  }

  async list(query: ListQuery): Promise<Result<ItemSummary[]>> {
    this.calls.push('list');
    const problem = this.locked();
    if (problem) return problem;
    const group = query.group ?? this.options.group;
    if (group !== undefined && !this.groups().includes(group)) {
      return { ok: false, kind: 'notFound', what: 'group', name: group, vault: this.vaultName };
    }
    const out = this.rows()
      .filter((i) => i.deleted === (query.deleted ?? false) && (group === undefined || i.group === group))
      .map((i) => this.summary(i))
      .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
    return { ok: true, value: out };
  }

  async find(selector: ItemSelector, scope: { deleted?: boolean } = {}): Promise<Result<ItemSummary>> {
    this.calls.push('find');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, scope);
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    return { ok: true, value: this.summary(r.value) };
  }

  async get(selector: ItemSelector, field: string): Promise<Result<FieldValue>> {
    this.calls.push('get');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const item = r.value;
    const lower = field.toLowerCase();
    let value: string | undefined;
    if (lower === 'username') value = item.username;
    else if (lower === 'url') value = item.url;
    else {
      const key = Object.keys(item.fields).find((k) => k === field) ?? Object.keys(item.fields).find((k) => k.toLowerCase() === lower);
      value = key === undefined ? undefined : item.fields[key];
    }
    if (value === undefined) {
      return { ok: false, kind: 'notFound', what: 'field', name: field, vault: this.vaultName, item: item.title, fields: Object.keys(item.fields) };
    }
    return { ok: true, value: { item: this.summary(item), field, value } };
  }

  async set(selector: ItemSelector, field: string, value: string, options: { create: boolean }): Promise<Result<SetOutcome>> {
    this.calls.push('set');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    let itemCreated = false;
    let item = r.value;
    if (item === null) {
      if ('id' in selector) return this.missing(selector.id, 'id');
      if (!options.create) return this.missing(selector.title);
      itemCreated = true;
      const group = r.group ?? this.groups()[0];
      item = { id: this.newId(), title: selector.title, group, fields: {}, deleted: false, previous: {} };
      this.rows().push(item);
    }
    const previousKept = Object.hasOwn(item.fields, field);
    if (previousKept) (item.previous[field] ??= []).push(item.fields[field]);
    item.fields[field] = value;
    return { ok: true, value: { item: this.summary(item), field, itemCreated, previousKept } };
  }

  async delete(selector: ItemSelector): Promise<Result<ItemSummary>> {
    this.calls.push('delete');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    r.value.deleted = true;
    return { ok: true, value: this.summary(r.value) };
  }

  async restore(selector: ItemSelector): Promise<Result<ItemSummary>> {
    this.calls.push('restore');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, { deleted: true });
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    r.value.deleted = false;
    return { ok: true, value: this.summary(r.value) };
  }

  /** The password last given to setPassword. For tests only; never printed. */
  password?: string;

  async setPassword(password: string): Promise<Result<null>> {
    this.calls.push('setPassword');
    this.password = password;
    return { ok: true, value: null };
  }

  async sync(progress?: (line: string) => void): Promise<Result<SyncReport>> {
    this.calls.push('sync');
    const problem = this.locked();
    if (problem) return problem;
    const report = this.scenario.sync ?? {
      locations: (this.scenario.locations ?? [{ label: 'This computer', path: this.vaultPath, state: 'upToDate' as const }]).map((l) => ({
        label: l.label,
        path: l.path,
        pulled: 0,
        pushed: 0,
      })),
    };
    if (report.locations.length > 1) for (const l of report.locations) progress?.(`Reading ${l.label}`);
    return { ok: true, value: report };
  }

  async verify(): Promise<Result<VerifyReport>> {
    this.calls.push('verify');
    const problem = this.locked();
    if (problem) return problem;
    return { ok: true, value: this.scenario.verify ?? { records: 0, locations: 1, problems: [] } };
  }

  /** What import and export were asked, with no password in it. */
  readonly kdbxRequests: Array<{ kind: 'import' | 'export'; file: string; dryRun: boolean; hasPassword: boolean; keyFile?: string; flags: string[] }> = [];
  /** The password the last import or export was given. For tests only; never printed. */
  kdbxPassword?: string;
  private imported = new Set<string>();
  private written = new Set<string>();

  /** A path as the real service shows it: ./x below the working folder, ~/x below home. */
  private shownPath(p: string): string {
    const cwd = this.options.cwd.replace(/\/+$/, '');
    if (p.startsWith(`${cwd}/`)) return `./${p.slice(cwd.length + 1)}`;
    const home = this.options.home.replace(/\/+$/, '');
    return p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p;
  }

  async importKdbx(request: ImportRequest): Promise<Result<ImportResult>> {
    this.calls.push(request.dryRun ? 'importKdbx:dry' : 'importKdbx');
    const problem = this.locked();
    if (problem) return problem;
    const file = path.resolve(this.options.cwd, request.file);
    const shown = this.shownPath(file);
    this.kdbxPassword = request.credentials.password;
    this.kdbxRequests.push({
      kind: 'import', file, dryRun: request.dryRun, hasPassword: !!request.credentials.password,
      ...(request.credentials.keyFile !== undefined ? { keyFile: request.credentials.keyFile } : {}),
      flags: [request.stripInvalid && 'strip', request.includeTrash && 'trash', request.update && 'update'].filter((f): f is string => typeof f === 'string'),
    });
    const known = this.scenario.kdbxFiles?.[file];
    if (!known) return { ok: false, kind: 'kdbx', why: 'missing', file: shown };
    if (known.problem) return { ok: false, kind: 'kdbx', why: known.problem, file: shown };
    if (known.password !== undefined && known.password !== (request.credentials.password ?? '')) return { ok: false, kind: 'kdbx', why: 'wrongKey', file: shown };
    const items = known.items ?? 0;
    const again = this.imported.has(file);
    if (!request.dryRun) this.imported.add(file);
    const group = this.options.group ?? this.groups()[0];
    return {
      ok: true,
      value: {
        group, dryRun: request.dryRun, added: again ? 0 : items, attachments: again ? 0 : known.attachments ?? 0, updated: 0, unchanged: again ? items : 0, keptYours: 0, changedInFile: 0,
        conflicts: 0, skippedDeleted: 0, skippedGone: 0, skippedTrash: request.includeTrash ? 0 : known.trashed ?? 0, inFolders: known.inFolders ?? 0, refusedItems: 0,
        refusedFields: 0, invalidFields: 0, strippedFields: 0, issues: known.issues ?? [], items: [],
      },
    };
  }

  async exportKdbx(request: ExportRequest): Promise<Result<ExportResult>> {
    this.calls.push(request.dryRun ? 'exportKdbx:dry' : 'exportKdbx');
    const problem = this.locked();
    if (problem) return problem;
    const file = path.resolve(this.options.cwd, request.file);
    this.kdbxPassword = request.credentials.password;
    this.kdbxRequests.push({
      kind: 'export', file, dryRun: request.dryRun, hasPassword: !!request.credentials.password,
      ...(request.credentials.keyFile !== undefined ? { keyFile: request.credentials.keyFile } : {}),
      flags: [request.stripInvalid && 'strip', request.force && 'force'].filter((f): f is string => typeof f === 'string'),
    });
    const e = this.scenario.kdbxExport ?? {};
    if (!request.force && (this.written.has(file) || (e.existing ?? []).includes(file))) return { ok: false, kind: 'kdbx', why: 'exists', file: this.shownPath(file) };
    if (!request.dryRun) this.written.add(file);
    return {
      ok: true,
      value: {
        file, dryRun: request.dryRun, items: e.items ?? this.rows().filter((i) => !i.deleted).length, deleted: e.deleted ?? this.rows().filter((i) => i.deleted).length,
        attachments: e.attachments ?? 0, groups: e.groups ?? this.groups().length, doesNotTravel: e.doesNotTravel ?? [], issues: e.issues ?? [], refusedFields: 0, strippedFields: 0,
      },
    };
  }
}
