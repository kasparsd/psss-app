// A deterministic in-memory VaultService for tests and for trying the commands before the real library is wired in.
// Holds no crypto and no files. It keeps one flat list of items; ids and the clock are fixed, so output is stable.

import path from 'node:path';
import { nearTitles } from './near.ts';
import { matchesSearch, searchTerm, swiftTrim } from './search.ts';
import type { SearchableItem } from './search.ts';
import { printable } from './text.ts';
import { shellQuote } from './reference.ts';
import type {
  AddOutcome,
  AddRequest,
  EditOutcome,
  FileContent,
  FileList,
  FilePut,
  ItemDetails,
  ItemFields,
  ItemKind,
  PurgeOutcome,
  Candidate,
  ChangeEvent,
  CodeOutcome,
  EarlierValue,
  HistoryOutcome,
  HistoryRequest,
  SearchQuery,
  SearchResult,
  CreateRequest,
  Delivery,
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
  /** The item type of the format: 1 login (default), 2 card (its number is the field `card`), 3 secure note (its text is the field `notes`), 4 custom item. */
  kind?: number;
  /** The field called `code` is an ordinary stored value, not a verification code. Default: it is a verification code. */
  plainCode?: boolean;
  /** Changes of the item, newest first. Default: one `added` change. */
  changes?: ChangeEvent[];
  /** Earlier values per field, newest first. A `set` adds to it. */
  earlier?: Record<string, Array<{ replaced: number; value: string }>>;
  /** Names of the fields that are not protected (shown by `item show`). Every other field is hidden. */
  plain?: string[];
  tags?: string[];
  websites?: string[];
  /** Attachments by name. */
  files?: Record<string, Uint8Array | string>;
  created?: number;
  edited?: number;
  deletedAt?: number;
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
  /** What a write leaves undelivered: reported by `delivery`, and `info` counts it. Default: nothing. */
  delivery?: Delivery;
  /** The clock of the fake: when a `set` says it replaced a value. Default 2026-11-24 12:00 UTC. */
  now?: number;
  /** Seconds the current verification code of every item with a `code` field is still valid. Default 21. */
  codeRemaining?: number;
  /** Titles whose code cannot be made (an unsupported algorithm). */
  codeUnsupported?: string[];
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
  kind: number;
  plainCode: boolean;
  previous: Record<string, string[]>;
  changes: ChangeEvent[];
  earlier: Record<string, Array<{ replaced: number; value: string }>>;
  plain: string[];
  tags: string[];
  websites: string[];
  files: Map<string, Uint8Array>;
  created?: number;
  edited?: number;
  deletedAt?: number;
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
      kind: i.kind ?? 1,
      plainCode: i.plainCode ?? false,
      previous: {},
      changes: i.changes ? i.changes.map((c) => ({ ...c, fields: [...c.fields] })) : [{ at: Date.UTC(2026, 9, 2, 8, 0), kind: 'added' as const, fields: [] }],
      earlier: Object.fromEntries(Object.entries(i.earlier ?? {}).map(([k, v]) => [k, v.map((e) => ({ ...e }))])),
      plain: i.plain ?? [],
      tags: [...(i.tags ?? [])],
      websites: i.websites ?? (i.url !== undefined ? [i.url] : []),
      files: new Map(Object.entries(i.files ?? {}).map(([n, d]) => [n, typeof d === 'string' ? new TextEncoder().encode(d) : d])),
      ...(i.created !== undefined ? { created: i.created } : {}),
      ...(i.edited !== undefined ? { edited: i.edited } : {}),
      ...(i.deletedAt !== undefined ? { deletedAt: i.deletedAt } : {}),
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
    const out: ItemSummary = { id: i.id, title: i.title, group: i.group, fields: Object.keys(i.fields), hasCode: this.hasCode(i), deleted: i.deleted };
    if (i.username !== undefined) out.username = i.username;
    if (i.url !== undefined) out.url = i.url;
    return out;
  }

  private hasCode(i: Row): boolean {
    return Object.hasOwn(i.fields, 'code') && !i.plainCode;
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
        ...(this.scenario.delivery ? { undelivered: this.scenario.delivery.undelivered } : {}),
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

  private searchable(i: Row): SearchableItem {
    return { title: i.title, kind: i.kind, ...(i.username !== undefined ? { username: i.username } : {}), ...(i.url !== undefined ? { url: i.url } : {}), ...(i.fields.notes !== undefined ? { notes: i.fields.notes } : {}), ...(i.fields.card !== undefined ? { cardNumber: i.fields.card } : {}) };
  }

  private clock(): number {
    return this.scenario.now ?? Date.UTC(2026, 10, 24, 12, 0);
  }

  async search(query: SearchQuery): Promise<Result<SearchResult>> {
    this.calls.push('search');
    const problem = this.locked();
    if (problem) return problem;
    const group = query.group ?? this.options.group;
    if (group !== undefined && !this.groups().includes(group)) {
      return { ok: false, kind: 'notFound', what: 'group', name: group, vault: this.vaultName };
    }
    const term = searchTerm(query.text);
    const scoped = this.rows().filter((i) => i.deleted === (query.deleted ?? false) && (group === undefined || i.group === group));
    const items = scoped
      .filter((i) => matchesSearch(this.searchable(i), term))
      .map((i) => this.summary(i))
      .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
    const hints = items.length === 0 ? nearTitles(swiftTrim(query.text), scoped.map((i) => i.title)) : [];
    return { ok: true, value: { items, hints } };
  }

  async history(selector: ItemSelector, request: HistoryRequest): Promise<Result<HistoryOutcome>> {
    this.calls.push('history');
    const problem = this.locked();
    if (problem) return problem;
    let r = this.resolve(selector, {});
    if (r.ok && r.value === null) {
      const again = this.resolve(selector, { deleted: true });
      if (again.ok && again.value !== null) r = again;
    }
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const item = r.value;
    if (request.field === undefined) return { ok: true, value: { mode: 'item', item: this.summary(item), changes: item.changes.map((c) => ({ ...c, fields: [...c.fields] })) } };
    const key = Object.keys(item.fields).find((k) => k.toLowerCase() === request.field!.toLowerCase());
    const named = ['username', 'url'].includes(request.field.toLowerCase()) ? request.field.toLowerCase() : key;
    if (named === undefined) return { ok: false, kind: 'notFound', what: 'field', name: request.field, vault: this.vaultName, item: item.title, fields: Object.keys(item.fields) };
    if (named.toLowerCase() === 'code' && this.hasCode(item)) return { ok: true, value: { mode: 'field', item: this.summary(item), field: 'code', earlier: [], computed: true } };
    const earlier: EarlierValue[] = (item.earlier[named] ?? []).map((e) => ({ replaced: e.replaced, ...(request.show === true ? { value: e.value } : {}) }));
    return { ok: true, value: { mode: 'field', item: this.summary(item), field: named, earlier } };
  }

  async code(selector: ItemSelector): Promise<Result<CodeOutcome>> {
    this.calls.push('code');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const item = r.value;
    if (this.hasCode(item) && (this.scenario.codeUnsupported ?? []).includes(item.title)) {
      return { ok: false, kind: 'failed', message: `The verification code of "${printable(item.title)}" cannot be made: its setup key asks for an algorithm Psss does not support (7).` };
    }
    if (!this.hasCode(item)) return { ok: false, kind: 'notFound', what: 'field', name: 'code', vault: this.vaultName, item: item.title, fields: Object.keys(item.fields) };
    return { ok: true, value: { item: this.summary(item), code: item.fields.code, period: 30, remaining: this.scenario.codeRemaining ?? 21 } };
  }

  async set(selector: ItemSelector, field: string, value: string, options: { create: boolean; onlyIfEmpty?: boolean }): Promise<Result<SetOutcome>> {
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
      item = { ...this.blank(selector.title, group), changes: [{ at: this.clock(), kind: 'added', fields: [field] }] };
      this.rows().push(item);
    }
    if (!itemCreated && options.onlyIfEmpty && Object.hasOwn(item.fields, field)) return { ok: true, value: { item: this.summary(item), field, itemCreated: false, previousKept: false, refusedExisting: true } };
    // the item already holds this value: nothing is written
    if (!itemCreated && Object.hasOwn(item.fields, field) && item.fields[field] === value) return { ok: true, value: { item: this.summary(item), field, itemCreated: false, previousKept: false, unchanged: true } };
    const previousKept = Object.hasOwn(item.fields, field);
    if (previousKept) {
      (item.previous[field] ??= []).push(item.fields[field]);
      (item.earlier[field] ??= []).unshift({ replaced: this.clock(), value: item.fields[field] });
    }
    if (!itemCreated) item.changes.unshift({ at: this.clock(), kind: 'changed', fields: [field] });
    item.fields[field] = value;
    return { ok: true, value: { item: this.summary(item), field, itemCreated, previousKept } };
  }

  private blank(title: string, group: string, kind = 1): Row {
    return { id: this.newId(), title, group, fields: {}, deleted: false, kind, plainCode: false, previous: {}, changes: [{ at: this.clock(), kind: 'added', fields: [] }], earlier: {}, plain: [], tags: [], websites: [], files: new Map(), created: this.clock() };
  }

  async show(selector: ItemSelector, scope: { deleted?: boolean } = {}): Promise<Result<ItemDetails>> {
    this.calls.push('show');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, scope);
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const i = r.value;
    const fields: ItemDetails['fields'] = [];
    if (i.username !== undefined) fields.push({ name: 'username', hidden: false, value: i.username });
    for (const [name, value] of Object.entries(i.fields)) {
      if (name === 'card') {
        const digits = value.replace(/\D/g, '');
        fields.push({ name, hidden: true, ...(i.kind === 2 && digits.length >= 12 ? { detail: `ends in ${digits.slice(-4)}` } : {}) });
      } else if (name === 'notes') {
        const n = value === '' ? 0 : value.split(/\r\n|\r|\n/).length;
        fields.push({ name, hidden: true, detail: n === 1 ? '1 line' : `${n} lines` });
      } else if (i.plain.includes(name)) fields.push({ name, hidden: false, value });
      else fields.push({ name, hidden: true });
    }
    const kinds: ItemKind[] = ['login', 'card', 'note', 'custom'];
    const out: ItemDetails = { item: this.summary(i), kind: kinds[i.kind - 1] ?? 'custom', websites: [...i.websites], tags: [...i.tags], fields, files: [...i.files].map(([name, d]) => ({ name, size: d.length })), hasCode: this.hasCode(i) };
    if (i.created !== undefined) out.created = i.created;
    if (i.edited !== undefined) out.edited = i.edited;
    if (i.deletedAt !== undefined) out.deletedAt = i.deletedAt;
    return { ok: true, value: out };
  }

  private apply(i: Row, f: ItemFields, changed: string[]): void {
    const put = (name: string, value: string | undefined, hidden: boolean) => {
      if (value === undefined || i.fields[name] === value) return;
      if (Object.hasOwn(i.fields, name)) (i.earlier[name] ??= []).unshift({ replaced: this.clock(), value: i.fields[name] });
      i.fields[name] = value;
      if (!hidden && !i.plain.includes(name)) i.plain.push(name);
      changed.push(name);
    };
    if (f.title !== undefined && f.title !== i.title) { i.title = f.title; changed.push('title'); }
    if (f.username !== undefined && f.username !== i.username) { i.username = f.username; changed.push('username'); }
    put('password', f.password, true);
    if (f.notes !== undefined) put('notes', f.notes, true);
    put('cardholder', f.cardholder, false);
    put('card', f.cardNumber, true);
    if (f.expiry) put('expiry', `${String(f.expiry.month).padStart(2, '0')}/${f.expiry.year}`, false);
    put('card_code', f.cardCode, true);
    put('card_pin', f.cardPin, true);
    put('Valid from', f.validFrom, false);
    put('Card issuer', f.issuer, false);
    if (f.websites !== undefined && JSON.stringify(f.websites) !== JSON.stringify(i.websites)) { i.websites = [...f.websites]; i.url = f.websites[0]; changed.push('url'); }
    for (const c of f.custom ?? []) {
      if (c.value === null) { delete i.fields[c.label]; changed.push(c.label); } else put(c.label, c.value, c.concealed);
    }
    const add = (f.addTags ?? []).filter((t) => !i.tags.includes(t)), rem = (f.removeTags ?? []).filter((t) => i.tags.includes(t));
    if (add.length > 0 || rem.length > 0) { i.tags = [...i.tags.filter((t) => !rem.includes(t)), ...add]; changed.push('tags'); }
  }

  async add(request: AddRequest, options: { dryRun?: boolean } = {}): Promise<Result<AddOutcome>> {
    this.calls.push('add');
    const problem = this.locked();
    if (problem) return problem;
    const group = this.options.group ?? this.groups()[0];
    if (!this.groups().includes(group)) return { ok: false, kind: 'notFound', what: 'group', name: group, vault: this.vaultName };
    const row = this.blank(request.title ?? '', group, { login: 1, card: 2, note: 3, custom: 4 }[request.kind]);
    this.apply(row, request, []);
    row.changes = [{ at: this.clock(), kind: 'added', fields: [] }];
    if (!options.dryRun) this.rows().push(row);
    return { ok: true, value: { item: this.summary(row), kind: request.kind } };
  }

  async edit(selector: ItemSelector, f: ItemFields): Promise<Result<EditOutcome>> {
    this.calls.push('edit');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const own = new Set(['password', 'notes', 'card', 'card_code', 'card_pin', 'cardholder', 'expiry', 'code']);
    for (const c of f.custom ?? []) {
      if (c.value !== null && !c.concealed && Object.hasOwn(r.value.fields, c.label) && !own.has(c.label) && !r.value.plain.includes(c.label)) {
        return { ok: false, kind: 'failed', message: `"${printable(c.label)}" is a hidden field, so its value is not taken as an argument, and it stays hidden.\nTo change it, read the new value from standard input with: --secret ${shellQuote(c.label)}\nNothing was changed.` };
      }
      if (c.value === null && !Object.hasOwn(r.value.fields, c.label)) return { ok: false, kind: 'notFound', what: 'field', name: c.label, vault: this.vaultName, item: r.value.title, fields: Object.keys(r.value.fields) };
    }
    const changed: string[] = [];
    this.apply(r.value, f, changed);
    if (changed.length > 0) { r.value.changes.unshift({ at: this.clock(), kind: 'changed', fields: [...changed] }); r.value.edited = this.clock(); }
    return { ok: true, value: { item: this.summary(r.value), changed } };
  }

  async purge(selector: ItemSelector, options: { dryRun: boolean }): Promise<Result<PurgeOutcome>> {
    this.calls.push('purge');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, { deleted: true });
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const out: PurgeOutcome = { item: this.summary(r.value), files: r.value.files.size, dryRun: options.dryRun, ...(r.value.deletedAt !== undefined ? { deletedAt: r.value.deletedAt } : {}) };
    if (!options.dryRun) this.items = this.items.filter((i) => i !== r.value);
    return { ok: true, value: out };
  }

  async vaultPlaceOf(file: string): Promise<Result<string | null>> {
    this.calls.push('vaultPlaceOf');
    const rel = path.relative(this.vaultPath, path.resolve(this.options.cwd, file));
    return { ok: true, value: rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? this.vaultPath : null };
  }

  async files(selector: ItemSelector, scope: { deleted?: boolean } = {}): Promise<Result<FileList>> {
    this.calls.push('files');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, scope);
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    return { ok: true, value: { item: this.summary(r.value), files: [...r.value.files].map(([name, d]) => ({ name, size: d.length })) } };
  }

  async readFile(selector: ItemSelector, name: string, scope: { deleted?: boolean } = {}): Promise<Result<FileContent>> {
    this.calls.push('readFile');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, scope);
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const key = [...r.value.files.keys()].find((k) => k === name) ?? [...r.value.files.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
    if (key === undefined) return { ok: false, kind: 'notFound', what: 'file', name, vault: this.vaultName, item: r.value.title, fields: [...r.value.files.keys()] };
    return { ok: true, value: { item: this.summary(r.value), name: key, data: r.value.files.get(key)! } };
  }

  async putFile(selector: ItemSelector, name: string, data: Uint8Array, options: { replace: boolean }): Promise<Result<FilePut>> {
    this.calls.push('putFile');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    const replaced = r.value.files.has(name);
    if (replaced && !options.replace) return { ok: false, kind: 'failed', message: `"${printable(r.value.title)}" already has a file called "${printable(name)}". Nothing was changed.\nTo replace it, add --force.` };
    r.value.files.set(name, data);
    r.value.changes.unshift({ at: this.clock(), kind: 'changed', fields: ['attachments'] });
    return { ok: true, value: { item: this.summary(r.value), name, size: data.length, replaced } };
  }

  async delete(selector: ItemSelector): Promise<Result<ItemSummary>> {
    this.calls.push('delete');
    const problem = this.locked();
    if (problem) return problem;
    const r = this.resolve(selector, {});
    if (!r.ok) return r;
    if (r.value === null) return this.missing('title' in selector ? selector.title : selector.id, 'title' in selector ? 'title' : 'id');
    r.value.deleted = true;
    r.value.deletedAt = this.clock();
    r.value.changes.unshift({ at: this.clock(), kind: 'deleted', fields: [] });
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
    r.value.changes.unshift({ at: this.clock(), kind: 'restored', fields: [] });
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

  async delivery(): Promise<Result<Delivery>> {
    this.calls.push('delivery');
    return { ok: true, value: this.scenario.delivery ?? { undelivered: 0, locations: [] } };
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
