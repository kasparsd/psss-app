import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { FIELD, ICON_FIELD, ICON_FILL } from '../logoField';
import './Logo.css';

// The drawing comes from scripts/build-logo.mjs, which also writes the logo
// files in Design/Logo and the landing page's logo, so all three agree.
// `u` is pixels per unit of the mark.

/** A field in one of its two states. `fade` keeps both states in the drawing and cross-fades them. */
interface FieldProps { u: number; mask?: boolean; fade?: boolean; /** The app icon's heavier cut. */ icon?: boolean }
type FieldDrawing = ComponentType<FieldProps>;

/** Pixels per unit for the app icon's field in an icon `size` pixels wide. */
export const iconU = (size: number) => (size * ICON_FILL) / ICON_FIELD.box[2];

/** The logo's field: hidden (p and three dots) with `mask`, shown (psss) without. */
export const Mark: FieldDrawing = ({ u, mask, fade, icon }) => {
  const F = icon ? ICON_FIELD : FIELD;
  const [x, y, w, h] = F.box;
  return (
    <svg className="lg-art" viewBox={`${x} ${y} ${w} ${h}`} width={w * u} height={h * u} role="img" aria-label={mask ? 'Field with a p and three dots' : 'Field with psss typed in it'}>
      <rect {...F.outline} fill="none" stroke="currentColor" strokeWidth={F.line} />
      <g fill="currentColor" stroke="currentColor" strokeWidth={F.fat} strokeLinejoin="round">
        <path d={F.p} />
        {F.s.map((d, i) => {
          // Each s and its dot share a place. The delay makes them go one after another, as when typing.
          const style = { transitionDelay: `${i * 70}ms` };
          const dot = F.dots[i];
          return (
            <g key={i}>
              {(fade || !mask) && <path className={`lg-s${mask ? ' off' : ''}`} style={style} d={d} />}
              {(fade || mask) && <circle className={`lg-d${mask ? '' : ' off'}`} style={style} cx={dot.cx} cy={dot.cy} r={dot.r} stroke="none" />}
            </g>
          );
        })}
      </g>
      <path d={F.tail} fill="currentColor" />
    </svg>
  );
};

// ── Tiles ───────────────────────────────────────────────────────────────

const Tile = ({ on, col, children }: { on: 'butter' | 'cream' | 'charcoal' | 'home'; col?: boolean; children: ReactNode }) => (
  <div className={`lg-tile ${on}${col ? ' col' : ''}`}>{children}</div>
);

/**
 * The logo as it behaves on the website. It rests in one state and switches
 * while the pointer is over it or it has keyboard focus. A finger has no
 * hover, so a tap switches it and the next tap switches it back.
 */
function HoverLogo({ draw: Draw, u, rest }: { draw: FieldDrawing; u: number; rest: 'shown' | 'hidden' }) {
  const [over, setOver] = useState(false);
  const [tapped, setTapped] = useState(false);
  const pointer = useRef('mouse');
  const switched = over || tapped;
  const mask = rest === 'hidden' ? !switched : switched;
  return (
    <button
      className="lg-hover"
      aria-label="Psss"
      onPointerDown={(e) => { pointer.current = e.pointerType; }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOver(true); }}
      onPointerLeave={() => setOver(false)}
      onFocus={() => setOver(true)}
      onBlur={() => { setOver(false); setTapped(false); }}
      onClick={() => { if (pointer.current !== 'mouse') { setOver(false); setTapped((t) => !t); } }}
    >
      <Draw u={u} mask={mask} fade />
    </button>
  );
}

/** An app icon as the Home Screen shows it: the hidden field, the system's rounding and the name underneath. */
function AppIcon({ size, draw: Draw, dark }: { size: number; draw: FieldDrawing; dark?: boolean }) {
  return (
    <div className="lg-app">
      <div className={`lg-appicon${dark ? ' dark' : ''}`} style={{ width: size, height: size }}>
        <Draw u={iconU(size)} mask icon />
      </div>
      <span>Psss</span>
    </div>
  );
}

const IconSizes = ({ draw }: { draw: FieldDrawing }) => (
  <Tile on="home">
    <AppIcon size={96} draw={draw} />
    <AppIcon size={60} draw={draw} />
    <AppIcon size={60} draw={draw} dark />
    <AppIcon size={29} draw={draw} />
  </Tile>
);

export function Logo() {
  return (
    <Page title="Logo: one field, shown and hidden" status={<><strong>Approved by the owner, 2026-11-24.</strong> The logo files are in <code>Design/Logo</code> and the landing page uses them. The app icon is redrawn from it and the lock screen switches.</>}>
      <div className="prose">
        <p>The logo is one password field in two states. <strong>Hidden</strong>, it is a p and three dots. <strong>Shown</strong>, each dot is the s it stands for and the field reads “psss”. It rests hidden and shows the name while the pointer is over it. Move the pointer over a logo marked “hover” to switch it; on a touch screen, tap it.</p>
      </div>

      <Section title="The two resting states">
        <p>Both are kept. The first is the default.</p>
      </Section>
      <Frames>
        <Frame label="Rests hidden (default), and rests shown" caption={<>First: the default. The field rests on the dots and shows the name on hover. Second: the other way round, for a place where the name has to be readable before anyone touches anything; it hides the name on hover. On the landing page the choice is one class on the drawing (<code>rest-shown</code>).</>}>
          <div className="lg-board">
            <Tile on="butter" col><HoverLogo draw={Mark} u={1.7} rest="hidden" /><span>Rests hidden (hover)</span></Tile>
            <Tile on="cream" col><HoverLogo draw={Mark} u={1.7} rest="shown" /><span>Rests shown (hover)</span></Tile>
            <Tile on="charcoal" col><HoverLogo draw={Mark} u={1.7} rest="hidden" /><span>On dark (hover)</span></Tile>
          </div>
        </Frame>
      </Frames>

      <Section title="The drawing">
        <p>Varela Round, the wordmark's typeface, thickened to a 6 unit line, a little heavier than the field's 5 unit outline. The letters are spaced wider than the typeface sets them. The dots sit in the letters' places. The p's stem runs down into the field's bottom line and is cut flush with the field's outer edge. The word sits in the middle of the field, with the same space on its left and right.</p>
      </Section>
      <Frames>
        <Frame label="Hidden, shown, small, and the icon" caption={<>In the hidden state the last dot is narrower than the s it replaces, so the space on the right is just under 1 unit larger there; the dots stay in the letters' places so that the switch does not move anything. The third tile shows both states at a header size and at a very small one. The last tile is the app icon, drawn flat: the same drawing in a heavier cut (a 6.5 unit outline and 7.4 unit letters), because the system's glass eats into a thin line, in a field 6 units wider than the logo's, because under the glass the sides looked tighter than the top. The shipped icon uses this drawing; how the glass treats it at each size still has to be looked at on a device.</>}>
          <div className="lg-board">
            <Tile on="butter"><Mark u={1.9} mask /></Tile>
            <Tile on="butter"><Mark u={1.9} /></Tile>
            <Tile on="cream"><Mark u={0.5} mask /><Mark u={0.5} /><Mark u={0.32} mask /><Mark u={0.32} /></Tile>
            <IconSizes draw={Mark} />
          </div>
        </Frame>
      </Frames>

      <Section title="In the app">
        <p><strong>The lock screen.</strong> Its header is the app icon over “Psss Is Locked”. Locked, the icon is the hidden field; when the vault opens, the dots become “sss”. The states are drawn on the <a href="#/unlock-screen">Unlock page</a>, where the glyph and the Unlock button play it. Built.</p>
        <p>Other places where it fits, not drawn yet: the first-launch screen (“Create your vault”), where the shown field can be the header; and the About window on Mac, where it can switch on hover. Not in the AutoFill sheet, which has to stay instant, and not at the top left of the main screen.</p>
      </Section>

      <Section title="Decisions" />
      <Decisions items={[
        {
          decision: <>The logo is the field alone, in two states: hidden (p and three dots) and shown (psss).</>,
          rejected: <>the mark followed by the wordmark; a field with only dots beside the name; the name stacked over the field; a speech bubble; dots with no field.</>,
          why: <>The earlier lockup said the name twice. One field in two states spells the name, keeps the dots as the symbol, and keeps the field that makes dots read as a password.</>,
        },
        {
          decision: <>It rests hidden and shows the name on hover or tap. The reverse (rests shown) is kept as an option.</>,
          why: <>The dots are the mark people know from the app icon; the name is the small reward for looking. Where the name must be readable at rest, the other mode is one class away.</>,
        },
        {
          decision: <>Letters: Varela Round thickened to 6 units against the outline's 5, spaced wider, with the p's stem merging into the bottom line and cut at the field's outer edge. Equal space left and right of the word.</>,
          rejected: <>the typeface's regular weight; single-line letters in the outline's own line; heavier letters in a thinner outline.</>,
          why: <>Letters lighter than the outline were hard to read. The typeface's s reads as writing; the geometric one did not.</>,
        },
        {
          decision: <>In the app the switch belongs to the lock screen, while the vault opens.</>,
          rejected: <>an animated logo at the top left of the main screen on launch.</>,
          why: <>Apple's guidance is to launch instantly and not to brand the launch, and the top left of the main screen is taken on every device.</>,
        },
      ]} />

      <Section title="Still open">
        <ul>
          <li>A look at the new app icon on a device, in every appearance (default, dark, tinted, clear) and at the small sizes.</li>
          <li>Whether the plain wordmark stays for places that need a bigger name. Its files are still in <code>Design/Logo</code>.</li>
        </ul>
      </Section>

      <History entries={[
        { date: '2026-11-24', text: <>The app icon's field was widened by 6 units (3 on each side), and the field now takes 77.8 percent of the icon's width so that it stays as tall as before. With the glass applied, the top of the field appeared to have more room than the sides (owner). The logo's own field is unchanged.</> },
        { date: '2026-11-24', text: <>The app icon was redrawn from the logo: the same field and p in a heavier cut, with a new small-size cut for the favicon. Before, the icon tile here was a preview of an icon that did not exist yet. The owner asked whether the Home Screen icon could change with the lock state; it was dropped (on iPhone and iPad the system shows an alert on every icon change).</> },
        { date: '2026-11-24', text: <>Approved by the owner. The logo rests hidden and shows the name on hover; an earlier recommendation was the reverse (rest shown, hide on hover), and that mode is kept as an option. The frame comparing it with the earlier mark-plus-wordmark lockup was removed, and that lockup's files were deleted. The logo files, the landing page's logo and these drawings now come from one script, <code>scripts/build-logo.mjs</code>.</> },
        { date: '2026-11-24', text: <>The p's stem ended in a round cap that reached about a unit past the field's outer edge. It is now cut by the field's own outer edge (owner: the p must not go outside the field).</> },
        { date: '2026-11-24', text: <>The owner asked for letters a bit thicker than the field's outline, with the p still touching and merging with it: the letters went from 5 to 6 units, the spacing opened a little more and the dots grew to match. The owner approved the lock screen as the place for the switch in the app; its sketch here moved to the Unlock page. The owner's first idea, the logo at the top left on launch, was not taken: Apple's guidance is to launch instantly and not to use the launch as a branding moment, and the top left of the main screen holds the back button and title on iPhone and the sidebar and window controls on iPad and Mac.</> },
        { date: '2026-11-24', text: <>The owner chose the typeface's letters, thickened to the outline's weight, allowed more space between the letters and the dots, and asked for equal space on both sides of the word, which the wider field gives. Two other versions of the letters were dropped: single-line letters in the outline's own 5 unit line (the hidden state was exactly the approved mark, so the icon would not have changed, but the s was plain geometry), and 6 unit letters inside a thinner 4 unit outline (the most readable when small, but the icon's outline would have become thinner than the glass allows). The owner also asked where the switch could live in the app, suggesting the top left at launch; the lock screen is proposed instead.</> },
        { date: '2026-11-24', text: <>The owner chose the direction “one field, shown and hidden”, liked the switch on hover, and asked for the p to be the same weight as the outline or fatter. The first sketch of it used Varela Round at its regular weight inside the field, which was lighter than the outline, and switched with a button; it is replaced by three versions of the letters and a logo that switches on hover.</> },
        { date: '2026-11-24', text: <>Four other directions were drawn and dropped. Dots in the field with the name beside it: nothing said twice, but a field with only dots is the generic picture for “password”, so the icon stopped being recognisably Psss. The name stacked over the field, as a square icon that spells the name: the word is a few pixels tall at 29 pt and the name appears twice on the Home Screen. A speech bubble with three dots (“psss” as a whisper): it reads as the “someone is typing” sign from Messages. Three dots with no field, and p with three dots: a “more” button or a sentence trailing off, which was the owner's own finding.</> },
        { date: '2026-11-24', text: <>Page added. The owner asked whether “psss” should be spelled out with the three dots as the symbol, since the mark approved on 2026-11-22 (p and three dots in a field, with the wordmark beside it) never spells the name.</> },
      ]} />
    </Page>
  );
}
