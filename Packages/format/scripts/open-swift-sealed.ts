// Opens everything the Swift implementation sealed (build/format-test/sealed-by-swift.json, written by
// scripts/test-format-swift.sh) with the TypeScript reference implementation, and reports per entry whether it opened to
// the expected content. Exit status 1 if any entry did not. Usage: node open-swift-sealed.ts [path-to-json]
// Uses src/ directly, no dependencies. Entry types are those of the vector files, plus `person.derive.partial`, which lists
// only the derived keys (the card is left out because Ed25519 signatures from CryptoKit are randomized): it is handled by
// deriving the person from `ps` and comparing sign_seed, kem_seed, pid and kem_pk.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { encode } from '../src/cbor.ts';
import { fromHex, hex as H } from '../src/bytes.ts';
import { CborError } from '../src/cbor.ts';
import { derivePerson, FormatError, verifyCardBytes } from '../src/keys.ts';
import { keyRing, openRecord } from '../src/record.ts';
import { ed25519Check } from '../src/prims.ts';
import * as hpke from '../src/hpke.ts';
import * as slots from '../src/slots.ts';
import * as xw from '../src/xwing.ts';

type J = Record<string, any>;
const F = fromHex;
const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ?? join(here, '..', '..', '..', 'build', 'format-test', 'sealed-by-swift.json');

const err = (e: unknown): J => {
  if (e instanceof FormatError) return { error: { code: e.code, disposition: e.disposition } };
  if (e instanceof CborError) return { error: { code: e.reason } };
  return { error: { code: 'exception', message: String((e as Error)?.message ?? e) } };
};
const extKeys = (m: Map<unknown, unknown>): string[] => [...m.keys()].filter((k) => typeof k === 'bigint' || (typeof k === 'number' && k >= 128)).map(String);

function run(type: string, i: J): J {
  switch (type) {
    case 'person.derive.partial': {
      const p = derivePerson(F(i.ps));
      return { sign_seed: H(p.signSeed), kem_seed: H(p.kemSeed), pid: H(p.pid), kem_pk: H(p.kemPk) };
    }
    case 'card.verify':
      try { const c = verifyCardBytes(F(i.card)); return { ok: true, pid: H(c.pid) }; } catch (e) { return err(e); }
    case 'signature.verify': return { result: ed25519Check(F(i.pk), F(i.msg), F(i.sig)) ?? 'ok' };
    case 'xwing.keygen': return { pk: H(xw.publicKey(F(i.seed))) };
    case 'xwing.decapsulate': return { ss: H(xw.decapsulate(F(i.seed), F(i.ct))) };
    case 'hpke.open':
      try { return { pt: H(hpke.openBase(F(i.seed), F(i.info), F(i.aad), F(i.blob))) }; } catch (e) { return err(e); }
    case 'record.open':
      try {
        const ring = keyRing((i.keys as J[]).map((k) => [F(k.gid), k.epoch, F(k.key)] as [Uint8Array, number, Uint8Array]));
        const r = openRecord(F(i.sealed), ring);
        return { ok: { epoch: r.epoch, author: H(r.author), device: H(r.device), seq: r.seq, prev: r.prev ? H(r.prev) : null,
                       clock: [r.wall, r.counter], kind: r.kind, mhead: r.mhead ? H(r.mhead) : null, record_id: H(r.id), payload: H(encode(r.payload)),
                       extension_keys: extKeys(r.body), payload_extension_keys: extKeys(r.payload) } };
      } catch (e) { return err(e); }
    case 'wrap.open':
      try { return { key: H(slots.unwrapGroupKey(F(i.gid), i.epoch, F(i.recipient_pid), F(i.recipient_kem_seed), F(i.wrap))) }; } catch (e) { return err(e); }
    case 'wrap.select': {
      const k = slots.selectGroupKey(F(i.gid), i.epoch, F(i.recipient_pid), F(i.recipient_kem_seed), (i.wraps as string[]).map(F), F(i.commit));
      return { key: k ? H(k) : null };
    }
    case 'slot.open': {
      const u = i.unlock;
      const unlock = u.password !== undefined ? { password: u.password as string } : u.kit ? { kit: F(u.kit) } : { deviceKemSeed: F(u.device_kem_seed) };
      try { return { ps: H(slots.openSlot(F(i.slot), unlock, { testOnly: !!i.test_only })) }; } catch (e) { return err(e); }
    }
    case 'kit.text': return { text: slots.kitToText(F(i.kit)) };
    case 'kit.parse': try { return { kit: H(slots.kitFromText(i.text)) }; } catch (e) { return err(e); }
    default: throw new Error(`no handler for entry type ${type}`);
  }
}

/** Every key the entry expects must be equal (the entry may expect only some keys); an `ok: true` marker is not a key of the result. */
function matches(actual: J, expected: J): string | null {
  if (actual.error && !expected.error) return `refused: ${JSON.stringify(actual.error)}`;
  for (const [k, v] of Object.entries(expected)) {
    if (k === 'ok' && v === true) { if (actual.error) return `refused: ${JSON.stringify(actual.error)}`; continue; }
    if (k === 'ok' && v && typeof v === 'object') {
      if (!actual.ok) return `did not open: ${JSON.stringify(actual.error)}`;
      for (const [kk, vv] of Object.entries(v as J)) {
        try { assert.deepEqual(actual.ok[kk], vv); } catch { return `ok.${kk}: got ${JSON.stringify(actual.ok[kk])}, want ${JSON.stringify(vv)}`; }
      }
      continue;
    }
    try { assert.deepEqual(actual[k], v); } catch { return `${k}: got ${JSON.stringify(actual[k])}, want ${JSON.stringify(v)}`; }
  }
  return null;
}

let doc: J;
try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
  console.error(`open-swift-sealed: cannot read ${path}: ${(e as Error).message}`);
  process.exit(2);
}
let failed = 0;
for (const v of doc.vectors as J[]) {
  let problem: string | null;
  try { problem = matches(run(v.type, v.input), v.expected); } catch (e) { problem = `threw: ${(e as Error).message}`; }
  if (problem) failed++;
  console.log(`${problem ? 'FAIL' : 'ok  '} ${v.name} [${v.type}]${problem ? ': ' + problem : ''}`);
}
console.log(`\n${(doc.vectors as J[]).length - failed} of ${(doc.vectors as J[]).length} opened to the expected content${failed ? `, ${failed} did not` : ''}`);
process.exit(failed ? 1 : 0);
