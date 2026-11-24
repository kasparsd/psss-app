// Builds the browser extension's icons from the app icon (Design/AppIcon/AppIcon-light-1024.png): the butter field with the
// p and three dots, cropped in a little so it stays readable at 16 px, on a rounded square (browsers do not mask icons).
// Usage: node scripts/build-extension-icons.mjs   (needs ImageMagick)
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'Design/AppIcon/AppIcon-light-1024.png');
const out = join(root, 'Extensions/Browser/src');
const crop = 900; // of 1024: the field takes more of the small sizes

for (const size of [16, 32, 48, 128]) {
  const radius = Math.round(size * 0.225);
  execFileSync('magick', [
    source, '-gravity', 'center', '-crop', `${crop}x${crop}+0+0`, '+repage',
    '-resize', `${size}x${size}`,
    '(', '-size', `${size}x${size}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`, ')',
    '-alpha', 'set', '-compose', 'DstIn', '-composite',
    join(out, `icon-${size}.png`),
  ]);
}
console.log('Wrote icon-16, 32, 48 and 128 in Extensions/Browser/src');
