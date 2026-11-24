// Text from a vault or a page (a vault name, a login's title, an account) made safe to show as one short line. It changes only
// what is displayed, never what is stored or filled, and it is used with textContent only, never innerHTML.
//  - control characters, line breaks and every kind of space become one space; runs collapse; the ends are trimmed
//  - bidirectional controls, zero-width and other invisible format characters are removed, so a name cannot reorder or hide
//    the words around it ("Work" followed by a right-to-left override)
//  - the result is cut to `max` characters (what a person sees as one character, so a flag counts once) and ends with an ellipsis
var Display = (function () {
  // Code point ranges, built into expressions here so the source holds no invisible character.
  const cls = (ranges) => new RegExp('[' + ranges.map(([a, b]) => String.fromCodePoint(a) + (b ? '-' + String.fromCodePoint(b) : '')).join('') + ']+', 'gu');
  const SPACES = cls([[0x00, 0x20], [0x7f, 0xa0], [0x1680], [0x2000, 0x200a], [0x2028], [0x2029], [0x202f], [0x205f], [0x3000]]);
  const INVISIBLE = cls([[0xad], [0x34f], [0x61c], [0x115f], [0x1160], [0x17b4], [0x17b5], [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e],
    [0x2060, 0x206f], [0x2800], [0x3164], [0xfeff], [0xffa0], [0xfff9, 0xfffc], [0xe0000, 0xe007f], [0x1d173, 0x1d17a]]);

  function characters(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
    return Array.from(text);
  }

  function line(text, max = 80) {
    // Cap the work before the work: a hostile value can be megabytes.
    const raw = String(text ?? '').slice(0, 2000);
    const clean = raw.replace(INVISIBLE, '').replace(SPACES, ' ').trim();
    const chars = characters(clean);
    if (chars.length <= max) return clean;
    return chars.slice(0, max - 1).join('').trimEnd() + '…';
  }

  return { line };
})();
if (typeof module !== 'undefined') module.exports = { Display };
