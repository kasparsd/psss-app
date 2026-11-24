// Child process of lock.test.ts: waits for the start file, then opens the shared vault and adds one item. Prints one JSON line.
import { existsSync } from 'node:fs';
import { openVault } from '../src/index.ts';

const [location, keyFile, stateDir, go, title] = process.argv.slice(2) as [string, string, string, string, string];
while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
try {
  const v = openVault({ locations: [location], unlock: { keyFile }, stateDir, durable: false, lockWaitMs: 60_000 });
  const r = v.addItem({ title, password: `secret of ${title}` });
  console.log(JSON.stringify({ ok: true, seq: r.write.seq }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
  process.exitCode = 1;
}
