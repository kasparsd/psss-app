// Shared helpers for the vector generator modules.
import assert from 'node:assert/strict';
import { hex } from '../src/bytes.ts';
import * as xw from '../src/xwing.ts';
import { mlkem768FromSeed } from '../src/prims.ts';
import { compute } from '../test/compute.ts';
import type { N } from '../test/notation.ts';

export type J = Record<string, any>;
export const H = hex;
export const nat = (n: number | bigint): N => ({ uint: String(n) });

export interface Minted {
  mlkem_ct_wrap: string;
  mlkem_ct_device: string;
  /** a group-key wrap sealed by Python's cryptography 50 */
  external_wrap: string;
  /** the ciphertext of a device slot sealed by Python's cryptography 50 with the slot map as aad */
  external_device_slot_ct: string;
  /** a generic HPKE blob sealed by Python with a non-empty aad (see makeExternalInputs) */
  external_hpke_blob: string;
}

export class Out {
  list: J[] = [];
  names = new Set<string>();
  /** Add a vector. `expected` given by hand is checked against the library; otherwise it is computed. A `heavy` vector needs more
   *  memory than a routine run should use: it is only computed when PSSS_HEAVY is set, and then needs `expected` by hand. */
  add(name: string, description: string, type: string, input: J, expected?: J, opts: { heavy?: string } = {}): J {
    assert(!this.names.has(name), `duplicate vector name ${name}`);
    this.names.add(name);
    let exp = expected;
    if (opts.heavy && !process.env.PSSS_HEAVY) {
      assert(expected, `heavy vector ${name} needs a hand-written expectation`);
    } else {
      const computed = compute(type, input);
      if (expected) assert.deepEqual(computed, expected, `hand-written expectation differs for ${name}`);
      exp = expected ?? computed;
    }
    const v: J = { name, description, type, input, expected: exp };
    if (opts.heavy) v.heavy = opts.heavy;
    this.list.push(v);
    return v;
  }
}
export const file = (description: string, o: Out) => ({ description, vectors: o.list });

export const seed32 = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i + n) & 255);
export function mlkemSs(seed: Uint8Array, ct: Uint8Array): Uint8Array {
  // The ML-KEM-768 shared secret that decapsulation of `ct` yields (generator-side helper only).
  return mlkem768FromSeed(xw.expand(seed).mlkemSeed).decapsulate(ct);
}
export const flipBit = (b: Uint8Array, i: number, bit = 0x01): Uint8Array => { const c = b.slice(); c[i]! ^= bit; return c; };
/** Generation-time check that a tampered input differs from its original (a vector that tampers with nothing proves nothing). */
export function differs(original: Uint8Array, tampered: Uint8Array, what: string): Uint8Array {
  assert(original.length === tampered.length && Buffer.compare(original, tampered) !== 0, `${what}: tampered input equals the original`);
  return tampered;
}
export const E = (code: string, disposition: string) => ({ error: { code, disposition } });

// ---- hand-written expectations: the generator states what must happen in plain words and asserts the library agrees.
import { decode } from '../src/cbor.ts';
import { fromHex } from '../src/bytes.ts';
import type { Rec } from '../src/record.ts';

export const CLEARED = '<cleared>';
/** JSON-friendly view of a decoded CBOR value: bytes as "0x..", maps as objects. */
function plain(v: any): any {
  if (v instanceof Uint8Array) return '0x' + hex(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), plain(x)]));
  if (typeof v === 'bigint') return String(v);
  return v;
}
/** A state summary (the `state` of a vector) as `{ itemName: { deleted, fields: { field: value | CLEARED } } }`. `names` maps item id hex to a name. */
export function stateView(state: J, names: Record<string, string>): J {
  const out: J = {};
  for (const [id, item] of Object.entries<any>(state)) {
    const fields: J = {};
    for (const [f, w] of Object.entries<any>(item.fields)) fields[f] = w.cleared ? CLEARED : plain(decode(fromHex(w.current)));
    out[names[id] ?? id] = { deleted: item.deleted, fields };
  }
  return out;
}
/** History of one field in plain values, oldest first (cleared writes as CLEARED). */
export function historyView(state: J, itemHex: string, field: string): any[] {
  return state[itemHex].fields[field].history.map((h: any) => (h.cleared ? CLEARED : plain(decode(fromHex(h.value)))));
}
export const itemNames = (...pairs: [string, Uint8Array][]): Record<string, string> => Object.fromEntries(pairs.map(([n, id]) => [hex(id), n]));

/** What a reader decided about one record, in words (derived from a `group.evaluate` result). */
export function outcome(v: J, r: Rec): string {
  const id = hex(r.id), e = v.expected;
  if (e.held_back.includes(id)) return 'held_back';
  const w = e.waiting.find((x: J) => x.id === id);
  if (w) return `waits:${w.reason}`;
  if (e.fork_blocked.includes(id)) return 'fork_blocked';
  if (e.checkpoint_mismatches.includes(id)) return 'mismatch';
  if (e.chain.includes(id)) return 'chain';
  if (e.ignored[id]) return `ignored:${e.ignored[id]}`;
  const c = e.content.find((x: J) => x.id === id);
  if (c) return c.status;
  if (e.checkpoints.includes(id)) return 'checkpoint:accepted';
  if (e.rejected_checkpoints.includes(id)) return 'checkpoint:ignored';
  return 'absent';
}
/** Assert that every record in `labels` has the outcome written out by hand in `table`, nothing is left unstated, and (optionally) that the
 *  final state is the one written out in `fields`. */
export function expectGroup(v: J, labels: Record<string, Rec>, table: Record<string, string>, fields?: J, names: Record<string, string> = {}): void {
  assert.deepEqual(Object.keys(table).sort(), Object.keys(labels).sort(), `${v.name}: the hand-written table must name every record`);
  const got = Object.fromEntries(Object.keys(labels).map((k) => [k, outcome(v, labels[k]!)]));
  assert.deepEqual(got, table, `${v.name}: outcomes differ from the hand-written table`);
  if (fields) assert.deepEqual(stateView(v.expected.state, names), fields, `${v.name}: final state differs from the hand-written one`);
}
