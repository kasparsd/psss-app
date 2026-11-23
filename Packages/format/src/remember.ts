// Section 4.4 "Remembering": for each chain and each location a device keeps the seq and record_id of the last record it accepted
// there, and reports a rollback when the location later offers less, or a different record at a seq already accepted.
import { eq, hex } from './bytes.ts';

/** What a device remembers about one location: chain ("author/device", hex) -> last accepted seq and record_id. */
export type Remembered = Map<string, { seq: number; id: Uint8Array }>;
/** What a location offers now: chain -> every (seq, record_id) it holds for the chain. */
export type Offered = Map<string, { seq: number; id: Uint8Array }[]>;
export type RollbackReason = 'less' | 'different';
export interface Rollback { chain: string; reason: RollbackReason; remembered: number; offered: number | null }

export const chainOf = (author: Uint8Array, device: Uint8Array) => `${hex(author)}/${hex(device)}`;

/** Record what was accepted: the greatest seq per chain wins. */
export function remember(prior: Remembered, accepted: { author: Uint8Array; device: Uint8Array; seq: number; id: Uint8Array }[]): Remembered {
  const out: Remembered = new Map(prior);
  for (const r of accepted) {
    const k = chainOf(r.author, r.device);
    const cur = out.get(k);
    if (!cur || r.seq > cur.seq) out.set(k, { seq: r.seq, id: r.id });
  }
  return out;
}

/** Compare a location's offer with what the device remembers. `covered` (chain -> seq of a complete accepted checkpoint, 5.3) excuses a
 *  location that dropped records a checkpoint covers: the specification does not say so (finding), but it MAY delete them. */
export function checkLocation(seen: Remembered, offered: Offered, covered: Map<string, number> = new Map()): Rollback[] {
  const out: Rollback[] = [];
  for (const [chain, mine] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const have = offered.get(chain) ?? [];
    const top = have.reduce((m, r) => Math.max(m, r.seq), 0);
    const atMine = have.filter((r) => r.seq === mine.seq);
    if (atMine.length > 0 && !atMine.some((r) => eq(r.id, mine.id))) out.push({ chain, reason: 'different', remembered: mine.seq, offered: mine.seq });
    else if (top < mine.seq && (covered.get(chain) ?? 0) < mine.seq) out.push({ chain, reason: 'less', remembered: mine.seq, offered: top || null });
  }
  return out;
}
