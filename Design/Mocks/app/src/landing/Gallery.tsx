import type { ReactNode } from 'react';

export type Platform = 'iphone' | 'ipad' | 'mac';
export const platformNames: Record<Platform, string> = { iphone: 'iPhone', ipad: 'iPad', mac: 'Mac' };
const order: Platform[] = ['iphone', 'ipad', 'mac'];

/** One picture: the screen as the app draws it, and one short line saying what it shows. */
export interface Slide {
  /** At most about twelve words, from the visitor's side: what happens, not what to tap. */
  caption: string;
  /** The device frame with the screen in it. It is a picture: no handlers, no state. */
  screen: ReactNode;
}

/** A story's pictures for each platform it is drawn on. Leave a platform out where the app does not do this there. */
export type Pictures = Partial<Record<Platform, Slide[]>>;

/**
 * A swipe gallery (owner, 2026-11-27): one picture per step on a quiet tile, its
 * line underneath, in a row that scrolls sideways and snaps. Plain HTML and CSS, no
 * script: a finger swipes it, a trackpad scrolls it, the arrow keys move it
 * once it has focus. The platform switch is a group of radio buttons that CSS
 * reads (`:has`), so it too works without a script.
 * The screens are pictures, so their controls are switched off (`inert`) and
 * the caption carries the meaning for a screen reader.
 */
export function Gallery({ id, title, pictures }: {
  id: string;
  /** Names the gallery for a screen reader, e.g. “Which account?”. */
  title: string;
  pictures: Pictures;
}) {
  const shown = order.filter((p) => pictures[p]?.length);
  return (
    <figure className="lp-gal" id={id}>
      {shown.length > 1 && (
        <fieldset className="lp-gal-switch">
          <legend className="lp-vh">Show {title} on</legend>
          {shown.map((p, i) => (
            <label key={p}>
              <input type="radio" name={`on-${id}`} value={p} defaultChecked={i === 0} />
              <span>{platformNames[p]}</span>
            </label>
          ))}
        </fieldset>
      )}
      {shown.map((p) => (
        <ol key={p} className="lp-gal-track" data-platform={p} tabIndex={0} aria-label={`${title} on ${platformNames[p]}: ${pictures[p]!.length} pictures. Swipe or scroll sideways.`}>
          {pictures[p]!.map((s, i) => (
            <li className="lp-gal-slide" key={i}>
              <div className="lp-gal-tile"><div className="lp-gal-device" inert aria-hidden="true">{s.screen}</div></div>
              <p className="lp-gal-cap">{s.caption}</p>
            </li>
          ))}
        </ol>
      ))}
    </figure>
  );
}

/**
 * One screen alone, for the hero. The wrapper hides nothing: the picture inside
 * names itself for a screen reader and switches off its own controls (`HeroArt`).
 */
export function Shot({ children }: { children: ReactNode }) {
  return <div className="lp-shot lp-gal-device">{children}</div>;
}
