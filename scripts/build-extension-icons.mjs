// Builds the browser extension's icons and the landing page's PNG favicon and home screen icons.
//   Toolbar (action-16, action-32) and the landing favicon-32: the small mark A2 (scripts/small-mark.mjs), rendered
//   straight from the SVG; the small cut at 16 px, the large cut from 32 px up.
//   Website home screen: apple-touch-icon (180) and the web manifest's 192 and 512, the app icon tile left square,
//   because the system rounds it.
//   Extensions page and store listing (icon-48, icon-128): the app icon tile (Design/AppIcon/AppIcon-light-1024.png), cropped
//   in a little and on a rounded square, because browsers do not mask icons.
// Usage: node scripts/build-extension-icons.mjs   (needs rsvg-convert and ImageMagick)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { smallMarkSvg } from './small-mark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'Extensions/Browser/src');
const scratch = mkdtempSync(join(tmpdir(), 'psss-icons-'));

function renderMark(size, file) {
  const svgPath = join(scratch, `mark-${size}.svg`);
  writeFileSync(svgPath, smallMarkSvg({ cut: size <= 24 ? 'small' : 'large' }));
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', file, svgPath]);
}

try {
  for (const size of [16, 32]) renderMark(size, join(out, `action-${size}.png`));
  renderMark(32, join(root, 'Site/src/assets/favicon-32.png'));

  const source = join(root, 'Design/AppIcon/AppIcon-light-1024.png');
  for (const [size, name] of [[180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512']]) {
    execFileSync('magick', [source, '-resize', `${size}x${size}`, '-strip', join(root, 'Site/public', `${name}.png`)]);
  }

  const crop = 900; // of 1024: the field takes more of the small sizes
  for (const size of [48, 128]) {
    const radius = Math.round(size * 0.225);
    execFileSync('magick', [
      source, '-gravity', 'center', '-crop', `${crop}x${crop}+0+0`, '+repage',
      '-resize', `${size}x${size}`,
      '(', '-size', `${size}x${size}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`, ')',
      '-alpha', 'set', '-compose', 'DstIn', '-composite',
      join(out, `icon-${size}.png`),
    ]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('Wrote action-16, action-32, icon-48, icon-128 in Extensions/Browser/src, Site/src/assets/favicon-32.png, and apple-touch-icon, icon-192, icon-512 in Site/public');
