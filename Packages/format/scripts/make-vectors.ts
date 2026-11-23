// Generates vectors/*.json deterministically from fixed inputs. Run: node scripts/make-vectors.ts
// No randomness and no clock. The only non-derivable inputs are in scripts/minted.json: two ML-KEM-768 encapsulations (Node cannot
// supply the encapsulation randomness) and three ciphertexts sealed by an independent implementation (Python's cryptography 50).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mlkem768Encapsulate, rememberArgon2 } from '../src/prims.ts';
import * as xw from '../src/xwing.ts';
import { Scenario, bytesOf } from '../test/scenario.ts';
import { checkpointVectors, cborVectors, clockVectors, foldVectors, personVectors, recordVectors } from './vec-core.ts';
import { groupVectors } from './vec-group.ts';
import { schemaVectors } from './vec-schema.ts';
import { chunkVectors, externalInputs, folderVectors, slotVectors, wrapVectors } from './vec-keys.ts';
import { H } from './vec-common.ts';
import type { J, Minted } from './vec-common.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = join(here, '..', 'vectors');
const MINTED_PATH = join(here, 'minted.json');
export type { Minted };

export function buildVectors(minted: Minted): Record<string, J> {
  rememberArgon2(true); // the default-parameter derivation takes about a second: do it once per run (the tests assert this)
  const s = new Scenario();
  return {
    'cbor.json': cborVectors(),
    'person.json': personVectors(s, minted),
    'record.json': recordVectors(s),
    'clock.json': clockVectors(s),
    'fold.json': foldVectors(s),
    'checkpoint.json': checkpointVectors(s),
    'group.json': groupVectors(),
    'slots.json': slotVectors(s, minted),
    'wraps.json': wrapVectors(s, minted),
    'chunks.json': chunkVectors(),
    'folder.json': folderVectors(minted),
    'schema.json': schemaVectors(),
  };
}

export const serialize = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const loadMinted = (): Minted => JSON.parse(readFileSync(MINTED_PATH, 'utf8'));

/** `--mint` regenerates the ML-KEM encapsulations (random). The externally sealed data is made by hand (README, "Minted data"). */
function mint() {
  const s = new Scenario();
  const old: Partial<Minted> = (() => { try { return loadMinted(); } catch { return {}; } })();
  const ct = (pk: Uint8Array) => H(mlkem768Encapsulate(pk.subarray(0, 1184)).ct);
  const next: Minted = {
    mlkem_ct_wrap: ct(s.person('bob').kemPk), mlkem_ct_device: ct(xw.publicKey(bytesOf('device kem seed'))),
    external_wrap: old.external_wrap ?? '', external_device_slot_ct: old.external_device_slot_ct ?? '', external_hpke_blob: old.external_hpke_blob ?? '',
  };
  writeFileSync(MINTED_PATH, JSON.stringify(next, null, 2) + '\n');
}

if (import.meta.main) {
  const arg = (n: string) => process.argv.includes(n);
  if (arg('--mint')) { mint(); console.log('minted'); process.exit(0); }
  if (arg('--external-input')) { const e = externalInputs(new Scenario()); console.log(JSON.stringify({ wrap: e.wrap, device_slot: e.device_slot, generic: e.generic })); process.exit(0); }
  const setAt = process.argv.indexOf('--set-external');
  if (setAt > 0) {
    const sealed = JSON.parse(readFileSync(process.argv[setAt + 1]!, 'utf8')) as Record<string, string>;
    const m = loadMinted();
    m.external_wrap = sealed.wrap!; m.external_device_slot_ct = sealed.device_slot!; m.external_hpke_blob = sealed.generic!;
    writeFileSync(MINTED_PATH, JSON.stringify(m, null, 2) + '\n');
    console.log('external ciphertexts stored');
    process.exit(0);
  }
  const files = buildVectors(loadMinted());
  mkdirSync(VECTOR_DIR, { recursive: true });
  let total = 0;
  for (const [name, f] of Object.entries(files)) {
    writeFileSync(join(VECTOR_DIR, name), serialize(f));
    total += f.vectors.length;
    console.log(`${name}: ${f.vectors.length} vectors`);
  }
  console.log(`total: ${total}`);
}
