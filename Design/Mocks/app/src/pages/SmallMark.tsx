import { Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { FIELD } from '../logoField';
import './Logo.css';
import './SmallMark.css';

/**
 * The small mark for places where the full field (p and three dots) is too wide: the browser's toolbar button, a favicon and
 * similar. The logo's field closed into a ring, with one of its dots (one hidden character) in the middle.
 *
 * `filled`: the inside of the ring is butter, the ring and dot charcoal, on every background.
 * `heavy` is a cut for 16–24 px: a thicker ring and a bigger dot, because a 5 unit line at 16 px is under a pixel.
 */
const B = 56; // drawn in a 56 unit box, the field's height
const C = B / 2;
const BUTTER = '#FFD84D';
const CHARCOAL = '#1F1F23';

function SmallMark({ size, heavy, filled }: { size: number; heavy?: boolean; filled?: boolean }) {
  const w = heavy ? 7 : FIELD.line;
  const r = C - w / 2;
  const ink = filled ? CHARCOAL : 'currentColor';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${B} ${B}`} role="img" aria-label="Psss">
      <circle cx={C} cy={C} r={r} fill={filled ? BUTTER : 'none'} stroke={ink} strokeWidth={w} />
      <circle cx={C} cy={C} r={heavy ? 10 : 8} fill={ink} />
    </svg>
  );
}

const SIZES = [16, 19, 24, 32, 48, 96];

function Strip({ filled, on }: { filled?: boolean; on: 'cream' | 'charcoal' | 'butter' }) {
  return (
    <div className={`lg-tile ${on} sm-strip`}>
      {SIZES.map((s) => (
        <div key={s} className="sm-cell"><SmallMark size={s} heavy={s <= 24} filled={filled} /><span>{s}</span></div>
      ))}
    </div>
  );
}

/** A browser's tab strip and toolbar at real size, with the mark as the tab's favicon and the extension's button. */
function InBrowser({ filled, dark }: { filled?: boolean; dark?: boolean }) {
  return (
    <div className={`sm-browser${dark ? ' dark' : ''}`}>
      <div className="sm-tabs">
        <div className="sm-tab on"><SmallMark size={16} heavy filled={filled} /><span>Psss: passwords that stay on your devices</span></div>
        <div className="sm-tab"><span className="sm-fav" /><span>Inbox</span></div>
      </div>
      <div className="sm-bar">
        <div className="sm-url">psss.app</div>
        <button className="sm-ext" aria-label="Psss"><SmallMark size={16} heavy filled={filled} /></button>
        <span className="sm-puzzle" />
      </div>
    </div>
  );
}

export function SmallMarkPage() {
  return (
    <Page title="Small mark: toolbar button and favicon" status={<><strong>Decided by the owner, 2026-11-25:</strong> A2 (butter inside, charcoal ring and dot) is the small mark everywhere; A, outline in one colour, is the monochrome fallback.</>}>
      <div className="prose">
        <p>The full logo (a field with a p and three dots) is about twice as wide as tall, so at 16 px it becomes a thin line with specks. The small mark closes the field into a ring and keeps one dot, one hidden character, in the middle. Sizes: 16 and 19 px (toolbar button, favicon), 24, 32 (the same at 2×), 48 and 96. Up to 24 px it uses a heavier cut (a 7 unit ring, a bigger dot), because a 5 unit line is under a pixel there.</p>
      </div>

      <Section title="A · Outline: the ring and dot in one colour" />
      <Frames>
        <Frame label="Sizes on cream, charcoal and butter" caption="One colour: charcoal on light grounds, butter on dark. The browser needs a light and a dark file, and a toolbar that is neither (a coloured theme) gets whichever is closer.">
          <div className="sm-col"><Strip on="cream" /><Strip on="charcoal" /><Strip on="butter" /></div>
        </Frame>
        <Frame label="At real size in a browser (light, dark)" caption="The tab’s favicon and the extension’s toolbar button, both 16 px.">
          <div className="sm-col"><InBrowser /><InBrowser dark /></div>
        </Frame>
      </Frames>

      <Section title="A2 · Filled: the inside of the ring is butter" />
      <Frames>
        <Frame label="Sizes on cream, charcoal and butter" caption="The ring and dot stay charcoal and the inside is butter, on every ground. One file works on light, dark and coloured toolbars, the charcoal ring gives it an edge on butter and white, and it is the app icon’s colours in a circle.">
          <div className="sm-col"><Strip on="cream" filled /><Strip on="charcoal" filled /><Strip on="butter" filled /></div>
        </Frame>
        <Frame label="At real size in a browser (light, dark)" caption="The same file in both: it does not depend on the browser telling the extension which theme it has.">
          <div className="sm-col"><InBrowser filled /><InBrowser filled dark /></div>
        </Frame>
      </Frames>

      <Section title="Decision" />
      <Decisions
        items={[
          { decision: <><strong>A2, filled</strong>, by default: the browser’s toolbar button and the landing page’s favicon. <strong>A, outline</strong>, is the monochrome fallback wherever one colour is required (a template image, one-colour print, a ground where butter does not work).</>, rejected: 'A for the toolbar; a cream ring (A3); a butter dot with a black or white ring (A4).', why: 'Chrome draws an extension’s toolbar icon from one image, whatever the theme; a filled mark reads on every toolbar without a light and dark pair, and carries the brand colour.' },
        ]}
      />

      <History
        entries={[
          { date: '2026-11-25', text: <>Owner decided: A2 by default, A (outline) as the monochrome fallback. Removed A4.</> },
          { date: '2026-11-25', text: <>Owner: the cream ring (A3) has too little contrast against the butter inside; dropped. Stay with A, and try a colour cut with the dot butter on light and dark and the ring black or white: added A4.</> },
          { date: '2026-11-25', text: <>Owner: try a light ring with the butter inside on a dark browser. Added A3 (cream ring, butter inside, charcoal dot) beside A2 in a dark toolbar.</> },
          { date: '2026-11-25', text: <>Owner chose A, the ring with one dot, and asked for a version with the inside butter (A2). Removed the ring with the p, the field with a p and one dot, the p alone and the butter tile.</> },
          { date: '2026-11-25', text: <>New page: five small marks built from the logo’s parts (ring and dot, ring and p, field with p and one dot, the p, a butter tile), each at 16 to 96 px and in a browser.</> },
        ]}
      />
    </Page>
  );
}
