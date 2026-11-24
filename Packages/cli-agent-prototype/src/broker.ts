// A stand-in for the Psss app: the only process that holds the vault. It decides what leaves, in which form,
// and asks the person. In the app the question is a sheet confirmed with Touch ID; here it is a function.
//
// Not proven here, because Node cannot do it: who is really on the other end of the socket. The prototype takes
// the caller's word for `requester`. The app reads it from the kernel (see probe/peer.swift).
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { NOT_ALLOWED, VERSION, formatRef, type Listed, type Ref, type Request, type Response, type Use } from './protocol.ts';
import { totp } from './totp.ts';

export type Item = {
  id: string;
  title: string;
  username?: string;
  /** Hosts this item is saved for. A secret is sent only to these. */
  sites: string[];
  /** Secret fields by name: password, token and so on. */
  fields: Record<string, string>;
  /** Verification code secret, base32. */
  totp?: string;
};

export type Candidate = { id: string; title: string; username: string };

/** What the approval sheet shows. */
export type Ask = {
  requester: string;
  use: Use;
  /** The name the caller asked for. It may match nothing. */
  wanted: string;
  /** Items with that name. The person picks one, or another item, or says no. */
  candidates: Candidate[];
  /** Which fields of the item are wanted, by name. */
  fields: string[];
  /** The command line or address, in full. Characters that could hide or reorder text are written out. */
  detail: string;
  /** False when “until Psss locks” is not offered: showing a value, and running a program. */
  canKeep: boolean;
  /** Set when Psss will not do it whatever the person answers; the sheet then has only Close. */
  blocked?: string;
};

export type Answer = { decision: 'deny' } | { decision: 'once' | 'until-lock'; item?: string };
export type Approver = (ask: Ask) => Promise<Answer>;

export type Activity = {
  when: number;
  requester: string;
  item: string;
  use: Use;
  detail: string;
  outcome: 'allowed once' | 'allowed until lock' | 'already allowed' | 'not allowed' | 'refused';
};

/** Control characters, invisible characters and characters that reorder text. None belongs in a name shown on a sheet. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

function plain(text: unknown, longest = 200): text is string {
  return typeof text === 'string' && text.length > 0 && text.length <= longest && !UNSAFE.test(text);
}

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Kept = { requester: string; item: string; use: Use; covers: string };

/** A field the item really has. Never something inherited, such as “constructor”. */
function field(item: Item | null | undefined, name: string): string | undefined {
  if (!item || !Object.hasOwn(item.fields, name)) return undefined;
  const value = item.fields[name];
  return typeof value === 'string' ? value : undefined;
}

function refuse(error: 'locked' | 'not_allowed' | 'refused' | 'bad_request', message: string): Response {
  return { ok: false, error, message };
}

export class Broker {
  items: Item[];
  locked = false;
  activity: Activity[] = [];
  private approver: Approver;
  private now: () => number;
  /** Device-local and in memory only. Never written to the vault, never synced, gone when Psss locks. */
  private grants = new Map<string, Kept>();
  /** Which item the person picked when this caller asked for a name. */
  private picks = new Map<string, string>();
  private made = 0;

  constructor(options: { items: Item[]; approver: Approver; now?: () => number }) {
    this.items = options.items.map((item) => ({ ...item, fields: { ...item.fields }, sites: [...item.sites] }));
    this.approver = options.approver;
    this.now = options.now ?? Date.now;
  }

  lock(): void {
    this.locked = true;
    this.grants.clear();
    this.picks.clear();
  }

  unlock(): void {
    this.locked = false;
  }

  /** What Setup would list: who may use what until Psss locks. */
  kept(): { requester: string; item: string; use: string; covers: string }[] {
    return [...this.grants.values()].map((g) => ({ requester: g.requester, item: this.items.find((i) => i.id === g.item)?.title ?? g.item, use: g.use, covers: g.covers }));
  }

  async handle(request: Request): Promise<Response> {
    if (!request || request.v !== VERSION) return refuse('bad_request', 'This psss command and the Psss app are different versions.');
    if (!plain(request.requester)) return refuse('bad_request', 'Psss could not read this request.');
    if (request.op === 'status') return { ok: true, locked: this.locked };
    if (this.locked) return refuse('locked', 'Psss is locked. Unlock it in the app and try again.');
    switch (request.op) {
      case 'list':
        return { ok: true, items: this.list(request.requester) };
      case 'use':
        return this.use(request);
      case 'save':
        return this.save(request);
      default:
        return refuse('bad_request', 'Psss does not know this request.');
    }
  }

  /** Only what this caller was already allowed to use. Titles and accounts, never values. */
  private list(requester: string): Listed[] {
    const byItem = new Map<string, Set<string>>();
    for (const kept of this.grants.values()) {
      if (kept.requester !== requester || kept.item === '*') continue;
      if (!byItem.has(kept.item)) byItem.set(kept.item, new Set());
      byItem.get(kept.item)!.add(kept.use);
    }
    const listed: Listed[] = [];
    for (const [id, uses] of byItem) {
      const item = this.items.find((i) => i.id === id);
      if (!item) continue;
      listed.push({
        ref: formatRef(item.title, Object.keys(item.fields)[0] ?? 'code'),
        title: item.title,
        username: item.username ?? '',
        sites: [...item.sites],
        fields: [...Object.keys(item.fields), ...(item.totp ? ['code'] : [])],
        uses: [...uses].sort(),
      });
    }
    return listed.sort((a, b) => a.title.localeCompare(b.title));
  }

  private log(entry: Omit<Activity, 'when'>): void {
    this.activity.push({ when: this.now(), ...entry });
  }

  /** Finds the item, asks the person unless they already allowed this, and returns the item or null. */
  private async authorize(q: {
    requester: string;
    use: Use;
    wanted: string;
    fields: string[];
    scope: string;
    detail: string;
    /** What the activity list keeps. Never the arguments or the query: a caller may have typed a secret there. */
    record: string;
    canKeep: boolean;
    blocked?: (item: Item) => string | null;
  }): Promise<Item | null> {
    const pickKey = q.requester + '\n' + q.wanted.toLowerCase();
    const picked = this.items.find((i) => i.id === this.picks.get(pickKey));
    const named = picked
      ? [picked]
      : this.items.filter((i) => i.id === q.wanted || i.title.toLowerCase() === q.wanted.toLowerCase());
    const key = (item: Item) => JSON.stringify([q.requester, item.id, q.use, q.scope]);

    const held = named.find((i) => this.grants.has(key(i)));
    if (held) {
      this.log({ requester: q.requester, item: held.title, use: q.use, detail: q.record, outcome: 'already allowed' });
      return held;
    }

    const reasons = q.blocked ? named.map(q.blocked) : [];
    if (named.length > 0 && reasons.length > 0 && reasons.every((r) => r !== null)) {
      // The person is told, and nothing they answer changes the outcome.
      await this.approver({ requester: q.requester, use: q.use, wanted: q.wanted, candidates: [], fields: q.fields, detail: q.detail, canKeep: false, blocked: reasons[0]! });
      this.log({ requester: q.requester, item: named[0].title, use: q.use, detail: q.record, outcome: 'refused' });
      return null;
    }

    const open = q.blocked ? named.filter((i) => q.blocked!(i) === null) : named;
    const answer = await this.approver({
      requester: q.requester,
      use: q.use,
      wanted: q.wanted,
      candidates: open.map((i) => ({ id: i.id, title: i.title, username: i.username ?? '' })),
      fields: q.fields,
      detail: q.detail,
      canKeep: q.canKeep,
    });
    const chosenId = answer.decision === 'deny' ? undefined : answer.item ?? (open.length === 1 ? open[0].id : undefined);
    const chosen = this.items.find((i) => i.id === chosenId);
    if (!chosen || (q.blocked && q.blocked(chosen) !== null)) {
      this.log({ requester: q.requester, item: chosen?.title ?? q.wanted, use: q.use, detail: q.record, outcome: 'not allowed' });
      return null;
    }
    const keep = answer.decision === 'until-lock' && q.canKeep;
    // The choice between two items of one name is remembered only together with an allowance.
    if (keep) this.picks.set(pickKey, chosen.id);
    if (keep) this.grants.set(key(chosen), { requester: q.requester, item: chosen.id, use: q.use, covers: q.detail });
    this.log({ requester: q.requester, item: chosen.title, use: q.use, detail: q.record, outcome: keep ? 'allowed until lock' : 'allowed once' });
    return chosen;
  }

  private async use(request: Extract<Request, { op: 'use' }>): Promise<Response> {
    const refs: Ref[] = Array.isArray(request.refs) ? request.refs : [];
    if (refs.length === 0 || refs.some((r) => !r || !plain(r.item) || !plain(r.field))) {
      return refuse('bad_request', 'Name what to use, as psss://item/field.');
    }

    if (request.use === 'run') {
      const argv = request.argv;
      if (typeof request.program !== 'string' || !path.isAbsolute(request.program) || /[\u0000-\u001f\u007f]/.test(request.program) || !Array.isArray(argv) || argv[0] !== request.program || argv.some((a) => typeof a !== 'string' || a.includes('\u0000'))) {
        return refuse('bad_request', 'Name the program to run.');
      }
      const detail = argv.map(quote).join(' ');
      // Running a program is never kept. Two independent runs showed why: first “this program” was kept, and git and
      // find were told to start a shell; then “this exact command line” was kept, and the same command line was made
      // to do something else through the environment, the folder it ran in, and files it reads. A sheet can show a
      // command. It cannot show everything a command depends on.
      const values: string[] = [];
      const seen = new Map<string, Item | null>();
      for (const ref of refs) {
        const name = ref.item.toLowerCase();
        if (!seen.has(name)) {
          const fields = [...new Set(refs.filter((r) => r.item.toLowerCase() === name).map((r) => r.field))];
          seen.set(name, await this.authorize({ requester: request.requester, use: 'run', wanted: ref.item, fields, scope: '', detail, record: request.program, canKeep: false }));
        }
        const value = field(seen.get(name), ref.field);
        if (value === undefined) return refuse('not_allowed', NOT_ALLOWED);
        values.push(value);
      }
      return { ok: true, values };
    }

    if (refs.length !== 1) return refuse('bad_request', 'Name one item.');
    const ref = refs[0];

    if (request.use === 'fetch') {
      const target = checkAddress(request.url);
      // These answers depend only on the address the caller typed, so they tell it nothing about the vault.
      if (typeof target === 'string') return refuse('refused', target);
      const method = request.method;
      // The method and the place the secret goes are sent exactly as shown, or not at all.
      if (typeof method !== 'string' || !/^[A-Z]{1,16}$/.test(method)) return refuse('refused', 'Psss does not send that kind of request.');
      const place = request.as;
      if (place !== 'bearer' && place !== 'basic' && !(typeof place === 'string' && /^header:[A-Za-z0-9-]{1,64}$/.test(place))) {
        return refuse('refused', 'Psss cannot put a secret there.');
      }
      const where = place === 'bearer' ? 'as a bearer token' : place === 'basic' ? 'as a user name and password' : `in the header ${place.slice(7)}`;
      // Kept for the request the sheet showed: this field, this method, this address with its port and path, placed
      // this way, with or without a body. The query and the body's contents may differ.
      const record = `${method} ${target.origin}${target.pathname}`;
      const shown = `${record}, ${where}${request.body ? ', with a body' : ''}`;
      const item = await this.authorize({
        requester: request.requester,
        use: 'fetch',
        wanted: ref.item,
        fields: [ref.field],
        scope: JSON.stringify([ref.field, shown]),
        detail: shown,
        record,
        canKeep: true,
        blocked: (candidate) =>
          candidate.sites.includes(target.hostname) ? null : `“${candidate.title}” is saved for ${candidate.sites.join(', ') || 'no website'}, not ${target.hostname}. Psss sends it only where it is saved for.`,
      });
      const value = field(item, ref.field);
      if (!item || value === undefined) return refuse('not_allowed', NOT_ALLOWED);
      return { ok: true, values: [value], username: item.username ?? '' };
    }

    if (request.use === 'code') {
      const item = await this.authorize({ requester: request.requester, use: 'code', wanted: ref.item, fields: ['code'], scope: '', detail: 'A verification code, valid for up to 30 seconds', record: 'A verification code', canKeep: true });
      if (!item?.totp) return refuse('not_allowed', NOT_ALLOWED);
      return { ok: true, code: totp(item.totp, this.now()) };
    }

    if (request.use === 'show') {
      const item = await this.authorize({ requester: request.requester, use: 'show', wanted: ref.item, fields: [ref.field], scope: ref.field, detail: `Show the ${ref.field}`, record: `Shown: ${ref.field}`, canKeep: false });
      const value = field(item, ref.field);
      if (value === undefined) return refuse('not_allowed', NOT_ALLOWED);
      return { ok: true, values: [value] };
    }

    return refuse('bad_request', 'Psss does not know this request.');
  }

  private async save(request: Extract<Request, { op: 'save' }>): Promise<Response> {
    if (typeof request.title !== 'string' || !request.title.trim()) return refuse('bad_request', 'A new item needs a name.');
    if (!request.generate && typeof request.value !== 'string') return refuse('bad_request', 'Give a value, or ask Psss to make a password.');
    if (![request.title, request.field, request.username ?? '-', request.site ?? '-'].every((t) => plain(t))) {
      return refuse('bad_request', 'Names must be plain text of at most 200 characters.');
    }
    const key = JSON.stringify([request.requester, '*', 'save', '']);
    const detail = `New item “${request.title}”` + (request.site ? ` for ${request.site}` : '');
    if (this.grants.has(key)) {
      this.log({ requester: request.requester, item: request.title, use: 'save', detail, outcome: 'already allowed' });
    } else {
      const answer = await this.approver({ requester: request.requester, use: 'save', wanted: request.title, candidates: [], fields: [request.field], detail, canKeep: true });
      if (answer.decision === 'deny') {
        this.log({ requester: request.requester, item: request.title, use: 'save', detail, outcome: 'not allowed' });
        return refuse('not_allowed', NOT_ALLOWED);
      }
      if (answer.decision === 'until-lock') this.grants.set(key, { requester: request.requester, item: '*', use: 'save', covers: 'Adding new items' });
      this.log({ requester: request.requester, item: request.title, use: 'save', detail, outcome: answer.decision === 'until-lock' ? 'allowed until lock' : 'allowed once' });
    }
    let value = request.value ?? '';
    if (request.generate) {
      value = '';
      for (let i = 0; i < 24; i++) value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    this.made += 1;
    this.items.push({ id: `new-${this.made}`, title: request.title, username: request.username, sites: request.site ? [request.site] : [], fields: { [request.field]: value } });
    return { ok: true, ref: formatRef(request.title, request.field) };
  }
}

/** https only, plain http for the name localhost alone, and no sign-in details inside the address. */
export function checkAddress(text: unknown): URL | string {
  let url: URL;
  try {
    url = new URL(String(text));
  } catch {
    return 'That is not a web address.';
  }
  if (url.username || url.password) return 'Psss does not use an address that carries a user name or password.';
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && url.hostname === 'localhost') return url;
  return 'Psss sends a secret only over https.';
}

/** One argument as a person can read it: quoted when it has spaces, and with hidden characters written out. */
function quote(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word;
  if (UNSAFE.test(word)) {
    return JSON.stringify(word).replace(new RegExp(UNSAFE.source, 'g'), (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Serves a broker on a local socket that only this user can open. */
export function listen(broker: Broker, socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buffer = '';
      let chain: Promise<void> = Promise.resolve();
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.on('data', (data) => {
        buffer += data;
        for (let cut = buffer.indexOf('\n'); cut >= 0; cut = buffer.indexOf('\n')) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          chain = chain.then(async () => {
            let response: Response;
            try {
              response = await broker.handle(JSON.parse(line));
            } catch {
              response = refuse('bad_request', 'Psss could not read this request.');
            }
            if (!socket.destroyed) socket.write(JSON.stringify(response) + '\n');
          });
        }
      });
    });
    server.on('error', reject);
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Nothing was there.
    }
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      resolve(server);
    });
  });
}
