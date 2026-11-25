import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { ChevronIcon } from '../icons';
import { VaultStateMark, archiveVault, isUnavailable, passwordsVault, workVault, type VaultRowData } from '../components/VaultMenu';

/* ---------- small pieces shared by every frame on this page ---------- */

const Chev = () => <span className="chev"><ChevronIcon /></span>;

/** A group title above a card, in secondary colour at body size. */
const Head = ({ children }: { children: ReactNode }) => <div className="maphelp" style={{ paddingBottom: 4, paddingTop: 6 }}>{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div className="maphelp" style={{ paddingTop: 6 }}>{children}</div>;
const Card = ({ children }: { children: ReactNode }) => <div className="icard" style={{ marginBottom: 4 }}>{children}</div>;

const Line = ({ l, v, chev, link, red, sub }: { l: ReactNode; v?: ReactNode; chev?: boolean; link?: boolean; red?: boolean; sub?: ReactNode }) => (
  <div className="mapfield" style={link || red ? { color: red ? 'var(--red)' : 'var(--accent)' } : undefined}>
    <div className="l">{l}{sub && <div className="s">{sub}</div>}</div>
    {v && <span className="s">{v}</span>}
    {chev && <Chev />}
  </div>
);

const Switch = ({ on }: { on: boolean }) => (
  <span aria-hidden="true" style={{ width: 42, height: 26, borderRadius: 13, background: on ? '#34c759' : 'var(--field)', position: 'relative', flex: 'none' }}>
    <i style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 22, height: 22, borderRadius: 11, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
  </span>
);
const Toggle = ({ l, on }: { l: string; on: boolean }) => <div className="mapfield"><div className="l">{l}</div><Switch on={on} /></div>;

/** A pop-up button, drawn as the system draws a menu picker row. */
const Pick = ({ l, v }: { l: string; v: string }) => <div className="mapfield"><div className="l">{l}</div><span className="mapsel">{v} ⌃</span></div>;

type Kind = 'icloud' | 'device' | 'sample';

/* ---------- the vault page: everything that belongs to one vault ---------- */

const where: Record<Kind, string> = { icloud: 'iCloud Drive › Psss', device: 'On this device', sample: 'Not saved' };

function VaultBody({ kind, device = 'iPhone' }: { kind: Kind; device?: string }) {
  if (kind === 'sample') {
    return (
      <>
        <Foot>A made-up vault to look around in. Nothing you change here is saved: it is gone when Psss locks or quits.</Foot>
        <Head>Leave the sample</Head>
        <Card><Line l="Close Sample Vault" /></Card>
        <Foot>Shows the welcome screen, where you create a vault, open a vault file or import your logins.</Foot>
      </>
    );
  }
  const id = device === 'Mac' ? 'Touch ID' : 'Face ID';
  const managed = kind === 'device';
  return (
    <>
      <Card>
        <Line l="Name" v="Passwords" />
        <Line l="Location" v={where[kind]} />
        {!managed && <Line l="File" v="Passwords.kdbx" />}
        <Line l="Items" v="214" />
        <Line l="Modified" v="Today, 9:12" />
        {device === 'Mac'
          ? <>
              <div className="mapfield" style={{ gap: 8, justifyContent: 'flex-start' }}><span className="btn">Show in Finder</span><span className="btn">Save a Copy…</span></div>
              <Line l="Vault Password" v={<span className="btn">Change…</span>} />
              <div className="mapfield" style={{ justifyContent: 'flex-start' }}><span className="btn">Remove Vault…</span></div>
            </>
          : <><Line l="Save a Copy…" link /><Line l="Change Vault Password…" link /><Line l="Remove Vault…" link /></>}
        <Line l="Technical details" chev />
      </Card>
      <Foot>
        {`A KeePass file, encrypted with your vault password. Psss cannot reset the vault password. A copy is the way back if the file is lost. `}
        {managed
          ? (device === 'Mac' ? 'Removing it asks whether to keep the file on this Mac or delete it.' : `It is kept only on this ${device}, so removing it deletes the file. Save a copy first if you may need it.`)
          : 'Removing it keeps the file in iCloud Drive › Psss: you can open it again.'}
      </Foot>
      <Head>Unlock</Head>
      <Card><Toggle l={`Unlock with ${id}`} on /></Card>
      <Foot>{`AutoFill and the browser extension use this vault only while this is on. With it off, Psss asks for the vault password.`}</Foot>
    </>
  );
}

/* ---------- the app's own settings: apply to every vault ---------- */

export function AppBody() {
  return (
    <>
      <Head>Locking</Head>
      <Card>
        <Pick l="Lock" v="After 1 minute" />
        <Line l="Lock Now" link />
      </Card>
      <Foot>Applies to every vault.</Foot>
      <Head>AutoFill</Head>
      <Card>
        <Line l="AutoFill is on" sub="Psss fills your logins in Safari and apps." />
        <Line l="Open AutoFill Settings…" link />
      </Card>
      <Head>Help</Head>
      <Card>
        <Line l="Copying" chev />
        <Line l="Verification codes" chev />
        <Line l="Passkeys" chev />
      </Card>
    </>
  );
}

/** One vault in the list: the name only. The warning glyph appears only when the vault is not available; no second line. State and location stay on the vault's page. */
const VaultLine = ({ v }: { v: VaultRowData }) => <Line l={v.name} v={isUnavailable(v.state) ? <VaultStateMark state={v.state} inline /> : undefined} chev />;

export const VaultsList = ({ both, gone }: { both?: boolean; gone?: boolean }) => (
  <>
    <Head>Vaults</Head>
    <Card>
      <VaultLine v={{ ...passwordsVault, state: 'open' }} />
      {both && <VaultLine v={workVault} />}
      {gone && <VaultLine v={archiveVault} />}
      <Line l="Add Vault…" link />
    </Card>
    <Foot>Each vault has its own password, file and Face ID setting.</Foot>
  </>
);

/** The confirmation, drawn over a dimmed vault page. */
function Alert({ title, message, button, red, more = [] }: { title: string; message: string; button: string; red?: boolean; more?: { label: string; red?: boolean }[] }) {
  return (
    <>
      <div className="cs-dim" />
      <div style={{ position: 'absolute', left: 28, right: 28, top: '34%', zIndex: 9, background: 'var(--card)', borderRadius: 24, boxShadow: 'var(--shadow)', padding: '18px 16px 10px', textAlign: 'center' }}>
        <div className="t">{title}</div>
        <div className="s" style={{ padding: '6px 4px 12px' }}>{message}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn" style={{ justifyContent: 'center', padding: 11, color: red ? 'var(--red)' : 'var(--accent)' }}>{button}</button>
          {more.map((b) => <button key={b.label} className="btn" style={{ justifyContent: 'center', padding: 11, color: b.red ? 'var(--red)' : 'var(--accent)' }}>{b.label}</button>)}
          <button className="btn" style={{ justifyContent: 'center', padding: 11 }}>Cancel</button>
        </div>
      </div>
    </>
  );
}

/* ---------- frames ---------- */

export function Phone({ title, back, done, children, alert }: { title: string; back?: string; done?: boolean; children: ReactNode; alert?: ReactNode }) {
  return (
    <IPhone tall>
      <div className="nav">
        <div>{back ? <span className="btn glass">‹ {back}</span> : <span />}</div>
        <div className="mid">{title}</div>
        <div>{done ? <span className="btn glass save">Done</span> : <span />}</div>
      </div>
      <div className="pbody" style={{ overflow: 'visible' }}>{children}</div>
      {alert}
    </IPhone>
  );
}

function IPadSheet({ title, back, children }: { title: string; back?: string; children: ReactNode }) {
  return (
    <IPad>
      <div style={{ position: 'relative', height: 640, background: 'var(--win)' }}>
        <div className="sheetwrap">
          <div className="sheet" style={{ width: 'min(100%, 520px)' }}>
            <div className="sheetbar">
              {back ? <button className="btn plain">‹ {back}</button> : <span />}
              <strong>{title}</strong>
              <button className="btn pri main">Done</button>
            </div>
            <div className="sheetscroll">{children}</div>
          </div>
        </div>
      </div>
    </IPad>
  );
}

/** Mac, option C: the system's Settings window, with its toolbar of panes. */
export function MacSettings({ pane, both }: { pane: 'general' | 'vaults'; both?: boolean }) {
  const tab = (id: string, label: string) => (
    <span key={id} className="btn" style={{ background: pane === id ? 'var(--accent-bg)' : 'none', color: pane === id ? 'var(--accent)' : 'var(--lab2)', borderRadius: 10, flexDirection: 'column', padding: '6px 18px', fontWeight: 400 }}>{label}</span>
  );
  return (
    <MacWindow>
      <div style={{ height: 700, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 8px', borderBottom: '1px solid var(--sep)' }}>
          <div className="t" style={{ paddingBottom: 6 }}>{pane === 'general' ? 'General' : 'Vaults'}</div>
          <div style={{ display: 'flex', gap: 4 }}>{tab('general', 'General')}{tab('vaults', 'Vaults')}</div>
        </div>
        {pane === 'general' ? (
          <div style={{ padding: '14px 40px', overflow: 'hidden' }}>
            <AppBody />
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ width: 190, borderRight: '1px solid var(--sep)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="mapfield" style={{ background: 'var(--accent-sel)', borderRadius: 8, border: 0, minHeight: 36 }}><div className="l">Passwords</div></div>
              {both && <div className="mapfield" style={{ borderRadius: 8, border: 0, minHeight: 36 }}><div className="l">Work</div></div>}
              <div style={{ flex: 1 }} />
              <button className="btn">Add Vault…</button>
            </div>
            <div style={{ flex: 1, padding: '10px 22px', overflow: 'hidden' }}>
              <VaultBody kind="icloud" device="Mac" />
            </div>
          </div>
        )}
      </div>
    </MacWindow>
  );
}

const Row = ({ cells }: { cells: ReactNode[] }) => <tr>{cells.map((c, i) => <td key={i}>{c}</td>)}</tr>;

export function Settings() {
  return (
    <Page
      title="Settings: this vault and this app"
      status={<><strong>Options B and C chosen by the owner, 2026-11-24.</strong> B is built on iPhone and iPad, C on the Mac; the Mac window was clicked through on 2026-11-25 and the vault page regrouped (see the History). <strong>Proposal, not built (2026-11-24):</strong> the Face ID footer wording (see the History). Starts from the owner's remark that “Forget vault” sits outside the vault group in Setup and makes no sense there.</>}
    >
      <Clarity
        intro={<p>A person opens this screen to change something. They must know first whether it changes <em>one vault</em> or <em>the whole app</em>, and that the destructive step belongs to a vault and says what it does to the file.</p>}
        items={[
          ['Which thing?', 'Either one named vault (Passwords: its file, its password, its Face ID key, leaving it) or Psss on this device (when it locks, whether AutoFill is on, help). Every row is in exactly one of those two places and the screen says which.'],
          ['What must they give?', 'Nothing. Every row is a choice or an action; the only inputs are the Lock pop-up and the Face ID switch.'],
          ['What can go wrong?', 'Leaving a vault. The button is Remove Vault… for every vault; the confirmation says whether the file stays (and where), and only a button that deletes says Delete. It also says what Psss shows next.'],
          ['How do they leave?', 'Done. Forget is the way out of a vault; Save a Copy is the way to keep one first.'],
        ]}
      />

      <Section title="1. Today: where each row is and where it belongs">
        <table className="cmp">
          <thead><tr><th>Row in Setup today</th><th>Belongs to</th><th>Problem</th></tr></thead>
          <tbody>
            <Row cells={['Vault: name, location, details, items, Save a Copy, Change Vault Password', 'This vault', 'Fine, but it is a flat list beside app rows, so “Vault” is only a heading.']} />
            <Row cells={['Unlock with Face ID', 'This vault (the saved key is per vault)', 'Sits in its own unlabeled group, apart from the vault it unlocks.']} />
            <Row cells={['Security: Lock, Lock Now', 'The app (all vaults)', 'Fine. Says nothing about covering every vault once there are two.']} />
            <Row cells={['AutoFill', 'The device', 'Fine.']} />
            <Row cells={['Help', 'The app', 'Fine.']} />
            <Row cells={['Reset: Start Over…', 'This vault', 'Last in the list under “Reset”, far from the vault. Called “Start over” but it only forgets (or deletes) the one vault, and with a second vault it shows that vault’s lock screen instead of starting over. Red even when nothing is deleted.']} />
            <Row cells={['Sample vault: “Open a KeePass vault”, “Import from 1Password”, “Create a local or iCloud vault”', 'Leaving the sample', 'Three rows of plain text that do nothing when tapped.']} />
            <Row cells={['Title “Setup” (iPhone, iPad); menu item “Settings…” (Mac)', 'The app', 'Two names for one screen. Mac’s own menu says Settings.']} />
          </tbody>
        </table>
      </Section>

      <Section title="2. Option A: one page, two clear groups">
        <p>The smallest change. One scrolling page; the vault is a titled block at the top that ends with its own Forget row, then the app’s rows.</p>
      </Section>
      <Frames>
        <Frame label="A · One page (iPhone)" phone caption="“Passwords” is a heading that names the vault; Forget Vault… closes that block. “Psss on this iPhone” starts the app block. Simple, but with two vaults it cannot show both, and the page is long.">
          <Phone title="Settings" done>
            <Head>Vault: Passwords</Head>
            <Card>
              <Line l="Location" v="iCloud Drive" />
              <Line l="Items" v="214" />
              <Toggle l="Unlock with Face ID" on />
              <Line l="Save a Copy…" link />
              <Line l="Change Vault Password…" link />
              <Line l="Forget Vault…" link />
            </Card>
            <Foot>Forgetting stops Psss using this file. The file stays in iCloud Drive.</Foot>
            <Head>Psss on this iPhone</Head>
            <Card>
              <Pick l="Lock" v="After 1 minute" />
              <Line l="Lock Now" link />
              <Line l="AutoFill is on" />
              <Line l="Help" chev />
            </Card>
          </Phone>
        </Frame>
      </Frames>

      <Section title="3. Option B (recommended): Settings lists vaults and app rows; each vault has its own page">
        <p>The root has two kinds of thing, labeled as such: <strong>Vaults</strong> (each opens that vault’s page) and the app’s own rows. Everything that changes one vault, including leaving it, is on that vault’s page. This is how Apple’s Settings treats accounts and how Passwords treats its own settings, and it is the shape the multiple-vault design already needs (a vault list with an add action).</p>
      </Section>
      <Frames>
        <Frame label="B1 · Settings, one vault (iPhone)" phone caption="With one vault the Vaults group has one row and “Add Vault…”, as the multiple-vaults doc says. The app rows follow, each group named for what it covers.">
          <Phone title="Settings" done><VaultsList /><AppBody /></Phone>
        </Frame>
        <Frame label="B2 · The vault’s page, a vault in iCloud Drive" phone caption="One group for the vault: its name, where the file is (place and file name), then Save a Copy… and Change Vault Password…, the two things done to the file. <strong>Remove Vault…</strong> is in the same group, in the accent colour: the file stays in iCloud Drive and the footer says so. Unlock with Face ID next.">
          <Phone title="Passwords" back="Settings"><VaultBody kind="icloud" /></Phone>
        </Frame>
        <Frame label="B3 · A vault kept on this device only" phone caption="Same page, the same Remove Vault… row. The footer says the vault is kept only on this iPhone, so removing it deletes the file, and suggests a copy first.">
          <Phone title="Passwords" back="Settings"><VaultBody kind="device" /></Phone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="B4 · Remove Vault…, a vault in iCloud Drive" phone caption="The alert names the vault, says where the file stays and what shows next. Default-coloured button: nothing is lost.">
          <Phone title="Passwords" back="Settings"
            alert={<Alert title="Remove Passwords?" message="Psss stops using this vault on this iPhone. The file stays in iCloud Drive › Psss and you can open it again. Psss then shows the welcome screen." button="Remove Vault" />}>
            <VaultBody kind="icloud" />
          </Phone>
        </Frame>
        <Frame label="B5 · Remove Vault…, a vault kept on this iPhone only" phone caption="Files cannot reach Psss’s own storage, so a file kept there after removing would be lost to the person anyway: the alert says removing deletes it, offers Save a Copy… first, and Delete Vault is red. Only this button says Delete, because only it deletes.">
          <Phone title="Passwords" back="Settings"
            alert={<Alert red title="Remove Passwords?" message="It is kept only on this iPhone, so removing it deletes the vault and its backups. Without another copy of the file, your logins are gone. This cannot be undone. Psss then shows the welcome screen." button="Delete Vault" more={[{ label: 'Save a Copy…' }]} />}>
            <VaultBody kind="device" />
          </Phone>
        </Frame>
        <Frame label="B9 · Mac, Remove Vault… for a vault on this Mac" phone caption="On the Mac the file can be found again in Finder, so Remove Vault keeps it and says where; Delete File, in red, is the second choice.">
          <Phone title="Passwords" back="Settings"
            alert={<Alert title="Remove Passwords?" message="Psss stops using this vault on this Mac. Remove Vault keeps the file on this Mac, in Psss’s folder. Delete File deletes it and its backups, and cannot be undone." button="Remove Vault" more={[{ label: 'Delete File', red: true }]} />}>
            <VaultBody kind="device" device="Mac" />
          </Phone>
        </Frame>
        <Frame label="B6 · The sample vault" phone caption="The three inert text lines are gone. “Close Sample Vault” replaces Start Over and says the welcome screen is where to create, open or import.">
          <Phone title="Sample vault" back="Settings"><VaultBody kind="sample" /></Phone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="B8 · A vault that is not available" phone caption="Archive can’t be found, so its row ends in the orange warning glyph (spoken “Not available, not found”), and nothing else: no second line. The page behind the row says what Psss can do about it. The same glyph is in every vault menu.">
          <Phone title="Settings" done><VaultsList both gone /></Phone>
        </Frame>
        <Frame label="B7 · iPad, the vault’s page" caption="The same sheet and the same push; the sheet’s bar carries Settings as its back button and Done.">
          <IPadSheet title="Passwords" back="Settings"><VaultBody kind="icloud" /></IPadSheet>
        </Frame>
      </Frames>

      <Section title="4. Option C: on the Mac, the system’s Settings window">
        <p>Apple’s guidance for the Mac is a Settings window opened from Psss, Settings… (⌘,), with a toolbar of panes, not a sheet over the document window. Option B’s content fits it directly: <strong>General</strong> holds the app rows and <strong>Vaults</strong> holds a vault list on the left and the selected vault’s page on the right (the Mail and Internet Accounts pattern). iPhone and iPad keep option B; the rows, words and alerts are shared.</p>
      </Section>
      <Frames>
        <Frame label="C1 · Mac, General" caption="The app’s rows. Nothing about any one vault.">
          <MacSettings pane="general" />
        </Frame>
        <Frame label="C2 · Mac, Vaults" caption="Pick a vault on the left; its page on the right. The file actions share one row: Show in Finder (opens the folder with the file selected) and Save a Copy…; the Location tooltip is the full path. “Vault Password” is a labeled row with Change… at the right. Remove Vault… is in the same group. Add Vault… under the list. The window is titled Vaults, not by the vault’s name.">
          <MacSettings pane="vaults" />
        </Frame>
      </Frames>

      <Section title="5. The options against each other">
        <table className="cmp">
          <thead><tr><th /><th>A · One page</th><th>B · Vault pages</th><th>C · Mac window</th></tr></thead>
          <tbody>
            <Row cells={['Says which rows are vault and which are app', 'By heading', 'By structure: a row opens a vault', 'By pane']} />
            <Row cells={['Works with two or more vaults', 'No: one vault’s block only', 'Yes: one row per vault', 'Yes: a list per pane']} />
            <Row cells={['Forget sits with its vault', 'Yes, last in the block', 'Yes, last on the page', 'Yes, last on the page']} />
            <Row cells={['Risky or rare actions out of the first view', 'No', 'Yes', 'Yes']} />
            <Row cells={['Taps to Face ID or Change Password', '0', '1 more', '1 more (select a vault)']} />
            <Row cells={['Matches Apple', 'Fine', 'Settings and Passwords', 'The Mac Settings window']} />
            <Row cells={['Cost', 'Small', 'Medium: one new page', 'Larger on Mac: a new window scene instead of the sheet']} />
          </tbody>
        </table>
      </Section>

      <Decisions
        items={[
          {
            decision: <>Recommend <strong>B on iPhone and iPad</strong>, and <strong>C on Mac</strong> once B is in. Until then the Mac keeps the sheet with B’s content.</>,
            rejected: <>A, which is a relabel and fails the moment a second vault exists.</>,
            why: <>B is the only shape where “this vault” and “the app” are different places, and it is already what the multiple-vaults design implies. C is the Mac’s native shape; it is a recommendation, not a requirement.</>,
          },
          {
            decision: <>Leaving a vault lives on that vault’s page, in the vault’s group (owner, 2026-11-25), as <strong>Remove Vault…</strong> for every vault. The confirmation says where the file stays; only a button that deletes says Delete (<strong>Delete Vault</strong> for a vault kept only on iPhone or iPad, <strong>Delete File</strong> as the Mac’s second choice). The sheet called “Reset” and the words “Start Over” go.</>,
            why: <>“Start Over” promised more than it did and sat away from the thing it acted on. The lost-password sheet and this page now use one pair of words and one alert.</>,
          },
          {
            decision: <>Red only for the button that deletes, in the confirmation. Remove Vault… uses the default button colour.</>,
            why: <>Red is for deletion. Forgetting an iCloud or opened file deletes nothing, the same reasoning as Move to Recently Deleted. The current code uses a destructive role for both.</>,
          },
          {
            decision: <>The Face ID switch moves into the vault page, under “Unlock”. Lock timing and Lock Now stay in the app group and say they cover every vault.</>,
            why: <>The saved key belongs to one vault (<code>biometricUnlock</code> on its reference). The timer and the lock cover the app.</>,
          },
          {
            decision: <>Rename <strong>Setup to Settings</strong> on iPhone and iPad (title, gear label, help text, docs). The Mac menu already says Settings….</>,
            why: <>One screen, one name, and it is the word people look for. Open for the owner: this touches strings, docs and any UI test that looks for “Setup”.</>,
          },
          {
            decision: <>In the sample vault the three inert lines go, and Start Over becomes “Close Sample Vault”, which leads to the welcome screen that already has Create, Open and Import.</>,
          },
          {
            decision: <>“Add Vault…” sits at the end of the Vaults group (a row on iPhone and iPad, a labeled button under the list on the Mac) and opens the Add a Vault sheet drawn on <a href="#/vault-switcher">Vaults: add one, switch between them</a>. The list shows names only, with the warning glyph on a vault that is not available. Not drawn and not added: About, rename vault, colour, default vault. They are listed in the multiple-vaults doc and arrive with it; the vault page has room for them under the file details.</>,
          },
        ]}
      />
      <Against>
        <li><strong>Option B on Mac as a sheet.</strong> The Mac’s convention is a Settings window; a sheet opened by ⌘, over the vault window is a stand-in and option C replaces it.</li>
        <li><strong>The vault list row.</strong> A one-row list with a chevron is more than one vault needs; it is kept so the screen does not change shape when a second vault arrives.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-25', text: <>Remove Vault… for every vault, in the vault’s group (owner: “don’t call it delete vault unless we’re actually deleting the file”). Replaces Forget Vault… (file stays) and the red Delete Vault… (vault kept on this device) and the Remove group at the end. The footer and the alert say where the file stays; a vault kept only on iPhone or iPad cannot be reached in Files, so its alert says removing deletes it, offers Save a Copy…, and only that button, Delete Vault, is red. On the Mac the alert keeps the file by default and offers Delete File. B2 to B5 and C2 redrawn, B9 added. This also undoes the lead’s earlier choice to keep leaving in its own last group: the button no longer deletes anything by itself.</> },
          { date: '2026-11-25', text: <>The vault page has one group for the vault (owner: the actions belong with the vault’s details): Name, Location (the place: “On this device”, “iCloud Drive › Psss” or the folder; its tooltip on the Mac is the full path), File (the name of a file the person opened; none for a vault Psss created, whose file has an internal name), Items, Modified, <strong>Save a Copy…</strong>, <strong>Change Vault Password…</strong> and Technical details. On the Mac (owner, same day): the file actions share one row, <strong>Show in Finder</strong> and <strong>Save a Copy…</strong>, and the password is a labeled row, “Vault Password” with <strong>Change…</strong> at the right, as macOS draws a password in Users & Groups. Replaces the separate “Keep it safe” group under Unlock; its footer sentence joins the vault group’s footer. Remove stays last in its own group: the owner asked whether it belongs at the top too, and the lead kept it apart, as Apple keeps destructive actions away from everyday ones. iPhone and iPad have no Show in Files: Files cannot reliably open at a file (roadmap). The Mac Settings window is titled by its pane (“Vaults”), no longer by the selected vault. The delete footer says “removes its saved Touch ID key” instead of “turns off Touch ID or password for it”. B2, B3, B7 and C2 redrawn.</> },
          { date: '2026-11-24', text: <>Added B8: a vault that is not available (Archive) shows the warning glyph in the list. The decision about “Add Vault…” no longer says it is not drawn: the row, the button and the sheet are drawn and (on iPhone and iPad) built. Replaces the older decision that left Add Vault… for the multiple-vaults work.</> },
          { date: '2026-11-24', text: <>Lead decisions applied: the Vaults list (iPhone, iPad and the Mac pane) is names only again; the warning glyph shows only for a vault that is not available, with no second line and no padlocks. Replaces the entry below, which gave every row a padlock and a state line. Uses the shared <code>VaultMenu.tsx</code> data; shared Vault row and menu.</> },
          { date: '2026-11-24', text: <>(Superseded by the entry above.) The Vaults list rows end in the shared state glyph (Passwords an open padlock, Work a closed one; a warning triangle for a vault that is not available), the same as every vault menu, and carry a second line only when the state has words (“Needs vault password”, “Not found”). Still no file name or place: those stay on the vault’s page. Drawn from the shared row data in <code>VaultMenu.tsx</code>; see <a href="#/vault-states">Vault states</a>. Proposal, not built.</> },
          { date: '2026-11-24', text: <>The footer under “Unlock with Face ID” (Touch ID on the Mac) now says plainly that AutoFill and the browser extension use this vault only while it is on. Replaces “Psss keeps a key for this vault on this iPhone, behind Face ID. AutoFill uses it too.”, which hinted at it but did not say that turning it off removes the vault from AutoFill. This toggle is the “include in AutoFill” setting; there is no second one. Proposal, not built. See <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-24', text: <>Vault rows show names only (no file name, place or Face ID line), at the owner’s request: those facts are on each vault’s page. B1 and C2 redrawn. The Add Vault row and the switcher are on the page <a href="#/vault-switcher">Vaults: add one, switch between them</a>.</> },
          { date: '2026-11-24', text: <>Option C built. The Mac has a Settings scene instead of the sheet: General and Vaults panes, the vault list with its page beside it. Differs from C2: no “Add Vault…” button under the list (not wired yet); while locked the Vaults pane shows only name and location and says to unlock for the rest; a vault that is remembered but not active shows name and location only. Change Vault Password opens in the vault window.</> },
          { date: '2026-11-24', text: <>Owner chose B, then Mac C. B built: Setup is now Settings (root list plus a page per vault), Forget Vault… and Delete Vault… moved onto the vault’s page, “Reset” and “Start Over” removed. Drawn differently from the proposal: the sample vault page has one Close Sample Vault button instead of three buttons, and the Vaults group has no “Add Vault…” row yet (B1 still draws it).</> },
          { date: '2026-11-24', text: <>Page added as a proposal after the owner noted that Forget Vault sat outside the vault group in Setup. Draws three options and the rows today. Nothing replaced yet; the current Setup sheet stays until a choice is made.</> },
        ]}
      />
    </Page>
  );
}
