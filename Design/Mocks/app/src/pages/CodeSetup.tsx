import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { Problem } from '../components/Problem';

/* ---------- small pieces shared by every frame on this page ---------- */

const Camera = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></svg>
);
const Photo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 16" /></svg>
);
const Clip = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="3.5" width="11" height="14" rx="2" /><path d="M5 7.5v11a2 2 0 0 0 2 2h8" /></svg>
);

/** The system Paste control: a fixed label and icon; it cannot be renamed, and the system dims it until the clipboard holds a key or an image. */
const PasteControl = ({ dim, small }: { dim?: boolean; small?: boolean }) => (
  <button className={`btn cs-go${small ? ' small' : ''}`} disabled={dim} aria-label="Paste"><Clip />Paste</button>
);

const Rows = ({ children }: { children: ReactNode }) => <div className="cs-list">{children}</div>;
const ActionRow = ({ icon, children }: { icon?: ReactNode; children: ReactNode }) => <div className="cs-row" role="button" tabIndex={0}>{icon}{children}</div>;

/** The login's editor, dimmed behind a sheet. The sheet is at the medium detent, as on a device. */
function SheetPhone({ title = 'Add verification code', cancel = true, tall = 380, children }: { title?: string; cancel?: boolean; tall?: number; children: ReactNode }) {
  return (
    <IPhone>
      <div className="nav"><span className="btn glass">Cancel</span><span /><span className="btn pri main">Save</span></div>
      <div className="ident" style={{ paddingTop: 0 }}>
        <div className="ic big c5">G</div>
        <div className="t">google.com</div>
      </div>
      <div className="pbody" style={{ overflow: 'hidden' }}>
        <div className="icard">
          <div className="frow"><div className="fbody"><span className="s">Website (optional)</span><span>google.com</span></div></div>
          <div className="frow"><div className="fbody"><span className="s">Username (optional)</span><span>kaspars@damb.is</span></div></div>
        </div>
      </div>
      <div className="cs-dim" />
      <div className="cs-sheet" style={{ height: tall }}>
        <div className="cs-grab" />
        <div className="nav" style={{ padding: '4px 12px 0' }}>
          {cancel ? <span className="btn glass">Cancel</span> : <span />}
          <span className="mid">{title}</span>
          <span />
        </div>
        <div className="cs-body">{children}</div>
      </div>
    </IPhone>
  );
}

/** One sheet on iPad or Mac: a centred sheet over the window. */
function SheetWide({ device, children }: { device: 'ipad' | 'mac'; children: ReactNode }) {
  const inner = (
    <div className="cs-wide">
      <div className="sheetwrap">
        <div className="sheet" style={{ width: 'min(100%, 440px)' }}>
          {device === 'ipad' ? (
            <div className="sheetbar"><span className="btn glass">Cancel</span><strong>Add verification code</strong><span /></div>
          ) : (
            <div className="maphead" style={{ textAlign: 'center' }}><div className="t">Add verification code</div></div>
          )}
          <div className="cs-body" style={{ padding: '4px 4px 6px' }}>{children}</div>
          {device === 'mac' && <div className="sheetfoot" style={{ justifyContent: 'flex-start' }}><span className="btn glass">Cancel</span></div>}
        </div>
      </div>
    </div>
  );
  return device === 'ipad' ? <IPad>{inner}</IPad> : <MacWindow>{inner}</MacWindow>;
}

const HELP_PHONE = 'Copy the setup key from the site: tap “Can’t scan?” to show it. Or screenshot the QR code, tap its preview and choose Copy and Delete.';
const HELP_ROWS = 'Take a screenshot of the QR code, then paste it or pick it from your photos. Or copy the setup key from the site and paste that.';
const HELP_ROWS_MAC = 'Take a screenshot of the QR code with ⇧⌃⌘4, which copies it, then paste. Or choose an image, drop one here, or copy the setup key and paste that.';

const Lead = ({ children }: { children: ReactNode }) => <div>{children}</div>;
const Help = ({ children }: { children: ReactNode }) => <div className="s">{children}</div>;

/* ---------- the options (iPhone, nothing copied yet) ---------- */

/** A: today's sheet, redrawn from the screenshot of 2026-11-24. */
const OptionA = () => (
  <SheetPhone>
    <Lead>Copy the setup key or QR code from the site. Psss reads it on this device. Nothing is uploaded.</Lead>
    <Help>On this phone? On the site, tap “Can’t scan?”, copy the key, then tap Paste. Or take a screenshot, tap it, choose Copy and Delete, then tap Paste.</Help>
    <div><PasteControl dim small /></div>
    <div className="cs-pair">
      <span className="btn cs-uneven"><Camera />Scan with camera</span>
      <span className="btn cs-uneven">Choose photo</span>
    </div>
  </SheetPhone>
);

/** B: one row per situation, each with its own button. */
const OptionB = () => (
  <SheetPhone>
    <Rows>
      <div className="cs-row split"><span>Key or QR screenshot you copied</span><PasteControl dim small /></div>
      <div className="cs-row split"><span>QR code on another screen</span><span className="btn">Scan</span></div>
      <div className="cs-row split"><span>Screenshot saved in Photos</span><span className="btn">Choose</span></div>
    </Rows>
    <Help>On the site, tap “Can’t scan?” and copy the key. Nothing is uploaded.</Help>
  </SheetPhone>
);

/** C: recommended. One lead, one primary, help under it, two equal rows, one footer. */
function OptionC({ dim = true, problem, tall = 380 }: { dim?: boolean; problem?: ReactNode; tall?: number }) {
  return (
    <SheetPhone tall={tall}>
      <div><PasteControl dim={dim} /></div>
      {problem ? <div style={{ textAlign: 'left' }}>{problem}</div> : <div>{HELP_PHONE}</div>}
      <Rows>
        <ActionRow icon={<Camera />}>Scan with camera</ActionRow>
        <ActionRow icon={<Photo />}>Choose photo</ActionRow>
      </Rows>
      <Help>Nothing is uploaded.</Help>
    </SheetPhone>
  );
}

/** H: three rows. The first has its own label at the left and the system Paste control at its end. */
const PasteRow = ({ dim }: { dim?: boolean }) => (
  <div className="cs-row split" style={{ color: 'var(--lab)' }}><span>Screenshot or key</span><PasteControl dim={dim} small /></div>
);
function OptionH({ dim = true, problem }: { dim?: boolean; problem?: ReactNode }) {
  return (
    <SheetPhone>
      <Rows>
        <PasteRow dim={dim} />
        <ActionRow icon={<Camera />}>Scan with camera</ActionRow>
        <ActionRow icon={<Photo />}>Choose photo</ActionRow>
      </Rows>
      {problem ? <div style={{ textAlign: 'left' }}>{problem}</div> : <div>{HELP_ROWS}</div>}
    </SheetPhone>
  );
}

/** D, first screen: ask where the QR code is. */
const OptionD1 = () => (
  <SheetPhone tall={300}>
    <Lead>Where is the QR code or setup key?</Lead>
    <Rows>
      <ActionRow>On this device</ActionRow>
      <ActionRow>On another screen</ActionRow>
    </Rows>
  </SheetPhone>
);
/** D, second screen: the steps for this device. */
const OptionD2 = () => (
  <SheetPhone title="On this device">
    <Lead>1. On the site, tap “Can’t scan?”.<br />2. Copy the setup key.<br />3. Come back here and tap Paste.</Lead>
    <div><PasteControl dim /></div>
    <Rows>
      <ActionRow icon={<Photo />}>Choose photo</ActionRow>
    </Rows>
  </SheetPhone>
);

/* ---------- the recommended flow, state by state ---------- */

const Confirm = ({ replace }: { replace?: boolean }) => (
  <SheetPhone tall={440}>
    <div className="t">Found a code for Northbank</div>
    <div className="s" style={{ marginTop: -8 }}>sam.r</div>
    <div><span className="digits big">348 692</span></div>
    <Lead>Type this code into the site to finish turning on two-step verification. It saves to Northbank in your vault, on this device.</Lead>
    {replace && <Help>This login already has a code. Saving replaces it.</Help>}
    <div><span className="btn pri cs-go">{replace ? 'Replace code' : 'Save code'}</span></div>
    {replace && <div><span className="btn cs-quiet">Keep current code</span></div>}
  </SheetPhone>
);

const Saved = ({ screenshot }: { screenshot?: boolean }) => (
  <SheetPhone cancel={false} tall={330}>
    <div className="t">Code saved to Northbank.</div>
    {screenshot && <Lead>Delete the screenshot now. It still holds the setup key.</Lead>}
    <div><span className="btn pri cs-go">Done</span></div>
  </SheetPhone>
);

const Wide = ({ device }: { device: 'ipad' | 'mac' }) => (
  <SheetWide device={device}>
    <Rows>
      <PasteRow dim />
      {device === 'mac'
        ? <ActionRow icon={<Photo />}>Choose image…</ActionRow>
        : <><ActionRow icon={<Camera />}>Scan with camera</ActionRow><ActionRow icon={<Photo />}>Choose photo</ActionRow></>}
    </Rows>
    <div>{device === 'mac' ? HELP_ROWS_MAC : HELP_ROWS}</div>
  </SheetWide>
);

/* ---------- the page ---------- */

/** Opened by a site's otpauth:// link: the person says which login the code belongs to. Nothing is saved by choosing. */
function LinkPicker() {
  const Row = ({ title, sub }: { title: string; sub?: string }) => (
    <div className="cs-row" role="button" tabIndex={0}><span style={{ flex: 1 }}>{title}{sub ? <><br /><span className="s">{sub}</span></> : null}</span><span aria-hidden="true">›</span></div>
  );
  return (
    <SheetPhone tall={640}>
      <div style={{ textAlign: 'left', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 20 }}>Found a code for GitHub</div>
        <div className="s">kaspars</div>
        <div className="s">Choose the login it belongs to. Nothing is saved until you confirm.</div>
      </div>
      <Rows><ActionRow>+ New login for GitHub</ActionRow></Rows>
      <div className="s" style={{ margin: '6px 4px 12px' }}>It opens the new login to review. Nothing is saved until you save it.</div>
      <div className="s" style={{ margin: '0 4px 4px' }}>Likely</div>
      <Rows><Row title="GitHub" sub="kaspars" /></Rows>
      <div className="s" style={{ margin: '12px 4px 4px' }}>Other logins</div>
      <Rows><Row title="Apple" sub="kaspars@damb.is" /><Row title="Google" sub="kaspars@damb.is" /></Rows>
    </SheetPhone>
  );
}

export function CodeSetup() {
  return (
    <Page
      title="Verification code setup"
      status={<><strong>Approved by the owner, 2026-11-24: H, with the system Paste control in a row labelled “Screenshot or key”. Built 2026-11-24 in the sheet; device check open.</strong> Redraws the “Add verification code” sheet (the owner’s screenshot of the running app showed too much text, buttons of three sizes and the main button dimmed and smallest) and writes down every way a code gets in.</>}
    >
      <Clarity
        intro={<p>The check from the ui-clarity skill, answered for a person who has never seen the screen.</p>}
        items={[
          ['Which thing?', 'The setup key a website shows when it turns on two-step verification, or the QR code that holds it. The sheet adds it to one login (here “google.com”) so Psss can make that login’s six-digit codes.'],
          ['What must they give?', 'The key as text, or the QR code as an image. Nothing typed: it is copied, scanned or picked. Everything is optional; Cancel leaves the login as it was.'],
          ['Where does it live?', 'In the vault, inside the login, on this device and wherever the vault is kept. Psss reads the image on the device and never keeps it. Nothing is uploaded.'],
          ['What can go wrong?', 'Nothing copied yet (the system dims Paste), an image with no QR code, a QR code that is a web link, a key that cannot make codes. Each names the fix in the place the help was.'],
          ['How do they leave?', 'Cancel in the top corner, at every step before “Save code”. After it, the code is stored; remove it from the login’s editor with “Remove code”.'],
          ['What happens next?', 'A live code appears. The person types it into the site, which will not turn on two-step verification until it is right. Then Done.'],
        ]}
      />

      <Section title="1. The problem in the screenshot">
        <ul>
          <li><strong>Too much text.</strong> Two paragraphs, seven sentences, eight lines before the first button. The second paragraph is the instruction the first button needs, but it comes first.</li>
          <li><strong>The primary action looks like the weakest.</strong> Paste is the common path, but it is the smallest control, and the system dims it until something is copied, which is exactly when a first-time person opens the sheet. A dim small pill reads as broken.</li>
          <li><strong>Three buttons, three sizes.</strong> “Scan with camera” has an icon and is wide, “Choose photo” has none and is narrower, Paste is smaller than both. Side by side they look like a layout accident.</li>
          <li><strong>Placement.</strong> The two minor ways sit on the bottom edge, far from the help they belong to, and the lower third is empty.</li>
          <li><strong>The unavoidable fact:</strong> Paste does nothing until the person has left the app, copied from the site and come back. The sheet has to wait for them, so it must say what to copy, not just offer a dead button.</li>
        </ul>
      </Section>

      <Section title="2. Workflows">
        <p className="muted">Every way a verification code gets into a login, and what Psss does at each step.</p>
        <table className="cmp">
          <thead><tr><th>#</th><th>Situation</th><th>The person</th><th>Psss</th></tr></thead>
          <tbody>
            <tr><td>W1</td><td><strong>Same phone, setup key</strong> (most people)</td><td>Taps Add code. Switches to the site, taps “Can’t scan?”, copies the key, comes back, taps Paste.</td><td>The sheet waits where it was left. Paste turns on when the clipboard holds text. A valid key opens the confirm step.</td></tr>
            <tr><td>W2</td><td><strong>Same phone, screenshot</strong></td><td>Screenshots the QR code, taps the preview, chooses Copy and Delete, comes back, taps Paste.</td><td>Reads the image on the device, decodes the QR code, opens the confirm step. The screenshot never reached Photos, so nothing is left to delete.</td></tr>
            <tr><td>W3</td><td><strong>Same phone, screenshot already in Photos</strong></td><td>Taps Choose photo, picks it from Screenshots.</td><td>No photo-library permission (the system picker hands over the one image). Confirm step, then “Delete the screenshot now” after saving.</td></tr>
            <tr><td>W4</td><td><strong>QR code on another screen</strong> (laptop, a printed sheet)</td><td>Taps Scan with camera, points at the code.</td><td>Asks for the camera on first tap only. Decodes live, closes the camera, opens the confirm step.</td></tr>
            <tr><td>W5</td><td><strong>iPad, site in Split View</strong></td><td>Drags the QR image onto the sheet, or W1 to W3.</td><td>Same decode and confirm.</td></tr>
            <tr><td>W6</td><td><strong>Mac</strong></td><td>Copies the key and presses Paste or ⌘V; or screenshots with ⇧⌃⌘4 (it goes to the clipboard); or Choose image…; or drops an image.</td><td>Same decode and confirm. No screen capture: it would need Screen Recording permission.</td></tr>
            <tr><td>W7</td><td><strong>The login already has a code</strong></td><td>Replace code, then any of W1 to W6.</td><td>The confirm step says “This login already has a code. Saving replaces it.” and offers “Keep current code”.</td></tr>
            <tr><td>W8</td><td><strong>A new login, not saved yet</strong></td><td>Any of W1 to W6 from the new-login sheet.</td><td>“Save code” stores the login at once. The person leaves the app to type the code into the site, and a draft would be lost if the vault locks.</td></tr>
            <tr><td>W9</td><td><strong>It does not work</strong></td><td>Reads the line where the help was and tries again, or Cancels.</td><td>Names the problem and the fix: nothing copied, no QR code in the image, a web link, a key that cannot make codes, camera not allowed.</td></tr>
          </tbody>
        </table>
        <p className="muted">Not built yet and drawn nowhere: the tap-to-open <code>otpauth://</code> link, a pasted link in the global Add field, a Share extension, Google Authenticator export batches (see the verification codes doc).</p>
      </Section>

      <Section title="3. Options for the first screen">
        <p className="muted">All on iPhone at the medium detent, nothing copied yet. The confirm step and everything after it is the same in every option.</p>
      </Section>
      <Frames>
        <Frame label="A · Today" phone caption="Baseline, redrawn from the screenshot. The numbers in the table below score it.">
          <OptionA />
        </Frame>
        <Frame label="B · One row per situation" phone caption="Each row says what the person has and carries its own button. Clear, but the three buttons cannot be one size (Paste is a system control with a fixed label), and the row texts repeat what the buttons say.">
          <OptionB />
        </Frame>
        <Frame label="C · Paste leads, two equal rows" phone caption="Was the recommendation until the owner chose H. One prominent Paste, one help block directly under it saying what to copy, the two other ways as equal full-width rows, and the privacy line.">
          <OptionC />
        </Frame>
      </Frames>
      <Frames>
        <Frame label="D · Ask first, 1 of 2" phone caption="One question, two rows.">
          <OptionD1 />
        </Frame>
        <Frame label="D · Ask first, 2 of 2" phone caption="The answer opens numbered steps for this device, then Paste. Each screen is calm, but every person pays an extra tap and the sheet changes under them.">
          <OptionD2 />
        </Frame>
      </Frames>

      <Frames>
        <Frame label="H · Paste in a labelled row (chosen)" phone caption="Chosen by the owner, 2026-11-24. The first row names what it takes at the left (Screenshot or key) and carries the system Paste control at its end, the same pattern as the editor's approved row; the other two rows are tapped anywhere. No footer, one short help.">
          <OptionH />
        </Frame>
        <Frame label="H · Something copied" phone caption="Same card with Paste on.">
          <OptionH dim={false} />
        </Frame>
      </Frames>

      <h3>Not drawn</h3>
      <ul className="prose">
        <li><strong>E · No sheet, in place.</strong> The Verification code card in the editor grows the three methods as rows. It removes the stacked sheet (on a new login this sheet sits on the new-login sheet; Apple’s sheet guidance favours one at a time) but makes the editor taller for everyone, including the many who never set up a code, and the confirm step still needs a place to show a live code.</li>
        <li><strong>F · An “Add code” menu</strong> with Paste, Scan and Choose photo as items. Tidy, and what Apple Passwords does for its two choices, but it hides the actions behind a tap and the system Paste control cannot live in a menu (a menu item that reads the clipboard would raise the “Allow Paste” prompt). Against the rule that important actions stay visible and labeled.</li>
        <li><strong>G · A separate screen per method</strong> (three buttons that each push a page). Three taps for the commonest path.</li>
      </ul>

      <Section title="4. How the options score">
        <table className="cmp">
          <thead><tr><th>Question</th><th>A today</th><th>B rows</th><th>C Paste leads</th><th>D ask first</th><th>E in place</th><th>H rows</th></tr></thead>
          <tbody>
            <tr><td>Taps for the common case (same phone, key)</td><td>1 (Paste)</td><td>1</td><td>1</td><td>2</td><td>1</td><td>1 (Paste)</td></tr>
            <tr><td>One obvious primary action</td><td>No: Paste is smallest and dim</td><td>No: three equal rows</td><td>Yes</td><td>Yes, on screen 2</td><td>No</td><td>No: three equal rows</td></tr>
            <tr><td>Controls the same size</td><td>No: three sizes</td><td>No: system Paste differs</td><td>Yes for the two rows; Paste is the one different thing, on purpose</td><td>Yes</td><td>Yes</td><td>No: the Paste row has a button</td></tr>
            <tr><td>Says what to copy while Paste is dim</td><td>Yes, but after seven sentences</td><td>Partly</td><td>Yes, in the help under Paste</td><td>Yes, as steps</td><td>Partly</td><td>Yes, in the help under the card</td></tr>
            <tr><td>Lines of text before the first control</td><td>8</td><td>0</td><td>0</td><td>1, then 3 steps</td><td>0</td><td>0</td></tr>
            <tr><td>Fits the medium detent with no scrolling</td><td>Yes: 360 pt of 450 (measured on the screenshot), 90 pt empty at the bottom</td><td>Yes</td><td>Yes: about 410 pt of the 450 pt sheet (estimated from the mock)</td><td>Yes</td><td>n/a</td><td>Yes, about the same as C</td></tr>
            <tr><td>Same on iPhone, iPad and Mac</td><td>Yes</td><td>Yes</td><td>Yes (Mac swaps the rows and the help)</td><td>No: Mac has no “on another screen”</td><td>Yes</td><td>Yes (Mac swaps the third row)</td></tr>
            <tr><td>Actions visible, labeled</td><td>Yes</td><td>Yes</td><td>Yes</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
            <tr><td>Cost to build</td><td>Built</td><td>Small</td><td>Small: layout and copy only</td><td>Medium: a second state</td><td>Large: editor and confirm</td><td>Small</td></tr>
          </tbody>
        </table>
        <p>H is C with Paste folded into the card as a labelled row. Its gain is one card of three rows instead of a button plus a card, and the label explains the dim state; its cost is that the system Paste control is not a row, so the card holds two kinds of row. C wins on the two things the screenshot got wrong, hierarchy and sizing, for the least change: no new state, no new component, the same three entry points and the same decode path.</p>
      </Section>

      <Section title="5. The recommended flow, state by state (iPhone)" />
      <Frames>
        <Frame label="1 · Nothing copied yet" phone caption="The first row is dimmed by the system until something is copied, and the help under the card says what to copy, so a dim row reads as “not yet”. The person can leave the app and come back; the sheet is still here.">
          <OptionH />
        </Frame>
        <Frame label="2 · Something copied" phone caption="The system turns Paste on. Nothing else moves. The words stay the same, because the clipboard’s contents are unknown until Paste is tapped (no “Allow Paste” prompt).">
          <OptionH dim={false} />
        </Frame>
        <Frame label="3 · It did not work" phone caption="The problem replaces the help in the same place, in the primary colour with a warning symbol, not red. Paste and both rows stay, so the next try is one tap.">
          <OptionH dim={false} problem={<Problem>No QR code found in that image. Try a sharper screenshot, or copy the setup key instead.</Problem>} />
        </Frame>
      </Frames>
      <Frames>
        <Frame label="4 · Found a code" phone caption="Issuer, account and a live code, because the site will not turn on two-step verification until the person types a valid one. The extra “Cancel” under Save code is gone: Cancel is already in the corner.">
          <Confirm />
        </Frame>
        <Frame label="5 · Replacing a code" phone caption="Asks before replacing. “Keep current code” names what leaving does, so it stays as a second button here (and only here).">
          <Confirm replace />
        </Frame>
        <Frame label="6 · Saved" phone caption="One line, one button. When the source was a picked photo, one line says to delete the screenshot; after Copy and Delete there is nothing to delete, so no line.">
          <Saved screenshot />
        </Frame>
      </Frames>

      <Section title="6. iPad and Mac" />
      <Frames>
        <Frame label="iPad" caption="A centred form sheet with Cancel in its bar. Same words as iPhone, so the two cannot drift. Paste, the camera and Choose photo all stay."><Wide device="ipad" /></Frame>
        <Frame label="Mac" caption="A sheet with Cancel at the foot, Choose image… as the one row, and the Mac help (⌘V works anywhere in the sheet; dropping an image works too). No camera row: a Mac webcam is not pointed at a screen."><Wide device="mac" /></Frame>
      </Frames>

      <Section title="7. Opened from a site’s setup link (otpauth://)" />
      <Frames>
        <Frame label="1 · Which login" phone caption="A site’s “set up authenticator” button opens Psss (after unlock, if locked). The code found is named, the likely logins come first, a new login is one row, and the rest follow, with search. Choosing a login saves nothing.">
          <LinkPicker />
        </Frame>
        <Frame label="2 · Confirm" phone caption="The same step as Add verification code: issuer, account, live code, Save code. “Choose another login” is the way back; Cancel stays in the corner.">
          <Confirm />
        </Frame>
        <Frame label="3 · Not a code" phone caption="A link Psss cannot make a code from says why in the same words as the paste flow, and that nothing was saved.">
          <SheetPhone tall={380}>
            <Problem>This code uses a type Psss can’t make yet. Nothing was saved.</Problem>
            <p style={{ textAlign: 'center' }}>This link was not saved. Look for “Can’t scan?” on the site to get the setup key, then use Add code on a login.</p>
          </SheetPhone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="Setup, Verification codes (iPhone and iPad)" phone caption="iOS does not say which app opens these links and has no link to that picker, so this is a standing line, not a status, and it never nags. The Mac has no such picker and shows nothing.">
          <IPhone>
            <div className="pbody" style={{ padding: 16 }}>
              <div className="s" style={{ margin: '0 4px 6px' }}>Verification codes</div>
              <div className="icard"><div className="frow"><div className="fbody">To open a site’s “set up authenticator” link in Psss, choose Psss under Settings, Passwords, Verification Codes, Set Up Codes In.</div></div></div>
            </div>
          </IPhone>
        </Frame>
      </Frames>

      <Decisions
        items={[
          {
            decision: <>The first screen is option H (owner, 2026-11-24): three rows in one card, “Screenshot or key” with the system Paste control at its end, Scan with camera, Choose photo (Choose image… on Mac), then one help block under the card: “Take a screenshot of the QR code, then paste it or pick it from your photos. Or copy the setup key from the site and paste that.”. No footer: “Nothing is uploaded.” is gone from this sheet, and the confirm step still says the code is saved in the vault on this device. (Earlier recommendation, option C: one prominent Paste, the help directly under it, two equal full-width rows (Scan with camera, Choose photo; Choose image… on Mac) in one card, and one privacy line under the card.</>,
            rejected: <>today’s two paragraphs and mismatched buttons (A); a row per situation (B); asking where the QR code is first (D); growing the editor in place (E); an Add code menu (F).</>,
            why: <>Paste is how most people get a code in, so it leads and is the only filled control. The two other ways are equal because they are equal. The instruction sits directly under the button it explains, and the problem takes the same place when something fails, so there is one block of words to read.)</>,
          },
          {
            decision: <>Two type sizes only, as everywhere: the title in the bar, body for everything else, secondary colour for help.</>,
          },
          {
            decision: <>The confirm step loses its bottom “Cancel” (the corner Cancel does that). “Keep current code” stays, only when replacing, because it says what leaving does.</>,
          },
          {
            decision: <>Copy changes: the lead sentence goes (its job moves into the help, which is the one block under Paste); help “Copy the setup key from the site: tap “Can’t scan?” to show it. Or screenshot the QR code, tap its preview and choose Copy and Delete.”; footer “Nothing is uploaded.” (the confirm step already says the code is saved in the vault on this device). “On this phone?” goes: the help is right for every device.</>,
          },
        ]}
      />
      <Against>
        <li><strong>The system Paste control cannot be renamed, so the row carries the label.</strong> The owner first asked for “Paste Screenshot”, then chose the system control (no “Allow Paste” prompt) with a label at the left of its row. The label says “screenshot or setup key” because the control takes both. The row is the one with a button; the other two are tapped anywhere. <strong>Paste cannot be restyled:</strong> The system control keeps its label and icon, and the system dims it when the clipboard is empty. The help under it is what makes the dim state understandable. Whether it can be stretched to full width is untested; the design does not need it (the two rows set the width), and it stays centred at the large control size, as today, until checked on a device.</li>
        <li><strong>A sheet over a sheet on a new login.</strong> Apple’s guidance prefers one sheet at a time. Kept, because the code must be saved at once (W8) and a sheet is the one place a person can wait while they leave the app. Option E is the way out if this is ever decided against.</li>
        <li><strong>Apple Passwords uses a text field plus “Scan QR Code…”.</strong> It can, because Safari hands it the key. Nothing in iOS lets Psss do that yet, so Paste has to lead.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-24', text: <>Section 7 added: a site’s otpauth:// link now opens Psss, which asks which login the code belongs to (frames 1 to 3 and the Setup line). Replaces deferred item 1 of the code-setup doc. Nothing is saved from the link until the confirm button; a new login opens in the editor unsaved.</> },
          { date: '2026-11-24', text: <>The first row became a label at the left (“Screenshot or key”) with the system Paste control at its end; the stretched “Paste Screenshot” row and the H2 frame are gone. The owner chose the system control because a plain row named Paste Screenshot would raise the “Allow Paste” prompt each time, and the stretched system control is untested.</> },
          { date: '2026-11-24', text: <>The owner chose H1 and asked for the first row to read Paste Screenshot, the footer “Nothing is uploaded.” to go, and the help to be shorter and direct (take a screenshot, pick it from photos, or copy). C was the recommendation before; its frames stay in the options section. The iPad and Mac frames and the state frames now draw H1.</> },
          { date: '2026-11-24', text: <>Option H added at the owner’s request: Paste as a row like Scan with camera and Choose photo, drawn stretched (H1) and with the button at the row’s end (H2).</> },
          { date: '2026-11-24', text: <>Page added, not yet approved. Replaces the sheet drawn in the Item page mock (a bare Paste button and a paragraph) and the one built from it, which showed two paragraphs, a small dimmed Paste and two buttons of different widths. The owner asked for the workflow to be improved and documented, with options evaluated.</> },
        ]}
      />
    </Page>
  );
}
