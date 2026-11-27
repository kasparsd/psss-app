// Packs the website's one font as WOFF2: Design/Fonts/VarelaRound to Site/src/assets/VarelaRound-Regular.woff2,
// with its licence beside the published page (Site/public/OFL.txt).
// Compression only, never a subset: "Varela" is a Reserved Font Name in the licence, so a cut-down file
// could not keep the name. WOFF2 holds every table of the original.
// Usage: node scripts/build-site-font.mjs   (after npm install in Site)
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../Site/package.json', import.meta.url));
const wawoff2 = require('wawoff2');

const from = new URL('../Design/Fonts/VarelaRound/', import.meta.url);
const font = readFileSync(new URL('VarelaRound-Regular.ttf', from));
const out = await wawoff2.compress(font);
writeFileSync(new URL('../Site/src/assets/VarelaRound-Regular.woff2', import.meta.url), out);
copyFileSync(new URL('OFL.txt', from), new URL('../Site/public/OFL.txt', import.meta.url));
console.log(`Wrote Site/src/assets/VarelaRound-Regular.woff2 (${font.length} to ${out.length} bytes) and Site/public/OFL.txt`);
