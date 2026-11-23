// Section 5.1 (folding item changes), 5.3 (checkpoints): a pure function from accepted records to state.
import { cmp as cmpBytes, eq, hex } from './bytes.ts';
import { cmap, encode, type CborValue, type CMap } from './cbor.ts';
import { compareKeys, type OrderKey } from './record.ts';

export interface Entry { key: OrderKey; value: CborValue; cleared: boolean }
/** item id (hex) -> field -> entries sorted ascending by order key; the last one is current, the rest are history. */
export type State = Map<string, Map<string, Entry[]>>;

/** Anything with an order tuple and a payload can be folded (a Rec, or a bare change in a vector). */
export interface Change { key5: OrderKey; payload: CMap }

const sameKey = (a: OrderKey, b: OrderKey) => compareKeys(a, b) === 0;

function put(state: State, itemHex: string, field: string, e: Entry): void {
  let fields = state.get(itemHex);
  if (!fields) state.set(itemHex, (fields = new Map()));
  let list = fields.get(field);
  if (!list) fields.set(field, (list = []));
  if (list.some((x) => sameKey(x.key, e.key))) return; // folding a record twice changes nothing
  list.push(e);
  list.sort((a, b) => compareKeys(a.key, b.key));
}

/** 5.1: apply one item change. */
export function applyChange(state: State, c: Change): void {
  const item = hex(c.payload.get(1) as Uint8Array);
  for (const [name, value] of c.payload.get(2) as CMap) put(state, item, name as string, { key: c.key5, value, cleared: false });
  for (const name of c.payload.get(3) as string[]) put(state, item, name, { key: c.key5, value: null, cleared: true });
}

/** 5.3: load a checkpoint's items. A null value is read as "cleared" (the spec's only distinction; see findings). */
export function applyCheckpointItems(state: State, items: CborValue[]): void {
  for (const it of items as [Uint8Array, CMap][]) {
    for (const [name, e] of it[1] as CMap) {
      const [value, ck] = e as [CborValue, [number, number, Uint8Array, Uint8Array, number]];
      put(state, hex(it[0]), name as string, { key: [ck[0], ck[1], ck[2], ck[3], ck[4]], value, cleared: value === null });
    }
  }
}

/** Fold changes (any order) on top of zero or more checkpoints' items. */
export function fold(changes: Change[], checkpointItems: CborValue[][] = []): State {
  const state: State = new Map();
  for (const items of checkpointItems) applyCheckpointItems(state, items);
  for (const c of changes) applyChange(state, c);
  return state;
}

export const current = (list: Entry[]): Entry => list[list.length - 1]!;

/** 5.1 Deleting: Recently Deleted when `deleted` is set and no other field was set or cleared later in the order. */
export function isDeleted(fields: Map<string, Entry[]>): boolean {
  const d = fields.get('deleted');
  if (!d) return false;
  const cur = current(d);
  if (cur.cleared) return false;
  for (const [name, list] of fields) {
    if (name !== 'deleted' && compareKeys(current(list).key, cur.key) > 0) return false;
  }
  return true;
}

/** 5.3: a checkpoint's `items` from a state: the winner of every field with its clock (null = cleared). */
export function checkpointItems(state: State): CborValue[] {
  const ids = [...state.keys()].sort();
  return ids.map((id) => {
    const fields = new Map<string, CborValue>();
    for (const [name, list] of state.get(id)!) {
      const w = current(list);
      fields.set(name, [w.cleared ? null : w.value, [w.key[0], w.key[1], w.key[2], w.key[3], w.key[4]]]);
    }
    return [fromHexLocal(id), fields as CborValue] as CborValue;
  });
}
function fromHexLocal(s: string): Uint8Array {
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return o;
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
        clock: clockJson(cur.key),
        history: list.slice(0, -1).map((e) => ({ value: e.cleared ? null : hex(encode(e.value)), clock: clockJson(e.key) })),
      };
    }
    out[id] = { deleted: isDeleted(fields), fields: f };
  }
  return out;
}
/** 5.3 checkpoint payload { 1: covered, 2: mhead, 3: items }; covered is [author, device, seq, record_id] per chain. */
export function checkpointPayload(items: CborValue[], covered: [Uint8Array, Uint8Array, number, Uint8Array][], mhead: Uint8Array): CMap {
  const sorted = [...covered].sort((a, b) => cmpBytes(encode(a as CborValue), encode(b as CborValue)));
  return cmap([[1, sorted as CborValue], [2, mhead], [3, items]]);
}
export const clockJson = (k: OrderKey) => [k[0], k[1], hex(k[2]), hex(k[3]), k[4]];
export { eq, cmap };
