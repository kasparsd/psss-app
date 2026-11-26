import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, type TabSpec } from '../components/devices';
import { AllGlyph, CardsGlyph, ChevronDownIcon, CodesGlyph, MoreGlyph, TrashGlyph, WifiGlyph } from '../icons';
import { Chevron, ListRow } from '../components/Rows';
import { Nav } from '../screens/PhoneScreens';
import { items as vaultItems } from '../data';
import './mt.css';

const bar: TabSpec[] = [
  ['all', 'All', <AllGlyph key="a" />],
  ['codes', 'Codes', <CodesGlyph key="c" />],
  ['cards', 'Cards', <CardsGlyph key="d" />],
  ['more', 'More', <MoreGlyph key="m" />],
];

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const PinG = () => svg(<><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></>);
const NoteG = () => svg(<><path d="M6 3.5h9l3.5 3.5v13.5H6z" /><path d="M9 11h6M9 14.5h6M9 18h3.5" /></>);
const CustomG = () => svg(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
const PersonG = () => svg(<><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 10h4M14 13.5h3" /></>);
const BankG = () => svg(<><path d="M3.5 9.5 12 4l8.5 5.5zM6 11v6M10 11v6M14 11v6M18 11v6M4 19.5h16" /></>);
const KeyG = () => svg(<><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H20M17 12v3M20 12v2.5" /></>);
const Wifi = () => <WifiGlyph />;
const Trash = () => <TrashGlyph />;

interface Place { name: string; sym: ReactNode; n?: number }
const addresses: Place = { name: 'Addresses', sym: <PinG />, n: 5 };
const wifi: Place = { name: 'Wi-Fi', sym: <Wifi />, n: 4 };
const deleted: Place = { name: 'Recently Deleted', sym: <Trash />, n: 3 };
const five: Place[] = [addresses, { name: 'Custom Items', sym: <CustomG />, n: 7 }, { name: 'Notes', sym: <NoteG />, n: 12 }, wifi];
const many: Place[] = [
  addresses,
  { name: 'Bank Accounts', sym: <BankG />, n: 2 },
  { name: 'Custom Items', sym: <CustomG />, n: 7 },
  { name: 'Identities', sym: <PersonG />, n: 3 },
  { name: 'Notes', sym: <NoteG />, n: 12 },
  { name: 'Insurance', sym: <BankG />, n: 4 },
  { name: 'Memberships', sym: <PersonG />, n: 6 },
  { name: 'Passports', sym: <PersonG />, n: 2 },
  { name: 'Software Licences', sym: <KeyG />, n: 9 },
  { name: 'Vehicles', sym: <CustomG />, n: 2 },
  wifi,
];

function Group({ places }: { places: Place[] }) {
  return (
    <div className="mt-group">
      {places.map((p) => (
        <div key={p.name} className="mt-row">
          <span className="mt-sym">{p.sym}</span>
          <span className="grow trunc">{p.name}</span>
          {p.n ? <span style={{ color: 'var(--lab2)' }}>{p.n}</span> : null}
          <Chevron />
        </div>
      ))}
    </div>
  );
}

/** A: the page, styled as places. `places` is the group above Recently Deleted, which stands alone at the foot. */
function OptionA({ places, top }: { places: Place[]; top?: boolean }) {
  return (
    <IPhone tab="more" tabs={bar}>
      <div className="lt"><div className="t">More</div></div>
      <div className={`mt-body${top ? ' top' : ''}`}>
        <Group places={places} />
        <Group places={[deleted]} />
      </div>
    </IPhone>
  );
}

function Today() {
  const row = (sym: ReactNode, name: string, sub: string, n: number) => (
    <div className="prow link">
      <div className="mt-tile"><span>{sym}</span></div>
      <div className="grow"><div className="trunc">{name}</div><div className="s trunc">{sub}</div></div>
      <span className="s">{n}</span>
      <Chevron />
    </div>
  );
  return (
    <IPhone tab="more" tabs={bar}>
      <div className="lt"><div className="t">More</div></div>
      <div className="pbody tabpad">
        <div className="grp">
          {row(<PinG />, 'Addresses', 'Where you live, work, ship to', 5)}
          {row(<Wifi />, 'Wi-Fi', 'Network passwords', 4)}
          {row(<Trash />, 'Recently Deleted', 'Kept for 30 days', 3)}
        </div>
      </div>
    </IPhone>
  );
}

/** What is underneath while a menu from the bar is open: the page that was on screen, here All. */
function AllBehind({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <>
      {title ?? <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· 214 items</span></div></div>}
      <div className="pbody tabpad"><div className="grp">{vaultItems.slice(0, 7).map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div></div>
      {children}
    </>
  );
}

const menuRows = (rows: Place[], withDeleted = true) => (
  <>
    {rows.map((p) => (
      <div key={p.name} className="mt-mi"><span className="grow">{p.name}</span>{p.n ? <span style={{ color: 'var(--lab2)' }}>{p.n}</span> : null}<span className="mt-sym">{p.sym}</span></div>
    ))}
    {withDeleted && <><div className="mt-sep" /><div className="mt-mi"><span className="grow">Recently Deleted</span><span style={{ color: 'var(--lab2)' }}>3</span><span className="mt-sym"><Trash /></span></div></>}
  </>
);

function OptionB() {
  return (
    <div className="mt-light">
      <IPhone tab="more" tabs={bar}>
        <AllBehind>
          <div className="mt-dim" />
          <div className="mt-menu" role="menu">{menuRows([addresses, { name: 'Notes', sym: <NoteG />, n: 12 }, { name: 'Custom Items', sym: <CustomG />, n: 7 }, wifi])}</div>
        </AllBehind>
      </IPhone>
    </div>
  );
}

function OptionC() {
  const mid = <span className="mt-title">All <ChevronDownIcon /></span>;
  const places: Place[] = [{ name: 'All', sym: <AllGlyph /> }, { name: 'Codes', sym: <CodesGlyph /> }, { name: 'Cards', sym: <CardsGlyph /> }, addresses, wifi];
  return (
    <div className="mt-light">
      <IPhone tab="all" tabs={bar}>
        <Nav mid={mid} />
        <div className="pbody tabpad"><div className="grp">{vaultItems.slice(0, 7).map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div></div>
        <div className="mt-dim" />
        <div className="mt-menu top" role="menu">{menuRows(places)}</div>
      </IPhone>
    </div>
  );
}

function Sidebar() {
  const row = (p: Place, sel?: boolean) => (
    <div className={`mt-sr${sel ? ' sel' : ''}`}><span className="mt-sym">{p.sym}</span><span>{p.name}</span>{p.n !== undefined && <span className="n">{p.n}</span>}</div>
  );
  return (
    <div className="mt-light dt">
      <div className="mt-side">
        <div className="mt-sh">Passwords</div>
        {row({ name: 'All', sym: <AllGlyph />, n: 214 }, true)}
        {row({ name: 'Codes', sym: <CodesGlyph />, n: 41 })}
        {row({ name: 'Cards', sym: <CardsGlyph />, n: 6 })}
        {row(addresses)}
        {row(wifi)}
        {row(deleted)}
      </div>
    </div>
  );
}

export function MoreTab() {
  return (
    <Page
      title="iPhone: the More tab"
      status={<><strong>Proposal (2026-11-26), not built.</strong> The owner finds that More opens its list at the top of the screen, far from the thumb, and that its rows look like items. This page compares today with three ways to change it and recommends A. Mac and iPad are not affected: their sidebar already lists the places as plain rows.</>}
    >
      <Clarity
        intro={<p>What a person must know here, before any layout:</p>}
        items={[
          ['Which thing?', 'A list of the places in the vault that are not in the bar (Addresses, Wi-Fi, Recently Deleted, and the ones to come). A place is a group of items; the rows are not items.'],
          ['What must they give?', 'One tap on a place. Nothing is typed, chosen or saved here.'],
          ['What can go wrong?', 'The list is long (it scrolls, and opens at its foot so the nearest rows stay in reach); a place is empty (it is listed with no count, so a new vault shows what exists).'],
          ['Where does it live?', 'Nothing is created or stored. The list is built from the vault that is open; nothing is sent anywhere.'],
          ['How do they leave?', 'The back button in a place says More; any tab in the bar leaves More. Nothing is changed by looking.'],
          ['What happens next?', 'The place opens as a page with its own title and its own + Add, as Addresses and Wi-Fi do today.'],
        ]}
      />

      <Section title="1. Today and recommendation A" />
      <div className="prose"><p>Today the three rows look like the items below them: a tile, a name, a grey line, a count, a chevron. Frame A keeps the tab and the page, and changes only what the page looks like and where the list sits.</p></div>
      <Frames>
        <Frame phone label="Today (as built)" caption="Grey rounded tile, white symbol, name, subtitle, count and chevron: the same anatomy as a login row. The list starts under the title, the farthest point from the thumb on a tall phone.">
          <div className="mt-light"><Today /></div>
        </Frame>
        <Frame phone label="A · three places (light)" caption="Inset grouped list. A plain symbol in the accent colour, the name, the count as plain text, a chevron. No tile, no subtitle. The list sits right above the tab bar and the large title stays at the top. Recently Deleted stands in its own group, the way Mail separates Trash.">
          <div className="mt-light"><OptionA places={[addresses, wifi]} /></div>
        </Frame>
        <Frame phone label="A · five places (light)" caption="Five places as they could be once Notes and Custom Items have places of their own (examples, not decided). The group grows upward from the tab bar; the first row is a short reach from the More tab.">
          <div className="mt-light"><OptionA places={five} /></div>
        </Frame>
        <Frame phone label="A · many places (light)" caption="Eleven rows, more than the screen holds (the names are examples); the rows clipped under the title are one swipe away. The page opens scrolled to its foot, so Recently Deleted and the rows nearest the bar need no scrolling; the rest are one swipe down.">
          <div className="mt-light"><OptionA places={many} /></div>
        </Frame>
        <Frame phone label="A · five places (dark)" caption="The same page in dark mode: the symbols take the system accent, the group is the system dark grouped background.">
          <div className="mt-dark"><OptionA places={five} /></div>
        </Frame>
      </Frames>

      <Section title="2. B and C, and the sidebar for comparison" />
      <Frames>
        <Frame phone label="B · a menu above the bar (owner's idea)" caption="Tapping More opens a menu of places right above the tab bar, over a dimmed All page. Drawn as an iOS menu: names left, symbols right, Recently Deleted set apart. The page underneath is still All, and More is lit while the menu is open.">
          <OptionB />
        </Frame>
        <Frame phone label="C · a title menu" caption="Tapping the title, All with a chevron, opens a native menu of places under it (toolbarTitleMenu). The menu is a real popup, but it drops from the top: the finger travels as far as today, and the title says All while the menu lists places that are not All.">
          <OptionC />
        </Frame>
        <Frame label="For comparison: the sidebar on iPad and Mac" caption="The places are plain rows: a symbol, a name, a count, in a list headed by the vault. This is the look A takes to the phone. Nothing here changes.">
          <Sidebar />
        </Frame>
      </Frames>

      <Section title="3. What Apple's guidance says" />
      <div className="prose">
        <p>Read on 2026-11-26 from Apple's published page for Tab bars (Human Interface Guidelines, last changed June 8, 2026) and Apple's SwiftUI reference for <code>TabContent</code>. Where this page goes past what Apple wrote, it says so.</p>
        <ul>
          <li><strong>Navigation, not actions.</strong> The guideline reads: “Use a tab bar to support navigation, not to provide actions.” Controls that act on the current view belong in a toolbar. It does not mention menus or popovers on a tab. That a menu counts as an action, not navigation, is this page's reading.</li>
          <li><strong>Avoid overflow tabs.</strong> Apple says a More tab, which the system makes when tabs do not fit, shows the remaining items in a separate list and makes hidden content harder to reach and notice, so apps should limit how often it happens. Our More is a tab of our own, not the system's, but it has the same cost, which is what the owner is feeling. Apple's alternatives for a complex structure are a sidebar or a tab bar that adapts to a sidebar, which the iPad and Mac already use.</li>
          <li><strong>Do not hide or disable tabs; keep the bar visible.</strong> Having tabs available in some cases and not others makes the app seem unstable, and hiding the bar makes people forget where they are. A tab that opens a menu keeps the bar visible but never shows a page of its own.</li>
          <li><strong>Preserving state.</strong> A tab bar lets people switch between sections “preserving the current navigation state within each section” (Apple's words, paraphrased). A menu has no section to return to, so More would have no selected state of its own.</li>
          <li><strong>Badges</strong> are for critical information only. <strong>iOS 26:</strong> the bar floats above content on a Liquid Glass background and can carry a trailing search tab, which ours does.</li>
          <li><strong>Correction to the brief.</strong> It was assumed that SwiftUI cannot attach a menu to a tab. The reference lists both <code>TabContent.contextMenu(menuItems:)</code> (a menu on press-and-hold) and <code>TabContent.popover(isPresented:attachmentAnchor:arrowEdge:content:)</code>, each from iOS 18. So B does not need a custom tab bar on paper. What the reference does not say is how they behave on the iPhone bar: a popover adapts to a sheet in a compact width unless told otherwise, a tap on a tab selects it first, and press-and-hold is not a tap. B needs a device prototype before it can be judged as built; this page cannot show one.</li>
        </ul>
      </div>

      <Section title="4. Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>1. Recommended: A. More stays a tab that shows a page, and the page looks like places, not items.</strong> Inset grouped list, plain accent symbols, name, count, chevron; no subtitles, no tiles; Recently Deleted in its own group at the foot.</>,
            rejected: <>keeping the tiles and subtitles (they are what makes the rows look like items); a different name for the tab (the tab is only the doorway; the rows were the confusion).</>,
            why: <>It fixes the look the owner called confusing with standard controls, keeps the tab selected so the person knows where they are, and keeps one way to reach a place. The list matches the sidebar on iPad and Mac, so a place looks the same everywhere.</>,
          },
          {
            decision: <><strong>2. The list sits at the bottom of the page, right above the bar, and a long list opens scrolled to its foot.</strong> The large title stays at the top. In SwiftUI this is a scroll anchor at the bottom (<code>defaultScrollAnchor(.bottom)</code>); it must be checked on a device with a <code>List</code> in a large-title page, and if the list will not rest at the foot, the fallback is the list at the top as in Apple's own apps, with the rest of A unchanged.</>,
            rejected: <>a list at the top, as today (the travel the owner reported); a floating card of places (a custom control, and a second look for the same list).</>,
            why: <>A short list lands where the thumb already is. It is not what Apple's apps do (they top-anchor lists), so the gap between the title and the list is a departure from convention; it is the owner's request, and it is cheap to undo. Recently Deleted is last in every list, as on the sidebar, even though it is then nearest the thumb: the order stays the same everywhere.</>,
          },
          {
            decision: <><strong>3. B, a menu above the bar, is not recommended.</strong> It is drawn faithfully above.</>,
            rejected: <>B as the replacement for the page.</>,
            why: <>Apple's tab bar guideline is for navigation, not actions, and a menu is closer to an action; More would have no page and so no selected state to return to, and VoiceOver would announce a tab that opens a menu. The platform has the pieces (tab popover, tab context menu, from iOS 18) but how they behave on the iPhone bar is unverified, and a popover may become a sheet. If the owner still prefers B, the next step is a device prototype of <code>TabContent.popover</code> before any design work, not a custom tab bar.</>,
          },
          {
            decision: <><strong>4. C, a title menu, is not recommended as the way into More.</strong> It is a native control and works with a hand on the phone, but it drops from the top.</>,
            rejected: <>C as a second way in beside More (a place should have one home); C instead of More (the finger travels as far as today).</>,
            why: <>The title All would also list places that are not All, which says the wrong thing. <code>toolbarTitleMenu</code> is documented for the navigation title; how it appears on a large title is not verified here, so C is drawn with an inline title.</>,
          },
        ]}
      />
      <Against>
        <li>A departs from Apple's habit in one place: the bottom-anchored list under a large title (Decision 2). Everything else is a standard inset grouped list with SF Symbols in the accent colour, as in Files and Mail.</li>
        <li>More itself is the overflow pattern Apple asks apps to avoid. It was chosen on 2026-11-24 for room to grow (<a href="#/wifi-place">More and Wi-Fi</a>); A makes it cheaper to use, and does not remove it. Replacing More with a sidebar-adaptable tab bar (as the iPad could use) is the guideline's own alternative and is not part of this proposal.</li>
        <li>Symbols for Notes, Custom Items and the other examples are drawn here as stand-ins; the real ones are chosen from SF Symbols when each place is built.</li>
      </Against>

      <History
        proposal
        entries={[
          { date: '2026-11-26', text: <>New page. The owner reported that More opens at the top of the screen and its rows look like vault items, and asked whether it could open a popup above the tab bar. The page draws today, A (places styled as places, bottom-anchored), B (the popup) and C (a title menu), and recommends A. Nothing replaced yet; the More frames on <a href="#/wifi-place">More and Wi-Fi</a> and <a href="#/address-item">Addresses</a> stay as they are until the owner chooses.</> },
        ]}
      />
    </Page>
  );
}
