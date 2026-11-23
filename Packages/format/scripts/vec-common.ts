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
