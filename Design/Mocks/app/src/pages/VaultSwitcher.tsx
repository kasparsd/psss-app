import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, MacWindow } from '../components/devices';
import { ChevronIcon, GearIcon } from '../icons';
import { VaultCapsule } from '../components/VaultCapsule';
import { FilterMenu } from '../components/FilterMenu';
import { SortMenu } from '../components/SortMenu';
import { Workspace } from '../components/Workspace';
import { Lock } from './UnlockScreen';
import { VaultMenu } from '../components/VaultMenu';
import { AppBody, IPadSheet, MacSettings, Phone, VaultsList } from './Settings';

/* ---------- pieces ---------- */

const Chev = () => <span className="chev"><ChevronIcon /></span>;

/* ---------- 3. The vault switcher in the main window ---------- */

/** `both`: Passwords and Work are both open. `shown`: the vault whose list is on screen (default Passwords). */
function SwitcherPhone({ open, both, shown = 'Passwords' }: { open?: boolean; both?: boolean; shown?: string }) {
  const name = shown;
  const openNames = both ? ['Passwords', 'Work'] : ['Passwords'];
  return (
    <IPhone tab="all">
      <div className="nav">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="ibtn" aria-label="Settings" data-tip="Settings"><GearIcon /></button>
          <VaultCapsule name={name} open={open} glyphOnly menu={<VaultMenu current={name} open={openNames} />} />
        </div>
        <div className="mid" />
        <span className="navend">
          <span className="viewopts">
            <SortMenu value="used" onChange={() => {}} />
            <FilterMenu value={{ type: 'all', feats: [] }} onChange={() => {}} />
          </span>
          <span className="btn glass">+ Add</span>
        </span>
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

/** The Mac File menu, drawn from the menu bar above the window (so the traffic lights are not under it): the three add items after the New items, then Vault Settings… and Lock beside each other (owner, 2026-11-25). With two or more vaults open, Lock becomes Lock All Vaults (⌘L); each vault's own Lock is on its sidebar header (owner, 2026-11-25). */
function FileMenu({ many }: { many?: boolean }) {
  const Item = ({ l, k, sep }: { l: string; k?: string; sep?: boolean }) => (
    <>
      {sep && <div className="msep" />}
      <div className="mi"><span>{l}</span>{k && <span className="k">{k}</span>}</div>
    </>
  );
  return (
    <>
      <Item l="New Login" k="⌘N" />
      <Item l="New Card" k="⇧⌘N" />
      <Item l="New Note" />
      <Item l="New Custom Item" />
      <Item l="New Wi-Fi Network" />
      <Item l="New Vault…" sep />
      <Item l="Open Vault File…" />
      <Item l="Import from Apple Passwords…" />
      <Item l="Vault Settings…" sep />
      <Item l={many ? 'Lock All Vaults' : 'Lock Passwords'} k="⌘L" />
      <Item l="Close Window" k="⌘W" sep />
    </>
  );
}

export function VaultSwitcher() {
  return (
    <Page
      title="Vaults: add one, switch between them"
      status={<><strong>Proposal (revised 2026-11-25), not built.</strong> Several vaults can be open at once (owner, 2026-11-25), and Open Vault File… adds the file and shows its unlock screen instead of asking for its password in the add flow. Vaults become sections of the sidebar on Mac and iPad, as Mail shows accounts (owner’s suggestion); iPhone keeps a labeled vault button. Add Vault moves from a chooser sheet into Settings › Vaults. The names-only list and the shared menu rows are built. Where this page recommends something, the caption says so: the owner confirms the Mac locked window (frame I), the context-menu items (F) and the Add Vault control’s place (G). AutoFill and the browser have a Vault row too (section 6); see <a href="#/vault-states">Vault states</a>.</>}
    >
      <Clarity
        intro={<p>A second vault is added from Settings › Vaults, from the vault’s sidebar on Mac and iPad (Add Vault at the foot), from the vault button on iPhone, from the lock screen’s Vault pop-up, or from the Mac’s File menu. The main window must say which vault it shows. On Mac and iPad the sidebar does, section by section.</p>}
        items={[
          ['Which thing?', 'A vault: its name, and where its file is. The list shows names only; the vault’s own page shows the file and location.'],
          ['What must they give?', 'Create asks for a name and a new password (it must set one). Import asks for the export file. Open Vault File… asks only for the file; its password is asked on the vault’s own unlock screen, right after it is added.'],
          ['What can go wrong?', 'Opening a file that is not a vault, a file that moved, or a wrong password. Create and Import say so in their own flow. Open Vault File… adds the file and shows its unlock screen, which says so for a wrong password; the vault stays in the list, locked.'],
          ['How do they leave?', 'Back (iPhone and iPad) or Cancel in the flow. A vault added by mistake is removed with Remove Vault… on its page; the file stays.'],
          ['What happens next?', 'A new or imported vault opens at once. A vault added with Open Vault File… is in the list and shows its unlock screen. Other open vaults stay open; choosing another open vault shows it without a password, and choosing a locked one shows its unlock form.'],
          ['Who holds the key?', 'Each vault has its own password, and its own Face ID or Touch ID key if turned on in Settings. Adding a vault does not give any other vault’s key to anything.'],
        ]}
      />

      <Section title="1. Settings › Vaults: the list, then Add Vault">
        <p>The three ways to add a vault are a group of their own under the list of vaults, in Settings, with the same words as the menu and the welcome screen. There is no chooser sheet any more: one level fewer. On iPhone and iPad the rows are navigation rows (no descriptions) that push the create form, the Files picker or the import inside Settings; one footer says what each does and warns that exports are not encrypted. On the Mac, “Add Vault” is the last row of the vault list, and choosing it shows the three choices in the right panel.</p>
      </Section>
      <Frames>
        <Frame label="A · iPhone" phone caption="Vaults (names only), then “Add Vault” with the three rows. The rows have chevrons: each pushes its screen inside Settings, and Back returns here. One footer says what each does and warns about the unencrypted export."><Phone title="Settings" done><VaultsList both /><AppBody /></Phone></Frame>
        <Frame label="B · iPad" caption="The same group in the Settings sheet; the same pushes. The app’s own groups follow below, as on iPhone."><IPadSheet title="Settings"><VaultsList both /></IPadSheet></Frame>
      </Frames>
      <Frames>
        <Frame label="C · Mac, a vault selected" caption="The list is the vaults, then a last row “Add Vault” with a + glyph, styled like the vault rows, not a button. The chosen vault’s page is on the right. Its File row (the file’s name) is hidden only for a vault kept in Psss’s private storage on this device, whose file has an internal name; a vault in iCloud Drive › Psss shows its file name, Passwords.kdbx, as here. Technical details is a disclosure triangle, not a chevron row."><MacSettings pane="vaults" both /></Frame>
        <Frame label="C2 · Mac, Add Vault selected" caption="Choosing “Add Vault” shows one grouped section on the right: the three choices with a push button each (Create…, Open…, Import…), and one footer in plain words. A macOS form puts its action in a labeled button, not in the whole row; chevron rows are an iOS idiom the Mac Settings window does not use, so Technical details on the vault’s page is a disclosure triangle."><MacSettings pane="vaults" both adding /></Frame>
      </Frames>

      <Section title="2. Mac and iPad: each vault is a section of the sidebar, as Mail shows accounts">
        <p>The sidebar has one section per vault, like Mail’s accounts: the vault’s name as the section header (secondary text, a disclosure chevron at the end) and, under it, that vault’s places with their counts: All, Codes, Cards, Logins, Notes, Custom items, Recently Deleted. Choosing a place chooses that place in the vault it belongs to, and the list and detail show it. Several vaults can be open at once (owner, 2026-11-25): each open vault is its own expanded section with its places, and a locked vault is a collapsed section with a small lock after its name (the warning glyph for a vault that is not available). Choosing a locked vault, by its header, shows its unlock form in the content area and leaves the other open vaults open; after it unlocks, its section expands. With two or more vaults open the list heading names the vault under the place. Nothing vault-related is left in the list column’s toolbar, which keeps the list heading and Sort, Filter and + Add at the right.</p>
        <p>Each header has its own menu, right-click (long-press on iPad), with only that vault’s actions: Vault Settings…, Lock [name] (Unlock [name]… when it is locked), Show in Finder (Mac only) and Remove Vault…. The app’s auto-lock (timer, sleep, quit) locks every vault. The sidebar has a foot, pinned to the bottom on Mac and iPad alike (not a row of the list): <strong>Add Vault</strong>, a labeled control, and at its end an icon-only <strong>gear</strong> (accessibility label and tooltip “Settings”) that opens the app’s Settings: the Settings window on the Mac, as ⌘, does, and the Settings sheet on iPad. The gear is in the sidebar, not in a window toolbar, so Apple’s note against settings buttons in a toolbar still holds. Add Vault’s menu is New Vault…, Open Vault File… and Import from Apple Passwords…, the same three as the File menu and Settings. With one vault the section header is still shown and expanded, so people learn the model and where to right-click. New vaults go at the end, in the fixed order.</p>
      </Section>
      <Frames>
        <Frame label="D · Mac, two vaults, Passwords open" caption="Passwords is expanded with its places. Work is locked: collapsed after it, with a lock after the name and a chevron. The list column’s toolbar has only Sort, Filter and + Add. The sidebar foot, pinned to the bottom, has Add Vault (labeled) and the Settings gear (icon-only; it opens the Settings window like ⌘,). The vaults are always in this order, the order of Settings › Vaults."><Workspace device="mac" init={{ vaults: 'two' }} /></Frame>
        <Frame label="D2 · Mac, both vaults open" caption="After Work unlocks, its section expands under its header, with its own places and counts. Passwords stays expanded and open. The place that is chosen is shown in the list and detail, and the list heading names the vault under the place. Choosing Work › Logins, then Passwords › Codes, shows each with no password: both vaults are open (click the rows)."><Workspace device="mac" init={{ vaults: 'both' }} /></Frame>
        <Frame label="E · Mac, choosing the locked Work" caption="Work’s header is chosen, and its unlock form fills the list and detail columns: “Unlock Work”, the vault password field, then one row: Unlock, the default button (accent fill, Return), dimmed until a password is typed (click the field and type to try it), then Use Touch ID, a normal push button. The password is the main way in and Touch ID the alternative people reach for second; in macOS alerts the default button sits on the trailing side, but this is an in-window form, not an alert. Forgot Password is under it. Passwords stays open and expanded while Work is unlocked; there is no line about it. When this form becomes active and Touch ID is on for Work, Psss shows the system’s Touch ID prompt by itself, without a click (frame E2); Use Touch ID brings it back if it was cancelled."><Workspace device="mac" init={{ vaults: 'two', unlock: 'Work' }} /></Frame>
      </Frames>
      <Frames>
        <Frame label="E2 · Mac, the Touch ID prompt" caption="The system sheet “Psss wants to unlock Work” hangs from the window’s top edge over the unlock form, shown by Psss the moment the form becomes active (the window comes to the front, or the person chooses Work), with Touch ID on. Touch ID, not a click, answers it; Cancel closes it and leaves the form as in E. Honest limit: macOS shows Touch ID only through this system prompt; an app cannot listen for a finger silently, so there is always a prompt on screen while Touch ID is waiting."><Workspace device="mac" init={{ vaults: 'two', unlock: 'Work', bioPrompt: true }} /></Frame>
      </Frames>
      <Frames>
        <Frame label="F · Mac, right-click on a vault header" caption="The context menu of Passwords, an open vault, with only that vault’s actions: Vault Settings… (opens Settings › Vaults with this vault selected), Lock Passwords, a divider, Show in Finder, Remove Vault…. The Settings gear is in the sidebar foot (frame D), not in the Mac toolbar: Apple’s guidance is no settings buttons in a window’s toolbar, and settings in the app menu. The File menu (frame Q) has Vault Settings… and Lock too (Lock All Vaults with two or more open, frame Q2)."><Workspace device="mac" init={{ vaults: 'two', sideMenu: 'context' }} /></Frame>
        <Frame label="F2 · Mac, right-click on a locked vault" caption="The menu of Work, a locked vault: Vault Settings…, Unlock Work… (it shows the unlock form), a divider, Show in Finder, Remove Vault…. Each header’s menu holds only its own vault’s actions."><Workspace device="mac" init={{ vaults: 'two', sideMenu: 'context-locked' }} /></Frame>
        <Frame label="G · Mac, Add Vault menu" caption="The labeled “+ Add Vault” control in the sidebar foot opens New Vault…, Open Vault File… and Import from Apple Passwords…; the gear beside it is Settings."><Workspace device="mac" init={{ vaults: 'two', sideMenu: 'add' }} /></Frame>
      </Frames>
      <Frames>
        <Frame label="H · Mac, one vault" caption="One vault: the section header “Passwords” is still there, expanded. The person sees that a vault is a thing with its own places, and where to right-click."><Workspace device="mac" /></Frame>
        <Frame label="I · Mac, locked window (proposal)" caption="Proposal, owner to confirm: replaces the full-window lock screen and its Vault pop-up on the Mac. The same window after the app’s auto-lock, which locks every vault: the sidebar with every vault collapsed and locked, in the same order, and the unlock form for the last used vault (Passwords) in the content area, with Unlock and Use Touch ID on one row. The system Touch ID prompt appears by itself when the window becomes active (as in E2). Choosing Work shows Work’s form. The existing Unlock page frames stay until this is confirmed."><Workspace device="mac" init={{ locked: true }} /></Frame>
      </Frames>
      <Frames>
        <Frame label="J · iPad, two vaults" caption="The same sections in the sidebar, in the same order. The sidebar toolbar has only the sidebar button; the foot, pinned to the bottom of the sidebar (a bottom bar, not the last row of the list), has Add Vault and the Settings gear, which opens the Settings sheet. The gear is in the sidebar, not the toolbar. Tapping Work shows its unlock form: the same row, Unlock then Use Face ID (Unlock dimmed until a password is typed); iPadOS keeps Face ID starting by itself. Long-press on a header gives the context menu."><Workspace device="ipad" init={{ vaults: 'two' }} /></Frame>
      </Frames>

      <Section title="3. iPhone, and iPad with the sidebar hidden: a labeled vault button">
        <p>iPhone has no sidebar, so the vault control stays a toolbar menu: its own glass button at the top left, next to the gear (two separate buttons, then the Sort and Filter group, then + Add). On iPhone Sort and Filter are almost always in the toolbar and take the room, so the button is the vault glyph alone; the name and a small chevron (the labeled capsule) appear only where the name fits, as on iPad with the sidebar hidden (frame N, where a long name is cut at the tail after about 11 characters), the way iOS toolbars drop labels when space runs out. The spoken label is always “Vault: [full name]”. It is shown always, even with one vault. iPad shows the same button at the left of the list toolbar while the sidebar is hidden. Its menu keeps Safari’s profile menu structure, with one change: every vault is a row, in the one fixed order of Settings › Vaults (Passwords, then Work), the one shown with a checkmark and each with where it is kept (or the state’s words) under the name; a locked vault has a closed padlock at the end and an open vault has none; the open vault never moves to the top, and there is no “Switch to” prefix because the check already says which is current. Then a divider; a section header with the current vault’s name, “Passwords”, in secondary text, holding Vault Settings… and Lock Passwords, and Lock All Vaults when two or more vaults are open; a divider; then New Vault…, Open Vault File… and Import from Apple Passwords…. With one vault the list has one row. Several vaults can be open at once: choosing another open vault switches to it at once, with no password; choosing a locked one shows its unlock screen (frame L3) and the other vaults stay open. It is the same on iPhone and on iPad while the sidebar is hidden.</p>
      </Section>
      <Frames>
        <Frame label="K · iPhone, closed" phone caption="Gear and vault glyph as two separate glass buttons, then the Sort and Filter group, then + Add. The vault button is the glyph alone because Sort and Filter take the room; its spoken label is “Vault: Passwords”."><SwitcherPhone /></Frame>
        <Frame label="L · iPhone, menu open" phone caption="The menu hangs from the vault button’s left edge, as Safari’s profile menu does: Passwords (checked, no padlock because it is open) then Work (Work.kdbx under it, closed padlock because it is locked), always in that order; a divider, the section “Passwords” with Vault Settings… and Lock Passwords, a divider, then the three add items."><SwitcherPhone open /></Frame>
      </Frames>
      <Frames>
        <Frame label="L2 · iPhone, both vaults open" phone caption="Passwords and Work are both open, so neither has a padlock. Choosing Work switches to it at once, with no password. The section “Passwords” now also has Lock All Vaults, under Lock Passwords."><SwitcherPhone open both /></Frame>
        <Frame label="L3 · iPhone, choosing the locked Work" phone caption="Work was locked, so choosing it shows its unlock screen (password, and Face ID when it is on for Work). Passwords stays open: coming back to it needs no password."><IPhone><Lock bio="face" state="ready" vault="Work" phone title="Unlock Work" /></IPhone></Frame>
      </Frames>
      <Frames>
        <Frame label="N · iPad, sidebar hidden" caption="With the sidebar hidden the list toolbar starts with the sidebar button, then the gear, then the labeled vault button (glyph, “Passwords”, chevron): the name fits here beside the gear, Sort and Filter, and + Add, as the screenshot check shows; a longer name is cut at the tail (“Family Pass…”) and the button would drop to the glyph alone if even that did not fit. Sort, Filter and + Add stay at the right. The gear is here because the sidebar foot, which holds it while the sidebar shows (frame J), is hidden with the sidebar, so there is never more than one gear. The menu is the iPhone’s, with two vaults: Passwords (checked) then Work (locked), the section “Passwords” with Vault Settings… and Lock Passwords, then the three add items."><Workspace device="ipad" init={{ showSide: false, sideMenu: 'capsule', vaults: 'two' }} /></Frame>
      </Frames>

      <Section title="4. The same menu on the unlock screens">
        <p>The lock screen keeps its “Vault” pop-up row: the label “Vault” on the left, the name of the vault that will open on the right with chevrons. On every platform the menu is the same list: the header “Vault”, every vault in the fixed order of Settings › Vaults with a checkmark on the one that will open, its padlock or warning glyph (nothing is open, so every working vault is locked), a divider, and the three add items. There is no Vault Settings… or Lock item and no section, because nothing is open. The name is on the row so a person can see which vault a password would open.</p>
      </Section>
      <Frames>
        <Frame phone label="O · iPhone lock screen" caption="A “Vault” row with “Passwords ⌃⌄”, menu open: Passwords (checked), Work and Archive (Not found, with the warning glyph) in the fixed order, a divider, then the add items. No section for Passwords: it is locked."><IPhone><Lock bio="face" state="ready" phone menu /></IPhone></Frame>
        <Frame label="P · Mac lock screen" caption="The same list on the Mac: “Vault:” beside a pop-up button with chevrons, menu open. All rows are padlocked closed. Proposed replacement on the Mac: frame I."><MacWindow><div className="lk-win" style={{ alignItems: 'start', paddingTop: 20, height: 560 }}><Lock bio="touch" state="ready" menu /></div></MacWindow></Frame>
      </Frames>

      <Section title="5. Mac File menu">
        <p>The three add items also live in the File menu, after the New items, and so do <strong>Vault Settings…</strong> and Lock (<strong>Lock All Vaults</strong>, ⌘L, when two or more vaults are open; each vault’s own Lock is on its sidebar header). A vault is the document-like thing the window shows, and Apple says to put document-level options in File. The app menu keeps Settings… (⌘,) for the whole app.</p>
      </Section>
      <Frames>
        <Frame label="Q · Mac, File menu" caption="The File menu hangs from the menu bar above the window: New Login, New Card, New Note, New Custom Item, New Wi-Fi Network, then New Vault…, Open Vault File…, Import from Apple Passwords…, then Vault Settings… and Lock Passwords ⌘L (with only Passwords open)."><MacWindow menuBar fileMenu={<FileMenu />}><Workspace device="mac" init={{ vaults: 'two' }} /></MacWindow></Frame>
        <Frame label="Q2 · Mac, File menu, two vaults open" caption="With two or more vaults open, ⌘L reads Lock All Vaults and locks every vault, as the auto-lock does. Each vault’s own Lock stays on its sidebar header’s menu (frame F)."><MacWindow menuBar fileMenu={<FileMenu many />}><Workspace device="mac" init={{ vaults: 'both' }} /></MacWindow></Frame>
      </Frames>

      <Section title="6. AutoFill and the browser">
        <p>AutoFill and the browser popup show one vault at a time, with the same menu rows and a <strong>Vault</strong> row (compact in the popup) when there are two or more vaults. The plain vault select lists open vaults as ready to fill and locked ones as needing unlock; choosing one changes which vault they fill from, and no other vault locks. When the chosen vault is locked there, an <strong>Unlock</strong> button sits beside the Vault row; when it is not available, a notice says what Psss will do. Their menu has no add items: adding a vault is done in the app. The row, its states and the table of every surface are on <a href="#/vault-states">Vault states</a>; the screens are on <a href="#/autofill">AutoFill</a> and <a href="#/browser-extension">Browser extension</a>. No frames here.</p>
      </Section>

      <Section title="7. Open Vault File…: add the file, then unlock it">
        <p>Open Vault File… (the Add Vault menu, Settings › Add Vault, the File menu and the welcome screen) never asks for the file’s password inside the add flow. The person picks the file; the vault is added to the list (a sidebar section at the end, in the fixed order) and its normal unlock screen is shown, “Unlock [name]”, with the password field. Touch ID (Face ID) is not offered yet, because the first unlock needs the password; it is offered after the vault has been unlocked once and Face ID is turned on for it. If the person cancels the unlock, the vault stays in the list, locked, and the other open vaults stay open. <strong>New Vault…</strong> still asks for a new password while creating, because it must set one, and <strong>Import</strong> is unchanged.</p>
      </Section>
      <Frames>
        <Frame label="R · Mac, a vault file was just opened" caption="After the file picker: Family is at the end of the sidebar, locked, and the content area shows “Unlock Family” with the password field, Unlock (dimmed until a password is typed) and Forgot Password. There is no Use Touch ID button yet. Passwords stays open. Choosing another place instead of unlocking leaves Family in the list, locked."><Workspace device="mac" init={{ vaults: 'two', added: 'Family', unlock: 'Family' }} /></Frame>
        <Frame label="S · iPad, a vault file was just opened" caption="The same on iPad: Family added at the end, its unlock form in the content area, no Use Face ID button until the vault has been unlocked once."><Workspace device="ipad" init={{ vaults: 'two', added: 'Family', unlock: 'Family' }} /></Frame>
      </Frames>
      <Frames>
        <Frame label="T · iPhone, a vault file was just opened" phone caption="Files picker, then “Unlock Family”: the password field and Unlock only, no Face ID button yet. Family is in the vault menu with a closed padlock."><IPhone><Lock bio="none" state="ready" vault="Family" phone title="Unlock Family" /></IPhone></Frame>
      </Frames>

      <Decisions
        items={[
          {
            decision: <><strong>Several vaults can be open at once.</strong> Each open vault is an expanded section of the sidebar with its places (and a menu row without a padlock on iPhone); a locked vault is collapsed with a lock. Choosing a locked vault shows its unlock form and leaves the others open; the list and detail show the place chosen, in the vault it belongs to. Each header’s menu has only that vault’s actions. The app’s auto-lock (timer, sleep, quit) locks every vault, and ⌘L is Lock All Vaults when two or more are open.</>,
            rejected: <>only one vault open at a time (the 1.0 rule until 2026-11-25), where choosing another vault locks the open one.</>,
            why: <>The owner: switching between work and personal vaults should not need the password again. Auto-lock still locks all of them, so nothing stays open longer than one vault did.</>,
          },
          {
            decision: <><strong>Open Vault File… does not ask for the password in the add flow.</strong> File picker, then the vault is added (locked, at the end of the list) and its unlock screen, “Unlock [name]”, is shown with Touch ID not offered until the first unlock. Cancelling leaves the vault in the list, locked. New Vault… still asks for a new password (it must set one) and Import is unchanged.</>,
            rejected: <>a password field inside the open-file sheet; keeping the file out of the list until its password has been accepted.</>,
            why: <>The owner: one place asks for a vault’s password, the unlock screen, with all its states (wrong password, Touch ID later, Forgot Password). The add flow only adds.</>,
          },
          {
            decision: <>The Vaults list shows names only. Where and how each is kept is on its page.</>,
            why: <>The owner’s request: the same facts were shown twice.</>,
          },
          {
            decision: <><strong>Add Vault</strong> is a group in Settings › Vaults, under the list: Create a New Vault, Open a Vault File, Import from Apple Passwords, with the import warning as its footer. Navigation rows on iPhone and iPad; rows with a labeled push button (Create…, Open…, Import…) on the Mac. The chooser sheet is gone.</>,
            rejected: <>the chooser sheet (a panel inside a panel, reached from a row that only opened another list of rows); an “Add Vault…” row at the end of the vault list.</>,
            why: <>The owner’s request: one level fewer. The three ways are always visible where vaults are managed; each leads directly to the flow that exists for it.</>,
          },
          {
            decision: <><strong>On Mac and iPad each vault is a section of the sidebar</strong>, as Mail shows accounts: the vault’s name as the header, its places under it. Open vaults are expanded; locked vaults are collapsed with a lock after the name. Choosing a locked vault shows its unlock form in the content area and leaves the other open vaults open. Vault actions are on each header (right-click, long-press on iPad), for that vault only: Vault Settings…, Lock [name] or Unlock [name]…, Show in Finder (Mac), Remove Vault…. The sidebar has a foot pinned to the bottom (a bottom bar on Mac and iPad alike, not a row of the list): the labeled Add Vault control with New Vault…, Open Vault File… and Import from Apple Passwords…, and an icon-only Settings gear at its end. With one vault the section header is still shown. Nothing vault-related is in the list column’s toolbar.</>,
            rejected: <>a vault pop-up in the sidebar header; a labeled pop-up button at the left of the list column’s toolbar (the owner did not like how it looked); a settings gear in the Mac toolbar; Add Vault as the last row of the list on iPad; plain text with one vault.</>,
            why: <>The owner’s suggestion (Apple Mail’s accounts): the places belong to a vault, so the sidebar shows them that way and the structure teaches the model. Collapsed vaults are the locked ones. Recommendations the owner should confirm: the context-menu items, the Add Vault control at the sidebar foot, and showing the unlock form in the content area. The gear is not in the Mac toolbar, on Apple’s advice (no settings buttons in a window’s toolbar); it is in the sidebar foot instead, where it is not a toolbar item, and opens the same Settings window as ⌘,. iPhone keeps its gear in the top row.</>,
          },
          {
            decision: <><strong>iPhone, and iPad with the sidebar hidden: a labeled vault capsule</strong> at the top left next to the gear: the vault glyph, the selected vault’s name (tail-cut after about 11 characters) and a chevron, spoken “Vault: [full name]”. Shown always, even with one vault. Its menu has the structure of Safari’s profile menu in macOS 26, with a fixed list: every vault as a row in the order of Settings › Vaults, the current one checked (each with where it is kept or the state’s words, and its padlock), a divider, a section header with the current vault’s name and under it Vault Settings…, Lock [name] and, with two or more vaults open, Lock All Vaults, a divider, then the three add items. The lock screens show the same list under the header “Vault”, and the add items, without the section.</>,
            rejected: <>the icon-only vault glyph (the owner asked for a labeled button; important actions stay visible and labeled); “Switch to [name]” rows for the other vaults only, with the current vault moved into a section header (the list reordered every time the vault changed).</>,
            why: <>The owner’s request, and the owner pointed at Safari’s profile switcher as the precedent: a labeled glass capsule beside the sidebar button whose menu lists the other profiles as “Switch to …”, then a section for the current one. iPhone has no sidebar to hold the vaults, so the same content sits behind a standard glass toolbar button.</>,
          },
          {
            decision: <>In the app’s menu (iPhone, iPad with the sidebar hidden) a locked vault’s row ends in a closed padlock (spoken “Locked”) and an open vault’s row has none. The AutoFill and browser picker and the lock screens keep their padlocks (the picker’s open one is spoken “Unlocked”). Every menu lists every vault. The lock screens use the same list behind a “Vault” pop-up row, with the add items and without Vault Settings… and Lock; on the Mac the sidebar’s locks do this job, and frame I proposes replacing the lock screen’s pop-up.</>,
            why: <>The owner’s request, now that several vaults can be open at once (2026-11-25): the closed padlock is what a person looks for, and an open vault needs no mark. Replaces the open padlock on the current vault in the app’s menu.</>,
          },
          {
            decision: <><strong>Vault order never changes; the order is the Settings › Vaults list</strong> (the order the vaults were added). Every menu, sidebar, lock-screen pop-up and extension picker lists vaults in it. The open vault is marked (a check in a menu, an expanded section in the sidebar) and never moves to the top. Sample order: Passwords, Work, then Archive where it is drawn.</>,
            rejected: <>putting the current vault first or in a section header above the rest (“Switch to …” rows); a most-recently-used order.</>,
            why: <>The owner: a list that reorders when a vault is chosen makes the person look for the vault again. A fixed order is learned once.</>,
          },
          {
            decision: <><strong>Glyph alone on iPhone, because Sort and Filter take the room; the name only where it fits</strong> (iPad with the sidebar hidden). The gear and the vault button are two separate glass buttons, then the Sort and Filter group, then + Add. The spoken label and the menu are the same everywhere.</>,
            why: <>The owner’s decision (2026-11-25): iOS toolbars drop labels when space runs out; the spoken label “Vault: [full name]” never changes.</>,
          },
          {
            decision: <><strong>Sidebar foot, Mac and iPad:</strong> pinned to the bottom of the sidebar, Add Vault (labeled) and at its end an icon-only Settings gear (SF Symbol gearshape, accessibility label and tooltip “Settings”) that opens the Settings window (as ⌘, does) or the Settings sheet on iPad. On iPad the gear leaves the sidebar toolbar, so it appears once; with the sidebar hidden it is in the list toolbar before the vault capsule.</>,
            rejected: <>a gear in the Mac toolbar (Apple: no settings buttons in a window’s toolbar); two gears on iPad; Add Vault as the last row of the iPad list.</>,
            why: <>The owner: a visible way to Settings next to the other app-level control. The gear is in the sidebar, not a toolbar, so Apple’s note does not apply. It is icon-only where the guidelines allow it: a standard symbol, with a label and tooltip.</>,
          },
          {
            decision: <><strong>Unlock form:</strong> the vault password field, then Unlock and Use Touch ID (Face ID on iPhone and iPad), Unlock first: one row on Mac and iPad, Unlock above Use Face ID on iPhone. Unlock is the default button (accent, Return) and is dimmed until a password is typed; Use Touch ID is a normal push button. The password is the main way in and Touch ID the alternative people reach for second; in macOS alerts the default button sits on the trailing side, but this is an in-window form, not an alert. When the form or lock window becomes active and Touch ID is on, the Mac shows the system Touch ID prompt by itself; Use Touch ID brings it back after Cancel. macOS can only show Touch ID through that prompt.</>,
            rejected: <>Use Touch ID before Unlock; Unlock full width above Use Touch ID and Forgot Password on Mac; a Touch ID glyph that listens silently.</>,
            why: <>The owner: one row, one order, on every device. Listening silently is not something macOS offers to an app, so the mock does not promise it.</>,
          },
          {
            decision: <>Mac File menu: New Vault…, Open Vault File…, Import from Apple Passwords… after the New items, then Vault Settings… and Lock Passwords.</>,
            rejected: <>one “Add Vault…” item that opened a chooser.</>,
          },
          {
            decision: <>AutoFill and the browser popup fill from one vault at a time, chosen in a plain vault select (the Vault row) that lists open vaults as ready to fill and locked ones as needing unlock. Choosing a vault there does not lock another one.</>,
            rejected: <>a filter that searches “All Vaults” (the earlier draft of this decision read every vault at once): the browser relay lives in the app, and three different pickers was the confusion.</>,
            why: <>See Vault states: the select stays simple and now reflects which vaults are open.</>,
          },
        ]}
      />
      <Against>
        <li><strong>A hidden vault list.</strong> The sidebar sections keep every vault visible on Mac and iPad; collapsed sections are the locked ones. iPhone’s labeled capsule shows the vault’s name and opens the list.</li>
        <li><strong>A switch that locks.</strong> Apple’s account switchers change the view without a new unlock, and so does this one for a vault that is open. Only a locked vault asks, with Face ID or Touch ID when that vault has it on. The auto-lock locks every vault.</li>
        <li><strong>A gear in the Mac toolbar.</strong> Requested by the owner; not drawn because Apple advises against settings buttons in a window’s toolbar. The gear is in the sidebar foot instead, and the vault header’s context menu and the File menu carry Vault Settings….</li>
      </Against>

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>Two owner decisions. (1) Several vaults can be open at once: each open vault is an expanded sidebar section, a locked vault stays collapsed with a lock; choosing a locked vault shows its unlock form and leaves the others open, and its section expands after unlocking (new frames D2, F2, Q2, L2, L3; the “locks when Work opens” line and the “one vault at a time” wording are gone everywhere). Each header’s menu has only that vault’s actions; auto-lock locks every vault; ⌘L is Lock All Vaults with two or more open, and the iPhone menu gains Lock All Vaults. In the app’s menu an open vault has no padlock and a locked one has the closed padlock. Replaces “only one vault is unlocked at a time (the 1.0 rule)”, “unlocking locks the open one” and the decision “Switching locks the open vault”, because switching between work and personal vaults should not need the password again. (2) Open Vault File… no longer asks for a password in the add flow: file picker, then the vault is added locked at the end and its unlock screen is shown, Touch ID not offered until the first unlock (new section 7, frames R, S and T). New Vault… still sets a password and Import is unchanged.</> },
          { date: '2026-11-25', text: <>On iPhone the vault button is the glyph alone (Sort and Filter take the room), drawn with the gear as two separate glass buttons, then Sort and Filter, then + Add (frames K and L); the name and chevron stay only on iPad with the sidebar hidden (frame N), where they fit. Replaces the labeled capsule on iPhone, the long-name frame M (truncation no longer applies on iPhone) and a same-day draft that merged the gear and the vault button in one glass group (owner: keep them separate, as built).</> },
          { date: '2026-11-25', text: <>Four owner changes. (1) Settings gear in the sidebar foot on Mac and iPad, next to Add Vault, icon-only with label and tooltip “Settings”; on iPad it leaves the sidebar toolbar (hidden-sidebar iPad keeps it in the list toolbar). Replaces the iPad gear in the sidebar toolbar. (2) Add Vault and the gear are pinned to the bottom of the iPad sidebar like on the Mac, a bottom bar and not the last list row (frame J). (3) The unlock form has Unlock first, then Use Touch ID (Face ID): one row on Mac and iPad, stacked on iPhone; Unlock is the default button and dimmed until a password is typed; the Mac shows the system Touch ID prompt by itself (new frame E2) and says that macOS can only show it that way. Replaces Unlock full width with Touch ID beside Forgot Password, and a first draft with Use Touch ID before Unlock. (4) Vaults keep one order everywhere (Settings › Vaults): the app menu lists every vault, the current one checked, then a section with Vault Settings… and Lock; lock-screen menus use the same list. Replaces the “Switch to [name]” rows and the current vault moving into the section header. Frames D to N, O and P redrawn.</> },
          { date: '2026-11-25', text: <>The vault menu on iPhone, and on iPad while the sidebar is hidden, takes the structure of Safari’s profile menu in macOS 26 (owner’s pointer): “Switch to Work” rows for the other vaults (location or state words under, padlock at the end), a divider, a section header with the current vault’s name (secondary text) holding Vault Settings… and Lock Passwords, a divider, then New Vault…, Open Vault File…, Import from Apple Passwords…; with one vault the menu starts at the section header. The iOS lock screens’ menu shows only the Switch rows and the add items (the locked vault has no section: nothing is open); the Mac lock screen’s pop-up, the Mac and iPad sidebar sections and their right-click menu are unchanged. Frames L, N and O redrawn. Replaces the list of every vault with a check, then Vault Settings… and Lock, then the add items.</> },
          { date: '2026-11-25', text: <>Review fixes. The File menu (frame Q) hangs from a menu bar drawn above the window, so the traffic lights no longer sit under it; the window behind it is the real main window. The iPhone menu (frame L) hangs from the capsule’s left edge and is cut to the screen’s width, so its padlock column and its last item show. Frame N (iPad, sidebar hidden) draws the gear before the vault capsule and a menu with two vaults, as D and J. Frame C’s caption says when the File row is hidden. Mac frames D to J, N and Q use macOS push buttons and switches (the window is a Mac surface), the Passwords vault shows 214 items in every frame, and the Mac window’s text is two sizes, the title (17 px) and the body (13 px). “Add a Vault” is now “Add Vault” everywhere. Replaces the collapsed menu, the menu that ran off the screen, and the capsule menu with one vault.</> },
          { date: '2026-11-25', text: <>The Add Vault choices lose their per-row descriptions on every platform and share one footer (what Create, Open and Import do, and that exports are not encrypted). On the Mac they leave the left list: the list gets an “Add Vault” row, and choosing it shows the three rows with push buttons in the right panel. Replaces the group under the vault list. Frames A, B and C redrawn, C2 added. Also fixed a Clarity line that still said “in the menu”.</> },
          { date: '2026-11-25', text: <>The iPhone vault control (and the iPad one while the sidebar is hidden) is a labeled glass capsule next to the gear: vault glyph, the vault’s name cut at the tail after about 11 characters, a chevron; spoken “Vault: [full name]”; shown even with one vault. Replaces the icon-only vault glyph, at the owner’s request (important actions are labeled). Frames K, L, M and N drawn; the long-name frame M is new.</> },
          { date: '2026-11-25', text: <>The middle-column vault button (vault glyph, name and chevron at the left of the list column’s toolbar) is replaced by Mail-style vault sections in the sidebar, at the owner’s suggestion (the button did not look good). Each vault is a section with its places; locked vaults are collapsed with a lock; choosing one shows its unlock form in the content area; right-click on the header for Vault Settings…, Lock, Show in Finder and Remove Vault…; Add Vault at the foot of the sidebar. The list toolbar is Sort, Filter and + Add again. Frames D to J drawn, including a proposed Mac locked window (I) that would replace the lock screen’s Vault pop-up on the Mac (owner to confirm). The earlier toolbar-button, sidebar-header and sidebar-toolbar frames are gone.</> },
          { date: '2026-11-25', text: <>(Superseded by the entries above.) The sidebar-header pop-up is replaced by a labeled toolbar button (vault glyph, name, chevron) at the top left of the middle (list) column’s toolbar on Mac and iPad, at the owner’s requirement: global scope on the left, Sort, Filter and + Add on the right. The sidebar header is gone, so the sidebar starts with its places and the vault name is not shown twice. With the sidebar hidden the button follows the sidebar button. The menu drops down from the button and floats above the list. Frames F, G and H redrawn; iPhone unchanged. The width argument for the sidebar header (about 110 pt beside the traffic lights) is dropped: with the sidebar shown, the list column’s toolbar has room. The no-gear note stays.</> },
          { date: '2026-11-25', text: <>The Mac Settings tabs in frame C are pane items (icon above a label, subtle grey background on the selected one) instead of a blue pill. The vault menu in frames F and G floats above the window and may extend past the sidebar into the list column instead of being clipped at the sidebar’s edge.</> },
          { date: '2026-11-25', text: <>Add Vault moves into Settings › Vaults as a group under the vault list (owner: one level fewer than a chooser sheet inside the app). Replaces the three chooser-sheet frames (iPhone, iPad, Mac) and the “Add Vault…” row and button under the list. Frames A to C redrawn. The welcome screen keeps its own choices.</> },
          { date: '2026-11-25', text: <>The vault menu now ends in New Vault…, Open Vault File… and Import from Apple Passwords…, each opening its flow directly. Replaces the single “Add Vault…” item that opened the chooser. It also gained Vault Settings… and Lock [name] after the vaults, and lost its header and its Lock-first order. The File menu got the same three items plus Vault Settings… and Lock Passwords. Frames D to K redrawn.</> },
          { date: '2026-11-25', text: <>On Mac and iPad the vault menu is available even with one vault (superseded the same day: the control is now in the middle column’s toolbar, see above). Replaces the plain-text header of the one-vault frame (owner: people need to find vault settings). The owner asked for a settings gear on Mac; the toolbar gear is not drawn because Apple’s HIG advises against settings buttons in a window’s toolbar and wants settings in the app menu (File menu for document-level options). Frame H redrawn.</> },
          { date: '2026-11-25', text: <>(Superseded by the entry at the top.) Mac and iPad: the vault control moves from the sidebar toolbar (an icon beside the sidebar button, and in the built Mac app after it, beside a stray “Vault” title) to the sidebar’s header, “Passwords ⌄”. The owner asked for global things on the left and the list’s actions on the right; in the toolbar the traffic lights and the sidebar button leave about 110 pt, too little for a vault name, while the header has the sidebar’s full width and already names the vault. The built Mac app also drops the “Vault” title from the toolbar: the list has its own heading. H, I and J redrawn; iPhone unchanged.</> },
          { date: '2026-11-24', text: <>Lead decisions applied to the shared parts: the spoken label of the open padlock is “Unlocked” everywhere, including the AutoFill and browser menu, which shows the open padlock on the current vault when it is unlocked there.</> },
          { date: '2026-11-24', text: <>Revised after the owner’s review (“all over the place”). The menu rows now come from one set of row data shared with the lock screen, Settings and the new <a href="#/vault-states">Vault states</a> page: closed or open padlock, or a warning glyph with “Not downloaded yet”, “Not found” or “Can’t be read”. Section 6 and its decision replaced “AutoFill and the browser read every vault at once, with no switcher” by one current vault per device with a Vault row and an Unlock button, because the browser relay lives in the app and three different pickers was the confusion. Status back to proposal.</> },
          { date: '2026-11-24', text: <>The icon stays and the menu gained Lock (owner): a compact vault icon beside the gear on iPhone and in the sidebar toolbar on Mac and iPad, with two or more vaults only; the menu starts with a header naming the open vault and “Lock Passwords”, then the vaults, then Add Vault…. Replaces a draft the same day that showed the vault name with chevrons in the top bar centre (the owner: few people have several vaults, the name need not be on screen; Lock belongs in the same menu). Also added: the Mac File menu with Add Vault… (section 5), the AutoFill and browser paragraph (section 6), sample vaults Passwords and Work. Proposal, not built.</> },
          { date: '2026-11-24', text: <>Approved (“Build it”) and built: Add Vault sheet, names-only list, the switcher in the main window and “Choose Vault” on the lock screens. Nothing in the drawing changed.</> },
          { date: '2026-11-24', text: <>Menu rows gained a padlock (open or closed) for each vault’s lock state, and the unlock screens take this same control, “Choose Vault” with the database icon (section 4). Replaces the lock screen’s “Unlock Vault: [name]” pop-up; see the History of the Unlock page.</> },
          { date: '2026-11-24', text: <>Redrawn at the owner’s request: the first drawing (the vault name as a menu, in a hand-drawn sidebar) looked bad. The switcher is now a database icon in the top row beside Settings on iPhone, and in the sidebar toolbar on Mac and iPad, drawn in the real sidebar.</> },
          { date: '2026-11-24', text: <>Page added as a proposal at the owner’s request: Add Vault under the list, names only in the list, a vault switcher with two or more vaults. Nothing replaced yet.</> },
        ]}
      />
    </Page>
  );
}
