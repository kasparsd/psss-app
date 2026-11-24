// Near-miss titles for the "Did you mean" line. Text for a person: a hint is never used as a result.
// A title is near when, ignoring case, it starts with the name asked for, the name starts with it (three letters or more),
// or the two differ by a small edit (at most 1 change for names under five letters, otherwise at most 2), measured on the
// whole title or on its first letters (so "Exampel" finds "Example API").
// At most three are returned, closest first, then alphabetical.

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

export function nearTitles(query: string, titles: string[]): string[] {
  const q = query.toLowerCase();
  const limit = q.length < 5 ? 1 : 2;
  const scored: Array<{ title: string; score: number }> = [];
  for (const title of new Set(titles)) {
    const t = title.toLowerCase();
    if (t === q) continue;
    const d = Math.min(distance(q, t), distance(q, t.slice(0, q.length)));
    if (t.startsWith(q) || (t.length >= 3 && q.startsWith(t))) scored.push({ title, score: 0 });
    else if (d <= limit) scored.push({ title, score: d });
  }
  return scored.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'en')).slice(0, 3).map((s) => s.title);
}
