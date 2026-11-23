// Deterministic scenario builder shared by the vector generator and the tests. Not part of the library.
import { cmp, concat, eq, hex, utf8 } from '../src/bytes.ts';
import { cmap, encode, type CborValue, type CMap } from '../src/cbor.ts';
import { commitOf, derivePerson, gidOf, makeCard, type Person } from '../src/keys.ts';
import { KIND, keyRing, openRecord, sealRecord, type Clock, type KeyRing, type Rec } from '../src/record.ts';
import { sha256 } from '../src/prims.ts';

export const BASE_MS = 1_700_000_000_000;
export const bytesOf = (s: string, n = 32): Uint8Array => sha256(utf8(s)).slice(0, n);

export interface SealOpts {
  epoch?: number; clock?: Clock; seq?: number; prev?: Uint8Array | null; salt?: Uint8Array; signer?: Person;
  /** try salts until the record id satisfies this (deterministic search) */
  grind?: (id: Uint8Array) => boolean;
}

export class Scenario {
  persons = new Map<string, Person>();
  keys = new Map<number, Uint8Array>();
  nonce = bytesOf('test genesis nonce');
  creator: string;
  gid: Uint8Array;
  epoch = 0;
  mhead: Uint8Array | null = null;
  step = 0;
  saltN = 0;
  last = new Map<string, { seq: number; id: Uint8Array }>();

  constructor(creator = 'alice') {
    this.creator = creator;
    this.gid = gidOf(this.person(creator).pid, this.nonce);
    this.key(0);
  }
  person(name: string): Person {
    let p = this.persons.get(name);
    if (!p) this.persons.set(name, (p = derivePerson(bytesOf(`test person ${name}`))));
    return p;
  }
  device(name: string): Uint8Array { return bytesOf(`test device ${name}`, 16); }
  key(e: number): Uint8Array {
    let k = this.keys.get(e);
    if (!k) this.keys.set(e, (k = bytesOf(`test group key ${e}`)));
    return k;
  }
  ring(): KeyRing { return keyRing([...this.keys].map(([e, k]) => [this.gid, e, k])); }
  keyList() { return [...this.keys].map(([e, k]) => ({ gid: hex(this.gid), epoch: e, key: hex(k) })); }
  nextSalt(): Uint8Array { return bytesOf(`test salt ${this.saltN++}`); }

  seal(who: string, dev: string, kind: number, payload: CborValue, o: SealOpts = {}): Rec {
    const p = o.signer ? o.signer : this.person(who);
    const author = this.person(who).pid;
    const device = this.device(dev);
    const ck = `${hex(author)}/${hex(device)}`;
    const l = this.last.get(ck);
    const seq = o.seq ?? (l ? l.seq + 1 : 1);
    const prev = o.prev !== undefined ? o.prev : (seq === 1 ? null : l ? l.id : null);
    const clock = o.clock ?? [BASE_MS + 1000 * ++this.step, 0] as Clock;
    const epoch = o.epoch ?? this.epoch;
    const f = { author, device, seq, prev, clock, kind, payload };
    let sealed: Uint8Array;
    let salt = o.salt ?? this.nextSalt();
    for (let i = 0; ; i++) {
      sealed = sealRecord(p, this.gid, epoch, this.key(epoch), salt, f);
      if (!o.grind || o.grind(sha256(sealed))) break;
      if (i > 200000) throw new Error('grind failed');
      salt = this.nextSalt();
    }
    const rec = openRecord(sealed, this.ring());
    this.last.set(ck, { seq, id: rec.id });
    return rec;
  }

  member(r: Rec): Rec { this.mhead = r.id; return r; }
  genesis(dev = 'alice-1', o: SealOpts = {}): Rec {
    const c = this.person(this.creator);
    return this.member(this.seal(this.creator, dev, KIND.genesis,
      cmap([[1, this.nonce], [2, makeCard(c)], [3, commitOf(this.gid, 0, this.key(0))]]), { epoch: 0, ...o }));
  }
  /** kind 2: add (pass a card by naming the person and `asCard`), change a role, or remove (role 0). */
  setRole(by: string, dev: string, name: string, role: number, o: SealOpts & { card?: boolean; cut?: [Uint8Array, number][]; mprev?: Uint8Array } = {}): Rec {
    const p = this.person(name);
    const t: CborValue = o.card ? makeCard(p) : p.pid;
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, t], [3, role]]);
    if (o.cut) m.set(4, sortedByEncoding(o.cut.map((c) => [c[0], c[1]] as CborValue)));
    return this.member(this.seal(by, dev, KIND.member, m, o));
  }
  newEpoch(by: string, dev: string, e: number, o: SealOpts & { mprev?: Uint8Array } = {}): Rec {
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, e], [3, commitOf(this.gid, e, this.key(e))], [4, this.key(e - 1)]]);
    const r = this.member(this.seal(by, dev, KIND.epoch, m, { epoch: e, ...o }));
    this.epoch = e;
    return r;
  }
  replace(by: string, dev: string, oldName: string, newName: string, o: SealOpts & { mprev?: Uint8Array } = {}): Rec {
    const m = cmap([[1, o.mprev ?? this.mhead!], [2, this.person(oldName).pid], [3, makeCard(this.person(newName))]]);
    return this.member(this.seal(by, dev, KIND.replace, m, o));
  }
  item(by: string, dev: string, itemId: Uint8Array, set: [string, CborValue][], clear: string[] = [], o: SealOpts = {}): Rec {
    return this.seal(by, dev, KIND.item, itemPayload(itemId, set, clear), o);
  }
}

export const sortedByEncoding = (xs: CborValue[]): CborValue[] => [...xs].sort((a, b) => cmp(encode(a), encode(b)));

export function itemPayload(itemId: Uint8Array, set: [string, CborValue][], clear: string[]): CMap {
  return cmap([[1, itemId], [2, new Map(set) as CborValue], [3, sortedByEncoding(clear)]]);
}

export const itemId = (n: string) => bytesOf(`test item ${n}`, 16);
export { eq, concat };
