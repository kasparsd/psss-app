import '../landing/landing.css';
import { Decisions, History, Page, Section } from '../components/page';
import { Gallery, platformNames, type Platform } from '../landing/Gallery';
import { browserGroup, browserTopics } from '../landing/pictures/browser';
import { menuBarGroup, menuBarTopics } from '../landing/pictures/menuBar';
import type { Topic } from '../landing/Topics';

/**
 * Mock page for the last two groups of the landing page's list: “In the
 * browser” and “From the Mac menu bar”. It draws every gallery of
 * `browserTopics()` and `menuBarTopics()` as the page draws it, with the
 * topic's words above it and, here only, its status and status note. The
 * landing page itself shows no status (owner, 2026-11-27); this page is where
 * the record of what is built can be read.
 */

const order: Platform[] = ['iphone', 'ipad', 'mac'];

function TopicBlock({ n, t }: { n: string; t: Topic }) {
  const on = order.filter((p) => t.pictures[p]?.length).map((p) => platformNames[p]).join(', ');
  return (
    <>
      <Section title={`${n}. ${t.quote}`}>
        <ul>
          <li><strong>Elsewhere.</strong> {t.elsewhere}{t.source && <> (<a href={t.source.href} rel="noopener noreferrer">{t.source.label}</a>)</>}</li>
          <li><strong>What it saves.</strong> {t.saves}</li>
          <li><strong>Drawn on.</strong> {on}. The gallery is named “{t.title}” for a screen reader.</li>
          <li><strong>Status (not shown on the page): {t.status === 'works' ? 'works' : 'coming'}.</strong> {t.statusNote ?? 'No note.'}</li>
        </ul>
      </Section>
      <Gallery id={`more-${t.id}`} title={t.title} pictures={t.pictures} />
    </>
  );
}

export function LandingGalleriesMore() {
  const browser = browserGroup();
  const menu = menuBarGroup();
  return (
    <div className="lp">
      <Page
        title="Landing galleries: browser and menu bar"
        status={<><strong>First draft, 2026-11-27; the look was approved by the owner in conversation, not built into a deployed site.</strong> The eight galleries of the groups “{browser.heading}” and “{menu.heading}”, each with the words the list shows above it and, only here, its status and note. The landing page marks nothing as built or not built; this page keeps that record. The whole page is <a href="#/landing">Landing page</a>, the parts <a href="#/landing-components">Landing parts</a>. Drawn from <a href="#/browser-extension">Browser extension</a>, <a href="#/ios-safari-fill">Safari fill on iPhone and iPad</a> and <a href="#/menu-bar">Mac menu bar</a>.</>}
      >
        <Section title="In the browser">
          <p>Group line under the card on the page: “{browser.lead}”</p>
        </Section>
        {browserTopics().map((t, i) => <TopicBlock key={t.id} n={`${i + 1}`} t={t} />)}

        <Section title="From the Mac menu bar">
          <p>Group line under the card on the page: “{menu.lead}” Every story here is drawn for the Mac only, so on a phone the Mac pictures are offered because there are no iPhone ones.</p>
        </Section>
        {menuBarTopics().map((t, i) => <TopicBlock key={t.id} n={`${i + 5}`} t={t} />)}

        <Section title="Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. Two groups for the places Psss is reached from outside the app:</strong> “In the browser” (the toolbar popup on a Mac browser, and Safari on iPhone and iPad) and “From the Mac menu bar”. Each row is a moment in the visitor’s words and opens to its pictures, like the rows of the other groups.</>,
              rejected: <>one group of everything; a section on the page for the browser and one for the menu bar.</>,
              why: <>The owner asked for a calm list that visitors explore; four groups by where the thing happens keep each short.</>,
            },
            {
              decision: <><strong>2. The status of every topic is kept in code and shown here, not on the page.</strong> <code>status</code> and <code>statusNote</code> are fields of each topic.</>,
              rejected: <>a “Coming” or “In development” flag on the row, in the gallery or in a “Where it stands” list.</>,
              why: <>The owner: stop adding the in development, not ready flags. The record has to live somewhere a reader of the mock can see it, and this page is it. It is a departure from the truthful-language rule in <code>docs/product.md</code>; see Departures on <a href="#/landing-components">Landing parts</a>.</>,
            },
            {
              decision: <><strong>3. Pictures are the mock app’s own screens</strong>, taken from the browser extension, Safari fill and menu bar pages, so a change to a screen there changes the picture here.</>,
              rejected: <>separate drawings for the site.</>,
              why: <>One source for what a screen looks like, and the page cannot drift from the approved mocks.</>,
            },
            {
              decision: <><strong>4. A calm ring marks the one control being touched,</strong> as in the other galleries; the line under each picture says what happens, not what to tap.</>,
            },
            {
              decision: <><strong>5. Menu bar pictures show the panel at the right end of a Mac screen,</strong> cropped, with an app behind it.</>,
              rejected: <>the whole screen, in which the panel would be too small to read.</>,
              why: <>It still shows that the panel hangs from the menu bar item and floats over other apps.</>,
            },
          ]}
        />

        <Section title="What the pictures fake">
          <ul>
            <li><strong>Browser popup.</strong> It is drawn as the mock page draws it, in a cropped browser window with a toolbar button. The window is not a real browser’s: the address bar, lights and button are a sketch. The popup answers a stand-in for the Mac app in tests; the pictures do not show that.</li>
            <li><strong>Safari on iPhone and iPad.</strong> Safari’s chrome, the page menu and the extension sheet or popover are drawn, not Safari’s own. The checkout form is a made-up page; the keyboard, if shown, is a placeholder.</li>
            <li><strong>Touch ID.</strong> The unlock prompt in the locked story is the library’s sketch of the system sheet.</li>
            <li><strong>Menu bar.</strong> The panel is the mock library’s own, with the generator’s sample values fixed (a stand-in for random bytes, restarted each render) so every build of the page is identical. The app behind it (a sign-in page or a terminal asking for a password) is a drawing, not a screenshot.</li>
            <li><strong>All of them.</strong> Names, sites, numbers and addresses are made up; copied pieces lose their state; every control is drawn but switched off (<code>inert</code>).</li>
            <li><strong>What is not built.</strong> The menu bar panel exists as a debug prototype only (approved 2026-11-26), and the search pills and several browser stories are not in a release build; the pictures show them as done. That is the owner’s choice, recorded in the status lines above.</li>
          </ul>
        </Section>

        <History
          proposal
          entries={[
            { date: '2026-11-27', text: <>First draft of the browser and menu bar galleries, split from the page’s first list so the status of each topic can be read in one place. The “Coming” flags and their notes were removed from the landing page the same day and are shown only here; nothing replaced.</> },
          ]}
        />
      </Page>
    </div>
  );
}
