// Randomness is injected so that tests are deterministic. The default is the platform's.
import { createHash } from 'node:crypto';

export type Random = (n: number) => Uint8Array;

export const systemRandom: Random = (n) => crypto.getRandomValues(new Uint8Array(n));

/** A deterministic byte stream for tests: SHA-256 of the seed and a counter. Never for real keys. */
export function seededRandom(seed: string): Random {
  let counter = 0;
  let buffer = new Uint8Array(0);
  return (n) => {
    while (buffer.length < n) {
      const block = createHash('sha256').update(`${seed}/${counter++}`).digest();
      const grown = new Uint8Array(buffer.length + block.length);
      grown.set(buffer);
      grown.set(block, buffer.length);
      buffer = grown;
    }
    const out = buffer.slice(0, n);
    buffer = buffer.slice(n);
    return out;
  };
}
