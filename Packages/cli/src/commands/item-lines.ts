// One line per item for `list` and `search` (frame A4): title, account, field names. Never values.
// Items that share a title (case and Unicode form ignored) cannot be told apart by name, so they show an id that works in a reference.
// Every name is written through `printable`: cut to 60 characters, and a control or direction character shown as `\u{202e}`.

import { printable } from '../text.ts';
import type { ItemSummary } from '../service.ts';

export function itemLines(items: ItemSummary[]): string {
  const key = (t: string) => t.normalize('NFC').toLowerCase();
  const seen = new Map<string, number>();
  for (const i of items) seen.set(key(i.title), (seen.get(key(i.title)) ?? 0) + 1);
  const shared = (i: { title: string }) => (seen.get(key(i.title)) ?? 0) > 1;
  const anyShared = items.some(shared);
  const rows = items.map((i) => ({ item: i, title: printable(i.title), user: printable(i.username ?? ''), fields: i.fields.map((f) => printable(f)).join(', ') }));
  const titleW = Math.max(...rows.map((r) => r.title.length)) + 3;
  const userW = Math.max(...rows.map((r) => r.user.length));
  const idW = anyShared ? 'id:'.length + Math.max(...items.filter(shared).map((i) => i.id.slice(0, 8).length)) + 3 : 0;
  let text = '';
  for (const r of rows) {
    const user = userW > 0 ? r.user.padEnd(userW + 4) : '';
    const id = anyShared ? (shared(r.item) ? `id:${r.item.id.slice(0, 8)}` : '').padEnd(idW) : '';
    text += `${r.title.padEnd(titleW)}${user}${id}${r.fields}`.trimEnd() + '\n';
  }
  return text;
}

/** The JSON of one item for `list --json` and `search --json`: names escaped, never a value. */
export function itemJson(i: ItemSummary, name: (text: string) => string): Record<string, unknown> {
  return {
    id: i.id,
    title: name(i.title),
    ...(i.username !== undefined ? { username: name(i.username) } : {}),
    ...(i.url !== undefined ? { url: name(i.url) } : {}),
    group: name(i.group),
    fields: i.fields.map(name),
  };
}
