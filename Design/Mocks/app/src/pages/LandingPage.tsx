import { copy } from '../landing/copy';
import { Shot } from '../landing/Gallery';
import { HeroArt } from '../landing/pictures/hero';
import { Topics } from '../landing/Topics';
import { topicGroups } from '../landing/topicGroups';
import { Faq, Hero, SiteFooter, SiteHeader, Story, WhatYouGet } from '../landing/sections';

/**
 * The whole landing page: the logo, the lead picture (Mac, iPhone and the
 * browser extension together), a calm list of the moments that go wrong, each
 * row opening to its pictures, the story, what you get, and questions.
 * Plain HTML; nothing on it needs a script.
 */
export function LandingPage() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">{copy.site.skip}</a>
      <SiteHeader />
      <main id="main">
        <Hero headline={copy.hero.headline} lead={copy.hero.lead} art={<Shot><HeroArt /></Shot>} />
        <Topics heading={copy.painWall.heading} lead={copy.painWall.lead} groups={topicGroups()} />
        <Story {...copy.story} />
        <WhatYouGet heading={copy.whatYouGet.heading} items={copy.whatYouGet.items} />
        <Faq {...copy.faq} />
      </main>
      <SiteFooter lines={copy.footer.lines} />
    </div>
  );
}
