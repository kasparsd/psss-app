import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { ListRow, CodeDigits } from '../components/Rows';
import { Nav } from '../screens/PhoneScreens';
import { PopUpRow } from '../components/PopUpRow';
import { VaultRow, VaultNotice } from '../components/VaultRow';
import { VaultMenu, type VaultState } from '../components/VaultMenu';
import { Notice } from '../components/Notice';
import { BioPrompt } from '../components/BioPrompt';
import { Caret, FillBtn, Hit, Pills, gitforge, gitforge2, harbor, hosting } from '../components/loginParts';
import './autofill.css';

/** One heading above a card, outside the card (plan section 4). */
const Head = ({ children }: { children: ReactNode }) => <div className="af-h">{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div className="af-help">{children}</div>;

/** The search field, focused: the accent ring and a caret, with the typed text before it. */
const Field = ({ text }: { text?: string }) => (
  <div className="sfield" style={{ width: '100%', boxShadow: '0 0 0 2px var(--accent)' }}>
    {text}<Caret />{!text && <span className="s" style={{ marginLeft: 4 }}>Search all items</span>}
  </div>
);

/** The shared Vault row (components/VaultRow.tsx) with the shared picker menu (components/VaultMenu.tsx) when open; `unlock` is the locked state, `gone` the not-available one.
 * The menu hangs inward from the control (right-aligned on iPhone and iPad, left-aligned beside the Mac's label) so it never leaves the device; the current vault's padlock follows its state. */
function Vr({ name = 'Passwords', mac, unlock, gone, menu, states }: { name?: string; mac?: boolean; unlock?: boolean; gone?: boolean; menu?: boolean; states?: Record<string, VaultState> }) {
  const st: Record<string, VaultState> = { ...(unlock ? { [name]: 'locked' } : {}), ...states };
  return (
    <div className="af-vrow">
      <div className="af-pu">
        <VaultRow name={name} state={gone ? 'unavailable' : unlock ? 'locked' : 'unlocked'} variant={mac ? 'mac' : 'phone'} menu={menu && <VaultMenu picker align={mac ? 'left' : 'right'} shift={mac ? 0 : 16} current={name} states={st} />} />
      </div>
    </div>
  );
}

/* ---------- screens: the same rows on every device ---------- */

type Dev = 'iphone' | 'ipad' | 'mac';

/** The picker or sheet frame: iPhone has the search at the foot over the keyboard; iPad and Mac have a sheet with the search on top. */
function Screen({ device, title, left = 'Cancel', vault, search, pills, overlay, children }: {
  device: Dev; title: string; left?: string; vault?: ReactNode; search?: ReactNode; pills?: ReactNode; overlay?: ReactNode; children: ReactNode;
}) {
  if (device === 'iphone') {
    return (
      <IPhone>
        <Nav left={<button className="btn glass">{left}</button>} mid={<strong>{title}</strong>} />
        {vault}
        {pills && <div className="af-pills">{pills}</div>}
        <div className="pbody" style={{ flex: 1 }}>{children}</div>
        {search && <div className="pin">{search}</div>}
        {search && <div className="kbd" style={{ position: 'static', height: 150 }}>Keyboard</div>}
        {overlay}
      </IPhone>
    );
  }
  const inner = (
    <div style={{ position: 'relative', height: device === 'mac' ? 440 : 560, background: 'var(--win)' }}>
      <div className="sheetwrap">
        <div className="sheet" style={{ width: 'min(100%, 460px)' }}>
          <div className="maphead" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}><div className="t">{title}</div></div>
          {vault}
          {search && <div style={{ padding: '0 0 8px' }}>{search}</div>}
          {pills && <div className="af-pills">{pills}</div>}
          <div className="sheetscroll">{children}</div>
          <div className="sheetfoot"><button className="btn glass">{left}</button></div>
        </div>
      </div>
    </div>
  );
  return device === 'ipad' ? <IPad>{inner}</IPad> : <MacWindow>{inner}</MacWindow>;
}

const counts: [string, number][] = [['Name', 2], ['Website', 3], ['Username', 0]];

/** Logins for this site: the heading above the card; rows name over account, the website when the name is the account. */
const SiteList = ({ mac, one }: { mac?: boolean; one?: boolean }) => (
  <>
    <Head>For This Site</Head>
    <div className="grp">
      <ListRow item={gitforge} mac={mac} traits="passkey" trailing={<FillBtn main={one} />} />
      {!one && <ListRow item={harbor} mac={mac} traits={false} sub="gitforge.example" trailing={<FillBtn />} />}
    </div>
  </>
);

const SearchList = ({ mac }: { mac?: boolean }) => (
  <>
    <Head>For This Site</Head>
    <div className="grp">
      <ListRow item={gitforge} mac={mac} traits="passkey" sub={<Hit hit="git" after="forge.example" />} trailing={<FillBtn />} />
      <ListRow item={gitforge2} mac={mac} traits={false} sub={<Hit hit="git" after="forge.example" />} trailing={<FillBtn />} />
    </div>
    <Head>Other Matches</Head>
    <div className="grp">
      <ListRow item={hosting} mac={mac} traits={false} wrap sub={<>Saved for <Hit hit="git" after="hosting.example" /></>} trailing={<FillBtn />} />
    </div>
  </>
);

/** The app's lock screen, inside the sheet (UnlockScreen.tsx, approved 2026-11-24): Vault row above, vault password, Unlock, Cancel. No More Options and no Forgot Password.
 * The Key file row shows only when the vault is known to use one (`keyfile="uses"`) or after Choose Key File… in the wrong-password notice (`"chosen"`). */
function UnlockBody({ mac, state = 'idle', keyfile }: { mac?: boolean; state?: 'idle' | 'wrong' | 'checking'; keyfile?: 'uses' | 'chosen' }) {
  const checking = state === 'checking';
  return (
    <div className="af-pad">
      <div className="lk-field" style={{ width: 'auto', ...(checking ? { opacity: 0.5, borderColor: 'var(--sep)' } : null) }} aria-disabled={checking}>{checking ? '••••••••••••' : <>Vault Password{state === 'idle' && <Caret />}</>}</div>
      {state === 'wrong' && (
        <Notice kind="warning" action={keyfile ? undefined : <button className="btn sq">Choose Key File…</button>}>That didn’t open Work. Check Caps Lock and your keyboard language. If this vault uses a key file, choose it.</Notice>
      )}
      {checking && <Notice kind="progress" title="Checking your vault password…">This takes a moment on purpose: it makes guessing your vault password very slow. Keep this sheet open.</Notice>}
      {keyfile && <PopUpRow label="Key file" value={keyfile === 'chosen' ? 'Work.keyx' : 'Choose…'} mac={mac} trailing={keyfile === 'chosen' ? <button className="lk-x" aria-label="Remove key file">×</button> : undefined} />}
      <button className="btn pri wide" disabled={checking}>Unlock</button>
      {!checking && <div className="af-help" style={{ padding: 0 }}>Opens Work for this sheet only. Psss closes it when the sheet closes.</div>}
    </div>
  );
}

const Unlocking = ({ device, state, keyfile }: { device: Dev; state?: 'idle' | 'wrong' | 'checking'; keyfile?: 'uses' | 'chosen' }) => (
  <Screen device={device} title="Unlock Work" vault={<Vr name="Work" mac={device === 'mac'} />}>
    <UnlockBody mac={device === 'mac'} state={state} keyfile={keyfile} />
  </Screen>
);

/** Work's logins for the site, after the vault opened (Face ID, or the vault password in the sheet). */
const WorkList = ({ search = true }: { search?: boolean }) => (
  <Screen device="iphone" title="Choose a Login" vault={<Vr name="Work" />} search={search ? <Field /> : undefined}>
    <Head>For gitforge.example</Head><div className="grp"><ListRow item={gitforge2} traits={false} trailing={<FillBtn main />} /></div>
  </Screen>
);

const Values = () => (
  <Screen device="iphone" title="Gitforge" left="Back" vault={<Vr />}>
    <Head>Fill one value</Head>
    <div className="ac-card" style={{ margin: 0 }}>
      <div className="ac-kv"><span>Username</span><span className="s">sam.r</span></div>
      <div className="ac-kv"><span>Password</span><span className="s">••••••••••</span></div>
      <div className="ac-kv"><span>Verification code</span><CodeDigits code="482 913" /></div>
    </div>
    <Foot>Tap a value to fill it.</Foot>
  </Screen>
);

/* ---------- saving ---------- */

function SaveScreen({ title, vault, kind, button, disabled, notice }: { title: string; vault: ReactNode; kind: 'password' | 'passkey'; button: string; disabled?: boolean; notice?: ReactNode }) {
  return (
    <IPhone>
      <Nav left={<button className="btn glass">Cancel</button>} mid={<strong>{title}</strong>} />
      {vault}
      <div className="pbody" style={{ flex: 1 }}>
        {notice}
        <Head>{kind === 'password' ? 'To save' : 'To create'}</Head>
        <div className="ac-card" style={{ margin: 0 }}>
          <div className="ac-kv"><span>Website</span><span className="s">gitforge.example</span></div>
          <div className="ac-kv"><span>Username</span><span className="s">sam.r</span></div>
          {kind === 'password' ? <div className="ac-kv"><span>Password</span><span className="s">••••••••••</span></div> : <div className="ac-kv"><span>Passkey</span><span className="s">New</span></div>}
        </div>
        <div className="ac-save" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 20 }}><button className="btn pri wide" disabled={disabled}>{button}</button></div>
      </div>
    </IPhone>
  );
}

export function Autofill() {
  return (
    <Page
      title="AutoFill: choosing a login"
      status={<><strong>Redrawn 2026-11-24 from the vault-states model; lead-approved, being built.</strong> The picker is built without Unlock beside the Vault row, the in-sheet unlock, the list header, the passkey section and the save frames; those are being built from this page. The browser extension has <a href="#/browser-extension">its own page</a>.</>}
    >
      <Clarity
        intro={<p>The system opens this sheet over another app or a web page, in the middle of signing in or saving. The person did not come to browse: they want one login in the field, or a new one saved, and to be back where they were.</p>}
        items={[
          ['Which thing?', 'The AutoFill sheet on iPhone, iPad and Mac, named for the job: “Choose a Login”, “Save Password”, “Choose a Code”. It always names the vault it reads from or saves into, in a Vault row.'],
          ['What must they give?', 'Usually only Face ID or Touch ID, which the system asks for, then one Fill. A locked vault gets an Unlock button beside the Vault row; when quick unlock is off it shows the app’s lock screen right here: the vault password, and a key file only when the vault uses one.'],
          ['What can go wrong?', 'The vault is locked, needs its password, or is not available (not downloaded, not found, can’t be read). The notice says which, in the vault’s name, and the Vault row stays so another vault is one tap away..'],
          ['How do they leave?', 'Fill, Save or Cancel, all returning to the page. Looking, searching and unlocking change nothing in the vault; Psss closes the vault when the sheet closes.'],
        ]}
      />

      <Section title="1. Choosing a login">
        <p>One current vault per device: the app, this sheet and the browser popup all show it. With two or more vaults the Vault row sits at the top of every AutoFill screen (list, values, codes, save). The sheet opens on the logins for the page’s site and the search field has the focus.</p>
      </Section>
      <Frames>
        <Frame label="A · iPhone, logins for this site" phone caption="The heading is above the card. Rows are the app’s: name over account, and the website when the name is the account (the second row). Fill is bordered; it is filled when exactly one login matches."><Screen device="iphone" title="Choose a Login" vault={<Vr />} search={<Field />}><SiteList /><Foot>Tap a name to fill one value instead, such as only the username.</Foot></Screen></Frame>
        <Frame label="B · iPhone, searching “git”" phone caption="The Name, Website and Username pills sit directly under the Vault row with no gap above the list; accent when on, dimmed at 0. Results are in two groups, as the app’s list groups rows: “For This Site” and “Other Matches”. A login saved for another site is in Other Matches, its second line says “Saved for githosting.example” (or “No website”), and its button is the same Fill."><Screen device="iphone" title="Choose a Login" vault={<Vr />} pills={<Pills counts={counts} />} search={<Field text="git" />}><SearchList /></Screen></Frame>
      </Frames>
      <Frames>
        <Frame label="C · Mac, one login matches" caption="A sheet over the page’s window: Vault row, the search field, pills directly under it when typing, then the heading and the card. One match, so Fill is the filled button."><Screen device="mac" title="Choose a Login" vault={<Vr mac />} search={<Field />}><SiteList mac one /><Foot>Tap a name to fill one value instead, such as only the username.</Foot></Screen></Frame>
        <Frame label="D · iPad, searching" caption="Same sheet; the rows are the iPad list’s rounded rows. The pills touch the search field."><Screen device="ipad" title="Choose a Login" vault={<Vr />} search={<Field text="git" />} pills={<Pills counts={counts} />}><SearchList mac /></Screen></Frame>
      </Frames>
      <Frames>
        <Frame label="E · iPhone, nothing for this site in this vault" phone caption="A notice, the same card as the vault notices: “No logins for this site”, the vault named, and the ways on: search all items below, or choose another vault in the Vault row. No button, because both are controls already on screen. Psss does not search the other vault for the person. The menu is closed here so the notice can be read; frame F opens it."><Screen device="iphone" title="Choose a Login" vault={<Vr />} search={<Field />}><Head>For cloudnest.example</Head><Notice kind="info" title="No logins for this site">Passwords has none for cloudnest.example. Search all items below, or choose another vault above.</Notice></Screen></Frame>
      </Frames>

      <Section title="2. Another vault: locked, needs password, not available">
        <p>Choosing a vault makes it the app’s vault too; the open one locks. A vault that is locked gets a labeled Unlock button at the end of the Vault row and one notice saying why. The vault menu lists every vault with its location, or its state when it is not simply locked; the current vault shows the open padlock when it is unlocked here (spoken “Unlocked”) and the closed one when it is not (“Locked”).</p>
        <p>The main story, with Face ID ready: the empty line (frame E), choose Work (F), Face ID (G), Work’s list (H).</p>
      </Section>
      <Frames>
        <Frame label="F · iPhone, choosing Work" phone caption="From frame E. Passwords, the current vault, has the open padlock; Work’s row has the closed padlock (spoken “Locked”) and its location. Face ID is ready for Work, so choosing it goes straight to the prompt. No Lock and no Add Vault… here; the vault that is open locks."><Screen device="iphone" title="Choose a Login" vault={<Vr menu />} search={<Field />}><Head>For cloudnest.example</Head></Screen></Frame>
        <Frame label="G · iPhone, Face ID" phone caption="Work is now the current vault and Face ID is asked at once, over the sheet. This is the system’s prompt, not Psss’s. Cancelling it leaves Work locked with Unlock beside the Vault row (frame J)."><Screen device="iphone" title="Choose a Login" vault={<Vr name="Work" unlock />} search={<Field />} overlay={<BioPrompt bio="Face ID" reason="Unlock Work" />}><Head>For cloudnest.example</Head></Screen></Frame>
        <Frame label="H · iPhone, Work’s logins" phone caption="Face ID accepted (or the vault password, frame L): Work’s logins for the site. The Unlock button is gone and the padlock is open; the vault stays open until the sheet closes."><WorkList /></Frame>
      </Frames>
      <Frames>
        <Frame label="I · iPhone, a vault that needs its password" phone caption="Same rows as the app’s menu. Work needs its vault password, so its subtitle says so instead of the location; the glyph is still the closed padlock."><Screen device="iphone" title="Choose a Login" vault={<Vr menu states={{ Work: 'needs-password' }} />}><SiteList /></Screen></Frame>
        <Frame label="J · iPhone, locked" phone caption="Quick unlock is ready but Face ID was cancelled. Unlock asks Face ID again; the person can also pick the other vault."><Screen device="iphone" title="Choose a Login" vault={<Vr unlock />}><VaultNotice kind="cancelled" /></Screen></Frame>
        <Frame label="K · iPhone, needs password" phone caption="Quick unlock is off for Work, so Unlock opens the app’s lock screen inside this sheet (frame L). The notice says why, then what to do."><Screen device="iphone" title="Choose a Login" vault={<Vr name="Work" unlock />}><VaultNotice kind="needs-password" name="Work" /></Screen></Frame>
      </Frames>
      <Frames>
        <Frame label="L · iPhone, Unlock chosen" phone caption="The app’s lock screen, as approved (Unlock page): the Vault row, the vault password with the focus, Unlock. No More Options and no Key file row, because Work is not known to use a key file. No Forgot Password: that help lives in the app. Cancel goes back to frame K."><Unlocking device="iphone" /></Frame>
        <Frame label="M · iPhone, wrong password" phone caption="The notice sits under the field, as on the lock screen. Only here does Choose Key File… appear, for a vault made elsewhere that turns out to need one."><Unlocking device="iphone" state="wrong" /></Frame>
        <Frame label="N · iPhone, checking the password" phone caption="The field is dimmed and locked; “Checking your vault password…” says the wait is on purpose. Unlock dims and moves down; the Vault row stays."><Unlocking device="iphone" state="checking" /></Frame>
        <Frame label="O · Mac, vault uses a key file" caption="The Key file row is shown from the start, because Psss recorded that Work uses one (after Choose Key File…, it shows the file’s name and a remove button). The same screen on iPad."><Unlocking device="mac" keyfile="uses" /></Frame>
      </Frames>
      <Frames>
        <Frame label="P · iPhone, not found" phone caption="No Unlock: nothing here can fix it. The Vault row carries the orange warning glyph as the menu does; the notice says what Psss will do and where the fix is. The row stays, so Passwords is one tap away."><Screen device="iphone" title="Choose a Login" vault={<Vr name="Archive" gone />}><VaultNotice kind="not-found" name="Archive" /></Screen></Frame>
        <Frame label="Q · iPhone, not downloaded yet" phone caption="Travel is in iCloud but not on this device. Same row and glyph, no Unlock; downloading is done in Psss."><Screen device="iphone" title="Choose a Login" vault={<Vr name="Travel" gone />}><VaultNotice kind="not-downloaded" name="Travel" /></Screen></Frame>
        <Frame label="R · iPhone, can’t be read" phone caption="Taxes is damaged or not a vault. Same row and glyph; the details are in Psss."><Screen device="iphone" title="Choose a Login" vault={<Vr name="Taxes" gone />}><VaultNotice kind="unreadable" name="Taxes" /></Screen></Frame>
        <Frame label="S · iPhone, one vault, locked" phone caption="With one vault there is no Vault row, so the notice carries the Unlock button."><Screen device="iphone" title="Choose a Login"><div style={{ padding: '4px 2px' }}><VaultNotice kind="cancelled" unlock /></div></Screen></Frame>
      </Frames>

      <Section title="3. What to fill">
        <p>Fill fills the username and the password. Tapping a name opens its values to fill one. A passkey request lists the passkeys first. The single Fill screen is gone: every entry point opens a list.</p>
      </Section>
      <Frames>
        <Frame label="T · iPhone, tap a name for its values" phone caption="Username, password and the verification code, each tapped to fill on its own. The Vault row is on this screen too. Choosing another vault here returns to that vault’s list."><Values /></Frame>
        <Frame label="U · iPhone, a passkey request" phone caption="“Passkeys for gitforge.example” first, rows with the passkey glyph and Sign In; logins below under “Logins”. No warning paragraph."><Screen device="iphone" title="Sign In" vault={<Vr />}><Head>Passkeys for gitforge.example</Head><div className="grp"><ListRow item={gitforge} traits="passkey" trailing={<FillBtn main label="Sign In" />} /></div><Head>Logins</Head><div className="grp"><ListRow item={harbor} traits={false} sub="gitforge.example" trailing={<FillBtn />} /></div></Screen></Frame>
        <Frame label="V · iPhone, a verification code" phone caption="The codes for the site, with the same Vault row. The code is the live one; Fill puts it in the field."><Screen device="iphone" title="Choose a Code" vault={<Vr />}><Head>For gitforge.example</Head><div className="grp"><ListRow item={gitforge} traits={false} trailing={<><CodeDigits code="482 913" /><FillBtn main /></>} /></div></Screen></Frame>
      </Frames>

      <Section title="4. Saving">
        <p>A save goes into the current vault. With two vaults the same Vault row sits at the top, so the person sees where it goes and can change it. Choosing a locked vault asks to unlock it first. Nothing is written until the vault file is.</p>
      </Section>
      <Frames>
        <Frame label="W · iPhone, Save Password" phone caption="Title from the site name, website, username, password. The button says Save. Changing vault here keeps the form and only changes where it goes."><SaveScreen title="Save Password" kind="password" vault={<Vr />} button="Save" /></Frame>
        <Frame label="X · iPhone, the login already exists" phone caption="Same website and username in Passwords: the button names what it will change and is the default. Update changes the password only (and adds a passkey); the username and title stay. Otherwise it says Save."><SaveScreen title="Save Password" kind="password" vault={<Vr />} button="Update Gitforge (sam.r)" /></Frame>
        <Frame label="Y · iPhone, creating a passkey" phone caption="The passkey joins the matching login when there is one (same website and username), otherwise a new login is made. The Vault row is here too."><SaveScreen title="Create Passkey" kind="passkey" vault={<Vr />} button="Add Passkey to Gitforge (sam.r)" /></Frame>
      </Frames>
      <Frames>
        <Frame label="Z · iPhone, a locked vault chosen" phone caption="Work is chosen but locked: Unlock first, and Save stays dimmed until it is open. Changing vault on this screen keeps the form (website, username, password); only the destination changes."><SaveScreen title="Save Password" kind="password" vault={<Vr name="Work" unlock />} button="Save" disabled notice={<div style={{ paddingTop: 4 }}><VaultNotice kind="needs-password" name="Work" /></div>} /></Frame>
      </Frames>

      <Section title="5. A reminder card is not a notice">
        <p>The app’s AutoFill and Safari reminder cards (title, one sentence, buttons) ask the person to do something and can be put off. A notice tells them what is true now. Both are cards with the same corner radius and padding.</p>
      </Section>
      <Frames>
        <Frame label="AA · Side by side" caption="Left: the reminder card as built. Right: the notice card. Different jobs, so a different look.">
          <div style={{ display: 'flex', gap: 12, padding: 16, background: 'var(--win)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', background: 'rgba(142,142,147,.16)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 600 }}>Turn on AutoFill</div>
              <div style={{ margin: '4px 0 12px' }}>Psss then fills your logins in Safari and apps.</div>
              <div style={{ display: 'flex', gap: 8 }}><button className="btn pri">Turn On</button><button className="btn sq">Later</button></div>
            </div>
            <div style={{ flex: '1 1 240px' }}><VaultNotice kind="needs-password" name="Work" /></div>
          </div>
        </Frame>
      </Frames>

      <Section title="6. How it is built">
        <ul>
          <li>The AutoFill extension compiles only <code>App/Core</code> and its own folder, so the row, the icon, the Vault row, the menu and the search pills it shares with the app live in <code>App/Core</code>. The search rule (<code>ItemSearch</code>) is the app’s.</li>
          <li>One set of words for the sheet, the browser popup and the app: Fill, Unlock, Cancel, the group headings “For This Site” and “Other Matches”, “Saved for …”, the pill names, the notice sentences.</li>
          <li>The extension opens a vault only for the lifetime of the sheet; nothing stays open after it closes.</li>
        </ul>
      </Section>

      <Decisions
        items={[
          {
            decision: <>Keep the Vault row as the vault picker, and add a labeled Unlock button beside it when the current vault is locked. One current vault per device: choosing a vault in the sheet makes it current in the app and the browser popup as well.</>,
            why: <>The owner’s review of the earlier drawing (“all over the place”): keep the switchers, put Unlock beside the picker, think from the states up. One rule is simple to say and matches the code, where switching works only while locked and the browser relay lives in the app.</>,
          },
          {
            decision: <>The Vault row is on every AutoFill screen when there are two or more vaults: list, values, codes and save.</>,
            why: <>The person always sees which vault a login comes from or goes into. With one vault there is no row; the notice carries Unlock.</>,
          },
          {
            decision: <>Unlock for a vault that needs its password shows the app’s lock screen inside the sheet, exactly as approved on the Unlock page: the vault password, no More Options, a Key file row only when the vault is known to use a key file or after Choose Key File… in the wrong-password notice, and the same wrong-password and “Checking your vault password…” notices. There is no Forgot Password in the sheet.</>,
            why: <>The sheet cannot open the app, and a notice with words only left the person stuck. One lock screen is one thing to learn; help for a forgotten password lives in the app, which the sheet cannot open.</>,
          },
          {
            decision: <>The list heading (“For gitforge.example”) is above the card. Rows show name over account, and the website when the name is the account. The pills touch the search field.</>,
            why: <>The same rows as the app’s list. A heading inside the card read as a row.</>,
          },
          {
            decision: <>Fill is the same on every result; there is no Fill… and no confirmation. Results are grouped like the app’s list: “For This Site” (website matches), then “Other Matches” (matched by name or search, saved for another site or without a website), an empty group omitted. Other Matches rows keep a second line, “Saved for githosting.example” or “No website”. Fill is the same everywhere; the group heading and the row’s “Saved for …” line say it’s another site.</>,
            rejected: <>“Fill…” with an ask-first confirmation (Fill Anyway).</>,
            why: <>The owner: one button, no extra step. The second line is now the safety signal against a lookalike site.</>,
          },
          {
            decision: <>Nothing for this site in the current vault is a notice (the card the vault notices use) titled “No logins for this site”, naming the vault and pointing to the search field and the Vault row; Psss does not search every vault.</>,
            why: <>The device test showed a person not knowing the login was in the other vault.</>,
          },
          {
            decision: <>Update changes the password (and adds a passkey) of the existing login; it never changes the username or title.</>,
            why: <>The person matched on website and username, so those are the login’s identity; the password is what changed.</>,
          },
          {
            decision: <>Choosing another vault mid-flow: on a values screen it returns to the new vault’s list; on a save screen the form is kept and only the destination changes (unlock first if needed).</>,
            why: <>A list belongs to one vault, a half-filled save form does not.</>,
          },
          {
            decision: <>The needs-password notice says why in a few words (“Face ID is off for Work.”, “Face ID changed since Work was set up.”, “Face ID is locked out right now.”), then “Unlock with the vault password.”</>,
            why: <>“Needs its password” alone left the person guessing what had changed.</>,
          },
          {
            decision: <>Face ID first: choosing a vault whose quick unlock is ready goes straight to the system’s prompt, then to that vault’s list (frames E to H). The vault menu shows the open padlock on the current vault when it is unlocked here, and the closed one otherwise; the spoken labels are “Unlocked” and “Locked”.</>,
            why: <>The common case should be the shortest one, and the glyph must tell the truth about the vault that is current.</>,
          },
          {
            decision: <>On iPhone the Name, Website and Username pills sit directly under the Vault row, and the search field stays at the foot over the keyboard (iOS 26 placement). On iPad and Mac the search field is on top with the pills directly under it. Save screens on iPad and Mac follow the iPhone frames in the sheet layout.</>,
            why: <>The lead’s decision for the open questions: the search field is where the system puts it on each device, and the pills stay next to the thing they filter.</>,
          },
          {
            decision: <>A not-available vault shows the orange warning glyph in the Vault row as well as in the menu and the notice.</>,
            why: <>The row is what the person looks at; the glyph there says “not usable” before the notice is read.</>,
          },
          {
            decision: <>No Sort or Filter menus. The pills are the only filter.</>,
            why: <>The person is choosing one login for one page, not browsing a long list.</>,
          },
          {
            decision: <>Not-available vaults get no Unlock. The notice says what Psss will do and the Vault row stays.</>,
            why: <>Nothing here can fix a missing or unreadable file, and the app is where it is solved.</>,
          },
        ]}
      />

      <Section title="Open questions">
        <ul>
          <li><strong>The vault password in the extension.</strong> The key derivation for an Argon2 vault of 64 MiB may not fit the AutoFill extension’s memory limit. If it does not, Unlock for that vault says “Open Psss to unlock Work” instead (not measured).</li>
          <li><strong>Passkeys.</strong> Google’s passkey page offered none on the device. Not known whether the cause was the other vault, the relying party (<code>google.com</code> against <code>accounts.google.com</code>) or an export without passkeys.</li>
          <li><strong>Verification code suggestion.</strong> Frame V is not verified on a device.</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>Fill… and its confirmation are replaced by grouped results with a uniform Fill, at the owner’s request: “For This Site” (website matches), then “Other Matches” (matched by name or search, saved for another site or with no website), each of those rows keeping “Saved for githosting.example” or “No website” as the lookalike-site signal. Frame B and the site list’s heading (“For This Site”, was “For gitforge.example”) redrawn; the “Fill… asks first” footer is gone. The browser popup has the same groups.</> },
          { date: '2026-11-25', text: <>Frame E, nothing for this site: a notice titled “No logins for this site” (the vault notices’ card) with one sentence naming the vault, the search field and the Vault row. Replaces the single line of plain text. The browser popup has the same notice.</> },
          { date: '2026-11-25', text: <>On the Mac sheet the Vault row’s Unlock is the default push button (accent fill, white text), as on the other Mac frames, instead of the iOS capsule. Replaces the iOS capsule on the Mac.</> },
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Simulator test fixes, no frame redrawn: after the first tap the Save, Update and Create Passkey button is dimmed and reads “Saving…” and ignores further taps (a second tap had saved the login twice); the button title is plain text in one style, “Update Gitforge (sam.r)”, or “Update Gitforge” when the login has no username; the search field never capitalises or corrects; choosing another vault clears the list and shows the Vault row with “Opening…” until Face ID answers; a login saved from a page has no name of its own, so the website its row shows counts under Name too and the matching part of the name is in bold.</> },
          { date: '2026-11-24', text: <>Lead decisions applied to the frames: the menu hangs inward and never leaves the device; the empty-in-this-vault line is shown with the menu closed (E); the Face ID story is drawn end to end (E to H); the in-sheet unlock now matches the approved lock screen (no More Options; wrong-password with Choose Key File…, “Checking your vault password…”, key file known: L to O); not found, not downloaded and can’t be read have a frame each with the warning glyph in the Vault row (P to R), using Archive, Travel and Taxes instead of Work; “Gitforge (work)” is sam@work.example; the Save and Update buttons sit apart from the card. Replaces the unlock sheet with More Options and the menu drawn over frame E. Frames were re-lettered A to AA. The open questions about the pills and about save on iPad and Mac are decided and moved to the decisions.</> },
          { date: '2026-11-24', text: <>Shared Vault row and menu; lead decisions applied. The page’s own Vault row and menu are gone: every frame uses <code>VaultRow</code>, <code>VaultNotice</code> and <code>VaultMenu</code> (picker variant: no Lock, no Add Vault…, state subtitles). Needs-password notices say why; Update changes the password only; mid-flow vault change rules added to the values and save frames.</> },
          { date: '2026-11-24', text: <>Redrawn from the vault-states model (<code>docs/plans/vault-switcher-and-extension-style.md</code>, sections 2 to 6) after the owner’s review: Unlock beside the Vault row, the in-sheet unlock, not-available without Unlock, one-vault notice with Unlock, the list heading above the card, name-equals-account rows, pills with no gap, the empty-in-this-vault line, Fill and Fill…, the passkey request, the code list, the values screen and the save frames. Replaces the earlier notice frames F to H (words only, “open Psss”), which left a locked vault with no way to open it here, and the page’s own vault list. Frames were re-lettered A to U. Sample vaults are Passwords and Work. Not built.</> },
          { date: '2026-11-24', text: <>Split from “AutoFill and the browser extension: one style” (owner: they overlap but the journey is different); the popup is now on <a href="#/browser-extension">Browser extension</a>.</> },
          { date: '2026-11-24', text: <>The Vault row now uses the shared pop-up row component (<code>components/PopUpRow.tsx</code>): a rounded grey row with the value in the accent colour on iPhone and iPad, a bordered pop-up button on the Mac. Replaces the page’s own row drawing.</> },
          { date: '2026-11-24', text: <>The vault switcher is a Vault row above the list on iPhone, iPad and Mac, replacing the icon alone in the iPhone bar and the name button in the iPad and Mac heading. An icon alone said nothing about which vault was open.</> },
          { date: '2026-11-24', text: <>Tapping a keyboard suggestion opens the same list as frame A for the suggestion’s site (the one-login Fill screen is gone), with the search field always shown. I had drawn a Fill screen with a “Choose Another Login…” button first and the owner asked for the existing row format with the search always visible instead.</> },
          { date: '2026-11-24', text: <>Built in the native AutoFill picker (iPhone, iPad, Mac): the app’s row with a Fill button, focused search, field pills with the matched part bold, and the vault switcher.</> },
          { date: '2026-11-24', text: <>Page added as a proposal at the owner’s request: AutoFill takes the app’s row, search and pills. Does not replace <a href="../fill-a-login.html">fill-a-login</a>, which keeps the stories, state map and checks for the flow itself.</> },
        ]}
      />
    </Page>
  );
}
