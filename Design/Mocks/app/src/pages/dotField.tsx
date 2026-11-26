/**
 * The cover's background: rows of dots in threes, like passwords being typed, in a new random arrangement each time Psss is left.
 * The app draws the same layout (`CoverDots`, App/Features/PrivacyCover.swift). Static, never animated.
 */

/** A small repeatable number stream (mulberry32), so a frame draws the same arrangement on every render. */
function stream(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `w` and `h` are the window in points; `scale` shrinks the whole drawing for the app switcher's card; `mark` is the size of the
 * mark's icon box, which sets the clear space around it. Spacing is the same in points at every window size.
 */
export function DotField({ seed, w, h, mark = 120, scale = 1 }: { seed: number; w: number; h: number; mark?: number; scale?: number }) {
  const r = stream(seed * 7919);
  const cx = w / 2, cy = h / 2, m = mark / 120;
  /** 0 behind the mark, 1 away from it, so the mark always stands on plain charcoal. */
  const clear = (x: number, y: number) => Math.min(1, Math.max(0, (Math.hypot((x - cx) / 1.5, y - cy) - 56 * m) / (70 * m)));
  const dots: { x: number; y: number; s: number; o: number }[] = [];
  for (let y = 18; y <= h - 8; y += 30) {
    for (let x = -r() * 70; x < w; x += 78) {
      const k = r();
      if (k <= 0.3 || x < 8 || x + 30 > w - 8) continue;
      // A group fades as one, so no group is ever cut to one or two dots.
      const c = Math.min(...[0, 1, 2].map((i) => clear(x + i * 15, y)));
      if (c <= 0) continue;
      for (let i = 0; i < 3; i++) dots.push({ x: x + i * 15, y, s: 1.2 + k * 2.56, o: (0.1 + k * 0.224) * c });
    }
  }
  return (
    <svg className="as-dots" width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.s} fill="currentColor" opacity={d.o} />)}
    </svg>
  );
}
