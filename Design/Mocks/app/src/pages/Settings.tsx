import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { ChevronIcon, GearIcon, VaultsIcon } from '../icons';
import { PopChevrons } from '../components/PopUpRow';
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

/** iOS switch (green, 42 x 26); inside a Mac window the same markup is drawn as .mswitch (smaller, accent colour when on). See styles.css. */
const Switch = ({ on }: { on: boolean }) => <span aria-hidden="true" className={`iswitch${on ? ' on' : ''}`}><i /></span>;
const Toggle = ({ l, on }: { l: string; on: boolean }) => <div className="mapfield"><div className="l">{l}</div><Switch on={on} /></div>;

/** A pop-up button, drawn as the system draws a menu picker row. */
const Pick = ({ l, v, mac }: { l: string; v: string; mac?: boolean }) => mac
  ? <div className="mapfield"><div className="l">{l}</div><button className="mbtn popup" aria-haspopup="menu">{v}<PopChevrons /></button></div>
  :  <div className="mapfield"><div className="l">{l}</div><span className="mapsel">{v} <span className="chv-ios">⌃</span></span></div>;

type Kind = 'icloud' | 'device' | 'sample';

/* ---------- the vault page: everything that belongs to one vault ---------- */

const where: Record<Kind, string> = { icloud: 'iCloud Drive › Psss', device: 'On this device', sample: 'Not saved' };

function VaultBody({ kind, device = 'iPhone' }: { kind: Kind; device?: string }) {
  if (kind === 'sample') {
    return (
      <>
        <Foot>A made-up vault to look around in. Nothing you change here is saved: it is gone when Psss locks or quits.</Foot>
        <Head>Leave the sample</Head>
        <Card>{device === 'Mac' ? <div className="mapfield" style={{ justifyContent: 'flex-start' }}><button className="mbtn">Close Sample Vault</button></div> : <Line l="Close Sample Vault" />}</Card>
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
              <div className="mapfield" style={{ gap: 8, justifyContent: 'flex-start' }}><button className="mbtn">Show in Finder</button><button className="mbtn">Save a Copy…</button></div>
              <Line l="Vault Password" v={<button className="mbtn">Change…</button>} />
              <div className="mapfield" style={{ justifyContent: 'flex-start' }}><button className="mbtn">Remove Vault…</button></div>
            </>
          : <><Line l="Save a Copy…" link /><Line l="Change Vault Password…" link /><Line l="Remove Vault…" link /></>}
        {device === 'Mac'
          ? <div className="mapfield"><div className="l"><span className="mdisc" aria-hidden="true">▸</span>Technical details</div></div>
          : <Line l="Technical details" chev />}
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

export function AppBody({ mac }: { mac?: boolean }) {
  return (
    <>
      <Head>Locking</Head>
      <Card>
        <Pick l="Lock" v="After 1 minute" mac={mac} />
        {mac ? <div className="mapfield" style={{ justifyContent: 'flex-start' }}><button className="mbtn">Lock Now</button></div> : <Line l="Lock Now" link />}
      </Card>
      <Foot>Applies to every vault.</Foot>
      <Head>AutoFill</Head>
      <Card>
        <Line l="AutoFill is on" sub="Psss fills your logins in Safari and apps." />
        {mac ? <div className="mapfield" style={{ justifyContent: 'flex-start' }}><button className="mbtn">Open AutoFill Settings…</button></div> : <Line l="Open AutoFill Settings…" link />}
      </Card>
      <Head>Help</Head>
      {mac ? (
        <Card><Line l="Copying, verification codes and passkeys" v={<button className="mbtn">Psss Help</button>} /></Card>
      ) : (
        <Card>
          <Line l="Copying" chev />
          <Line l="Verification codes" chev />
          <Line l="Passkeys" chev />
        </Card>
      )}
    </>
  );
}

/** One vault in the list: the name only. The warning glyph appears only when the vault is not available; no second line. State and location stay on the vault's page. */
const VaultLine = ({ v }: { v: VaultRowData }) => <Line l={v.name} v={isUnavailable(v.state) ? <VaultStateMark state={v.state} inline /> : undefined} chev />;

/** The three ways to add a vault: the same words as the vault menu and the welcome screen. One source for every frame. */
export const addWays = [
  { title: 'Create a New Vault', mac: 'Create…' },
  { title: 'Open a Vault File', mac: 'Open…' },
  { title: 'Import from Apple Passwords', mac: 'Import…' },
];
/** The one footer under the three ways, on every platform: what each does, and the import warning. */
export const addSummary = 'Create makes a new, empty vault. Open adds a KeePass file from iCloud Drive or another folder. Import makes a new vault from an Apple Passwords export; exports are not encrypted, so delete the file afterwards.';

/** iPhone and iPad: the “Add Vault” group of Settings. Navigation rows: each pushes its screen inside Settings. */
export const AddGroup = () => (
  <>
    <Head>Add Vault</Head>
    <Card>{addWays.map((w) => <Line key={w.title} l={w.title} chev />)}</Card>
    <Foot>{addSummary}</Foot>
  </>
);

/** Mac: the right panel of the Vaults pane when “Add Vault” is chosen in the list: one grouped form section, label at the left, a push button at the right. */
export const MacAddGroup = () => (
  <>
    <Head>Add Vault</Head>
    <div className="icard">
      {addWays.map((w) => (
        <div key={w.title} className="mapfield"><div className="l">{w.title}</div><button className="mbtn">{w.mac}</button></div>
      ))}
    </div>
    <Foot>{addSummary}</Foot>
  </>
);

export const VaultsList = ({ both, gone }: { both?: boolean; gone?: boolean }) => (
  <>
    <Head>Vaults</Head>
    <Card>
      <VaultLine v={{ ...passwordsVault, state: 'open' }} />
      {both && <VaultLine v={workVault} />}
      {gone && <VaultLine v={archiveVault} />}
    </Card>
    <Foot>Each vault has its own password, file and Face ID setting.</Foot>
    <AddGroup />
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

/** A macOS alert sheet, drawn over a dimmed window: the app icon, a bold title, the message, and the buttons in a row at the right, the default button last (rightmost), Cancel beside it. */
function MacAlert({ title, message, buttons }: { title: string; message: string; buttons: { label: string; kind?: 'default' | 'destructive' }[] }) {
  return (
    <>
      <div className="cs-dim" />
      <div role="alertdialog" aria-label={title} style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 440, zIndex: 9, background: 'var(--win)', borderRadius: '0 0 12px 12px', boxShadow: 'var(--shadow)', padding: '18px 20px 16px' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div className="lk-app" style={{ width: 52, height: 52, borderRadius: 12, fontSize: 26, flex: 'none' }} aria-hidden="true">p</div>
          <div>
            <div style={{ fontWeight: 700 }}>{title}</div>
            <div className="s" style={{ paddingTop: 4 }}>{message}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16 }}>
          {buttons.map((b) => <button key={b.label} className={`mbtn${b.kind ? ` ${b.kind}` : ''}`}>{b.label}</button>)}
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

export function IPadSheet({ title, back, children }: { title: string; back?: string; children: ReactNode }) {
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

/** Mac: the system's Settings window, with its toolbar of panes. */
export function MacSettings({ pane, both, adding, kind = 'icloud', alert }: { pane: 'general' | 'vaults'; both?: boolean; adding?: boolean; kind?: Kind; alert?: ReactNode }) {
  const tab = (id: string, label: string) => (
    <span key={id} className={`mtab${pane === id ? ' on' : ''}`} aria-current={pane === id ? 'page' : undefined}>{id === 'general' ? <GearIcon /> : <VaultsIcon />}{label}</span>
  );
  return (
    <MacWindow>
      <div style={{ height: 700, display: 'flex', flexDirection: 'column', background: 'var(--win)', position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 8px', borderBottom: '1px solid var(--sep)' }}>
          <div className="t" style={{ paddingBottom: 6 }}>{pane === 'general' ? 'General' : 'Vaults'}</div>
          <div style={{ display: 'flex', gap: 4 }}>{tab('general', 'General')}{tab('vaults', 'Vaults')}</div>
        </div>
        {pane === 'general' ? (
          <div style={{ padding: '14px 40px', overflow: 'hidden' }}>
            <AppBody mac />
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ width: 220, borderRight: '1px solid var(--sep)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
              <div className="mapfield" style={{ background: adding ? 'none' : 'var(--accent-sel)', borderRadius: 8, border: 0, minHeight: 36 }}><div className="l">Passwords</div></div>
              {both && <div className="mapfield" style={{ borderRadius: 8, border: 0, minHeight: 36 }}><div className="l">Work</div></div>}
              <div className="mapfield" style={{ background: adding ? 'var(--accent-sel)' : 'none', borderRadius: 8, border: 0, minHeight: 36, gap: 8, flexWrap: 'nowrap' }}><span className="sfp" aria-hidden="true">+</span><div className="l">Add Vault</div></div>
            </div>
            <div style={{ flex: 1, padding: '10px 22px', overflow: 'hidden' }}>
              {adding ? <MacAddGroup /> : <VaultBody kind={kind} device="Mac" />}
            </div>
          </div>
        )}
        {alert}
      </div>
    </MacWindow>
  );
}

export function Settings() {
  return (
    <Page
      title="Settings: this vault and this app"
      status={<><strong>Chosen by the owner: each vault has its own page (B on iPhone and iPad; the Settings window on the Mac), 2026-11-24, confirmed 2026-11-25.</strong> Built on iPhone, iPad and the Mac; the Mac window was clicked through on 2026-11-25 and the vault page regrouped (see the History). <strong>Proposal, not built (2026-11-24):</strong> the Face ID footer wording (see the History).</>}
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

      <Section title="1. iPhone and iPad: Settings lists the vaults and the app rows; each vault has its own page">
        <p>The root has two kinds of thing, labeled as such: <strong>Vaults</strong> (each opens that vault’s page), an “Add Vault” group, and the app’s own rows. Everything that changes one vault, including leaving it, is on that vault’s page. This is how Apple’s Settings treats accounts and how Passwords treats its own settings, and it is the shape the multiple-vault design needs (a vault list with an add action). The Mac Settings window (section 2) has the same structure.</p>
      </Section>
      <Frames>
        <Frame label="A1 · Settings, one vault (iPhone)" phone caption="With one vault the Vaults group has one row. Under it, the “Add Vault” group holds the three ways to add one (Create, Open, Import), as navigation rows. The app rows follow, each group named for what it covers.">
          <Phone title="Settings" done><VaultsList /><AppBody /></Phone>
        </Frame>
        <Frame label="A2 · The vault’s page, a vault in iCloud Drive" phone caption="One group for the vault: its name, where the file is (place and file name), then Save a Copy… and Change Vault Password…, the two things done to the file. Remove Vault… is in the same group, in the accent colour: the file stays in iCloud Drive and the footer says so. Unlock with Face ID next.">
          <Phone title="Passwords" back="Settings"><VaultBody kind="icloud" /></Phone>
        </Frame>
        <Frame label="A3 · A vault kept on this device only" phone caption="Same page, the same Remove Vault… row. The footer says the vault is kept only on this iPhone, so removing it deletes the file, and suggests a copy first.">
          <Phone title="Passwords" back="Settings"><VaultBody kind="device" /></Phone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="A4 · The sample vault" phone caption="The three inert text lines are gone. “Close Sample Vault” replaces Start Over and says the welcome screen is where to create, open or import.">
          <Phone title="Sample vault" back="Settings"><VaultBody kind="sample" /></Phone>
        </Frame>
        <Frame label="A5 · A vault that is not available" phone caption="Archive can’t be found, so its row ends in the orange warning glyph (spoken “Not available, not found”), and nothing else: no second line. The page behind the row says what Psss can do about it. The same glyph is in every vault menu.">
          <Phone title="Settings" done><VaultsList both gone /></Phone>
        </Frame>
        <Frame label="A6 · iPad, the vault’s page" caption="The same sheet and the same push; the sheet’s bar carries Settings as its back button and Done.">
          <IPadSheet title="Passwords" back="Settings"><VaultBody kind="icloud" /></IPadSheet>
        </Frame>
      </Frames>

      <Section title="2. Mac: the Settings window, General and Vaults panes">
        <p>Apple’s guidance for the Mac is a Settings window opened from Psss, Settings… (⌘,), with a toolbar of panes, not a sheet over the document window. It has the same structure as the iPhone and iPad Settings: <strong>General</strong> holds the app rows and <strong>Vaults</strong> holds a vault list on the left and the selected vault’s own page on the right (the Mail and Internet Accounts pattern). The rows, words and alerts are shared with iPhone and iPad. Every control here is a macOS control: push buttons, pop-up buttons, switches and a disclosure triangle; none of the iOS capsules or chevron rows.</p>
      </Section>
      <Frames>
        <Frame label="B1 · Mac, General" caption="The app’s rows. Nothing about any one vault. Help is one row with a push button, Psss Help, which opens the help topics (copying, verification codes, passkeys); the three chevron rows of iOS are not used on the Mac.">
          <MacSettings pane="general" />
        </Frame>
        <Frame label="B2 · Mac, Vaults" caption="Pick a vault on the left; its page on the right. The file actions share one row: Show in Finder (opens the folder with the file selected) and Save a Copy…; the Location tooltip is the full path. “Vault Password” is a labeled row with Change… at the right. Remove Vault… is in the same group. The last row of the list is “Add Vault” (frame B3). Technical details is a disclosure triangle (▸) that opens in place, not a chevron row. The window is titled Vaults, not by the vault’s name. Buttons are macOS push buttons (grey, rounded rectangle), not the iOS tinted capsule.">
          <MacSettings pane="vaults" />
        </Frame>
        <Frame label="B3 · Mac, Add Vault" caption="“Add Vault” is the last row of the list, with a + glyph, styled like the vault rows. Choosing it shows one grouped section on the right: Create a New Vault [Create…], Open a Vault File [Open…], Import from Apple Passwords [Import…], and one footer that says in plain words what each does."><MacSettings pane="vaults" adding /></Frame>
      </Frames>

      <Section title="3. Remove Vault… alerts">
        <p>The confirmation says which vault, where the file stays and what Psss shows next. On iPhone and iPad an alert; on the Mac an alert sheet over the Settings window.</p>
      </Section>
      <Frames>
        <Frame label="C1 · Remove Vault…, a vault in iCloud Drive" phone caption="The alert names the vault, says where the file stays and what shows next. Default-coloured button: nothing is lost.">
          <Phone title="Passwords" back="Settings"
            alert={<Alert title="Remove Passwords?" message="Psss stops using this vault on this iPhone. The file stays in iCloud Drive › Psss and you can open it again. Psss then shows the welcome screen." button="Remove Vault" />}>
            <VaultBody kind="icloud" />
          </Phone>
        </Frame>
        <Frame label="C2 · Remove Vault…, a vault kept on this iPhone only" phone caption="Files cannot reach Psss’s own storage, so a file kept there after removing would be lost to the person anyway: the alert says removing deletes it, offers Save a Copy… first, and Delete Vault is red. Only this button says Delete, because only it deletes.">
          <Phone title="Passwords" back="Settings"
            alert={<Alert red title="Remove Passwords?" message="It is kept only on this iPhone, so removing it deletes the vault and its backups. Without another copy of the file, your logins are gone. This cannot be undone. Psss then shows the welcome screen." button="Delete Vault" more={[{ label: 'Save a Copy…' }]} />}>
            <VaultBody kind="device" />
          </Phone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="C3 · Mac, Remove Vault… for a vault on this Mac" caption="In the Settings window, a Mac alert sheet. On the Mac the file can be found again in Finder, so Remove Vault, the default button (accent fill, rightmost), keeps it and says where; Delete File is a push button with red text, set apart at the left, and Cancel sits beside the default button. Only the button that deletes says Delete."><MacSettings pane="vaults" kind="device" alert={<MacAlert title="Remove Passwords?" message="Psss stops using this vault on this Mac. Remove Vault keeps the file on this Mac, in Psss’s folder. Delete File deletes it and its backups, and cannot be undone." buttons={[{ label: 'Delete File', kind: 'destructive' }, { label: 'Cancel' }, { label: 'Remove Vault', kind: 'default' }]} />} /></Frame>
      </Frames>

      <Decisions
        items={[
          {
            decision: <>Settings lists the vaults and the app rows, and <strong>each vault has its own page</strong> (owner, 2026-11-24, confirmed 2026-11-25). On iPhone and iPad the vault pushes onto Settings; on the Mac the Settings window has a General pane (app rows) and a Vaults pane (list at the left, the selected vault’s page at the right): the same structure.</>,
            why: <>It is the only shape where “this vault” and “the app” are different places, it is what the multiple-vaults design implies, and the Mac window is the Mac’s native form of it.</>,
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
            decision: <>“Add Vault” is a group under the Vaults list (navigation rows on iPhone and iPad, rows with Create…, Open… and Import… push buttons on the Mac); the vault menu has the same three as direct items, drawn on <a href="#/vault-switcher">Vaults: add one, switch between them</a>. The list shows names only, with the warning glyph on a vault that is not available. Not drawn and not added: About, rename vault, colour, default vault. They are listed in the multiple-vaults doc and arrive with it; the vault page has room for them under the file details.</>,
          },
        ]}
      />
      <Against>
        <li><strong>The vault list row.</strong> A one-row list with a chevron is more than one vault needs; it is kept so the screen does not change shape when a second vault arrives.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-25', text: <>Owner confirmed option B: each vault has its own page, and the Mac Settings window has the same structure. Option A (one page; a relabel that fails with a second vault), the “Today” table of Setup rows and the comparison of options are removed from the page. Frames are lettered in page order: A1 to A6 (iPhone and iPad: Settings, vault pages, sample vault, not available, iPad; were B1, B2, B3, B7, B8, B9), B1 to B3 (Mac Settings window: General, Vaults, Add Vault; were C1 to C3), C1 to C3 (Remove Vault… alerts; were B4, B5, B6). Every control in the Mac Settings frames is a macOS control: the Lock pop-up is a pop-up button, Lock Now, Open AutoFill Settings…, Psss Help and Close Sample Vault are push buttons, in place of iOS link rows. Older entries below use the old letters. Replaces the options comparison.</> },
          { date: '2026-11-25', text: <>Review fixes. Frame B6 (Remove Vault… for a vault on this Mac) is drawn in the Mac Settings window with a Mac alert sheet: the app icon, a bold title, and a row of push buttons, Delete File (red text), Cancel and Remove Vault (the default button), instead of an iPhone alert in an iPhone frame; the vault page behind it has the Mac’s switch. In the Mac Settings window the chevron rows are gone: Help is one row with a Psss Help push button, and Technical details is a disclosure triangle (▸); iPhone and iPad keep their chevron rows. “Add a Vault” is now “Add Vault”. Frame letters now read in page order: B6 (the Mac alert, was B9), B7 (sample vault, was B6), B9 (iPad, was B7). Replaces the iPhone-shaped Mac alert and the iOS chevron rows on the Mac.</> },
          { date: '2026-11-25', text: <>Switches in Mac frames (Unlock with Touch ID) are macOS switches: smaller, blue (the accent colour) when on, instead of the green iOS switch. iPhone and iPad keep the green one. C1 and C2 redrawn.</> },
          { date: '2026-11-25', text: <>Mac Vaults pane: the Add Vault group leaves the left list. The list is the vaults, then an “Add Vault” row with a + glyph, styled as a normal row; choosing it shows the three choices in the right panel (label at the left, a push button at the right: Create…, Open…, Import…) under one footer. The rows lose their descriptions, on every platform; the footer says what each does and keeps the import warning. Replaces the group under the list with a description beside each button. C2 redrawn, C3 added.</> },
          { date: '2026-11-25', text: <>The Mac Settings window’s toolbar tabs are pane items as macOS draws them: an icon above a small label (General: gear, Vaults: the vault glyph), the selected one on a subtle grey rounded background with an accent-coloured icon. Replaces a blue filled pill. C1 and C2 redrawn.</> },
          { date: '2026-11-25', text: <>The Vaults group no longer ends in an “Add Vault…” row (iPhone, iPad) or has an “Add Vault…” button under the list (Mac). A group “Add Vault” follows the list instead: Create a New Vault, Open a Vault File, Import from Apple Passwords, with the import warning as its footer; on the Mac, rows with Create…, Open… and Import… push buttons beside a wider vault list. Replaces the chooser sheet, one level fewer (owner). B1, B8 and C2 redrawn; see <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Mac frames use macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for a default button) instead of the iOS tinted capsule: Show in Finder, Save a Copy…, Change…, Remove Vault…, the Lock pop-up (chevrons). The Mac Settings toolbar tabs are no longer buttons. Replaces the iOS capsule look on the Mac. C1 and C2 redrawn.</> },
          { date: '2026-11-25', text: <>Remove Vault… for every vault, in the vault’s group (owner: “don’t call it delete vault unless we’re actually deleting the file”). Replaces Forget Vault… (file stays) and the red Delete Vault… (vault kept on this device) and the Remove group at the end. The footer and the alert say where the file stays; a vault kept only on iPhone or iPad cannot be reached in Files, so its alert says removing deletes it, offers Save a Copy…, and only that button, Delete Vault, is red. On the Mac the alert keeps the file by default and offers Delete File. B2 to B5 and C2 redrawn, B6 added. This also undoes the lead’s earlier choice to keep leaving in its own last group: the button no longer deletes anything by itself.</> },
          { date: '2026-11-25', text: <>The vault page has one group for the vault (owner: the actions belong with the vault’s details): Name, Location (the place: “On this device”, “iCloud Drive › Psss” or the folder; its tooltip on the Mac is the full path), File (the name of a file the person opened; none for a vault Psss created, whose file has an internal name), Items, Modified, <strong>Save a Copy…</strong>, <strong>Change Vault Password…</strong> and Technical details. On the Mac (owner, same day): the file actions share one row, <strong>Show in Finder</strong> and <strong>Save a Copy…</strong>, and the password is a labeled row, “Vault Password” with <strong>Change…</strong> at the right, as macOS draws a password in Users & Groups. Replaces the separate “Keep it safe” group under Unlock; its footer sentence joins the vault group’s footer. Remove stays last in its own group: the owner asked whether it belongs at the top too, and the lead kept it apart, as Apple keeps destructive actions away from everyday ones. iPhone and iPad have no Show in Files: Files cannot reliably open at a file (roadmap). The Mac Settings window is titled by its pane (“Vaults”), no longer by the selected vault. The delete footer says “removes its saved Touch ID key” instead of “turns off Touch ID or password for it”. B2, B3, B9 and C2 redrawn.</> },
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
