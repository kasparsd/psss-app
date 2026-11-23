// Section 5.1 (folding item changes) and 5.3 (checkpoints restate writes; purged): a pure function from writes to state.
import { cmp as cmpBytes, hex } from './bytes.ts';
import { cmap, encode, type CborValue, type CMap } from './cbor.ts';
import { compareKeys, type OrderKey } from './record.ts';
import { limits, rules } from './limits.ts';

/** A write of one field with its place in the order (5.1). */
export interface Entry { key: OrderKey; value: CborValue; cleared: boolean }
/** item id (hex) -> field -> writes sorted ascending by order key; the last one is current, the rest are history. */
export type State = Map<string, Map<string, Entry[]>>;

/** Anything with an order tuple and a payload can be folded (a Rec, or a bare change in a vector). */
export interface Change { key5: OrderKey; payload: CMap }

const sameKey = (a: OrderKey, b: OrderKey) => compareKeys(a, b) === 0;

function put(state: State, itemHex: string, field: string, e: Entry): void {
  let fields = state.get(itemHex);
  if (!fields) state.set(itemHex, (fields = new Map()));
  let list = fields.get(field);
  if (!list) fields.set(field, (list = []));
  if (list.some((x) => sameKey(x.key, e.key))) return; // a write seen twice (record and checkpoint) is one write
  list.push(e);
  list.sort((a, b) => compareKeys(a.key, b.key));
}

/** 5.1: each record that sets or clears a field is a write of it. */
export function applyChange(state: State, c: Change): void {
  const item = hex(c.payload.get(1) as Uint8Array);
  for (const [name, value] of c.payload.get(2) as CMap) put(state, item, name as string, { key: c.key5, value, cleared: false });
  for (const name of c.payload.get(3) as string[]) put(state, item, name, { key: c.key5, value: null, cleared: true });
}

const clockKey = (ck: CborValue[]): OrderKey => [ck[0] as number, ck[1] as number, ck[2] as Uint8Array, ck[3] as Uint8Array, ck[4] as number];

/** The parts of a checkpoint payload (5.3) that affect state. */
export interface CheckpointWrites { items: CborValue[]; purged: CborValue[]; setId?: Uint8Array; part?: number; parts?: number }
export const checkpointWritesOf = (payload: CMap): CheckpointWrites =>
  ({ items: payload.get(5) as CborValue[], purged: payload.get(6) as CborValue[], setId: payload.get(1) as Uint8Array, part: payload.get(2) as number, parts: payload.get(3) as number });

/** 5.3 Parts: of the checkpoint records given, the part 0 of every set in which every part 0 .. parts-1 is present.
 *  `covered` and `purged` take effect only for these. A record without a set id is a set of one. */
export function completeSets<T extends { setId?: Uint8Array; part?: number; parts?: number }>(cps: T[]): T[] {
  const bySet = new Map<string, T[]>();
  for (const c of cps) {
    const k = c.setId ? hex(c.setId) : `single:${bySet.size}`;
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k)!.push(c);
  }
  const out: T[] = [];
  for (const list of bySet.values()) {
    for (const first of list.filter((c) => (c.part ?? 0) === 0)) {
      const n = first.parts ?? 1;
      let ok = true;
      for (let i = 1; i < n; i++) if (!list.some((c) => c.part === i && c.parts === n)) { ok = false; break; }
      if (ok) out.push(first);
    }
  }
  return out;
}

/** 5.3: a checkpoint's entries are folded exactly as the writes they name. */
function applyCheckpointItems(state: State, items: CborValue[]): void {
  for (const it of items as [Uint8Array, CMap][]) {
    for (const [name, ws] of it[1] as CMap) {
      for (const write of ws as CborValue[][]) {
        if (write[0] === 1) put(state, hex(it[0]), name as string, { key: clockKey(write[1] as CborValue[]), value: write[2]!, cleared: false });
        else put(state, hex(it[0]), name as string, { key: clockKey(write[1] as CborValue[]), value: null, cleared: true });
      }
    }
  }
}

/** 5.3 Permanent delete: writes of the item up to the named place in the order are forgotten. */
function applyPurges(state: State, purged: CborValue[][]): void {
  const upTo = new Map<string, OrderKey>();
  for (const list of purged) for (const p of list as [Uint8Array, CborValue[]][]) {
    const id = hex(p[0]), k = clockKey(p[1]);
    const cur = upTo.get(id);
    if (!cur || compareKeys(k, cur) > 0) upTo.set(id, k);
  }
  for (const [id, k] of upTo) {
    const fields = state.get(id);
    if (!fields) continue;
    for (const [name, list] of [...fields]) {
      const kept = list.filter((e) => compareKeys(e.key, k) > 0);
      if (kept.length) fields.set(name, kept); else fields.delete(name);
    }
    if (fields.size === 0) state.delete(id);
  }
}

/** Fold records' changes (any order) together with any number of accepted checkpoints' writes and purges. */
export function fold(changes: Change[], checkpoints: CheckpointWrites[] = []): State {
  const state: State = new Map();
  for (const c of checkpoints) applyCheckpointItems(state, c.items);
  for (const c of changes) applyChange(state, c);
  applyPurges(state, completeSets(checkpoints).map((c) => c.purged));
  return state;
}

export const current = (list: Entry[]): Entry => list[list.length - 1]!;

/** 5.1 Deleting: Recently Deleted when `deleted` is set and no other field has a winning write strictly later than the
 *  winning write of `deleted`. Clearing `deleted` restores the item. */
export function isDeleted(fields: Map<string, Entry[]>): boolean {
  const d = fields.get('deleted');
  if (!d) return false;
  const cur = current(d);
  if (cur.cleared) return false;
  for (const [name, list] of fields) {
    if (name !== 'deleted' && (rules.deletedStrict ? compareKeys(current(list).key, cur.key) > 0 : compareKeys(current(list).key, cur.key) >= 0)) return false;
  }
  return true;
}

const fromHexLocal = (s: string) => Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16));
export const clockValue = (k: OrderKey): CborValue => [k[0], k[1], k[2], k[3], k[4]];

/** 5.3 `items` of a checkpoint from a state: for each field the winning write and, when `history` is given, that many earlier
 *  writes (the newest ones). A write left out is forgotten once the records it covers are deleted. */
export function checkpointItems(state: State, history = 0): CborValue[] {
  const ids = [...state.keys()].sort();
  return ids.map((id) => {
    const fields = new Map<string, CborValue>();
    for (const [name, list] of state.get(id)!) {
      const kept = list.slice(-(history + 1));
      const enc = kept.map((w) => (w.cleared ? [0, clockValue(w.key)] : [1, clockValue(w.key), w.value]) as CborValue).sort((a, b) => cmpBytes(encode(a), encode(b)));
      fields.set(name, enc);
    }
    return [fromHexLocal(id), fields as CborValue] as CborValue;
  }).sort((a, b) => cmpBytes(encode(a), encode(b)));
}

/** 5.3 payload { 1: set_id, 2: part, 3: parts, 4: covered, 5: items, 6: purged }; `covered` is [author, device, seq, record_id]
 *  per chain, `purged` is [item_id, clock] entries. Both are sorted here by encoding. `set` defaults to a set of one part. */
export function checkpointPayload(items: CborValue[], covered: [Uint8Array, Uint8Array, number, Uint8Array][],
                                  purged: [Uint8Array, OrderKey][] = [], set: { id: Uint8Array; part: number; parts: number } = { id: new Uint8Array(16), part: 0, parts: 1 }): CMap {
  const byEnc = (a: CborValue, b: CborValue) => cmpBytes(encode(a), encode(b));
  const pu = purged.map(([id, k]) => [id, clockValue(k)] as CborValue).sort(byEnc);
  return cmap([[1, set.id], [2, set.part], [3, set.parts], [4, [...covered].sort(byEnc as never) as CborValue], [5, [...items].sort(byEnc)], [6, pu]]);
}

/** A JSON-safe canonical summary of a state, for vectors and comparisons. Values are hex of their CBOR encoding. */
export function summarize(state: State): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of [...state.keys()].sort()) {
    const fields = state.get(id)!;
    const f: Record<string, unknown> = {};
    for (const name of [...fields.keys()].sort()) {
      const list = fields.get(name)!;
      const cur = current(list);
      f[name] = {
        current: cur.cleared ? null : hex(encode(cur.value)),
        cleared: cur.cleared,
        clock: clockJson(cur.key),
        history: list.slice(0, -1).map((e) => ({ value: e.cleared ? null : hex(encode(e.value)), cleared: e.cleared, clock: clockJson(e.key) })),
      };
    }
    out[id] = { deleted: isDeleted(fields), fields: f };
  }
  return out;
}
export const clockJson = (k: OrderKey) => [k[0], k[1], hex(k[2]), hex(k[3]), k[4]];

/** 5.1 (draft 3): a deleted item is removed for good when the purging device's own clock is `purgeAfterMs` (30 days in Psss) past
 *  the time it accepted the delete. The value of `deleted` in the record plays no part. */
export const purgeDue = (acceptedAtMs: number, nowMs: number): boolean => nowMs - acceptedAtMs >= limits.purgeAfterMs;
