// The logo itself, not a redrawing: the file scripts/build-logo.mjs writes, with its own stylesheet.
import logo from '../../../../Logo/psss-logo.svg?raw';
import '../../../../Logo/psss-logo.css';

/**
 * The app icon with the logo alive inside it (owner, 2026-11-27: the icon makes
 * it plain that this is an app). A butter tile in the icon's shape, and in it
 * the logo's field at the icon's 77.8 percent width (docs/brand.md, "App icon"):
 * hidden at rest, a p and three dots, and on hover or a tap each dot turns into
 * its s, one after the other. `shown` rests on “psss” and hides instead.
 * The tile is the label of an unseen checkbox, so a tap switches it with no
 * script: once to change, again to change back.
 */
export function SiteLogo({ shown = false, className = '' }: { shown?: boolean; className?: string }) {
  const svg = shown ? logo.replace('class="psss-logo"', 'class="psss-logo rest-shown"') : logo;
  return (
    <label className={`lp-appicon ${className}`.trim()}>
      <input type="checkbox" className="psss-switch" autoComplete="off" aria-label={shown ? 'Hide the name in the logo' : 'Show the name in the logo'} />
      <span className="lp-appicon-art" dangerouslySetInnerHTML={{ __html: svg }} />
    </label>
  );
}
