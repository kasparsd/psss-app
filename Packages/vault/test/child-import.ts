// Child process of import.test.ts: waits for the start file, then opens the shared vault and imports a KeePass file. Prints one JSON line.
import { existsSync, readFileSync } from 'node:fs';
import { readKdbx } from '../../kdbx/src/index.ts';
import { openVault } from '../src/index.ts';

const [location, keyFile, stateDir, go, file] = process.argv.slice(2) as [string, string, string, string, string];
while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
try {
  const v = openVault({ locations: [location], unlock: { keyFile }, stateDir, durable: false, lockWaitMs: 60_000 });
  const r = v.importKdbx(readKdbx(new Uint8Array(readFileSync(file)), { password: 'pw' }));
  console.log(JSON.stringify({ ok: true, added: r.added, unchanged: r.unchanged }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exitCode = 1;
}
