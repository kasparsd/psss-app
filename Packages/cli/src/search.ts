// What a search reads and how it compares, the same in the real service and the fake one. It mirrors the apps (`ItemSearch` and `SearchField`
// in App/Core/RecentlyDeletedText.swift): the whole text, trimmed, must be inside the name shown for the item, its username or its website,
// the way `localizedStandardContains` compares: case, accents, width and Unicode form ignored. Notes, tags, custom fields and every secret are
// never read. The apps do not rank: the results are in title order, as in `list`.

/** Swift's `.whitespacesAndNewlines`: the Unicode separators (Z*), U+0009 to U+000D and U+0085. Not U+FEFF, which JavaScript's `trim` also removes. */
const SWIFT_SPACE = /^[\p{Z}\u0009-\u000d\u0085]+|[\p{Z}\u0009-\u000d\u0085]+$/gu;

/** `text.trimmingCharacters(in: .whitespacesAndNewlines)` */
export function swiftTrim(text: string): string {
  return text.replace(SWIFT_SPACE, '');
}

const MARKS = /\p{M}/gu;

/**
 * Letters that do not decompose into a base letter and a mark, but that `localizedStandardContains` treats as their base letters
 * (lowercase only: the text is lowercased first). This is the whole list; it is a small explicit map, not Apple's tables, so a letter that
 * is not here (`þ`, `ð`, `ħ`, dotless `ı`) is compared as itself until a check against the apps says otherwise.
 */
export const SEARCH_LETTERS: Readonly<Record<string, string>> = { 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l' };
const LETTERS = new RegExp(`[${Object.keys(SEARCH_LETTERS).join('')}]`, 'gu');

/**
 * One text for "the same to a search": compatibility decomposition (so a fullwidth letter, a ligature such as ﬁ and a superscript become plain
 * letters and every accent becomes a mark), marks removed, lowercase, the letters of `SEARCH_LETTERS` replaced, and composed again.
 * "Café", "CAFE", "ｃａｆé" and "ﬁsh" / "fish" are each one text.
 */
export function searchFold(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase().replace(LETTERS, (c) => SEARCH_LETTERS[c]!).normalize('NFC');
}

export function searchTerm(text: string): string {
  return searchFold(swiftTrim(text));
}

// ---------------------------------------------------------------- the name shown for an item

/** What a search needs to know about an item. `kind` is the item type of the format: 1 login, 2 card, 3 secure note, 4 custom item (absent: 1). */
export interface SearchableItem {
  title: string;
  username?: string;
  url?: string;
  kind?: number;
  /** Only needed for a secure note without a name: its text gives it one. */
  notes?: string;
  /** Only needed for a card without a name: its number gives it one. */
  cardNumber?: string;
}

/** Whether the name shown for the item can differ from its title, so the service has to read the notes or the card number to know it. */
export function needsDerivedName(item: { title: string; kind?: number }): boolean {
  return (item.kind ?? 1) !== 1 && swiftTrim(item.title) === '';
}

/** The card network as the apps read it from the first digits (`CardBrand.init(number:)`), as the short name a crowded row uses; undefined when unknown. */
export function cardBrandShortName(number: string): string | undefined {
  const digits = number.replace(/[^0-9]/g, '');
  const prefix = (n: number): number | undefined => (digits.length >= n ? Number(digits.slice(0, n)) : undefined);
  const within = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo && v <= hi;
  if (digits === '') return undefined;
  const elo: Array<[number, number]> = [
    [401178, 401179], [431274, 431274], [438935, 438935], [451416, 451416], [457393, 457393], [457631, 457632], [504175, 504175], [506699, 506778],
    [509000, 509999], [627780, 627780], [636297, 636297], [636368, 636368], [650031, 650033], [650035, 650051], [650405, 650439], [650485, 650538],
    [650541, 650598], [650700, 650718], [650720, 650727], [650901, 650978], [651652, 651679], [655000, 655019], [655021, 655058],
  ];
  const p6 = prefix(6);
  if (p6 !== undefined && elo.some(([lo, hi]) => p6 >= lo && p6 <= hi)) return 'Elo';
  if (digits[0] === '4') return 'Visa';
  const p2 = prefix(2), p3 = prefix(3), p4 = prefix(4);
  if (within(p2, 51, 55) || within(p4, 2221, 2720)) return 'Mastercard';
  if (within(p4, 2200, 2204)) return 'Mir';
  if (p2 === 34 || p2 === 37) return 'Amex';
  if (p4 === 6011 || p2 === 65 || within(p3, 644, 649)) return 'Discover';
  if (p2 === 62) return 'UnionPay';
  if (within(p4, 3528, 3589)) return 'JCB';
  if (within(p3, 300, 305) || p2 === 36 || p2 === 38 || p2 === 39) return 'Diners';
  if (p2 !== undefined && [50, 56, 57, 58, 59, 63, 67].includes(p2)) return 'Maestro';
  return undefined;
}

const NOTE_TITLE_LENGTH = 40;
const NEWLINE = /[\n\r\u000b\u000c\u0085\u2028\u2029]/u;
const TRIM_NOTE = /^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu;
const TRIM_NOTE_END = /^[\p{Zs}\t\p{P}]+|[\p{Zs}\t\p{P}]+$/gu;
const graphemes = (text: string): string[] => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);

/** `VaultItem.noteTitle`: the first line with something in it, cut at a word when longer than 40 characters, no punctuation left at either end. */
export function noteTitle(text: string): string | undefined {
  const first = text.split(NEWLINE).map((l) => l.replace(TRIM_NOTE, '')).find((l) => l !== '');
  if (first === undefined) return undefined;
  let line = first;
  const chars = graphemes(line);
  if (chars.length > NOTE_TITLE_LENGTH) {
    const head = chars.slice(0, NOTE_TITLE_LENGTH + 1);
    let space = -1;
    for (let i = head.length - 1; i >= 0; i--) if (/^\s/u.test(head[i]!)) { space = i; break; }
    line = space >= 0 ? head.slice(0, space).join('') : chars.slice(0, NOTE_TITLE_LENGTH).join('');
  }
  const trimmed = line.replace(TRIM_NOTE_END, '');
  return trimmed === '' ? undefined : trimmed;
}

/** `SharedVault.host`, simplified: the host of an address, lowercased, without a leading `www.`; empty when the text has no network host. */
function siteHost(text: string): string {
  const t = swiftTrim(text);
  if (t === '') return '';
  try {
    const url = new URL(t.includes('://') ? t : `https://${t}`);
    if (!/^https?:$/.test(url.protocol) || url.username !== '' || url.password !== '') return '';
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * `VaultItem.displayTitle`: the name a person gave, or, for an item without one, a name made from what it holds. A custom item: the host of its
 * website, else its username, else "Custom item". A card: the short network name and the last four digits ("Visa •• 4417"), either alone, else
 * "Card". A note: the start of its first line, else "Note". (A login's made-up name is its website or username, which are searched on their own.)
 */
export function shownName(item: SearchableItem): string {
  const name = swiftTrim(item.title);
  if (name !== '') return name;
  switch (item.kind ?? 1) {
    case 2: {
      const digits = (item.cardNumber ?? '').replace(/[^0-9]/g, '');
      const parts = [cardBrandShortName(digits), digits.length >= 4 ? `•• ${digits.slice(-4)}` : undefined].filter((p): p is string => p !== undefined);
      return parts.length > 0 ? parts.join(' ') : 'Card';
    }
    case 3:
      return noteTitle(item.notes ?? '') ?? 'Note';
    case 1:
      return 'Login';
    default: {
      const host = siteHost(item.url ?? '');
      if (host !== '') return host;
      const user = swiftTrim(item.username ?? '');
      return user === '' ? 'Custom item' : user;
    }
  }
}

/** The texts the apps' name field searches (`SearchField.name`): a login only its own title, any other kind its title and the name shown for it. */
export function nameTexts(item: SearchableItem): string[] {
  return (item.kind ?? 1) === 1 ? [item.title] : [item.title, shownName(item)];
}

export function matchesSearch(item: SearchableItem, term: string): boolean {
  if (term === '') return true;
  const texts = [...nameTexts(item), item.url ?? '', item.username ?? ''];
  return texts.some((t) => t !== '' && searchFold(t).includes(term));
}
