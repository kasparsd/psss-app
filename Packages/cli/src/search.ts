// What a search reads and how it compares, the same in the real service and the fake one. It mirrors the apps (`ItemSearch` in
// App/Core/RecentlyDeletedText.swift): the whole text, trimmed, must be inside the title, the username or the website, ignoring case,
// accents and Unicode form (`localizedStandardContains`). Notes, tags, custom fields and every secret are never read. The apps do not
// rank: the results are in title order, as in `list`.

const MARKS = /\p{M}/gu;

/** Case, accents and Unicode form removed, so "café" and "Café" and "CAFE" are one text. */
export function searchFold(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase().normalize('NFC');
}

export function searchTerm(text: string): string {
  return searchFold(text.trim());
}

export function matchesSearch(item: { title: string; username?: string; url?: string }, term: string): boolean {
  if (term === '') return true;
  return searchFold(item.title).includes(term) || (item.username !== undefined && searchFold(item.username).includes(term)) || (item.url !== undefined && searchFold(item.url).includes(term));
}
