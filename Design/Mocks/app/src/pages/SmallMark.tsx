import type { ReactNode } from 'react';
import { Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { FIELD } from '../logoField';
import './Logo.css';
import './SmallMark.css';

/**
 * Small marks for places where the full field (p and three dots) is too wide: the browser's toolbar button (16 and 32 px),
 * a favicon (16, 32 px) and similar. Each is drawn from the logo's own parts (FIELD from scripts/build-logo.mjs): the field's
 * outline, its p with the stem that runs into the outline, and its dots.
 *
 * `heavy` is a cut for 16–19 px: thicker outline and a bigger dot, because a 5 unit line at 16 px is under a pixel.
 */
type Kind = 'ring-dot' | 'ring-p' | 'field-p-dot' | 'p' | 'tile-p';

const B = 56; // every square mark is drawn in a 56 unit box, the field's height
const C = B / 2;

function line(heavy?: boolean) { return heavy ? 7 : FIELD.line; }

/** The p from the logo, moved so its bowl's centre lands on (cx, cy). The bowl spans about x 20.5–39.5, y 49.5–70.5. */
function P({ cx, cy, heavy }: { cx: number; cy: number; heavy?: boolean }) {
  const dx = cx - 30, dy = cy - 60;
  return (
    <g transform={`translate(${dx} ${dy})`}>
      <path d={FIELD.p} fill="currentColor" stroke="currentColor" strokeWidth={FIELD.fat + (heavy ? 1.6 : 0)} strokeLinejoin="round" />
    </g>
  );
}

function SmallMark({ kind, size, heavy }: { kind: Kind; size: number; heavy?: boolean }) {
  const w = line(heavy);
  const r = C - w / 2;
  if (kind === 'ring-dot') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${B} ${B}`} role="img" aria-label="Psss">
        <circle cx={C} cy={C} r={r} fill="none" stroke="currentColor" strokeWidth={w} />
        <circle cx={C} cy={C} r={heavy ? 10 : 8} fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'ring-p') {
    // The p's bowl in the middle; its stem runs down into the ring and is cut flush with the ring's outer edge, as in the logo.
    const stemX = C - 30 + 19.3; // the logo's tail starts at x 19.3, 6 units wide
    return (
      <svg width={size} height={size} viewBox={`0 0 ${B} ${B}`} role="img" aria-label="Psss">
        <defs><clipPath id={`ringclip-${size}-${heavy ? 1 : 0}`}><circle cx={C} cy={C} r={C} /></clipPath></defs>
        <circle cx={C} cy={C} r={r} fill="none" stroke="currentColor" strokeWidth={w} />
        <P cx={C + 1} cy={C - 3} heavy={heavy} />
        <rect x={stemX + 1} y={C + 6} width={6 + (heavy ? 1.6 : 0)} height={C} fill="currentColor" clipPath={`url(#ringclip-${size}-${heavy ? 1 : 0})`} />
      </svg>
    );
  }
  if (kind === 'field-p-dot') {
    // The logo's field cut after the first place: the p, one dot, the same margins.
    const o = FIELD.outline;
    const right = FIELD.dots[0].cx + 21.8;
    const width = right - o.x;
    const box = [4, 32, width + 5, 56];
    return (
      <svg width={size * (box[2] / box[3])} height={size} viewBox={box.join(' ')} role="img" aria-label="Psss">
        <rect x={o.x} y={o.y} width={width} height={o.height} rx={o.rx} fill="none" stroke="currentColor" strokeWidth={w} />
        <path d={FIELD.p} fill="currentColor" stroke="currentColor" strokeWidth={FIELD.fat} strokeLinejoin="round" />
        <path d={FIELD.tail} fill="currentColor" />
        <circle cx={FIELD.dots[0].cx} cy={FIELD.dots[0].cy} r={heavy ? 9 : FIELD.dots[0].r} fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'p') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${B} ${B}`} role="img" aria-label="Psss">
        <g transform={`translate(${B / 2 - 30} ${B / 2 - 60}) scale(1)`}>
          <g transform="translate(30 64) scale(1.55) translate(-30 -64)">
            <path d={FIELD.p} fill="currentColor" stroke="currentColor" strokeWidth={FIELD.fat + (heavy ? 1.2 : 0)} strokeLinejoin="round" />
          </g>
        </g>
      </svg>
    );
  }
  // tile-p: the app icon's idea at favicon size: a butter rounded square with the ring and p.
  return (
    <span className="sm-tile" style={{ width: size, height: size, borderRadius: size * 0.2237 }}>
      <SmallMark kind="ring-p" size={size * 0.8} heavy={heavy} />
    </span>
  );
}

const SIZES = [16, 19, 24, 32, 48, 96];

function Strip({ kind, on }: { kind: Kind; on: 'cream' | 'charcoal' | 'butter' }) {
  return (
    <div className={`lg-tile ${on} sm-strip`}>
      {SIZES.map((s) => (
        <div key={s} className="sm-cell"><SmallMark kind={kind} size={s} heavy={s <= 24} /><span>{s}</span></div>
      ))}
    </div>
  );
}

/** A browser's toolbar and tab strip at real size, with the mark as the extension button and as the tab's favicon. */
function InBrowser({ kind, dark }: { kind: Kind; dark?: boolean }) {
  return (
    <div className={`sm-browser${dark ? ' dark' : ''}`}>
      <div className="sm-tabs">
        <div className="sm-tab on"><SmallMark kind={kind} size={16} heavy /><span>Psss: passwords that stay on your devices</span></div>
        <div className="sm-tab"><span className="sm-fav" /><span>Inbox</span></div>
      </div>
      <div className="sm-bar">
        <div className="sm-url">psss.app</div>
        <button className="sm-ext" aria-label="Psss"><SmallMark kind={kind} size={16} heavy /></button>
        <span className="sm-puzzle" />
      </div>
    </div>
  );
}

const OPTIONS: { kind: Kind; title: string; caption: ReactNode }[] = [
  { kind: 'ring-dot', title: 'A · The field as a ring, one dot', caption: 'The owner’s first idea: the outline closed into a circle, one hidden character in the middle. Reads at 16 px. Alone, it can pass for a radio button or a record button; nothing in it says “p”.' },
  { kind: 'ring-p', title: 'B · The ring with the p', caption: 'The ring with the logo’s p in it, its stem running down into the ring and cut flush with the outside, exactly as the stem runs into the field in the logo. Reads as a letter at 16 px and keeps the logo’s one unusual detail.' },
  { kind: 'field-p-dot', title: 'C · The field cut after the first place: p and one dot', caption: 'The most literal: the logo with two of its three dots taken away, and it reads well (“p•”). But it is wider than tall: the strips and the browser above draw it 16 px high, about 22 px wide, which a square toolbar or favicon slot does not allow; fitted into 16 × 16 it is about 12 px high.' },
  { kind: 'p', title: 'D · Just the p', caption: 'The p alone, larger. Very legible, but it loses the field, which is what makes the logo a password field; many brands are a lone p.' },
  { kind: 'tile-p', title: 'E · B on a butter tile (favicon)', caption: 'For a favicon, the app icon’s idea at small size: a butter rounded square with B in charcoal. Stands out in a row of tabs and matches the Home Screen icon; on a butter page it needs the tile edge.' },
];

export function SmallMarkPage() {
  return (
    <Page title="Small mark: toolbar button and favicon" status={<><strong>Exploration (2026-11-25), not decided.</strong> Starts from the owner: turn the field’s outline into a circle with one dot, for the browser panel’s icon and later the landing page’s favicon; or the p and one dot, or just the p.</>}>
      <div className="prose">
        <p>The full logo (a field with a p and three dots) is about twice as wide as tall, so at 16 px it becomes a thin line with specks. A small place needs a square mark built from the same parts. Sizes below: 16 and 19 px (toolbar button, favicon), 24, 32 (the same at 2×), 48 and 96. Up to 24 px the marks use a heavier cut (a 7 unit outline, a bigger dot), because a 5 unit line is under a pixel there.</p>
      </div>

      {OPTIONS.map((o) => (
        <div key={o.kind}>
          <Section title={o.title} />
          <Frames>
            <Frame label="Sizes on cream, charcoal and butter" caption={o.caption}>
              <div className="sm-col">
                <Strip kind={o.kind} on="cream" />
                <Strip kind={o.kind} on="charcoal" />
                {o.kind !== 'tile-p' && <Strip kind={o.kind} on="butter" />}
              </div>
            </Frame>
            <Frame label="At real size in a browser (light, dark)" caption="The extension’s toolbar button and the tab’s favicon, both 16 px, as Chrome draws them.">
              <div className="sm-col">
                <InBrowser kind={o.kind} />
                <InBrowser kind={o.kind} dark />
              </div>
            </Frame>
          </Frames>
        </div>
      ))}

      <Section title="Recommendation" />
      <Decisions
        items={[
          { decision: <><strong>B, the ring with the p</strong>, for the browser’s toolbar button (charcoal on light, butter on dark, as the browser’s own icons), and <strong>E</strong> (B on a butter tile) for the landing page’s favicon.</>, rejected: 'A (reads as a generic control), C (the closest to the logo, but wider than a square slot; a good choice where the slot can be wide, such as a page header), D (loses the field).', why: 'B keeps the two things that make the logo Psss’s: the field’s round outline and the p whose stem runs into it. It is the only one that is both square and still says “p” at 16 px.' },
        ]}
      />

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>New page: five small marks built from the logo’s parts (A ring and dot, B ring and p, C field with p and one dot, D the p, E B on a butter tile), each at 16 to 96 px on three grounds and in a browser toolbar and tab. Recommends B for the toolbar button and E for the favicon.</> },
        ]}
      />
    </Page>
  );
}
