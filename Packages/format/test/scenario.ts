// Deterministic scenario builder shared by the vector generator and the tests. Not part of the library.
import { cmp, concat, eq, hex, utf8 } from '../src/bytes.ts';
import { cmap, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { commitOf, derivePerson, gidOf, makeCard, type Person } from '../src/keys.ts';
import { KIND, isContentKind, keyRing, openRecord, sealRecord, type Clock, type KeyRing, type Rec } from '../src/record.ts';
import { sha256 } from '../src/prims.ts';
import { checkpointPayload } from '../src/fold.ts';
import type { OrderKey } from '../src/record.ts';

export const BASE_MS = 1_700_000_000_000;
export const bytesOf = (s: string, n = 32): Uint8Array => sha256(utf8(s)).slice(0, n);

export interface SealOpts {
  epoch?: number; clock?: Clock; seq?: number; prev?: Uint8Array | null; signer?: Person;
  /** a salt that is not the derived one (negative vectors only: a reader rejects the record, 4.1) */
  salt?: Uint8Array;
  /** extension keys (section 2) in the body */
  extensions?: [number | bigint, CborValue][];
  /** key 10 of a content record; defaults to the newest membership record the scenario has made. `null` leaves it out. */
  mhead?: Uint8Array | null;
  /** seal under this key instead of the epoch's key (a second key for one epoch number after a fork) */
  key?: Uint8Array;
}

export class Scenario {
  persons = new Map<string, Person>();
  keys = new Map<number, Uint8Array>();
  /** keys sealed under that are not the primary key of their epoch */
  alt: [number, Uint8Array][] = [];
  nonce = bytesOf('test genesis nonce');
  creator: string;
  gid: Uint8Array;
  epoch = 0;
  mhead: Uint8Array | null = null;
  step = 0;
  last = new Map<string, { seq: number; id: Uint8Array }>();

  minReader = 1;
  constructor(creator = 'alice') {
    this.creator = creator;
    this.gid = gidOf(this.person(creator).pid, this.nonce, this.key(0), this.minReader);
  }
  person(name: string): Person {
    let p = this.persons.get(name);
    if (!p) this.persons.set(name, (p = derivePerson(bytesOf(`test person ${name}`))));
    return p;
  }
  device(name: string): Uint8Array { return bytesOf(`test device ${name}`, 16); }
  key(e: number, variant = ''): Uint8Array {
    if (variant) return bytesOf(`test group key ${e} ${variant}`);
    let k = this.keys.get(e);
    if (!k) this.keys.set(e, (k = bytesOf(`test group key ${e}`)));
    return k;
  }
  ring(): KeyRing { return keyRing([...this.keys, ...this.alt].map(([e, k]) => [this.gid, e, k])); }
  keyList() { return [...this.keys, ...this.alt].map(([e, k]) => ({ gid: hex(this.gid), epoch: e, key: hex(k) })); }
  /** pids in the order the fork rule compares them */
  pidOrder(...names: string[]): string[] { return [...names].sort((a, b) => cmp(this.person(a).pid, this.person(b).pid)); }

  seal(who: string, dev: string, kind: number, payload: CborValue, o: SealOpts = {}): Rec {
    const b = this.build(who, dev, kind, payload, o);
    const rec = openRecord(b.sealed, this.ring());
    this.last.set(b.ck, { seq: b.seq, id: rec.id });
    return rec;
  }
  /** Seal without opening or remembering: for records a reader must refuse. */
  raw(who: string, dev: string, kind: number, payload: CborValue, o: SealOpts = {}): Uint8Array { return this.build(who, dev, kind, payload, o).sealed; }

  private build(who: string, dev: string, kind: number, payload: CborValue, o: SealOpts): { sealed: Uint8Array; ck: string; seq: number } {
    const p = o.signer ? o.signer : this.person(who);
    const author = this.person(who).pid;
    const device = this.device(dev);
    const ck = `${hex(author)}/${hex(device)}`;
    const l = this.last.get(ck);
    const seq = o.seq ?? (l ? l.seq + 1 : 1);
    const prev = o.prev !== undefined ? o.prev : (seq === 1 ? null : l ? l.id : null);
    const clock = o.clock ?? [BASE_MS + 1000 * ++this.step, 0] as Clock;
    const epoch = o.epoch ?? this.epoch;
    const mhead = isContentKind(kind) ? (o.mhead === undefined ? this.mhead : o.mhead) : null;
    const f = { author, device, seq, prev, clock, kind, payload, ...(mhead ? { mhead } : {}), ...(o.extensions ? { extensions: o.extensions } : {}) };
    const key = o.key ?? this.key(epoch);
    if (o.key && !eq(o.key, this.key(epoch)) && !this.alt.some(([e, k]) => e === epoch && eq(k, o.key!))) this.alt.push([epoch, o.key]);
    return { sealed: sealRecord(p, this.gid, epoch, key, f, o.salt ? { salt: o.salt } : {}), ck, seq };
  }

  member(r: Rec): Rec { this.mhead = r.id; return r; }
  genesis(dev = 'alice-1', o: SealOpts & { minReader?: number } = {}): Rec {
    const c = this.person(this.creator);
    if (o.minReader !== undefined && o.minReader !== this.minReader) { this.minReader = o.minReader; this.gid = gidOf(c.pid, this.nonce, this.key(0), this.minReader); }
    return this.member(this.seal(this.creator, dev, KIND.genesis,
      cmap([[1, this.nonce], [2, makeCard(c)], [3, commitOf(this.gid, 0, this.key(0))], [4, this.minReader]]), { epoch: 0, ...o }));
  }
  /** kind 2: add (pass a card by naming the person and `card`), change a role, or remove (role 0). */
  setRole(by: string, dev: string, name: string, role: number, o: SealOpts & { card?: boolean; cut?: [Uint8Array, number][]; mprev?: Uint8Array } = {}): Rec {
    const p = this.person(name);
    const t: CborValue = o.card ? makeCard(p) : p.pid;
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, t], [3, role]]);
    if (o.cut) m.set(4, sortedByEncoding(o.cut.map((c) => [c[0], c[1]] as CborValue)));
    return this.member(this.seal(by, dev, KIND.member, m, o));
  }
  /** kind 3. `variant` makes a different key for the same epoch number (a fork). `prevKey` overrides K_(e-1) (negative vectors). */
  newEpoch(by: string, dev: string, e: number, o: SealOpts & { mprev?: Uint8Array; variant?: string; prevKey?: Uint8Array; commitKey?: Uint8Array } = {}): Rec {
    const k = this.key(e, o.variant);
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, e], [3, commitOf(this.gid, e, o.commitKey ?? k)], [4, o.prevKey ?? this.key(e - 1)]]);
    const r = this.member(this.seal(by, dev, KIND.epoch, m, { epoch: e, key: k, ...o }));
    this.epoch = e;
    return r;
  }
  /** kind 5: remove a person, starting epoch `e` in the same record, sealed under K_e (6.4). */
  remove(by: string, dev: string, name: string, e: number, o: SealOpts & { mprev?: Uint8Array; cut?: [Uint8Array, number][]; variant?: string; prevKey?: Uint8Array; commitKey?: Uint8Array } = {}): Rec {
    const k = this.key(e, o.variant);
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, this.person(name).pid], [3, sortedByEncoding((o.cut ?? []).map((c) => [c[0], c[1]] as CborValue))],
                    [4, e], [5, commitOf(this.gid, e, o.commitKey ?? k)], [6, o.prevKey ?? this.key(e - 1)]]);
    const r = this.member(this.seal(by, dev, KIND.remove, m, { epoch: e, key: k, ...o }));
    this.epoch = e;
    return r;
  }
  /** kind 4: replace a person's secret, starting epoch `e` in the same record (6.4). */
  replace(by: string, dev: string, oldName: string, newName: string, e: number, o: SealOpts & { mprev?: Uint8Array; cut?: [Uint8Array, number][]; variant?: string; prevKey?: Uint8Array; commitKey?: Uint8Array; signer?: Person } = {}): Rec {
    const k = this.key(e, o.variant);
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, this.person(oldName).pid], [3, makeCard(this.person(newName))],
                    [4, sortedByEncoding((o.cut ?? []).map((c) => [c[0], c[1]] as CborValue))], [5, e], [6, commitOf(this.gid, e, o.commitKey ?? k)], [7, o.prevKey ?? this.key(e - 1)]]);
    const r = this.member(this.seal(by, dev, KIND.replace, m, { epoch: e, key: k, ...o }));
    this.epoch = e;
    return r;
  }
  item(by: string, dev: string, itemId: Uint8Array, set: [string, CborValue][], clear: string[] = [], o: SealOpts = {}): Rec {
    return this.seal(by, dev, KIND.item, itemPayload(itemId, set, clear), o);
  }
  /** kind 32. `covered` is [person, device name, record] per chain. `set` makes it one part of several (5.3). */
  checkpoint(by: string, dev: string, items: CborValue[], covered: [string, string, Rec][], purged: [Uint8Array, OrderKey][] = [],
             o: SealOpts & { set?: { id: Uint8Array; part: number; parts: number } } = {}): Rec {
    const cov = covered.map(([who, d, r]) => [this.person(who).pid, this.device(d), r.seq, r.id] as [Uint8Array, Uint8Array, number, Uint8Array]);
    return this.seal(by, dev, KIND.checkpoint, checkpointPayload(items, cov, purged, o.set), o);
  }
  /** kind 33: a purge request for items (5.4). */
  purge(by: string, dev: string, ids: Uint8Array[], o: SealOpts = {}): Rec {
    return this.seal(by, dev, KIND.purge, cmap([[1, sortedByEncoding([...ids])]]), o);
  }
}

export const sortedByEncoding = (xs: CborValue[]): CborValue[] => [...xs].sort((a, b) => cmp(encode(a), encode(b)));

export function itemPayload(itemId: Uint8Array, set: [string, CborValue][], clear: string[]): CMap {
  return cmap([[1, itemId], [2, new Map(set) as CborValue], [3, sortedByEncoding(clear)]]);
}

export const itemId = (n: string) => bytesOf(`test item ${n}`, 16);
export { eq, concat };
