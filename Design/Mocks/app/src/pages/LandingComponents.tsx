import type { ReactNode } from 'react';
import { Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { copy } from '../landing/copy';
import { Gallery, Shot } from '../landing/Gallery';
import { HeroArt } from '../landing/pictures/hero';
import { cardsPictures } from '../landing/pictures/cards';
import { codeFillPictures } from '../landing/pictures/codeFill';
import { SiteLogo } from '../landing/SiteLogo';
import { Topics } from '../landing/Topics';
import { topicGroups } from '../landing/topicGroups';
import { Faq, Hero, Intro, Row, SiteFooter, SiteHeader, Story, WhatYouGet } from '../landing/sections';

/** A landing component on its own: forced light or dark, optionally at phone width. */
function Box({ dark, width, children }: { dark?: boolean; width?: number; children: ReactNode }) {
  return (
    <div className={`lp lpx-box ${dark ? 'lp-dark' : 'lp-light'}`} style={{ width: width ?? '100%', maxWidth: '100%', borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 1px var(--rule)' }}>
      {children}
    </div>
  );
}

/** Opens every row inside it, so a frame can show the open state. This is the mock page only; the real page opens a row with the browser's own disclosure. */
function Opened({ children }: { children: ReactNode }) {
  return <div ref={(el) => el?.querySelectorAll('details').forEach((d) => { d.open = true; })}>{children}</div>;
}

/*
 * The page sizes a gallery panel by the viewport (74vw, at most 300 px), and
 * the phone rules (iPhone pictures only) read the viewport too. This mock page
 * is viewed on a wide screen, so the narrow frame sizes a panel by its own
 * width and cannot show the phone-only rule: that rule is a media query and is
 * described in the caption instead.
 */
const narrowGallery = '.lpx-narrow .lp-gal-slide { width: min(74%, 300px); }';

/** The gallery sits inside the page's own wrapper, which gives it its side padding. */
const Wrap = ({ children }: { children: ReactNode }) => <div className="lp-wrap" style={{ paddingTop: 16, paddingBottom: 16 }}>{children}</div>;
const Tail = () => <div style={{ height: 32 }} />;

const groups = topicGroups();
/** The first group with its first row only, so a frame stays short. */
const oneGroup = { ...groups[0], topics: groups[0].topics.slice(0, 1) };

export function LandingComponents() {
  return (
    <Page
      title="Landing page components"
      status={<><strong>First draft, 2026-11-27; the look was approved by the owner in conversation, not built into a deployed site.</strong> The parts of the landing page as they are now, each on its own with its states. The whole page, in order, is <a href="#/landing">Landing page</a>; the galleries are on <a href="#/landing-demos-sign-in">signing in</a>, <a href="#/landing-demos-vault">your vault</a> and <a href="#/landing-galleries-more">browser and menu bar</a>. The page informs only: no buttons, no forms, no script, no flags. The plan is <code>docs/plans/landing-page.md</code>. All words are in <code>landing/copy.ts</code> and the picture files; every component takes them as props.</>}
    >
      <style>{narrowGallery}</style>

      <Section title="1. Header icon">
        <p>The header is the app icon, centred: a butter tile in the icon’s shape with the logo inside it, “to make it super clear it is an app” (owner). The logo is the original file, <code>Design/Logo/psss-logo.svg</code>, with its own stylesheet. On load it shows “psss” and hides it place by place, as the lock screen does when the vault locks; it then rests on a p and three dots, and hover or a tap shows the letters again. It takes no script. Under reduced motion it starts on the dots. <code>SiteLogo</code> takes <code>shown</code> to rest on “psss”.</p>
      </Section>
      <Frames>
        <Frame label="A. Header, light" caption="Cream band, butter tile, charcoal mark. At rest the mark is a p and three dots; hover it to see the letters.">
          <Box><SiteHeader /><Tail /></Box>
        </Frame>
        <Frame label="B. Header, dark" caption="Charcoal band. The tile keeps its butter in both appearances.">
          <Box dark><SiteHeader /><Tail /></Box>
        </Frame>
        <Frame phone label="C. Icon, shown" caption="The icon resting on “psss” (the state at load and on hover, drawn alone). Hover it and it hides.">
          <div className="lp lp-light" style={{ padding: 16, background: 'var(--hero)', display: 'flex', justifyContent: 'center' }}>
            <SiteLogo className="lp-header-logo" shown />
          </div>
        </Frame>
      </Frames>

      <Section title="2. Lead">
        <p>A centred headline and one line, then the lead picture across the width: the Mac app under the menu bar, the iPhone in front of it and the browser extension popup, all showing the same vault. It is a picture only: it is not interactive, and there is no button.</p>
      </Section>
      <Frames>
        <Frame label="D. Lead, light" caption="The picture scales to the width it is given. The lead is the only part of the page wider than the one text column.">
          <Box><Hero headline={copy.hero.headline} lead={copy.hero.lead} art={<Shot><HeroArt /></Shot>} /></Box>
        </Frame>
        <Frame label="E. Lead, dark" caption="Charcoal band; the picture keeps its own colours.">
          <Box dark><Hero headline={copy.hero.headline} lead={copy.hero.lead} art={<Shot><HeroArt /></Shot>} /></Box>
        </Frame>
        <Frame phone label="F. Lead at 390 px" caption="The same order, one column: headline, line, picture across the full width.">
          <Box width={390}><Hero headline={copy.hero.headline} lead={copy.hero.lead} art={<Shot><HeroArt /></Shot>} /></Box>
        </Frame>
      </Frames>

      <Section title="3. Section heading">
        <p>Each section opens with a prominent centred heading in the brand font and, where it has one, a line under it, followed by its panels (owner: preferred to small left-aligned titles). <code>Intro</code> is the one component for it.</p>
      </Section>
      <Frames>
        <Frame label="G. Heading with its line" caption="The list’s heading and the sentence that tells a visitor what to do with it.">
          <Box><div style={{ padding: '48px 0 16px' }}><div className="lp-wrap"><Intro id="ex-intro" heading={copy.painWall.heading} lead={copy.painWall.lead} /></div></div></Box>
        </Frame>
        <Frame label="H. Heading alone" caption="The story, the questions and “What you get” have no line under the heading, or have only the one they need.">
          <Box dark><div style={{ padding: '48px 0 16px' }}><div className="lp-wrap"><Intro id="ex-intro-2" heading={copy.story.heading} /></div></div></Box>
        </Frame>
      </Frames>

      <Section title="4. Row">
        <p>One row that opens: the browser’s own <code>details</code> element, so it needs no script. The words are the visitor’s own, in bold, with a chevron that turns when the row is open. Rows share a card and have a hairline between them. Space or Return on the focused row opens it. The row’s body holds a sentence and, for a topic, a gallery.</p>
      </Section>
      <Frames>
        <Frame label="I. Closed" caption="A row at rest: a moment in the visitor’s words and a chevron. Every row on the page starts closed.">
          <Box><Wrap><div className="lp-rows"><Row label={copy.pains[3].quote}><p className="lp-body">{copy.pains[3].elsewhere}</p></Row></div></Wrap></Box>
        </Frame>
        <Frame label="J. Open" caption="The chevron points up and the body shows under the label: the sentence, and where there is one a gallery.">
          <Box><Wrap><Opened><div className="lp-rows"><Row label={copy.pains[3].quote}><p className="lp-body">{copy.pains[3].elsewhere} {copy.pains[3].saves}</p></Row></div></Opened></Wrap></Box>
        </Frame>
        <Frame label="K. Open, dark" caption="The card takes the darker panel colour; the hairlines and chevron follow the muted text colour.">
          <Box dark><Wrap><Opened><div className="lp-rows"><Row label={copy.faq.items[0].q}><p className="lp-body">{copy.faq.items[0].a}</p></Row><Row label={copy.faq.items[1].q}><p className="lp-body">{copy.faq.items[1].a}</p></Row></div></Opened></Wrap></Box>
        </Frame>
      </Frames>

      <Section title="5. A group, and the list of groups">
        <p>The list is drawn like the app’s grouped lists (Settings): a small header above a card of rows, and a small line under the card saying where this is. Four groups, in this order: <strong>Signing in</strong>, <strong>In the app</strong>, <strong>In the browser</strong>, <strong>From the Mac menu bar</strong>. All rows are closed at first. Frame L shows one group alone, closed; frame M shows the same group with its first row open.</p>
      </Section>
      <Frames>
        <Frame label="L. A group, closed" caption="The header above the card (“Signing in”), the rows, and under the card the line “Psss fills in through the system’s own AutoFill.”">
          <Box><Topics heading={copy.painWall.heading} lead={copy.painWall.lead} groups={[oneGroup]} /><Tail /></Box>
        </Frame>
        <Frame label="M. A group, first row open" caption="The row opens to one sentence on what goes wrong elsewhere and what it saves, with a source link where one is cited, then the pictures. The platform switch sits at the top right of the opened row.">
          <Box><Opened><Topics heading={copy.painWall.heading} lead={copy.painWall.lead} groups={[oneGroup]} /></Opened><Tail /></Box>
        </Frame>
        <Frame label="N. The same, dark" caption="Light and dark follow the system setting; there is no switch on the page.">
          <Box dark><Opened><Topics heading={copy.painWall.heading} lead={copy.painWall.lead} groups={[oneGroup]} /></Opened><Tail /></Box>
        </Frame>
      </Frames>

      <Section title="6. Gallery">
        <p>A row of pictures, each a screen in its device frame straight on the card, with one short line under it (at most about twelve words, from the visitor’s side). The row scrolls sideways and snaps: a finger swipes it, a trackpad scrolls it and the arrow keys move it once it has focus. Where the app does the story on more than one platform an iPhone / iPad / Mac switch of radio buttons sits at the top right of the opened row; CSS reads it with <code>:has</code>, so it needs no script. On a phone, where a story has iPhone pictures, only those are shown and the switch is hidden, because a whole Mac window drawn that small would not be readable; a story drawn only for the Mac keeps its pictures. The screens are pictures: their controls are switched off and the line carries the meaning for a screen reader.</p>
      </Section>
      <Frames>
        <Frame label="O. iPhone only" caption="The code suggestion exists on iPhone only, so there is no switch. A panel fills most of the width and the next one starts to show.">
          <Box><Wrap><Gallery id="ex-o" title={copy.demos["code-fill"].title} pictures={codeFillPictures()} /></Wrap></Box>
        </Frame>
        <Frame label="P. With the platform switch" caption="iPhone is chosen first. Choosing iPad or Mac shows that platform’s row and hides the others. Outside an opened row the switch sits above the pictures; inside one it moves to the top right (frame M).">
          <Box><Wrap><Gallery id="ex-p" title="Two Visas" pictures={cardsPictures()} /></Wrap></Box>
        </Frame>
        <Frame label="Q. Narrow width" caption="One panel fills most of the width and the next peeks in from the right, so it is plain that there is more to swipe. The iPhone-only rule for phones is a viewport rule and does not show in this frame.">
          <div className="lpx-narrow"><Box width={390}><Wrap><Gallery id="ex-q" title={copy.demos["code-fill"].title} pictures={codeFillPictures()} /></Wrap></Box></div>
        </Frame>
      </Frames>

      <Section title="7. Story, what you get, questions, footer" />
      <Frames>
        <Frame label="R. Story" caption="Signed. What the owner still has to add is not marked on the page; it is listed under Open questions.">
          <Box><Story {...copy.story} /><Tail /></Box>
        </Frame>
        <Frame label="S. What you get" caption="The same card as the list: a few words and a line under each, with no chevron because nothing opens.">
          <Box><WhatYouGet heading={copy.whatYouGet.heading} items={copy.whatYouGet.items} /><Tail /></Box>
        </Frame>
        <Frame label="T. Questions" caption="The same card again, every answer closed. “Who can read my passwords?” says that no outside audit has been done yet.">
          <Box><Faq {...copy.faq} /><Tail /></Box>
        </Frame>
        <Frame label="U. Questions, one open, dark" caption="An answer is a plain sentence under its question.">
          <Box dark><Opened><Faq heading={copy.faq.heading} items={copy.faq.items.slice(0, 2)} /></Opened><Tail /></Box>
        </Frame>
        <Frame label="V. Footer" caption="What the page does not use: no cookies, no analytics, no outside scripts or fonts; then who owns which name.">
          <Box><SiteFooter lines={copy.footer.lines} /></Box>
        </Frame>
      </Frames>

      <Section title="8. Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>1. Swipe galleries with a script-free platform switch (owner, 2026-11-27).</strong> A row of pictures, one short line under each, sideways scroll with snap, and an iPhone / iPad / Mac switch. The page ships no JavaScript.</>,
            rejected: <>interactive, self-playing demos with Back and Next, and a placeholder slot per demo.</>,
            why: <>The owner: the demos did not look good; galleries work better on a phone. A row of pictures also reads without a script and cannot get stuck mid-step.</>,
          },
          {
            decision: <><strong>2. The original logo file with its letter-by-letter reveal.</strong> <code>Design/Logo/psss-logo.svg</code> and its stylesheet are imported as they are.</>,
            rejected: <>a redrawn copy of the logo for the page.</>,
            why: <>One logo, one source: a change to the brand file reaches the page without a second edit.</>,
          },
          {
            decision: <><strong>3. No notice with a coloured left edge, and the brand font on headings only.</strong> A saving is a plain sentence; the body, captions and rows use the system text face.</>,
            rejected: <>a callout bar for the saving; Varela Round on the whole page.</>,
            why: <>An edge reads as an alert and a saving is not one; the system face reads better in paragraphs and on a phone (owner).</>,
          },
          {
            decision: <><strong>4. No “Coming”, “In development” or “Not released” flag anywhere, and no “Where it stands” section.</strong> The page shows each story as a picture and says nothing about whether it is built (owner: “stop adding the in development, not ready tips and flags”). The record of what is built stays in each topic’s <code>status</code> and <code>statusNote</code> fields, shown on <a href="#/landing-galleries-more">Landing galleries: browser and menu bar</a> and not on the page.</>,
            rejected: <>a “Works in test builds” label on every item; then only “Coming” on what is unbuilt; then a “Where it stands” list.</>,
            why: <>The owner found flags on the page noise. See “Departures” below: this one costs the page some of its truthfulness, and the owner chose it.</>,
          },
          {
            decision: <><strong>5. No calls to action and no waitlist.</strong> No header or hero button, no form, nothing to sign up for.</>,
            rejected: <>a “Tell me when it is ready” button and a waitlist form.</>,
            why: <>The owner: keep the site informative and really just showcasing the value. No form also means nothing to store, validate or secure.</>,
          },
          {
            decision: <><strong>6. The lead picture is one composed picture:</strong> the Mac app under the menu bar, the iPhone and the browser extension together (<code>landing/pictures/hero.tsx</code>).</>,
            rejected: <>the single iPhone screen of the first fill demo.</>,
            why: <>It shows at a glance that one vault works on every device and in the browser, which is the product; one phone screen showed one feature.</>,
          },
          {
            decision: <><strong>7. A calm list: groups of closed rows, each opening to its pictures.</strong> Four groups: Signing in, In the app, In the browser, From the Mac menu bar. Each row is a moment in the visitor’s own words and uses the browser’s <code>details</code>.</>,
            rejected: <>a wall of pain cards linking to a full section each, with its heading, sentence, gallery and saving line open all the time.</>,
            why: <>The owner: “give users a calm list and let them explore”. Everything is closed, so the page is short and the visitor opens only what they know.</>,
          },
          {
            decision: <><strong>8. Captions under the pictures, and the page restyled to be calm like an Apple product page.</strong> The lead of the page is the app icon, centred, so it is clear that this is an app.</>,
            rejected: <>a line above each picture; a left-aligned header with a button; a wide page.</>,
            why: <>A caption reads best after the picture it explains. The calm look and the icon are the owner’s: “to make it super clear it is an app”.</>,
          },
          {
            decision: <><strong>9. One column, few text sizes (a step smaller on a phone), and one list style.</strong> Lists are drawn like the app’s grouped lists (a small header above a card, a small line under it); “What you get” and “Questions” are the same card; pictures sit straight on the card; the platform switch is at the top right of an opened row; on a phone only iPhone pictures show where a story has them.</>,
            rejected: <>five text sizes, twelve styles and five left edges, which a visual review measured on the earlier page.</>,
            why: <>Fewer styles make a calmer page and one that is easier to keep. A phone cannot show a Mac window at a readable size.</>,
          },
          {
            decision: <><strong>10. Section headings are prominent, centred and followed by a line, then the panels.</strong></>,
            rejected: <>small left-aligned titles over each panel.</>,
            why: <>The owner preferred the centred headings.</>,
          },
          {
            decision: <><strong>11. Every component is a pure function of its props, with the words in <code>landing/copy.ts</code> and the picture files, and all styles sit under <code>.lp</code> and use classes only.</strong> Light and dark follow the system; <code>lp-light</code> and <code>lp-dark</code> force one for this mock page.</>,
            rejected: <>words written inside each component; styling bare elements, which would leak into the device frames.</>,
            why: <>One place to read and check every sentence, and a component that renders the same in the mock and on the server. The frames inside keep the mock app’s own look.</>,
          },
          {
            decision: <><strong>12. Text is smaller on a phone (owner, 2026-11-27).</strong> Body 16 to 17, supporting 14 to 15, lead line 18 to 22 and group heading 20 to 22, each growing with the width.</>,
            rejected: <>17, 15 and 22 at every width.</>,
            why: <>On a phone the lead ran to six lines and the body looked too large (owner).</>,
          },
          {
            decision: <><strong>13. A gallery keeps its scrollbar for a mouse</strong> and hides it only where a finger swipes.</>,
            rejected: <>no scrollbar anywhere; arrow buttons, which need a script.</>,
            why: <>Without it a mouse with no trackpad had no visible way along the row.</>,
          },
        ]}
      />

      <Section title="9. Departures from Apple’s guidance or the product contract">
        <ul>
          <li><strong>The page shows things that are not built or not released without saying so</strong> (owner, 2026-11-27). With every flag removed, the menu bar panel (“From the Mac menu bar”) and the search pills show as if they ship, and so do the browser stories that rest on a prototype. This departs from the truthful-language rule in <code>docs/product.md</code> (a status is stated only when the roadmap says it). The owner chose it; the per-topic <code>status</code> and <code>statusNote</code> fields keep the record, and <a href="#/landing-galleries-more">Landing galleries: browser and menu bar</a> shows them.</li>
          <li><strong>The iPad and Mac pictures show a platform’s window on a page</strong> that a phone cannot show at a readable size, so on a phone only iPhone pictures are offered where a story has them. That is a choice about what is shown, not a claim.</li>
          <li><strong>The pictures are drawn, not screenshots.</strong> They are the mock app’s own screens in device frames, with made-up names and numbers. They are not photographs of a device and the page does not say they are.</li>
        </ul>
      </Section>

      <Section title="10. Open questions for the owner">
        <ul>
          <li>Story: add, in your own words, why the family left 1Password 7 and one or two things that actually went wrong at home. The text guesses neither.</li>
          <li>Signature: just “Kaspars”, or a full name and a link to an About page?</li>
          <li>Re-check the two linked forum reports (the 1Password QR thread and the Bitwarden accounts thread) before publishing: that they are still up and still say what the page says, or drop them.</li>
          <li>Replace the drawn pictures with real device screenshots at release.</li>
          <li>The Cloudflare Pages project and the domain are not set up yet.</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-27', text: <>The space between the lead picture and “Sound familiar?” was about halved (owner: reduce the gap). Replaced the full section spacing under a deep hero padding, 216 px on a wide screen and 112 px on a phone, with about 88 and 56.</> },
          { date: '2026-11-27', text: <>After a check against Chrome’s Modern Web Guidance: text became a step smaller on a phone (body 16, lead 18) in place of 17 and 22 everywhere; galleries show their scrollbar to a mouse in place of none; the skip link was removed, since the header holds nothing to skip; the chosen platform is outlined in forced colours; the lists say they are lists; and a gallery’s name no longer tells how to scroll it.</> },
          { date: '2026-11-27', text: <>Every heading became Nunito at 700 with slightly tighter lines (owner: “nunito at 700 for all headings”). Replaced Varela Round, whose single weight looked too light. The logo keeps its Varela Round letters.</> },
          { date: '2026-11-27', text: <>Section headings became prominent and centred again, with a line under them, followed by the panels (frames G and H). Replaced the small left-aligned titles over each panel, because the owner preferred the centred ones.</> },
          { date: '2026-11-27', text: <>A visual review measured five sizes, twelve styles and five left edges, so the page became one column with lists drawn like the app’s grouped lists (a small header above a card, a small line under it), “What you get” and “Questions” as the same card, pictures straight on the card, the platform switch at the top right of an opened row and, on a phone, only iPhone pictures where a story has them. Replaced the mixed styles of the earlier page. Frames I to Q.</> },
          { date: '2026-11-27', text: <>Picture captions moved under the pictures, the page was restyled to be calm like an Apple product page, and the header became the app icon, centred, “to make it super clear it is an app”. On load the icon shows “psss” and hides it place by place as the lock screen does, then rests on the dots with the hover reveal. Replaced the header logo with a status line beside it, the line above each picture and the wider layout. Frames A to C.</> },
          { date: '2026-11-27', text: <>The pains and their galleries became a calm list: groups of rows (the browser’s own <code>details</code>), all closed, each opening to its pictures, in four groups: Signing in, In the app, In the browser, From the Mac menu bar. Replaced the wall of pain cards and a full section for each pain; the owner: give users a calm list and let them explore. Frames I to N.</> },
          { date: '2026-11-27', text: <>The lead picture became the Mac app under the menu bar, the iPhone and the browser extension together, replacing the single iPhone screen of the fill demo, to show at once that one vault works everywhere. Frames D to F.</> },
          { date: '2026-11-27', text: <>All calls to action and the waitlist were removed: the header and hero buttons, the form and its error state. Replaced the “Tell me when it is ready” button and form; the owner: keep the site informative and really just showcasing the value.</> },
          { date: '2026-11-27', text: <>Every “Coming” and “In development” flag, the “Not released” marks and the “Where it stands” section were removed, after the “Works in test builds” labels had gone. Replaced a label on every item, then a label on what was unbuilt, because the owner said to stop adding the in development, not ready tips and flags. The record stays in each topic’s <code>status</code> and <code>statusNote</code> fields; see “Departures”.</> },
          { date: '2026-11-27', text: <>The header uses the original logo file with its letter-by-letter reveal, there are no notices with a left border, and Varela Round (the brand font) is limited to headings. Replaced a redrawn logo, a coloured edge on the saving line and the brand font on the whole page.</> },
          { date: '2026-11-27', text: <>Swipe galleries with a script-free iPhone / iPad / Mac switch replaced the interactive, self-playing demos, so the page ships no JavaScript. The owner: the demos did not look good; galleries work better on a phone.</> },
          { date: '2026-11-27', text: <>First draft of the landing page: sections with interactive, self-playing demos, a waitlist and call-to-action buttons. Nothing replaced.</> },
        ]}
      />
    </Page>
  );
}
