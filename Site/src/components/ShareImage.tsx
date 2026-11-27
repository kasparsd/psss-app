import '@mocks/styles.css';
import { copy } from '@mocks/landing/copy';
import { HeroArt } from '@mocks/landing/pictures/hero';
import { SiteLogo } from '@mocks/landing/SiteLogo';
import '@mocks/landing/landing.css';
import './site.css';
import './share.css';

/** Always the dark look, whatever the viewer's setting: a preview is one picture. */
export function ShareImage() {
  return (
    <div className="lp lp-dark share">
      <div className="share-words">
        <SiteLogo />
        <h1 className="lp-h1">{copy.hero.headline}</h1>
      </div>
      <HeroArt />
    </div>
  );
}
