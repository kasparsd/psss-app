// Replaces a secret in a stream of output, also when it arrives split across chunks.
// This catches accidents (a program that logs its token). It is not a boundary: a program that prints the secret
// reversed, encoded or one character per line walks straight past it. See test/agent.test.ts, “masking is not a boundary”.

export const HIDDEN = '[hidden by Psss]';

/** Shorter values are not masked: replacing every “1234” would wreck the output and mark where the value is. */
export const SHORTEST_MASKED = 6;

export type Masker = { push(chunk: Buffer): Buffer; end(): Buffer };

export function masker(secrets: string[], replacement = HIDDEN): Masker {
  const needles = [...new Set(secrets)]
    .filter((s) => Buffer.byteLength(s) >= SHORTEST_MASKED)
    .map((s) => Buffer.from(s, 'utf8'))
    .sort((a, b) => b.length - a.length);
  const hold = needles.length ? needles[0].length - 1 : 0;
  const mark = Buffer.from(replacement, 'utf8');
  let pending: Buffer = Buffer.alloc(0);

  function earliest(from: number): { at: number; length: number } | null {
    let best: { at: number; length: number } | null = null;
    for (const needle of needles) {
      const at = pending.indexOf(needle, from);
      // Needles are sorted longest first, so on a tie the longer one is kept.
      if (at >= 0 && (best === null || at < best.at)) best = { at, length: needle.length };
    }
    return best;
  }

  return {
    push(chunk: Buffer): Buffer {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const out: Buffer[] = [];
      let pos = 0;
      for (let hit = earliest(pos); hit; hit = earliest(pos)) {
        out.push(pending.subarray(pos, hit.at), mark);
        pos = hit.at + hit.length;
      }
      // The tail could be the start of a secret that the next chunk completes, so it waits.
      const rest = pending.subarray(pos);
      const keep = Math.min(hold, rest.length);
      out.push(rest.subarray(0, rest.length - keep));
      pending = Buffer.from(rest.subarray(rest.length - keep));
      return Buffer.concat(out);
    },
    end(): Buffer {
      const rest = pending;
      pending = Buffer.alloc(0);
      return rest;
    },
  };
}

/** Masks a whole buffer at once. */
export function maskAll(data: Buffer, secrets: string[]): Buffer {
  const m = masker(secrets);
  return Buffer.concat([m.push(data), m.end()]);
}
