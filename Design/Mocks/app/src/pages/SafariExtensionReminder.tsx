import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, type TabSpec } from '../components/devices';
import { AllGlyph, BackIcon, CardsGlyph, CodesGlyph, GearIcon, MoreGlyph, SidebarIcon, ChevronDownIcon, ChevronIcon, VaultsIcon } from '../icons';
import { Chevron, ListHead, ListRow } from '../components/Rows';
import { ItemCard } from '../components/ItemCard';
import { Nav } from '../screens/PhoneScreens';
import { byId, cardItems, type Item } from '../data';
import { withRecent } from '../listing';
import './ser.css';

/* ---------- the words ---------- */

const title = 'Fill cards and addresses in Safari';
const body = 'Passwords already fill through AutoFill. Cards and addresses need the Psss extension in Safari.';
const afTitle = 'Enable AutoFill';
const afBody = 'For autocomplete in browsers, enable AutoFill for Psss in Settings under General › AutoFill & Passwords.';

/* ---------- the cards ---------- */

function Reminder({ head, text, primary, later = true }: { head: string; text: string; primary: string; later?: boolean }) {
  return (
    <div className="ser-card" role="group" aria-label={head}>
      <div className="tx"><strong>{head}</strong><div>{text}</div></div>
      <div className="acts"><button className="btn pri">{primary}</button>{later && <button className="btn plain">Later</button>}</div>
    </div>
  );
}
const SafariCard = () => <Reminder head={title} text={body} primary="How to Turn It On" />;
const AutoFillCard = () => <Reminder head={afTitle} text={afBody} primary="Turn On AutoFill" />;

/* ---------- lists ---------- */

const Add = ({ label = '+ Add' }: { label?: string }) => <button className="btn">{label}</button>;
const Title = ({ children }: { children: ReactNode }) => <div className="lt"><div className="t">{children}</div></div>;

const cardsRecent = withRecent(cardItems.filter((c) => !c.expired)).recent;

function CardsPhone({ top, dimmed, children }: { top?: ReactNode; dimmed?: boolean; children?: ReactNode }) {
  return (
    <IPhone tab="cards">
      <Nav right={<Add />} />
      <Title>Cards</Title>
      <div className="pbody tabpad">
        {top}
        <ListHead>Recently used</ListHead>
        <div className="grp">{cardsRecent.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}</div>
      </div>
      {dimmed && <div className="ser-dim" />}
      {children}
    </IPhone>
  );
}

const addr = (id: number, name: string, color: Item['color']): Item => ({ id, name, account: '', kind: 'custom', color, uses: 0, fields: [] });
const addresses: [Item, string][] = [
  [addr(41, 'Cabin', 3), 'Sigulda'],
  [addr(42, 'Gift: Liene', 3), 'Liene Ozola · Riga'],
  [addr(43, 'Home', 5), 'Sam Rivers · Riga'],
  [addr(44, 'Parents', 2), 'Maria Karlsson · Portland'],
  [addr(45, 'Work', 4), 'Sam Rivers · Riga'],
];
const moreTab: TabSpec = ['more', 'More', <MoreGlyph key="m" />];
const bar: TabSpec[] = [['all', 'All', <AllGlyph key="a" />], ['codes', 'Codes', <CodesGlyph key="c" />], ['cards', 'Cards', <CardsGlyph key="d" />], moreTab];

function AddressesPhone({ top }: { top?: ReactNode }) {
  return (
    <IPhone tab="more" tabs={bar}>
      <Nav left={<button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>More</button>} right={<Add label="+ Add address" />} />
      <Title>Addresses <span className="s" style={{ fontWeight: 400 }}>· 5 addresses</span></Title>
      <div className="pbody tabpad">
        {top}
        <div className="grp">{addresses.map(([it, sub]) => <ListRow key={it.id} item={it} sub={sub} traits={false} trailing={<Chevron />} />)}</div>
      </div>
    </IPhone>
  );
}

/* ---------- the steps sheet ---------- */

const Gh = ({ children }: { children: ReactNode }) => <div className="ser-gh">{children}</div>;

/** What Safari's page menu looks like, drawn: the capsule with ᴀA lit, and the menu with Manage Extensions marked. Safari draws it; its rows differ by iOS version. */
const MenuPicture = () => (
  <div className="ser-pic" role="img" aria-label="Safari's page menu with Manage Extensions highlighted">
    <div className="ser-menu">
      <div className="mi"><span>ᴀ  100%  A</span></div>
      <div className="mi">Show Reader</div>
      <div className="mi">Website Settings</div>
      <div className="sepl" />
      <div className="mi hl"><span>Manage Extensions</span></div>
    </div>
    <div className="ser-cap"><span className="aa">ᴀA</span><span>🔒 harborshop.example</span><span aria-hidden>↻</span></div>
    <div className="ser-lbl">A drawing of Safari’s page menu. The real one is Safari’s and differs a little between iOS versions.</div>
  </div>
);

/** `at` scrolls the sheet: 0 is the top, 'safari' the second way with the picture. */
function StepsSheet({ at = 0 }: { at?: 0 | 'safari' }) {
  return (
    <>
      <div className="ser-dim" />
      <div className="ser-sheet" role="dialog" aria-label="Turn On Psss in Safari">
        <div className="ser-grab" />
        <Nav mid={<strong>Turn On Psss in Safari</strong>} right={<button className="btn glass save">Done</button>} />
        <div className="ser-scroll">
          <div className="ser-body" style={at === 'safari' ? { transform: 'translateY(-276px)' } : undefined}>
            <div>Cards and addresses fill only while the Psss extension is on. Passwords don’t need it: they already fill through AutoFill.</div>
            <Gh>In Settings</Gh>
            <ol className="ser-steps">
              <li>Open Settings, then tap Apps › Safari › Extensions.</li>
              <li>Tap Psss, then turn on Allow Extension.</li>
              <li>Tap All Websites and choose Allow. <span className="s">Ask also works: Safari then asks once on each site.</span></li>
            </ol>
            <Gh>Or in Safari</Gh>
            <div>Open any web page, tap the page menu (ᴀA, or the menu button), choose Manage Extensions, turn on Psss, then choose Allow when Safari asks.</div>
            <MenuPicture />
            <div className="s">Psss can’t open that page of Settings for you, so these are the steps. This card goes away once Psss has run in Safari.</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Settings, iPhone ---------- */

const Head = ({ children }: { children: ReactNode }) => <div className="maphelp" style={{ paddingBottom: 4, paddingTop: 6 }}>{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div className="maphelp" style={{ paddingTop: 6 }}>{children}</div>;
const Line = ({ l, v, sub, chev, link }: { l: ReactNode; v?: ReactNode; sub?: ReactNode; chev?: boolean; link?: boolean }) => (
  <div className="mapfield" style={link ? { color: 'var(--accent)' } : undefined}>
    <div className="l">{l}{sub && <div className="s">{sub}</div>}</div>
    {v && <span className="s">{v}</span>}
    {chev && <span className="chev"><ChevronIcon /></span>}
  </div>
);

function SettingsPhone({ seen }: { seen?: boolean }) {
  return (
    <IPhone>
      <Nav mid={<strong>Settings</strong>} right={<button className="btn glass save">Done</button>} />
      <div className="pbody ser-set">
        <Head>AutoFill</Head>
        <div className="icard">
          <Line l="AutoFill is on" sub="Psss fills your logins in Safari and apps." />
          <Line l="Open AutoFill Settings…" link />
        </div>
        <Head>Safari</Head>
        <div className="icard">
          <Line l="Safari Extension" v={seen ? 'Working' : 'Not seen yet'} chev />
        </div>
        <Foot>
          {seen
            ? 'Psss has run in Safari. If cards and addresses stop filling, check that it is still on: Settings › Apps › Safari › Extensions.'
            : 'Fills cards and addresses in Safari. Passwords fill through AutoFill and don’t need it.'}
        </Foot>
        <Head>Help</Head>
        <div className="icard">
          <Line l="Copying" chev />
          <Line l="Verification codes" chev />
          <Line l="Passkeys" chev />
        </div>
      </div>
    </IPhone>
  );
}

/* ---------- iPad, regular width ---------- */

const sides: [string, number][] = [['All', 214], ['Codes', 31], ['Cards', 6], ['Addresses', 5], ['Wi-Fi', 4], ['Logins', 168], ['Notes', 14], ['Custom items', 11]];

function CardsIPad() {
  const list = cardItems.filter((c) => !c.expired).slice(0, 4);
  return (
    <IPad>
      <div className="ws dt ipadws" style={{ position: 'relative' }}>
        <div className="ws-grid" style={{ height: 520, minHeight: 520 }}>
          <div className="col side" data-bounds>
            <div className="tbar"><span className="sp" /><button className="ibtn" aria-label="Hide sidebar" data-tip="Hide sidebar"><SidebarIcon /></button></div>
            <div className="scroll">
              <div className="vsec"><div className="vsh on"><span className="vhi" aria-hidden="true"><VaultsIcon /></span><span className="vhn">Passwords</span><span className="vhc" aria-hidden="true"><ChevronDownIcon /></span></div></div>
              {sides.map(([l, n]) => <div key={l} className={`sr${l === 'Cards' ? ' sel' : ''}`}><i />{l}<span className="n">{n}</span></div>)}
              <div className="sr"><i />Recently Deleted<span className="n">3</span></div>
            </div>
            <div className="sfoot">
              <div className="sfadd-wrap"><button className="sfadd"><span className="sfp" aria-hidden="true">+</span>Add Vault</button></div>
              <button className="sfgear" aria-label="Settings" data-tip="Settings"><GearIcon /></button>
            </div>
          </div>
          <div className="col list ser-lst" data-bounds>
            <div className="tbar"><span className="sp" /><button className="btn glass">+ Add</button></div>
            <SafariCard />
            <div className="lh">Cards<span> · 6 cards</span></div>
            <div className="scroll">
              {list.map((c, i) => <ListRow key={c.id} mac item={c} selected={i === 0} traits={false} />)}
            </div>
          </div>
          <div className="col det" data-bounds>
            <div className="tbar"><button className="btn glass main">Edit</button><label className="searchbox"><span className="s">Search all items</span></label></div>
            <div className="scroll"><div className="dbody"><ItemCard item={byId(list[0].id)} mode="view" /></div></div>
          </div>
        </div>
      </div>
    </IPad>
  );
}

/* ---------- the page ---------- */

export function SafariExtensionReminder() {
  return (
    <Page
      title="Safari extension reminder (iPhone, iPad)"
      status={<><strong>Proposal (2026-11-26), not built.</strong> The direction is the owner’s: iOS cannot say whether the Safari extension is on, so the extension leaves a note the first time it runs and the card shows only until then. This page draws the card on iPhone and iPad, the steps sheet it opens, the Settings row, the order with the AutoFill card, and the Mac card’s words beside it. It replaces the first-run card (frame 8) of <a href="#/ios-safari-fill">Cards and addresses in Safari</a>.</>}
    >
      <Clarity
        intro={<p>Passwords fill through system AutoFill without any extension. Cards and addresses do not: on iPhone and iPad only the Psss extension in Safari can fill them, and it is off until the person turns it on. The card says that in plain words and shows how, once, and then stays out of the way.</p>}
        items={[
          ['Which thing?', 'The Psss extension in Safari. The card is titled by what it gives the person (“Fill cards and addresses in Safari”), not by a setting name, and its body says in the second sentence that passwords do not need it.'],
          ['What must they give?', 'Nothing in the card: one tap on How to Turn It On opens a sheet of steps. The person does the switching in Settings or in Safari, in two or three taps, because iOS offers no button for it.'],
          ['What can go wrong?', 'The person turns it on but Safari still asks per site (the steps say Ask also works); the extension is turned off later (the card does not come back, see Decisions); the steps differ a little on another iOS version (the picture says it is drawn).'],
          ['Where does it live?', 'The card is at the top of the Cards and Addresses places, where a person who wants to fill a card has just looked. The same steps are always in Settings › Safari Extension. The “seen” note is a flag in the App Group the app and the extension share; it holds no vault data.'],
          ['Who holds the key?', 'Nothing here touches the vault key. Face ID, the vault password and the two-minute read permission are on the Safari page.'],
          ['How do they leave?', 'Later hides the card for a week, as the AutoFill card does, and says where the steps stay (Settings). Done closes the steps sheet. Nothing is changed or stored by looking.'],
        ]}
      />

      <Section title="1. The card on iPhone: Cards and Addresses">
        <p>The card is the AutoFill card’s: the same shape, the same two buttons, plain content at the top of the list that scrolls away with it. It sits on the places that hold what the extension fills, and not on All, where it would be above a long list of logins it does not concern. Addresses is under More on iPhone, so the card shows there once the person opens it.</p>
      </Section>
      <Frames>
        <Frame phone label="A · iPhone, Cards" caption="First thing in the list, above Recently used. The title says what it gives; the body says passwords already work and what needs the extension. One filled button that opens steps, one plain Later.">
          <CardsPhone top={<SafariCard />} />
        </Frame>
        <Frame phone label="B · iPhone, Addresses" caption="The same card at the top of the Addresses place (More › Addresses). It is shown while this place has addresses; a place with none shows its own empty state and Add button alone.">
          <AddressesPhone top={<SafariCard />} />
        </Frame>
      </Frames>

      <Section title="2. How to Turn It On">
        <p>A sheet over the list. iOS has no link to the page where the switch is: Psss can open its own page in Settings, but the extension is under Apps › Safari › Extensions, so there is no button that goes there, and the sheet says so. Two ways, one in Settings and one from Safari’s page menu with a drawn picture of that menu. The sheet scrolls; frame D is the same sheet further down.</p>
      </Section>
      <Frames>
        <Frame phone label="C · The steps sheet" caption="Title in the bar, Done at the trailing end (the system’s sheet). One sentence says what the extension is for and that passwords do not need it, then the three steps in Settings. All text is body size; the group names are secondary colour.">
          <CardsPhone dimmed top={<SafariCard />}><StepsSheet /></CardsPhone>
        </Frame>
        <Frame phone label="D · The same sheet, scrolled" caption="The second way: the page menu in Safari, Manage Extensions, with a drawn picture. The last line says Psss cannot open that Settings page for the person, and when the card goes away.">
          <CardsPhone dimmed top={<SafariCard />}><StepsSheet at="safari" /></CardsPhone>
        </Frame>
      </Frames>

      <Section title="3. iPad, regular width">
        <p>The same card at the top of the list column, above the title and count, as the AutoFill card sits on the Mac and iPad. The steps open as a form sheet in the middle of the window with the same content as frames C and D. At compact width iPad is the iPhone layout.</p>
      </Section>
      <Frames>
        <Frame label="E · iPad, the Cards place" caption="The sidebar has Cards selected; the card is in the list column and scrolls away with the rows. Its buttons are the same capsules as on iPhone.">
          <CardsIPad />
        </Frame>
      </Frames>

      <Section title="4. Settings">
        <p>Safari Extension is a row of its own in Settings, under AutoFill, with a status in words at the trailing end. It opens the same steps sheet, so a person who tapped Later can find the way back, and a person who turned the extension off later can too. It is a navigation row (chevron), not a switch, because Psss cannot turn the extension on or off.</p>
      </Section>
      <Frames>
        <Frame phone label="F · Settings, not seen yet" caption="“Not seen yet” is all Psss knows: the extension has not run in Safari. The footer says what it is for and that passwords do not need it.">
          <SettingsPhone />
        </Frame>
        <Frame phone label="G · Settings, working" caption="Once the extension has run, “Working”. The footer says what to check if it stops, because the status never changes back (accepted gap, Decisions 4).">
          <SettingsPhone seen />
        </Frame>
      </Frames>

      <Section title="5. One card at a time">
        <p>The AutoFill card comes first. This card shows only once AutoFill is on, the same rule as on the Mac, and not while the “AutoFill is on” confirmation card is on screen (Done on that card, then this one appears). With AutoFill off, the person sees only the AutoFill card. Once the extension has run in Safari, no card shows, whatever happens to the extension afterwards.</p>
      </Section>
      <Frames>
        <Frame phone label="H · AutoFill is off" caption="Only the AutoFill card. The extension card waits: AutoFill is what the person came for, and the extension only adds cards and addresses to it.">
          <CardsPhone top={<AutoFillCard />} />
        </Frame>
        <Frame phone label="I · Seen, or Later chosen" caption="No card. The list starts with its own rows. The same frame is what Later looks like for a week, and what a person with the extension already used sees for good.">
          <CardsPhone />
        </Frame>
      </Frames>

      <Section title="6. The Mac: the same words">
        <p>The Mac card exists in the app already and says something else. The Mac can read whether the extension is on and open its page in Safari Settings, so it keeps its own button and its own trigger (the extension is off), but the heading and the first sentence should be the same words on every device. The Mac extension also generates passwords and saves new logins, so its second sentence names them.</p>
      </Section>
      <Frames>
        <Frame label="J · Mac card, today and proposed" caption="Shared heading and first sentence; the Mac’s second sentence adds saving and generating. The button stays “Open Safari Settings…”: it opens the page itself, where iPhone and iPad can only explain. Later is the same. Not drawn in a Mac window: the card is the one in the list column.">
          <div className="ser-cmp macui">
            <div>
              <div className="cap">Today (App/Core/SafariExtensionReminder.swift)</div>
              <Reminder head="Turn on the Safari extension" text="To generate passwords and save new logins on sign-up pages, turn on Psss in Safari Settings under Extensions, then allow it on websites." primary="Open Safari Settings…" />
            </div>
            <div>
              <div className="cap">Proposed (Mac)</div>
              <Reminder head={title} text="Passwords already fill through AutoFill. Cards, addresses, new logins and generated passwords in Safari need the Psss extension." primary="Open Safari Settings…" />
            </div>
          </div>
        </Frame>
      </Frames>

      <Section title="Decisions">
        <p className="muted">For the owner to confirm, and what was rejected.</p>
      </Section>
      <Decisions
        items={[
          {
            decision: <><strong>1. A “seen” note, no reading.</strong> iOS has no API that says whether a Safari extension is on. The extension writes one flag into the App Group the first time Safari runs it. Until the flag is there the card may show (once AutoFill is on and it is not snoozed); once it is there, the card never shows again.</>,
            rejected: <>guessing from how long the app has been installed; asking the person “Did you turn it on?” with Yes and No; showing the card forever until the person taps a button.</>,
            why: <>A guess is wrong in both directions, a question makes the person do work for Psss, and a card that cannot be gotten rid of nags. A flag set by the real event is exact.</>,
          },
          {
            decision: <><strong>2. Copy.</strong> Title “Fill cards and addresses in Safari”. Body “Passwords already fill through AutoFill. Cards and addresses need the Psss extension in Safari.” Buttons “How to Turn It On” and “Later”.</>,
            rejected: <>“Turn on the Safari extension” (names a setting, not a benefit; it is the Mac’s old title); “Get more from Psss” (says nothing); a body that explains extensions, App Groups or permissions.</>,
            why: <>The person should read what they get and that the part they already use is not affected. The button says what happens next: steps, not a switch.</>,
          },
          {
            decision: <><strong>3. A steps sheet, not a link.</strong> How to Turn It On opens a sheet. iOS has no deep link to Settings › Apps › Safari › Extensions, so the sheet says so and gives both ways: Settings, and Safari’s page menu › Manage Extensions, with a drawn picture of that menu.</>,
            rejected: <>a button “Open Settings” (it opens Psss’s own page in Settings, which has no extension switch, so the person lands on the wrong page and must find the right one); steps written inside the card (frame 8 of the Safari page: too tall for a card at the top of a list); a looping video.</>,
            why: <>A button that goes somewhere other than where the switch is would lose the person. Two ways cover people who live in Settings and people who live in Safari.</>,
          },
          {
            decision: <><strong>4. Accepted gap: turning it off later does not bring the card back.</strong> The note says the extension ran once; it cannot say it is still on. The Settings row says “Working” and its footer says what to check if cards stop filling.</>,
            rejected: <>clearing the note on a timer so the card returns (nags people who left it off on purpose, and still cannot know).</>,
            why: <>Not knowing is the platform’s limit. Open for the owner: “Working” claims more than we know after a later switch-off. “Used in Safari” says only what is true; recommended if the owner agrees.</>,
          },
          {
            decision: <><strong>5. Where.</strong> The top of the Cards and Addresses places, not All. A Settings row, Safari Extension, with “Not seen yet” or “Working”, opens the same sheet.</>,
            rejected: <>the top of All (long list of logins; the card is about two other places); a badge on the Settings gear; a notification.</>,
            why: <>A person looking at their cards is the one who wants them filled. Settings is where a person looks for the way back. Never a badge or an alert, as the AutoFill card.</>,
          },
          {
            decision: <><strong>6. One card at a time.</strong> AutoFill first. This card only once AutoFill is on and the “AutoFill is on” confirmation is done. The Mac follows the same order (its code today also shows both when the confirmation is up; to align).</>,
            rejected: <>both cards stacked; this card first.</>,
            why: <>Two cards ask two things of a new person at once. AutoFill is the bigger win and the extension builds on it.</>,
          },
          {
            decision: <><strong>7. Shared words with the Mac.</strong> The Mac’s heading and first sentence match; its second sentence keeps saving and generating, which only the Mac extension does; its button stays “Open Safari Settings…” because the Mac can open that page.</>,
            rejected: <>the Mac using the iPhone sentence word for word (it would hide what the Mac extension does beyond filling); the iPhone using “Open Safari Settings…” (iOS cannot).</>,
            why: <>One name for the thing everywhere, and no promise a device cannot keep.</>,
          },
          {
            decision: <><strong>8. The site permission in the steps follows the brief: All Websites › Allow</strong>, with “Ask also works: Safari then asks once on each site” as the quieter option.</>,
            rejected: <>telling everyone to pick Ask (the Safari page’s least-privilege decision of 2026-11-26) or telling everyone to pick Allow with no mention of Ask.</>,
            why: <>Open for the owner: this page now recommends Allow, the Safari page recommends Ask. Allow is one fewer prompt on every checkout; Ask is less access. One of the two pages has to change. Recommended: keep Allow in the steps, say what it grants, and update the Safari page’s decision.</>,
          },
          {
            decision: <><strong>9. A place with nothing in it shows no card</strong> (an empty Cards or Addresses place shows its own empty state and Add button alone).</>,
            rejected: <>the card above an empty state.</>,
            why: <>The person has nothing to fill yet; two asks at once. The card appears on the first visit after a card or address is saved. Open: the owner may prefer to show it so the feature is discoverable before the first card.</>,
          },
        ]}
      />

      <Section title="Open questions">
        <ul>
          <li><strong>When the extension writes the note.</strong> The first time its popup or its page script runs. Not checked: whether Safari runs an extension’s script before the person opens it (it would set the note earlier than the first use, which is fine).</li>
          <li><strong>Settings wording on iOS 26.</strong> “Apps › Safari › Extensions” and “Allow Extension” are as best known and need a device check.</li>
          <li><strong>Frame 8 of the Safari page</strong> still draws the first-run card with steps inside it. It is replaced by frames A to D here; whoever edits that page should point it here.</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-26', text: <>New page, from the owner’s direction: the extension leaves a “seen” note for the app and the card shows only until then; How to Turn It On opens a steps sheet because iOS has no link to the switch; the card sits on Cards and Addresses and in a Settings row; AutoFill first. Replaces the first-run card with inline steps (frame 8 of <a href="#/ios-safari-fill">Cards and addresses in Safari</a>) and the Mac-only reminder as the only reminder; the Mac card’s words are proposed to match.</> },
        ]}
      />
    </Page>
  );
}
