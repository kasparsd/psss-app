import type { ReactNode } from 'react';
import '../landing/landing.css';
import { Decisions, History, Page, Section } from '../components/page';
import { copy } from '../landing/copy';
import { Gallery, type Pictures } from '../landing/Gallery';
import { cardsPictures } from '../landing/pictures/cards';
import { undoPictures } from '../landing/pictures/undo';
import { searchPictures } from '../landing/pictures/search';
import { keepVaultPictures } from '../landing/pictures/keepVault';

/** One gallery as the landing page draws it, with its title from `copy.demos`. */
function Shown({ id, pictures }: { id: keyof typeof copy.demos; pictures: Pictures }) {
  const c = copy.demos[id];
  return <Gallery id={`vault-${c.id}`} title={c.title} pictures={pictures} />;
}

function Block({ title, intro, id, pictures }: { title: string; intro: ReactNode; id: keyof typeof copy.demos; pictures: Pictures }) {
  return (
    <>
      <Section title={title}>{intro}</Section>
      <Shown id={id} pictures={pictures} />
    </>
  );
}

export function LandingDemosVault() {
  return (
    <div className="lp">
      <Page
        title="Landing galleries: your vault"
        status={<><strong>First draft, 2026-11-27; the look was approved by the owner in conversation, not built into a deployed site.</strong> Four swipe galleries for the landing page: a row of pictures, one short line under each, and an iPhone / iPad / Mac switch that needs no script. The page itself carries no flags; what is built is recorded in the notes below and on <a href="#/landing-galleries-more">Landing galleries: browser and menu bar</a>. The whole page is <a href="#/landing">Landing page</a>. Each picture is the app&rsquo;s screen drawn from the same device frames, rows, item cards and field rows as the approved mocks, so a change to a screen changes the picture. Plan: <code>docs/plans/landing-page.md</code>.</>}
      >
        <Block
          id="cards"
          title="1. Which Visa is the new one?"
          intro={<p>Two cards carry the same name; the last four digits and the expiry tell them apart, and the old one sits under Expired. Then the card&rsquo;s page, and the expiry copied. On iPhone, iPad and Mac. The wide pictures use the sample vault&rsquo;s own cards (Everyday Visa and the expired Old Visa), so the same-name pair is on iPhone only. Screens: <a href="#/cards-tab">Cards tab</a>.</p>}
          pictures={cardsPictures()}
        />

        <Block
          id="undo"
          title="2. Wait. Wrong login."
          intro={<p>A login is moved to Recently Deleted without a question; the Undo banner puts it back; otherwise it waits 30 days. On iPhone, iPad and Mac, but the banner itself is drawn on iPhone only. Screens: <a href="#/item-page">Item page</a>, <a href="#/wifi-place">Recently Deleted</a>.</p>}
          pictures={undoPictures()}
        />

        <Block
          id="search"
          title="3. I know I saved it. What did I call it?"
          intro={<p>Search for part of a website; the Name, Website and Username pills say where the text was found and how many results found it there. On iPhone and Mac. iPad is left out because the shared Mac and iPad window of the mock library has no pills yet; the page for search draws them in the Mac window only. Screens: <a href="#/search-fields">Search: find in a field</a>.</p>}
          pictures={searchPictures()}
        />

        <Block
          id="keep-vault"
          title="4. That is my vault. It is still my vault."
          intro={<p>A custom item from an existing KeePass file holds a card as custom fields. Show as Card or Login{'…'}, Valid Thru matched to Expiry, and the card is in Cards. On iPhone, iPad and Mac, with the sheet as that page draws it for each. Screens: <a href="#/field-mapping">KeePass field mapping</a>.</p>}
          pictures={keepVaultPictures()}
        />

        <Section title="Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. Pictures, not demos.</strong> Each gallery is a row of static screens that scrolls and snaps sideways, with one line under each picture.</>,
              rejected: <>self-playing and tap-through demos (the first draft of this page).</>,
              why: <>The owner found the demos did not look good; a swipe gallery works better on a phone and has nothing to break.</>,
            },
            {
              decision: <><strong>2. The platform switch is script-free</strong> and appears only for the platforms a story is drawn on. iPhone is always there.</>,
              why: <>The app does not do every story on every platform, and a platform that is left out says nothing false.</>,
            },
            {
              decision: <><strong>3. A calm ring marks the one control being touched</strong> (the row, the expiry, Edit, Move to Recently Deleted, Undo, the Website pill, Show as, the menu, Save). Accent colour, static, never animated.</>,
              rejected: <>a hand cursor drawn over the screen; a pulsing hint.</>,
              why: <>The line under the picture says what happens, never what to tap, so the ring is the only pointer.</>,
            },
            {
              decision: <><strong>4. Captions say what happens, from the visitor&rsquo;s side,</strong> in about twelve words, with no step numbers (the gallery numbers them).</>,
            },
            {
              decision: <><strong>5. No status on the page (owner, 2026-11-27).</strong> No gallery is marked Coming or Works. The record, kept in <code>copy.demos</code> and not shown: Cards and Undo are built; Search pills are written but not in a test build (<code>docs/plans/search-field-pills.md</code>), and the mapping sheet in the app still has the older one-row-per-role layout and is to be rebuilt from the field mapping page.</>,
              rejected: <>a “Coming” chip with a note on Search and the KeePass mapping.</>,
              why: <>The owner said to stop adding the in development and not ready flags. This departs from the truthful-language rule in <code>docs/product.md</code>; see Departures on <a href="#/landing-components">Landing parts</a>.</>,
            },
          ]}
        />

        <Section title="What the pictures fake">
          <ul>
            <li><strong>Cards.</strong> On iPhone the two cards are given the same name to show the problem; in the app the old one would more likely keep a different name. The iPad and Mac pictures use the sample vault&rsquo;s own cards. The copied pill and checkmark are drawn as they are for about two seconds in the app.</li>
            <li><strong>Undo.</strong> The banner is drawn on iPhone only: the Mac and iPad window draws it after a real delete, and a still of it would list the login it says has moved. In the app the banner closes after 10 seconds. The iPhone Recently Deleted screen is drawn from the Mac list and the rows of the other screens, because no iPhone frame of it is approved.</li>
            <li><strong>Search.</strong> The keyboard is the grey placeholder the mocks use, and the pills are the library&rsquo;s capsules, a sketch of the system toggle buttons the app uses. The vault is ten made-up logins. The Mac picture is the Mac window of the search page; iPad is not drawn.</li>
            <li><strong>Keep vault.</strong> Valid Thru is left as Other field in the first sheet so the next picture shows the choice; the app&rsquo;s name table would match it by itself. The Show as menu is closed in every picture.</li>
            <li><strong>All four.</strong> Controls the story does not use are drawn but do nothing, and the whole picture is switched off (<code>inert</code>) in the gallery. Names, sites, numbers and addresses are made up.</li>
            <li><strong>Copied, not imported.</strong> The search rule and pills (from <code>pages/SearchFields.tsx</code>) and the mapping sheet, roles and card page (from <code>pages/FieldMapping.tsx</code>) are copied into the pictures without their state, because those pages do not export them.</li>
          </ul>
        </Section>

        <History
          entries={[
            { date: '2026-11-27', text: <>The captions moved from above each picture to under it, the “Coming” chips and notes on Search and the KeePass mapping were removed, and the platform switch moved to the top right of an opened row. Replaced a line above each picture and a chip with a note, because the owner wanted a calm page without in-development flags. On a phone only iPhone pictures show where a story has them.</> },
            { date: '2026-11-27', text: <>Replaced by swipe galleries of pictures with a platform switch (owner: the demos did not look good; galleries work better on a phone).</> },
            { date: '2026-11-27', text: <>First draft as interactive demos.</> },
          ]}
          proposal
        />
      </Page>
    </div>
  );
}
