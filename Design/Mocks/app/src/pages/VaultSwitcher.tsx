import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { ChevronIcon, GearIcon, VaultsIcon } from '../icons';
import { Workspace } from '../components/Workspace';
import { Lock } from './UnlockScreen';
import { VaultMenu } from '../components/VaultMenu';
import { Nav } from '../screens/PhoneScreens';
import { AppBody, MacSettings, Phone, VaultsList } from './Settings';

/* ---------- pieces ---------- */

const Foot = ({ children }: { children: ReactNode }) => <div className="maphelp" style={{ paddingTop: 6 }}>{children}</div>;
const Card = ({ children }: { children: ReactNode }) => <div className="icard" style={{ marginBottom: 4 }}>{children}</div>;
const Chev = () => <span className="chev"><ChevronIcon /></span>;
const Line = ({ l, link, chev, sub }: { l: ReactNode; link?: boolean; chev?: boolean; sub?: ReactNode }) => (
  <div className="mapfield" style={link ? { color: 'var(--accent)' } : undefined}>
    <div className="l">{l}{sub && <div className="s">{sub}</div>}</div>
    {chev && <Chev />}
  </div>
);


/* ---------- 1. Settings: the Vaults group, names only, and Add Vault ---------- */

/* ---------- 2. The Add a Vault sheet ---------- */

function AddBody() {
  return (
    <>
      <div className="maphelp" style={{ paddingTop: 4 }}>
        Nothing changes until you choose. The vault you add opens now, and your other vaults stay in the list.
      </div>
      <Card>
        <Line l="Create a New Vault" sub="A new, empty vault. You choose its name and password." chev />
        <Line l="Open a Vault File" sub="A KeePass file from Files, iCloud Drive or another app." chev />
        <Line l="Import from Apple Passwords" sub="Make a new vault from an Apple Passwords export." chev />
      </Card>
      <Foot>Exports from other apps are not encrypted. Delete the file after importing.</Foot>
    </>
  );
}

function AddSheet({ device }: { device: 'iphone' | 'ipad' | 'mac' }) {
  if (device === 'iphone') {
    return (
      <IPhone tall>
        <Nav left={<span className="btn glass">Cancel</span>} mid={<strong>Add a Vault</strong>} />
        <div className="pbody" style={{ overflow: 'visible' }}><AddBody /></div>
      </IPhone>
    );
  }
  const sheet = (
    <div style={{ position: 'relative', height: device === 'ipad' ? 520 : 380, background: 'var(--win)' }}>
      <div className="sheetwrap">
        <div className="sheet">
          <div className="maphead"><div className="t">Add a Vault</div></div>
          <div className="sheetscroll"><AddBody /></div>
          <div className="sheetfoot"><button className="btn glass">Cancel</button></div>
        </div>
      </div>
    </div>
  );
  return device === 'ipad' ? <IPad>{sheet}</IPad> : <MacWindow>{sheet}</MacWindow>;
}

/* ---------- 3. The vault switcher in the main window ---------- */

function SwitcherPhone({ open }: { open?: boolean }) {
  return (
    <IPhone tab="all">
      <div className="nav">
        <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
          <button className="ibtn flat" aria-label="Settings" data-tip="Settings"><GearIcon /></button>
          <button className="ibtn flat" aria-label="Vaults" aria-haspopup="menu" aria-expanded={!!open} data-tip={open ? undefined : 'Vaults'}><VaultsIcon /></button>
          {open && <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 60 }}><div style={{ position: 'relative' }}><VaultMenu /></div></div>}
        </div>
        <div className="mid" />
        <div><span className="btn glass">+ Add</span></div>
      </div>
      <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· 214 items</span></div></div>
      <div className="pbody tabpad">
        <div className="grp">
          {['Apple', 'Gitforge', 'Netflix', 'Zoom'].map((n) => <div key={n} className="mapfield" style={{ minHeight: 52 }}><div className="l">{n}</div><Chev /></div>)}
        </div>
      </div>
    </IPhone>
  );
}

/** The Mac File menu with Add Vault… after the New items (D6). */
function FileMenu() {
  const Item = ({ l, k, sep }: { l: string; k?: string; sep?: boolean }) => (
    <>
      {sep && <div className="ph sepd" style={{ padding: 0 }} />}
      <button role="menuitem"><span style={{ flex: 1 }}>{l}</span>{k && <span style={{ color: 'var(--lab2)', paddingLeft: 24 }}>{k}</span>}</button>
    </>
  );
  return (
    <div style={{ padding: '14px 0 14px 18px', minHeight: 330 }}>
      <div style={{ display: 'flex', gap: 18, padding: '0 0 6px', color: 'var(--lab2)' }}><strong style={{ color: 'var(--lab)' }}>Psss</strong><strong style={{ color: 'var(--lab)' }}>File</strong><span>Edit</span><span>View</span><span>Window</span><span>Help</span></div>
      <div className="pop" role="menu" style={{ position: 'static', minWidth: 260, width: 280, marginLeft: 52 }}>
        <Item l="New Login" k="⌘N" />
        <Item l="New Card" k="⇧⌘N" />
        <Item l="New Note" />
        <Item l="New Custom Item" />
        <Item l="New Wi-Fi Network" />
        <Item l="Add Vault…" sep />
        <Item l="Close Window" k="⌘W" sep />
      </div>
    </div>
  );
}

export function VaultSwitcher() {
  return (
    <Page
      title="Vaults: add one, switch between them"
      status={<><strong>Proposal (revised 2026-11-24), not built.</strong> Add Vault and the names-only list are built. The switcher stays a compact vault icon in the app: its menu starts with the current vault’s name and Lock, and its rows are the shared ones drawn on <a href="#/vault-states">Vault states</a> (same words, same glyphs). AutoFill and the browser now have a Vault row too (section 6). The lead decided the open questions on 2026-11-24.</>}
    >
      <Clarity
        intro={<p>A second vault is added from Settings, from the switcher, from the lock screen’s Vault pop-up, or from the Mac’s File menu. The main window must say which vault it shows, and the same labeled control switches it.</p>}
        items={[
          ['Which thing?', 'A vault: its name, and where its file is. The list shows names only; the vault’s own page shows the file and location.'],
          ['What must they give?', 'Nothing to add: choose how (create, open a file, import). Each way then asks what it needs, as on the welcome screen.'],
          ['What can go wrong?', 'Opening a file that is not a vault, a wrong password, a file that moved. The sheets already say so; nothing is added until they succeed.'],
          ['How do they leave?', 'Cancel on the Add a Vault sheet. A vault added by mistake is removed with Forget Vault… on its page; the file stays.'],
          ['What happens next?', 'The new vault opens at once and the other stays in the list. Choosing another vault in the switcher locks the open one and shows the other’s unlock screen.'],
          ['Who holds the key?', 'Each vault has its own password, and its own Face ID or Touch ID key if turned on in Settings. Adding a vault does not give any other vault’s key to anything.'],
        ]}
      />

      <Section title="1. Settings: names only, and Add Vault">
        <p>The list rows lose the second line (file name, location, Face ID): the same facts are on each vault’s page. Add Vault… is a labeled row at the end of the list on iPhone and iPad, and a labeled button under the list on the Mac.</p>
      </Section>
      <Frames>
        <Frame label="A · iPhone and iPad" phone caption="Names only. “Add Vault…” is the last row of the group, in the accent colour, with the same words as the menu."><Phone title="Settings" done><VaultsList both /><AppBody /></Phone></Frame>
        <Frame label="B · Mac" caption="Names only in the list. Add Vault… is a bordered button under it, labeled, not a bare + and −."><MacSettings pane="vaults" both /></Frame>
      </Frames>

      <Section title="2. Add a Vault">
        <p>The welcome screen’s choices, without “Try a sample vault” and without the 1Password line that is not built. Each row leads to the sheet that already exists for it. Same sheet from Settings and from the switcher’s Add Vault….</p>
      </Section>
      <Frames>
        <Frame label="C · iPhone" phone caption="Three ways, each with a line saying what it makes. The footer repeats the import warning from the welcome screen."><AddSheet device="iphone" /></Frame>
        <Frame label="D · iPad" caption="A sheet over the window."><AddSheet device="ipad" /></Frame>
        <Frame label="E · Mac" caption="A sheet with Cancel at the foot."><AddSheet device="mac" /></Frame>
      </Frames>

      <Section title="3. The vault dropdown, shown with two or more vaults">
        <p>With two or more vaults a compact vault icon appears: beside the gear at the top left on iPhone, and in the sidebar toolbar on Mac and iPad. Few people have several vaults, so the name need not be on screen; the sidebar header still names the vault on iPad and Mac. The icon is a toolbar menu with the spoken label “Vaults” and a tooltip. Its menu has a header naming the open vault, then <strong>Lock Passwords</strong> (with a padlock) as the first action, a divider, each vault (check on the current one, where it is kept or the state’s words, an open or closed padlock, or a warning glyph for a vault that is not available), a divider, and Add Vault…. Choosing another vault locks this one and shows the other’s unlock screen (Face ID or Touch ID, or its password). With one vault nothing appears; Lock Now stays in Settings and ⌘L on the Mac.</p>
      </Section>
      <Frames>
        <Frame label="F · iPhone, closed" phone caption="The vault icon sits beside the gear at the top left; the centre of the bar is empty again, + Add on the right. Not drawn with one vault."><SwitcherPhone /></Frame>
        <Frame label="G · iPhone, menu open" phone caption="The menu: header “Passwords”, Lock Passwords, a divider, the vaults (check, where each is kept, glyph: open padlock is unlocked, closed is locked), a divider, Add Vault…. Every state is drawn on Vault states."><SwitcherPhone open /></Frame>
      </Frames>
      <Frames>
        <Frame label="H · Mac, menu open" caption="The vault icon sits in the sidebar toolbar next to the system’s sidebar button. The sidebar header still says “Passwords”."><Workspace device="mac" init={{ vaultMenu: 'open' }} /></Frame>
        <Frame label="I · iPad" caption="The same icon beside the Settings gear in the sidebar toolbar. Menu closed."><Workspace device="ipad" init={{ vaultMenu: true }} /></Frame>
        <Frame label="J · Mac, one vault" caption="With one vault there is no dropdown: the sidebar header names the vault."><Workspace device="mac" /></Frame>
      </Frames>

      <Section title="4. The same menu on the unlock screens">
        <p>The lock screen keeps its “Vault” pop-up row: the label “Vault” on the left, the name of the vault that will open on the right with chevrons (“Vault: Passwords ⌃⌄”). Its menu lists the same vaults with the same padlocks (every vault is locked there) and the same Add Vault… at the end, but has no Lock item, because nothing is open. The name is on the row so a person can see which vault a password would open.</p>
      </Section>
      <Frames>
        <Frame phone label="K · iPhone lock screen" caption="A “Vault” row with “Passwords ⌃⌄”, menu open. “Archive” (Not found) shows how a missing vault is listed."><IPhone><Lock bio="face" state="ready" phone menu /></IPhone></Frame>
        <Frame label="L · Mac lock screen" caption="The same on the Mac: “Vault:” beside a pop-up button, menu open. All rows are padlocked closed."><MacWindow><div className="lk-win" style={{ alignItems: 'start', paddingTop: 20, height: 560 }}><Lock bio="touch" state="ready" menu /></div></MacWindow></Frame>
      </Frames>

      <Section title="5. Mac File menu">
        <p>Add Vault… also lives in the File menu, after the New items, and opens the same Add a Vault sheet. The Mac’s menu bar is where people look for “make a new thing”, and a vault is one.</p>
      </Section>
      <Frames>
        <Frame label="M · Mac, File menu" caption="New Login, New Card, New Note, New Custom Item, New Wi-Fi Network, then a divider and Add Vault…."><MacWindow><FileMenu /></MacWindow></Frame>
      </Frames>

      <Section title="6. AutoFill and the browser">
        <p>There is one current vault per device. AutoFill and the browser popup show it, with the same menu rows and a <strong>Vault</strong> row (compact in the popup) when there are two or more vaults. Choosing another vault there makes it current everywhere, and the open one locks. When the current vault is locked there, an <strong>Unlock</strong> button sits beside the Vault row; when it is not available, a notice says what Psss will do. The row, its states and the table of every surface are on <a href="#/vault-states">Vault states</a>; the screens are on <a href="#/autofill">AutoFill</a> and <a href="#/browser-extension">Browser extension</a>. No frames here.</p>
      </Section>

      <Decisions
        items={[
          {
            decision: <>The Vaults list shows names only. Where and how each is kept is on its page.</>,
            why: <>The owner’s request: the same facts were shown twice.</>,
          },
          {
            decision: <><strong>Add Vault…</strong> sits in the Vaults group (row on iPhone and iPad, button under the list on Mac) and opens one Add a Vault sheet: Create a New Vault, Open a Vault File, Import from Apple Passwords. The same sheet is the switcher’s last item.</>,
            rejected: <>putting the three choices straight in the Settings list (three rows of mostly unused actions in a group that is about the vaults you have).</>,
          },
          {
            decision: <>The switcher is a compact vault icon, shown only with two or more vaults: beside the gear at the top left on iPhone, in the sidebar toolbar on Mac and iPad. Its menu: a header naming the open vault, Lock [name] first, a divider, the vaults, a divider, Add Vault…. The sidebar header keeps naming the vault. With one vault there is no dropdown.</>,
            rejected: <>the vault name with chevrons in the top bar centre — the owner: few people have several vaults, so the name need not be on screen, and Lock belongs in the same menu; a first row in the list (scrolls away, looks like an item); a tab (the bar is at Apple’s five-tab limit).</>,
            why: <>The owner’s decision (2026-11-24). It sits with Settings in the one place about the app rather than the items. The menu header says which vault is open whenever the person asks, and Lock is one tap from the same place.</>,
          },
          {
            decision: <>Each row of the menu ends in a padlock: closed for a locked vault, open for an unlocked one, with the spoken labels “Locked” and “Unlocked” everywhere. The AutoFill and browser menu shows the open padlock on the current vault when it is unlocked there. The unlock screens use the same rows behind a “Vault” pop-up row, without the header and Lock item.</>,
            why: <>The owner’s request. Today only the open vault is unlocked, so the main window’s menu shows one open padlock; the other rows are closed. The icons stay true if several vaults are ever open at once.</>,
          },
          {
            decision: <>Mac File menu gets Add Vault… after the New items (New Login, New Card, New Note, New Custom Item, New Wi-Fi Network), opening the same sheet.</>,
          },
          {
            decision: <>One current vault per device. AutoFill and the browser popup show it with the same menu rows and a Vault row; choosing another vault in any of them makes it current everywhere.</>,
            rejected: <>a vault choice per surface, and a filter that searches “All Vaults” (the earlier draft of this decision read every vault at once): the browser relay lives in the app, so a separate choice could not hold, and three different pickers was the confusion.</>,
            why: <>See Vault states: simple to say, and it is how <code>VaultSession.switchTo</code> already works.</>,
          },
          {
            decision: <>Switching locks the open vault and shows the other’s unlock screen. It does not keep both open.</>,
            why: <>It is what the code does (a vault is switched while locked) and what the lock screen’s pop-up does today. Keeping several open at once is the multiple-vaults design and a larger change.</>,
          },
        ]}
      />
      <Against>
        <li><strong>An icon-only control.</strong> Allowed here as a standard toolbar menu with the spoken label “Vaults” and a tooltip, like the gear beside it. It is not a daily action, and its menu names the open vault and carries Lock.</li>
        <li><strong>A switch that locks.</strong> Apple’s account switchers change the view without a new unlock. Here each vault has its own key, so it asks, with Face ID or Touch ID when that vault has it on.</li>
      </Against>

      <History
        proposal
        entries={[
          { date: '2026-11-24', text: <>Lead decisions applied to the shared parts: the spoken label of the open padlock is “Unlocked” everywhere, including the AutoFill and browser menu, which shows the open padlock on the current vault when it is unlocked there.</> },
          { date: '2026-11-24', text: <>Revised after the owner’s review (“all over the place”). The menu rows now come from one set of row data shared with the lock screen, Settings and the new <a href="#/vault-states">Vault states</a> page: closed or open padlock, or a warning glyph with “Not downloaded yet”, “Not found” or “Can’t be read”. Section 6 and its decision replaced “AutoFill and the browser read every vault at once, with no switcher” by one current vault per device with a Vault row and an Unlock button, because the browser relay lives in the app and three different pickers was the confusion. Status back to proposal.</> },
          { date: '2026-11-24', text: <>The icon stays and the menu gained Lock (owner): a compact vault icon beside the gear on iPhone and in the sidebar toolbar on Mac and iPad, with two or more vaults only; the menu starts with a header naming the open vault and “Lock Passwords”, then the vaults, then Add Vault…. Replaces a draft the same day that showed the vault name with chevrons in the top bar centre (the owner: few people have several vaults, the name need not be on screen; Lock belongs in the same menu). Also added: the Mac File menu with Add Vault… (section 5), the AutoFill and browser paragraph (section 6), sample vaults Passwords and Work. Proposal, not built.</> },
          { date: '2026-11-24', text: <>Approved (“Build it”) and built: Add a Vault sheet, names-only list, the switcher in the main window and “Choose Vault” on the lock screens. Nothing in the drawing changed.</> },
          { date: '2026-11-24', text: <>Menu rows gained a padlock (open or closed) for each vault’s lock state, and the unlock screens take this same control, “Choose Vault” with the database icon (section 4). Replaces the lock screen’s “Unlock Vault: [name]” pop-up; see the History of the Unlock page.</> },
          { date: '2026-11-24', text: <>Redrawn at the owner’s request: the first drawing (the vault name as a menu, in a hand-drawn sidebar) looked bad. The switcher is now a database icon in the top row beside Settings on iPhone, and in the sidebar toolbar on Mac and iPad, drawn in the real sidebar.</> },
          { date: '2026-11-24', text: <>Page added as a proposal at the owner’s request: Add Vault under the list, names only in the list, a vault switcher with two or more vaults. Nothing replaced yet.</> },
        ]}
      />
    </Page>
  );
}
