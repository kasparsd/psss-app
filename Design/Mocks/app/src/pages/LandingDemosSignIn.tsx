import { Decisions, History, Page, Section } from '../components/page';
import { Gallery } from '../landing/Gallery';
import { copy } from '../landing/copy';
import { fillPictures } from '../landing/pictures/fill';
import { codeFillPictures } from '../landing/pictures/codeFill';
import { codeSetupPictures } from '../landing/pictures/codeSetup';
import '../landing/landing.css';
import '../landing/pictures/signin.css';

/**
 * Mock page for the three sign-in galleries of the landing page: `fill`,
 * `code-fill` and `code-setup`. Each is a swipe gallery of still pictures with
 * the iPhone / iPad / Mac switch, rendered with the real `Gallery`. The
 * pictures live in `landing/pictures/`.
 */

const gallery = (id: 'fill' | 'code-fill' | 'code-setup', pictures: ReturnType<typeof fillPictures>) => {
  const c = copy.demos[id];
  return <Gallery id={c.id} title={c.title} pictures={pictures} />;
};

export function LandingDemosSignIn() {
  return (
    <Page
      title="Landing galleries: sign in, codes and setup"
      status={<><strong>First draft, 2026-11-27; the look was approved by the owner in conversation, not built into a deployed site.</strong> Three swipe galleries for the landing page, drawn from the same components as <a href="#/autofill">AutoFill</a>, <a href="#/autofill-lessons">AutoFill lessons</a>, <a href="#/places">Places</a> and <a href="#/code-setup">Code setup</a>. Each is a row of still pictures with one line under each and a script-free iPhone / iPad / Mac switch, shown here as the landing page shows it inside an opened row (the whole page is <a href="#/landing">Landing page</a>, the parts <a href="#/landing-components">Landing parts</a>). The page carries no flags: what is built is recorded on <a href="#/landing-galleries-more">Landing galleries: browser and menu bar</a> and in the notes below. Plan: <code>docs/plans/landing-page.md</code>.</>}
    >
      <div className="lp">
        <Section title="1. Wrong account filled (fill)" />
        {gallery('fill', fillPictures())}
        <p>Lumen’s sign-in page asks for a password and the person has three accounts there. The picker lists them by name over address; choosing one fills the form and the password stays hidden. On iPhone, iPad and Mac: the picker is built on all three (<code>docs/roadmap.md</code>, “AutoFill picker, owner decisions 2026-11-26”), drawn from frame A, C and D of the AutoFill page.</p>

        <Section title="2. The code is asked for (code-fill)" />
        {gallery('code-fill', codeFillPictures())}
        <p>The password worked and Lumen wants a six-digit code. Safari offers it above the keyboard; the other way is the Codes tab, where the digits are the button that copies. iPhone only: the suggestion bar is the system’s and no approved mock draws the codes list for this story on iPad or Mac.</p>

        <Section title="3. A QR code on the same phone (code-setup)" />
        {gallery('code-setup', codeSetupPictures())}
        <p>Lumen shows a setup QR code on the device the person is holding. On iPhone: screenshot, Copy and Delete, Paste in the login, a live code. On iPad and Mac the sheet is the one in “iPad and Mac” of Code setup (the Mac takes a screenshot with ⇧⌃⌘4, which copies it, and has Choose image… instead of the camera and photos); the pictures before and after it use the same words as iPhone.</p>

        <Section title="Decisions" />
        <Decisions
          items={[
            { decision: <>The picker is the approved screen: title “Choose a Login”, the heading “For This Site”, the app’s row (letter tile, name over address) with the (i) at the end, the search field over the keyboard on iPhone, and the footer “Tap a login to fill it. Tap the info button for its details.” iPad and Mac draw the sheet of frames C and D, with the search field on top and Cancel at the foot.</>, rejected: <>A line in the sheet naming the site (Apple Passwords does this).</>, why: <>The owner left the heading as built (2026-11-26, AutoFill lessons). The picture’s rows are the library’s <code>ListRow</code>, so name and address sit on two lines and a long address ends in an ellipsis.</> },
            { decision: <>The three accounts are “Lumen (Personal)”, “Lumen (Work)” and “Lumen (School)”, each over its own address, so they differ in the two lines the real picker shows today.</>, why: <>The pictures show what the app does now, not the third clue (website, vault or date) that only appears when name and address match.</> },
            { decision: <>One calm ring in the accent colour marks the one thing being touched in a picture, and no animation.</>, why: <>A picture has no controls to point at, and the ring says where the finger is.</> },
            { decision: <>The Codes picture has no ring on every row and no countdown, as the app’s list has none. The ring is on the login’s own page and in the “Found a code” sheet, where the app draws it.</>, rejected: <>A ring on every row (rejected 2026-11-23 in Places).</> },
            { decision: <>Code setup uses option H as approved: “Screenshot or key” with Paste at the end, Scan with camera, Choose photo, one help line, then “Found a code for Lumen” and “Save code”. The screenshot’s preview and the Done menu are one picture each; the preview sits in the corner of the first.</>, why: <>After Copy and Delete the screenshot is gone, so there is no “Delete the screenshot” line.</> },
            { decision: <>The codes are fixed, made-up ones (“348 692” for Lumen) and the ring on the login is part way round.</>, why: <>The pictures are static, and a code that cannot sign in anywhere has nothing to leak.</> },
          ]}
        />

        <Section title="What the pictures fake" />
        <div className="prose">
          <ul>
            <li><strong>The system keyboard</strong> is a labelled block. In the real app the system draws the keyboard and its suggestion bar; the suggestion’s words (“Lumen (Personal)”, “Code from Psss”) are the system’s and may read differently.</li>
            <li><strong>Face ID is skipped.</strong> The app asks for Face ID or Touch ID before it fills a login or a code.</li>
            <li><strong>The screenshot, its preview and the editor</strong> are drawings. The Done menu is the system’s; only Copy and Delete is shown.</li>
            <li><strong>The QR code is a pattern</strong>, not a scannable secret. Paste is drawn like the system Paste control but is not it; the real one is dimmed until something is copied.</li>
            <li><strong>The iPad and Mac windows</strong> show Safari as a plain page in a window with an address pill, not Safari’s own chrome.</li>
            <li><strong>The codes are made up.</strong> They are fixed numbers, not computed from a secret.</li>
            <li><strong>Nothing about status is on the page.</strong> The record, kept in <code>copy.demos</code> and not shown: fill: the picker works in test builds, telling accounts for one site apart is still being designed. code-fill and code-setup: built and checked in the simulator, not yet on a physical device (<code>docs/autofill.md</code>, <code>docs/verification-codes.md</code>).</li>
          </ul>
        </div>

        <History
          proposal
          entries={[
            { date: '2026-11-27', text: <>The captions moved from above each picture to under it, the “Coming” and “Works” flags and their notes were removed from the page, and the iPhone / iPad / Mac switch now sits at the top right of an opened row, as the list of the whole page draws it. Replaced a line above each picture and a chip with a note per gallery, because the owner wanted a calm page without in-development tips. Only iPhone pictures show on a phone where a story has them.</> },
            { date: '2026-11-27', text: <>Replaced by swipe galleries of pictures with a platform switch (owner: the demos did not look good; galleries work better on a phone). The interactive demos, their still frames and the ticking codes are gone.</> },
            { date: '2026-11-27', text: <>First draft as interactive demos: the fill, code-fill and code-setup demos with their still frames.</> },
          ]}
        />
      </div>
    </Page>
  );
}
