// Child process of lock.test.ts: takes the state lock, says so, holds it for a while, releases it.
import { withLock } from '../src/index.ts';

const [stateDir, ms] = process.argv.slice(2) as [string, string];
withLock(stateDir, () => {
  console.log('held');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
});
