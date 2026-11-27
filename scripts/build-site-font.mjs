// Cuts the website's one font from Design/Fonts/Nunito: weight 700 alone, Latin characters, as WOFF2 in
// Site/src/assets/Nunito-Bold.woff2, with its licence beside the published page (Site/public/OFL.txt).
// Every heading on the site is 700, so no other weight is shipped. Nunito's licence reserves no font name,
// so a cut-down file may keep it. A character outside the ranges below falls back to the next font.
// Usage: node scripts/build-site-font.mjs   (after npm install in Site)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../Site/package.json', import.meta.url));
const subsetFont = require('subset-font');

// Basic Latin, Latin-1 and Extended-A, then the dashes, quotes, bullet, ellipsis, euro and trade mark.
const ranges = [[0x20, 0x7e], [0xa0, 0x17f], [0x2013, 0x2014], [0x2018, 0x201e], [0x2022, 0x2022], [0x2026, 0x2026], [0x20ac, 0x20ac], [0x2122, 0x2122]];
const characters = ranges.map(([from, to]) => String.fromCodePoint(...Array.from({ length: to - from + 1 }, (_, i) => from + i))).join('');

const from = new URL('../Design/Fonts/Nunito/', import.meta.url);
const font = readFileSync(new URL('Nunito-Variable.ttf', from));
const out = await subsetFont(font, characters, { targetFormat: 'woff2', variationAxes: { wght: 700 } });
writeFileSync(new URL('../Site/src/assets/Nunito-Bold.woff2', import.meta.url), out);
copyFileSync(new URL('OFL.txt', from), new URL('../Site/public/OFL.txt', import.meta.url));
console.log(`Wrote Site/src/assets/Nunito-Bold.woff2 (${font.length} to ${out.length} bytes) and Site/public/OFL.txt`);
