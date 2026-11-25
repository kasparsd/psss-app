// The small mark (docs/brand.md, "Small mark"): a ring with one dot in the middle, drawn in a 56 unit box.
// A2 (default): butter inside, charcoal ring and dot. A (monochrome fallback): no fill, one colour.
// The small cut (24 px and below) is thicker, because a 5 unit line is under a pixel at 16 px.
// Geometry matches the `SmallMark` component of Design/Mocks (FIELD.line is 5 in src/logoField.ts).

export const CHARCOAL = '#1F1F23';
export const BUTTER = '#FFD84D';
const CUTS = {
  small: { stroke: 7, radius: 24.5, dot: 10 },
  large: { stroke: 5, radius: 25.5, dot: 8 },
};

/** @param {{cut: 'small'|'large', mono?: boolean, title?: string}} options */
export function smallMarkSvg({ cut, mono = false, title }) {
  const g = CUTS[cut];
  const ink = mono ? 'currentColor' : CHARCOAL;
  const fill = mono ? 'none' : BUTTER;
  const name = title ?? `Psss mark${mono ? ', one colour' : ''}, ${cut} cut`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" role="img" aria-label="${name}">
<title>${name}</title>
<circle cx="28" cy="28" r="${g.radius}" fill="${fill}" stroke="${ink}" stroke-width="${g.stroke}"/>
<circle cx="28" cy="28" r="${g.dot}" fill="${ink}"/>
</svg>
`;
}
