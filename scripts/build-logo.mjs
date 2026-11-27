#!/usr/bin/env node
// Builds the Psss logo, "one field, shown and hidden", and the app icon's
// artwork from one set of numbers. Run with Node 24: node scripts/build-logo.mjs
//
// Writes:
//   Design/Logo/Psss-field-{hidden,shown}[-butter].svg  the two states, as files
//   Design/Logo/psss-logo.svg                           both states in one drawing, for inlining in HTML
//   Design/Logo/psss-logo.css                           the switch on hover and tap, in both resting modes
//   Design/Mocks/app/src/logoField.ts                   the same geometry for the mock pages
//   App/AppIcon.icon/Assets/{Frame,Dots}[-Dark|-Tint].svg  the app icon's two glass layers
//   App/Features/LogoFieldGeometry.swift                the icon cut as SwiftUI paths, for the lock screen
//   Design/AppIcon/AppIcon-{light,dark}.svg             the icon drawn flat, for reference and export
//   Site/src/assets/Psss-mark-small[-mono].svg         the small mark: a ring with one dot (A2, and A in one colour)
//
// Units are the mark's own (docs/brand.md): centre line y 60, the field 118
// wide and 56 high, starting at x 4 and y 32.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { smallMarkSvg } from './small-mark.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const write = (p, s) => { writeFileSync(root + p, s); console.log('wrote', p); };

const CHARCOAL = '#1F1F23';
const BUTTER = '#FFD84D';

// ── The numbers ──────────────────────────────────────────────────────────
const FIELD_W = 118;      // outer width of the logo's field; the icon's is wider, see CUTS
const FIELD_H = 56;       // outer height
const X_HEIGHT = 21;      // of the letters, centred on y 60
const TRACK = 5;          // extra space between letters, in the typeface's units

/** The three cuts. The letters are always a little heavier than the outline. */
const CUTS = {
  /** The logo: page headers, print, anything from about 48 px high. */
  master: { line: 5, weight: 6, dot: 7 },
  /** The app icon. Glass bevels eat into a thin line, so everything is heavier. */
  // Its field is 6 units wider than the logo's: under the glass the sides looked tighter
  // than the top (owner, 2026-11-24). It fills 77.8 percent of the icon's width, which
  // keeps the field as tall as it was at 74 percent before it was widened.
  icon: { line: 6.5, weight: 7.4, dot: 7.2, fieldW: 124, fill: 0.778 },
  /** Favicons and anything below 48 px. */
  small: { line: 7, weight: 8, dot: 7.4, fieldW: 124 },
};

const glyphs = JSON.parse(read('Design/Logo/psss-glyphs.json'));
const k = X_HEIGHT / (glyphs.bottom - glyphs.top);
const n = (v) => String(Math.round(v * 1000) / 1000);

/**
 * The field's shapes for one cut. `scale`, `ox` and `oy` map the mark's units
 * to the output's, so a file never needs a transform.
 */
function geometry({ line, weight, dot, fieldW = FIELD_W }, { scale = 1, ox = 0, oy = 0 } = {}) {
  const X = (x) => x * scale + ox;
  const Y = (y) => y * scale + oy;
  /** Thickening: a stroke of this width around the typeface's outlines brings the stem to `weight`. */
  const fat = weight - glyphs.stem * k;
  const wordW = (glyphs.right - glyphs.left + 3 * TRACK) * k + fat;
  /** Equal space on both sides of the word. */
  const wordX = 4 + (fieldW - wordW) / 2 + fat / 2;

  /** Moves a glyph outline (absolute M, L, Q, Z only) into the field. `dx` is in the typeface's units. */
  const place = (d, dx = 0) => {
    if (/[^MLQZ0-9.\s-]/.test(d)) throw new Error('unexpected path command in glyph');
    let isX = true;
    return d.replace(/-?\d+(?:\.\d+)?/g, (v) => {
      const out = isX ? X((Number(v) + dx - glyphs.left) * k + wordX) : Y((Number(v) - 60) * k + 60);
      isX = !isX;
      return n(out);
    });
  };
  const sAt = (i) => TRACK + i * (glyphs.advance + TRACK);

  // The p's stem runs down to the field's outer edge and is cut by it, so it
  // merges with the outline and nothing reaches outside the field.
  const rOuter = FIELD_H / 2;
  const cxLeft = 4 + rOuter;
  const stemX = wordX + (glyphs.stem / 2) * k;
  const edgeY = (x) => 60 + Math.sqrt(rOuter ** 2 - (cxLeft - x) ** 2);
  const x1 = stemX - weight / 2;
  const x2 = stemX + weight / 2;
  const r = n(rOuter * scale);

  return {
    box: [4, 32, fieldW, FIELD_H],
    line: n(line * scale),
    fat: n(fat * scale),
    outline: { x: n(X(4 + line / 2)), y: n(Y(32 + line / 2)), width: n((fieldW - line) * scale), height: n((FIELD_H - line) * scale), rx: n(((FIELD_H - line) / 2) * scale) },
    p: place(glyphs.p),
    tail: `M${n(X(x1))} ${n(Y(72))}H${n(X(x2))}V${n(Y(edgeY(x2)))}A${r} ${r} 0 0 1 ${n(X(x1))} ${n(Y(edgeY(x1)))}Z`,
    s: [0, 1, 2].map((i) => place(glyphs.s, sAt(i))),
    dots: [0, 1, 2].map((i) => ({ cx: n(X((glyphs.sCentre + sAt(i) - glyphs.left) * k + wordX)), cy: n(Y(60)), r: n(dot * scale) })),
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────
const outlineSvg = (g, c) => `<rect x="${g.outline.x}" y="${g.outline.y}" width="${g.outline.width}" height="${g.outline.height}" rx="${g.outline.rx}" fill="none" stroke="${c}" stroke-width="${g.line}"/>`;
const letters = (g, c, paths) => `<g fill="${c}" stroke="${c}" stroke-width="${g.fat}" stroke-linejoin="round">${paths}</g>`;
const dotSvg = (d, extra = '') => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}"${extra}/>`;
const dotsSvg = (g, c) => `<g fill="${c}">${g.dots.map((d) => dotSvg(d)).join('')}</g>`;
/** The outline, the p and its tail: everything of the hidden state except the dots. */
const frameSvg = (g, c) => `${outlineSvg(g, c)}\n${letters(g, c, `<path d="${g.p}"/>`)}\n<path d="${g.tail}" fill="${c}"/>`;

// ── Filled shapes only, for the app icon ─────────────────────────────────
// Xcode also writes a fallback AppIcon.icns for older systems, and that
// renderer fills a stroked shape solid. So the icon's layers carry no strokes:
// the outline is a ring, and the p is thickened with filled shapes.

/** The field's outline as a filled ring: the outer pill one way round, the inner one the other. */
function ringPath(g) {
  const x = Number(g.outline.x), y = Number(g.outline.y), w = Number(g.outline.width), h = Number(g.outline.height), half = Number(g.line) / 2;
  const pill = (inset, clockwise) => {
    const l = x + inset, t = y + inset, r = x + w - inset, b = y + h - inset, rad = (b - t) / 2;
    return clockwise
      ? `M${n(l + rad)} ${n(t)}H${n(r - rad)}A${n(rad)} ${n(rad)} 0 0 1 ${n(r - rad)} ${n(b)}H${n(l + rad)}A${n(rad)} ${n(rad)} 0 0 1 ${n(l + rad)} ${n(t)}Z`
      : `M${n(l + rad)} ${n(t)}A${n(rad)} ${n(rad)} 0 0 0 ${n(l + rad)} ${n(b)}H${n(r - rad)}A${n(rad)} ${n(rad)} 0 0 0 ${n(r - rad)} ${n(t)}Z`;
  };
  return pill(-half, true) + pill(half, false);
}

/**
 * A glyph outline thickened by `width` without a stroke. Every edge of the
 * outline gets a filled capsule (a line with round ends, `width` across); with
 * the glyph itself they cover exactly what a round-joined stroke would. All
 * of them wind the same way as the glyph's outer contour, so the default
 * nonzero fill joins them into one shape.
 */
function thickenedPath(d, width) {
  const r = width / 2;
  const tokens = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g);
  const contours = [];
  let pts = null;
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++];
    const num = () => Number(tokens[i++]);
    if (cmd === 'M') { pts = [[num(), num()]]; contours.push(pts); }
    else if (cmd === 'L') pts.push([num(), num()]);
    else if (cmd === 'Q') {
      const [x0, y0] = pts.at(-1), cx = num(), cy = num(), x1 = num(), y1 = num();
      for (let t = 1; t <= 6; t++) {
        const u = t / 6, v = 1 - u;
        pts.push([v * v * x0 + 2 * v * u * cx + u * u * x1, v * v * y0 + 2 * v * u * cy + u * u * y1]);
      }
    } else if (cmd === 'Z') pts.push(pts[0]);
    else throw new Error('unexpected token in glyph path: ' + cmd);
  }
  const area = (p) => p.reduce((sum, [x, y], j) => { const [x2, y2] = p[(j + 1) % p.length]; return sum + x * y2 - x2 * y; }, 0);
  const outer = contours.map(area).reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  let out = d;
  for (const p of contours) {
    for (let j = 0; j + 1 < p.length; j++) {
      const [ax, ay] = p[j], [bx, by] = p[j + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.01) continue;
      let nx = (-(by - ay) / len) * r, ny = ((bx - ax) / len) * r;
      // Wind the capsule the same way as the glyph's outer contour.
      if (Math.sign(area([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]])) !== Math.sign(outer)) { nx = -nx; ny = -ny; }
      // The cap at b bulges away from a. Sweep 1 turns (x, y) towards (-y, x).
      const sweep = (-ny) * (bx - ax) + nx * (by - ay) > 0 ? 1 : 0;
      const R = n(r);
      out += `M${n(ax + nx)} ${n(ay + ny)}L${n(bx + nx)} ${n(by + ny)}A${R} ${R} 0 0 ${sweep} ${n(bx - nx)} ${n(by - ny)}L${n(ax - nx)} ${n(ay - ny)}A${R} ${R} 0 0 ${sweep} ${n(ax + nx)} ${n(ay + ny)}Z`;
    }
  }
  return out;
}

/** The frame of the hidden state (outline, p and tail) as filled shapes with no strokes. */
const frameFilledSvg = (g, c) => `<g fill="${c}">\n<path d="${ringPath(g)}"/>\n<path d="${thickenedPath(g.p, Number(g.fat))}"/>\n<path d="${g.tail}"/>\n</g>`;

// ── The logo ─────────────────────────────────────────────────────────────
const master = geometry(CUTS.master);
const viewBox = `4 32 ${FIELD_W} ${FIELD_H}`;

function logoFile(state, c) {
  const name = state === 'shown' ? 'psss' : 'Psss';
  const body = state === 'shown'
    ? `${outlineSvg(master, c)}\n${letters(master, c, `<path d="${master.p}"/>` + master.s.map((d) => `<path d="${d}"/>`).join(''))}\n<path d="${master.tail}" fill="${c}"/>`
    : `${frameSvg(master, c)}\n${dotsSvg(master, c)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${name}">\n<title>${name}</title>\n${body}\n</svg>\n`;
}

for (const state of ['hidden', 'shown']) {
  write(`Design/Logo/Psss-field-${state}.svg`, logoFile(state, CHARCOAL));
  write(`Design/Logo/Psss-field-${state}-butter.svg`, logoFile(state, BUTTER));
}

// Both states in one drawing, coloured by the text colour, switched by psss-logo.css.
// The letters carry opacity="0" so that a page whose stylesheet failed to load
// still shows one state (the dots), not both on top of each other.
const inline = `<svg class="psss-logo" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Psss">
${outlineSvg(master, 'currentColor')}
${letters(master, 'currentColor', `<path d="${master.p}"/><g class="psss-s">${master.s.map((d, i) => `<path style="--i:${i}" opacity="0" d="${d}"/>`).join('')}</g>`)}
<g class="psss-d" fill="currentColor">${master.dots.map((d, i) => dotSvg(d, ` style="--i:${i}"`)).join('')}</g>
<path d="${master.tail}" fill="currentColor"/>
</svg>`;
write('Design/Logo/psss-logo.svg', inline + '\n');

const css = `/* The Psss logo: one field, shown and hidden. Built by scripts/build-logo.mjs; edit it there.
   Use with the drawing in psss-logo.svg, inlined in the page. No script is needed.

   Default: the field rests hidden (p and three dots) and shows the name while
   a pointer is over it. With class "rest-shown" it is the other way round: it
   rests on "psss" and hides the name on hover.

   For a tap, put the drawing in a <label> after
   <input type="checkbox" class="psss-switch">: each tap, click or Space
   switches to the other state and back. A touch screen has no hover. */
.psss-logo { display: block; overflow: visible; }
.psss-logo .psss-s path,
.psss-logo .psss-d circle { transition: opacity .16s ease; transition-delay: calc(var(--i) * 70ms); }
.psss-logo .psss-s path { opacity: 0; }
.psss-logo.rest-shown .psss-s path { opacity: 1; }
.psss-logo.rest-shown .psss-d circle { opacity: 0; }
/* Hover only where there is a real one: a touch screen keeps it stuck after a tap, over the switch. */
@media (hover: hover) {
  .psss-logo:hover .psss-s path { opacity: 1; }
  .psss-logo:hover .psss-d circle { opacity: 0; }
  .psss-logo.rest-shown:hover .psss-s path { opacity: 0; }
  .psss-logo.rest-shown:hover .psss-d circle { opacity: 1; }
}
.psss-switch:checked ~ * .psss-logo .psss-s path { opacity: 1; }
.psss-switch:checked ~ * .psss-logo .psss-d circle { opacity: 0; }
.psss-switch:checked ~ * .psss-logo.rest-shown .psss-s path { opacity: 0; }
.psss-switch:checked ~ * .psss-logo.rest-shown .psss-d circle { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .psss-logo .psss-s path,
  .psss-logo .psss-d circle { transition: none; }
}
`;
write('Design/Logo/psss-logo.css', css);
// The website (Site/) reads Design/Logo/psss-logo.svg and psss-logo.css directly.

const num = (o) => Object.fromEntries(Object.entries(o).map(([a, b]) => [a, Number(b)]));
const forMock = (g) => ({ box: g.box, line: Number(g.line), fat: Number(g.fat), outline: num(g.outline), p: g.p, tail: g.tail, s: g.s, dots: g.dots.map(num) });
write('Design/Mocks/app/src/logoField.ts', `// Generated by scripts/build-logo.mjs. Do not edit by hand.
// The logo's field in the mark's own units: the outline, the p, its tail, and
// for each of the three places an s (shown) and a dot (hidden). FIELD is the
// logo; ICON_FIELD is the heavier cut the app icon uses.
export const FIELD = ${JSON.stringify(forMock(master), null, 2)} as const;
export const ICON_FIELD = ${JSON.stringify(forMock(geometry(CUTS.icon)), null, 2)} as const;
/** How much of the app icon's width the field takes. */
export const ICON_FILL = ${CUTS.icon.fill};
`);

// ── The app icon ─────────────────────────────────────────────────────────
// A 1024 square with no rounding; the system masks it. The field is centred. Icon Composer gives each layer its own glass, so the
// dots are a separate layer from the frame (the outline with the p merged in).
{
  const SIZE = 1024;
  const scale = (SIZE * CUTS.icon.fill) / CUTS.icon.fieldW;
  const icon = geometry(CUTS.icon, { scale, ox: SIZE / 2 - (4 + CUTS.icon.fieldW / 2) * scale, oy: SIZE / 2 - 60 * scale });
  const layer = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">\n${body}\n</svg>\n`;
  for (const [suffix, c] of [['', CHARCOAL], ['-Dark', BUTTER], ['-Tint', BUTTER]]) {
    write(`App/AppIcon.icon/Assets/Frame${suffix}.svg`, layer(frameFilledSvg(icon, c)));
    write(`App/AppIcon.icon/Assets/Dots${suffix}.svg`, layer(dotsSvg(icon, c)));
  }
  for (const [name, ground, c] of [['light', BUTTER, CHARCOAL], ['dark', CHARCOAL, BUTTER]]) {
    write(`Design/AppIcon/AppIcon-${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Psss app icon, ${name}">
<title>Psss app icon, ${name}</title>
<rect width="${SIZE}" height="${SIZE}" fill="${ground}"/>
${frameSvg(icon, c)}
${dotsSvg(icon, c)}
</svg>
`);
  }
}

// ── The icon cut for SwiftUI ─────────────────────────────────────────────
// The lock screen draws the icon itself so that it can switch between the two
// states. Same numbers as the icon's layers, in the mark's own units.
{
  const g = geometry(CUTS.icon);
  const f = (v) => String(Number(n(v)));
  /** A glyph outline (absolute M, L, Q, Z) as SwiftUI path calls. */
  const swiftPath = (d) => {
    const t = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g);
    const out = [];
    for (let i = 0; i < t.length;) {
      const c = t[i++];
      const pt = () => `CGPoint(x: ${f(t[i++])}, y: ${f(t[i++])})`;
      if (c === 'M') out.push(`p.move(to: ${pt()})`);
      else if (c === 'L') out.push(`p.addLine(to: ${pt()})`);
      else if (c === 'Q') { const control = pt(); out.push(`p.addQuadCurve(to: ${pt()}, control: ${control})`); }
      else if (c === 'Z') out.push('p.closeSubpath()');
      else throw new Error('unexpected token in glyph path: ' + c);
    }
    return `{\n        var p = Path()\n        ${out.join('\n        ')}\n        return p\n    }()`;
  };
  // The tail's lower edge follows the field's outer curve; a few short lines are close enough at icon size.
  const { line, weight, fieldW } = CUTS.icon;
  const fat = weight - glyphs.stem * k;
  const stemX = 4 + (fieldW - ((glyphs.right - glyphs.left + 3 * TRACK) * k + fat)) / 2 + fat / 2 + (glyphs.stem / 2) * k;
  const rOuter = FIELD_H / 2, cx = 4 + rOuter;
  const edgeY = (x) => 60 + Math.sqrt(rOuter ** 2 - (cx - x) ** 2);
  const x1 = stemX - weight / 2, x2 = stemX + weight / 2;
  const tail = [`p.move(to: CGPoint(x: ${f(x1)}, y: 72))`, `p.addLine(to: CGPoint(x: ${f(x2)}, y: 72))`];
  for (let j = 0; j <= 8; j++) { const x = x2 + ((x1 - x2) * j) / 8; tail.push(`p.addLine(to: CGPoint(x: ${f(x)}, y: ${f(edgeY(x))}))`); }
  tail.push('p.closeSubpath()');
  write('App/Features/LogoFieldGeometry.swift', `// Generated by scripts/build-logo.mjs. Do not edit by hand; change the script and run it.
//
// The logo's field in the app icon's cut, in the mark's own units (see docs/brand.md): the outline, the p and its
// tail, and for each of the three places an s (the shown state) and a dot (the hidden state).

import SwiftUI

enum LogoFieldGeometry {
    /// The field's outer bounds. Everything below is in these units.
    static let box = CGRect(x: 4, y: 32, width: ${fieldW}, height: ${FIELD_H})
    /// How much of the app icon's width the field takes.
    static let iconFill: CGFloat = ${CUTS.icon.fill}
    /// The outline: stroke this rounded rectangle (a capsule) with \`line\`, centred on its edge.
    static let outline = CGRect(x: ${g.outline.x}, y: ${g.outline.y}, width: ${g.outline.width}, height: ${g.outline.height})
    static let line: CGFloat = ${f(line)}
    /// The letters are the typeface's outlines, filled and also stroked with this width (round joins), which thickens them.
    static let letterStroke: CGFloat = ${g.fat}
    static let p: Path = ${swiftPath(g.p)}
    /// The p's stem running into the field's bottom line. Fill only, no stroke.
    static let tail: Path = {
        var p = Path()
        ${tail.join('\n        ')}
        return p
    }()
    /// The three s, left to right.
    static let s: [Path] = [
        ${g.s.map(swiftPath).join(',\n        ')},
    ]
    /// The three dots, in the places of the three s.
    static let dotCentres: [CGPoint] = [${g.dots.map((d) => `CGPoint(x: ${f(d.cx)}, y: ${f(d.cy)})`).join(', ')}]
    static let dotRadius: CGFloat = ${f(CUTS.icon.dot)}
}
`);
}

// ── The small mark ──────────────────────────────────────────────────────
// A ring with one dot, for favicons and the browser toolbar (scripts/small-mark.mjs).
// The PNG sizes come from scripts/build-extension-icons.mjs.
{
  write('Site/src/assets/Psss-mark-small.svg', smallMarkSvg({ cut: 'small', title: 'Psss mark, small cut' }));
  write('Site/src/assets/Psss-mark-small-mono.svg', smallMarkSvg({ cut: 'small', mono: true, title: 'Psss mark, one colour, small cut' }).replaceAll('currentColor', '#000000'));
}
