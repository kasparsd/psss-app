// Near-miss titles for the "Did you mean" line. Text for a person: a hint is never used as a result.
// The name asked for and each title are compared as a search compares them (case, accents, width and Unicode form ignored). A title is near when
// it starts with the name asked for, the name starts with it, or the two differ by a small edit (at most 1 change for names under five letters,
// otherwise at most 2), measured on the whole title or on its first letters (so "Exampel" finds "Example API").
// A name with fewer than three letters or digits (a single character, "--", "...") suggests nothing: almost every title is one edit away from it.
// Only the first 200 characters of the name are compared, and an edit distance is only worked out inside the band the limit allows, so a
// 20,000-character name costs no more than a 200-character one.
// At most three are returned, closest first, then alphabetical.

import { searchFold } from './search.ts';

/** The most characters of the asked-for name that are compared. */
export const NEAR_QUERY_LIMIT = 200;
const MIN_LETTERS = 3;

/** Edit distance between `a` and `b` when it is at most `max`; `max + 1` when it is more. Works inside the band of width `2 * max + 1`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const over = max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => (j <= max ? j : over));
  for (let i = 1; i <= a.length; i++) {
    const next = new Array<number>(b.length + 1).fill(over);
    if (i <= max) next[0] = i;
    let best = next[0]!;
    for (let j = Math.max(1, i - max); j <= Math.min(b.length, i + max); j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1), over);
      if (next[j]! < best) best = next[j]!;
    }
    if (best > max) return over;
    row = next;
  }
  return Math.min(row[b.length]!, over);
}

export function nearTitles(query: string, titles: string[]): string[] {
  const fold = searchFold;
  const q = fold(query.slice(0, NEAR_QUERY_LIMIT));
  if ((q.match(/[\p{L}\p{N}]/gu) ?? []).length < MIN_LETTERS) return [];
  const limit = q.length < 5 ? 1 : 2;
  const scored: Array<{ title: string; score: number }> = [];
  for (const title of new Set(titles)) {
    const t = fold(title);
    if (t === q) continue;
    if (t.startsWith(q) || (t.length >= 3 && q.startsWith(t))) {
      scored.push({ title, score: 0 });
      continue;
    }
    const d = Math.min(distance(q, t, limit), distance(q, t.slice(0, q.length), limit));
    if (d <= limit) scored.push({ title, score: d });
  }
  return scored.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'en')).slice(0, 3).map((s) => s.title);
}
