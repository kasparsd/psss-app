import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneAll, PhoneCodes, PhoneSearch } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';
import { MoreSidebar, OptionA, OptionB, OptionC, Strip, addresses, five, many, stripTabs as t, wifi } from './PlacesMore';

const bar3 = [t.all, t.codes, t.cards];
const bar4 = [t.all, t.codes, t.cards, t.more];

export function Places() {
  return (
    <DeviceProvider>
      <Page
        title="Places: All, Codes, Cards, More"
        status={
          <>
            <strong>2026-11-26: the owner chose option A for the iPhone More tab</strong> (a plain list of places, bottom-anchored); it is section 3; the decisions are in section 7.{' '}
            <Approved on="2026-11-24" /> The three places, the tab bar and the Codes list were approved on 2026-11-23; what changed on 2026-11-24 (no pill row, no All / Codes / Cards control on Mac and iPad, a Recently used group in Codes) was approved on that day. Filter and sort are on <a href="#/filter-and-sort">Filter and sort</a>, list rows on <a href="#/list-rows">List rows</a>, Cards on <a href="#/cards-tab">Cards tab</a>, the item page and the Mac and iPad toolbars on <a href="#/item-page">Item page, Edit and toolbar</a>.
          </>
        }
      >
        <Clarity
          intro={<p>What a person must know here, before any layout:</p>}
          items={[
            ['Which thing?', <>Their vault, in three places: everything in it (<strong>All</strong>), the six-digit codes that some logins carry (<strong>Codes</strong>) and their <strong>Cards</strong>. Search covers all of them.</>],
            ['What must they give?', 'One tap or click to choose a place. A code is copied with one tap, without opening the login.'],
            ['What can go wrong?', 'The code changes while they switch apps (the button always shows the current one); a login\'s code setting cannot make a code; the vault has no codes yet.'],
            ['Where are the other places?', <>Behind the <strong>More</strong> tab on iPhone: Addresses, Wi-Fi and Recently Deleted, and the places to come. On Mac and iPad they are rows in the sidebar.</>],
            ['How do they leave?', 'Choose another place. Nothing is changed by looking at or copying a code. A copied code leaves the clipboard after 60 seconds, as passwords do.'],
          ]}
        />

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. All tab" caption="The tab bar has All, Codes and Cards, and the search button at its trailing end, as iOS 26 draws it. Setup is at the top left; Sort, Filter and + Add are at the top right. There is no row of pills: Codes and Cards are tabs, and the kinds and what an item has are in the Filter menu. In the default order a “Recently used” group leads.">
            <PhoneAll />
          </Frame>
          <Frame phone label="B. Codes tab" caption="Every login with a code, live. The code is the button; the rest of the row opens the login. There is no countdown line: the codes change by themselves, and a row says its own timing only when its period differs (Harbor Vault, “Every 60 s”). “Recently used” leads, then “All codes” A to Z. Copying a code counts as using the login.">
            <PhoneCodes />
          </Frame>
          <Frame phone label="C. Just copied" caption="The button reads “Copied” for about two seconds, with a haptic, then shows the code again. The list does not reorder while the person is looking at it.">
            <PhoneCodes variant="copied" />
          </Frame>
          <Frame phone label="D. Search" caption="The search button opens a field above the keyboard. Results come from the whole vault, whichever tab it was opened from, in the order chosen for All. A result with a code shows it live as its button, so “g” finds the Gitforge code from any tab. Close clears the text and returns to the tab the person came from.">
            <PhoneSearch />
          </Frame>
          <Frame phone label="E. No codes yet" caption="The tab is always there, so a new vault shows what it is for. “Show logins” switches to the All tab.">
            <PhoneCodes variant="empty" />
          </Frame>
          <Frame phone label="F. A code that cannot be made" caption="An imported code setting Psss cannot use (unknown type, broken key) stays in the list with no button and no message. The row opens the login, whose code row explains it and offers Replace Code….">
            <PhoneCodes variant="broken" />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="G. The sidebar chooses the place"
            initial="mac"
            caption={{
              iphone: 'The All tab, as in A.',
              ipad: 'iPad at regular width works exactly like the Mac, with the Setup gear at the foot of the sidebar (and in the list toolbar while the sidebar is hidden) because the iPad has no app menu. At compact width (Slide Over, narrow Split View) it uses the iPhone tab bar.',
              mac: 'No tab bar and no All / Codes / Cards control in the toolbar: the sidebar is the one place that chooses. It stays visible (the person can hide it) and lists All, Codes and Cards, then the kinds, then Recently Deleted, each with a count. ⌘1, ⌘2 and ⌘3 choose All, Codes and Cards and are listed in the View menu. The first item opens by itself.',
            }}
            render={(d) => renderDevice(d, <PhoneAll />, { side: 'all', sel: 1 })}
          />
          <DeviceView
            label="H. Codes"
            initial="mac"
            caption={{
              iphone: 'The Codes tab, as in B.',
              ipad: 'Codes on iPad, the same as on the Mac.',
              mac: 'Codes chosen in the sidebar. The list shows live codes with the same copy button; selecting a row shows the login beside it, as every list does, and ⌘C copies the selected row\'s code. No Sort or Filter button: Codes keeps its own order. An item that is in “Recently used” and in “All codes” is selected once, in the group.',
            }}
            render={(d) => renderDevice(d, <PhoneCodes />, { side: 'codes', sel: 1 })}
          />
        </div>
        <p className="prose muted">Cards on every device is on <a href="#/cards-tab">Cards tab</a>.</p>

        <Section title="3. iPhone: the More tab" />
        <div className="prose">
          <p>More is a tab that opens a page of the places that are not in the bar. The owner found that the old page opened its list at the top of the screen, far from the thumb, and that its rows (a grey tile, a name, a grey line, a count) looked like vault items. Option A, chosen on 2026-11-26, keeps the tab and the page and changes what the page looks like and where its list sits.</p>
        </div>
        <Frames>
          <Frame phone label="A · three places (light)" caption="Inset grouped list. A plain symbol in the accent colour, the name, the count as plain text, a chevron. No tile, no subtitle. The list sits right above the tab bar and the large title stays at the top. Recently Deleted stands in its own group, the way Mail separates Trash.">
            <div className="mt-light"><OptionA places={[addresses, wifi]} /></div>
          </Frame>
          <Frame phone label="A · five places (light)" caption="Five places as they could be once Notes and Custom Items have places of their own (examples, not decided). The group grows upward from the tab bar; the first row is a short reach from the More tab.">
            <div className="mt-light"><OptionA places={five} /></div>
          </Frame>
          <Frame phone label="A · many places (light)" caption="Eleven rows, more than the screen holds (the names are examples); the rows clipped under the title are one swipe away. The page opens scrolled to its foot, so Recently Deleted and the rows nearest the bar need no scrolling.">
            <div className="mt-light"><OptionA places={many} /></div>
          </Frame>
          <Frame phone label="A · five places (dark)" caption="The same page in dark mode: the symbols take the system accent, the group is the system dark grouped background.">
            <div className="mt-dark"><OptionA places={five} /></div>
          </Frame>
        </Frames>
        <p className="prose muted">Rejected, drawn so the reasons can be checked:</p>
        <Frames>
          <Frame phone label="B · a menu above the bar (rejected)" caption="Tapping More opens a menu of places right above the tab bar, over a dimmed All page. Drawn as an iOS menu: names left, symbols right, Recently Deleted set apart. The page underneath is still All, and More is lit while the menu is open.">
            <OptionB />
          </Frame>
          <Frame phone label="C · a title menu (rejected)" caption="Tapping the title, All with a chevron, opens a native menu of places under it (toolbarTitleMenu). The menu is a real popup, but it drops from the top: the finger travels as far as the old list, and the title says All while the menu lists places that are not All.">
            <OptionC />
          </Frame>
          <Frame label="For comparison: the sidebar on iPad and Mac" caption="The places are plain rows: a symbol, a name, a count, in a list headed by the vault. This is the look A takes to the phone. Nothing here changes.">
            <MoreSidebar />
          </Frame>
        </Frames>

        <Section title="4. The bottom bar" />
        <div className="prose">
          <p>The bar is always All, Codes, Cards and More, whatever the vault holds. More is a list of the other places, so a new place is one more row, never one more tab.</p>
        </div>
        <Strip label="Before More" tabs={bar3} tab="all" note="All, Codes and Cards, and the search button apart at the end." />
        <Strip label="Chosen: a More tab of our own" tabs={bar4} tab="more" note="Always there and always the same. It opens a list: Addresses, Wi-Fi, Recently Deleted, and whatever comes next." />
        <Strip label="Considered: Wi-Fi as its own tab" tabs={[t.all, t.codes, t.cards, t.wifi]} tab="wifi" note="One tap shorter for Wi-Fi, but the next place (identities, bank accounts) needs another tab, and a fifth tab is where the bar stops fitting." />
        <Strip label="Rejected: a Recently Deleted tab that appears when needed" tabs={[t.all, t.codes, t.cards, t.wifi, t.trash]} tab="all" note="The whole bar changes the moment something is deleted or the last item leaves Recently Deleted. Apple: do not hide tab bar buttons." />

        <Section title="5. What Apple's guidance says about More" />
        <div className="prose">
          <p>Read on 2026-11-26 from Apple's published page for Tab bars (Human Interface Guidelines, last changed June 8, 2026) and Apple's SwiftUI reference for <code>TabContent</code>. Where this page goes past what Apple wrote, it says so.</p>
          <ul>
            <li><strong>Navigation, not actions.</strong> The guideline reads: “Use a tab bar to support navigation, not to provide actions.” Controls that act on the current view belong in a toolbar. It does not mention menus or popovers on a tab. That a menu counts as an action, not navigation, is this page's reading.</li>
            <li><strong>Avoid overflow tabs.</strong> Apple says a More tab, which the system makes when tabs do not fit, shows the remaining items in a separate list and makes hidden content harder to reach and notice, so apps should limit how often it happens. Our More is a tab of our own, not the system's, but it has the same cost. Apple's alternatives for a complex structure are a sidebar or a tab bar that adapts to a sidebar, which the iPad and Mac already use.</li>
            <li><strong>Do not hide or disable tabs; keep the bar visible.</strong> Having tabs available in some cases and not others makes the app seem unstable, and hiding the bar makes people forget where they are. A tab that opens a menu keeps the bar visible but never shows a page of its own.</li>
            <li><strong>Preserving state.</strong> A tab bar lets people switch between sections “preserving the current navigation state within each section” (Apple's words, paraphrased). A menu has no section to return to, so More would have no selected state of its own.</li>
            <li><strong>Badges</strong> are for critical information only. <strong>iOS 26:</strong> the bar floats above content on a Liquid Glass background and can carry a trailing search tab, which ours does.</li>
            <li><strong>Menus on a tab.</strong> The SwiftUI reference lists <code>TabContent.contextMenu(menuItems:)</code> (press and hold) and <code>TabContent.popover(isPresented:attachmentAnchor:arrowEdge:content:)</code>, each from iOS 18. So B would not need a custom tab bar on paper, but how they behave on the iPhone bar is not documented: a popover adapts to a sheet in a compact width unless told otherwise, and a tap on a tab selects it first. B was not prototyped.</li>
          </ul>
        </div>

        <Section title="6. What else could be a tab" />
        <div className="prose">
          <p>Apple's guidance: tabs are for top-level places a person moves between, never actions; three to five on iPhone; each one always visible and never empty without explanation. Each candidate against that:</p>
          <table className="cmp">
            <thead><tr><th>Candidate</th><th>Verdict</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>All</td><td>Tab</td><td>Everything in the vault. The home.</td></tr>
              <tr><td>Codes</td><td>Tab</td><td>A different job (copy a code in seconds) with a different row. Apple Passwords also gives codes their own place.</td></tr>
              <tr><td>Cards</td><td>Tab</td><td>A different job (four fields in a row at a checkout) with a different row. See <a href="#/cards-tab">Cards tab</a>.</td></tr>
              <tr><td>Search</td><td>Tab (search role)</td><td>iOS 26 puts search as a separate button at the trailing end of the tab bar. It replaces the floating search field, so the bottom of the screen does not carry two bars.</td></tr>
              <tr><td>Security (weak, reused, found in a breach)</td><td>Later, fourth or fifth tab</td><td>A real place with its own list and its own job. The on-device audit is under Later in the roadmap. Add the tab when the audit ships, not before; an empty or “coming soon” tab breaks the honesty rule.</td></tr>
              <tr><td>Passkeys, Notes</td><td>No, filters</td><td>Ways of narrowing the same list with the same rows (With passkey, With notes in the Filter menu). As tabs they would split search and duplicate the menu.</td></tr>
              <tr><td>Recent, Most used</td><td>No, sort orders</td><td>“Recently used” is the order All opens in, with its own group on top; “Most used” is a choice in the Sort menu.</td></tr>
              <tr><td>Family / shared groups</td><td>No, a way of narrowing</td><td>The approved sharing design keeps groups inside one vault, so a group narrows the same list; the Filter menu has room for it. Revisit only if separate vaults become something a person switches between.</td></tr>
              <tr><td>Recently Deleted</td><td>No</td><td>Rare, and a recovery place. A row in More on iPhone (in its own group, with its count) and the last row of the sidebar on Mac and iPad.</td></tr>
              <tr><td>Addresses, Wi-Fi, and the places to come</td><td>No, rows in More</td><td>Places a person visits now and then. One more row each, never one more tab: five tabs is where the bar stops fitting. See section 3.</td></tr>
              <tr><td>Setup</td><td>No</td><td>Settings, not a place in the vault. The gear stays top left on iPhone and sits in the sidebar foot on iPad; on Mac it is Psss › Settings… (⌘,).</td></tr>
              <tr><td>Add, Password generator</td><td>No</td><td>Actions. Apple's guidance rules out actions in a tab bar. Add stays labeled at the top; the generator lives in the editor.</td></tr>
            </tbody>
          </table>
        </div>

        <Section title="7. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. A tab bar on iPhone</strong> with All, Codes, Cards and the search tab. It shrinks while scrolling down and returns on scrolling up; tapping the All tab again or the status bar returns to the top.</>,
              rejected: <>keeping only a Codes pill, with rows that show codes; no tab bar, with Codes and Cards in one menu at the bottom (drawn 2026-11-24: two taps to a code).</>,
              why: <>A tab is one tap, in thumb reach, from anywhere, and Codes and Cards must stay that close (owner). A pill sits far along a row that scrolls, and a pill that changes what rows do is a surprise.</>,
            },
            {
              decision: <><strong>2. The tabs are called “All”, “Codes” and “Cards”.</strong></>,
              rejected: <>“Vault” (drawn first), “Passwords”, “Items”, “Verification codes”, “2FA”.</>,
              why: <>“All” is plainer and does not suggest codes and cards are outside the vault; the vault holds cards and notes, so “Passwords” is not true. The Filter menu's first choice is also “All”, so the word means everything in both places.</>,
            },
            {
              decision: <><strong>3. Search is the iOS 26 search tab.</strong> It opens a field above the keyboard and lists matches from the whole vault, in the order chosen for All, with a live code where there is one. It does not narrow to a kind or to the tab it was opened from. Return opens the top result.</>,
              rejected: <>a search field at the top of each tab, or always visible (the first drawing of the filter menu); search that follows the tab it was opened from; dropping the tab bar.</>,
              why: <>Apple's placement, and one search that always finds everything, so a missing result never comes from a hidden scope.</>,
            },
            {
              decision: <><strong>4. The code itself is the copy button;</strong> the rest of the row opens the login.</>,
              rejected: <>the whole row copies with an info button to open the login; a separate “Copy” label beside the code.</>,
              why: <>A visible code in a tinted button reads as tappable, and a row that opens its item behaves like every other row in the app. A separate label does not fit beside a six-digit code on a phone. The line under the list says it once.</>,
            },
            {
              decision: <><strong>5. No countdown on the Codes list.</strong> A row carries its own timing only when its period differs from 30 seconds.</>,
              rejected: <>one countdown line for the list with an info button (approved earlier on 2026-11-23); a ring on every row.</>,
              why: <>The owner found the line a distraction, and the code button changes by itself.</>,
            },
            {
              decision: <><strong>6. Copy always copies the current code.</strong></>,
              rejected: <>copying the next code near the end; hiding the code near the end.</>,
              why: <>A code that is not valid yet fails everywhere, and one that has just changed is often still accepted.</>,
            },
            {
              decision: <><strong>7. Codes: a “Recently used” group, then “All codes” A to Z.</strong> The group holds up to five logins whose code was used in the last 30 days, most recently used first, and the same login is also in the list below. With five codes or fewer there is no group and no headings. Nothing moves while the list is on screen; on Mac and iPad a login in both is selected once, in the group.</>,
              rejected: <>everything used in the last 30 days (for a daily user that is most of the vault, and it pushes the list off the screen); three logins as before; ordering by most used.</>,
              why: <>The code you want is usually one you used lately, and a list that jumps under a thumb causes wrong copies.</>,
            },
            {
              decision: <><strong>8. Codes is its own place, not a filter.</strong> There is no “With code” filter and no Codes pill.</>,
              why: <>One way to reach it, named the same everywhere. The code glyph in a row points to this list.</>,
            },
            {
              decision: <><strong>9. Mac and iPad: the sidebar is the only control that chooses the place.</strong> No All / Codes / Cards control in the toolbar. ⌘1 to ⌘3 and the View menu stay. With the sidebar hidden, the Filter menu also lists the places and kinds.</>,
              rejected: <>the segmented control in the toolbar beside + Add (approved 2026-11-23); the system top tab bar on iPad; an iPhone-style bottom bar on iPad; Passwords-style tiles in the sidebar; native window tabs.</>,
              why: <>The control repeated the sidebar, where Codes and Cards are already one click away. One control fewer, and iPad and Mac still work the same.</>,
            },
            {
              decision: <><strong>10. The bar is always All, Codes, Cards, More and the search tab (owner, 2026-11-24).</strong> More lists the places that are not in the bar: Addresses, Wi-Fi and Recently Deleted now, and identities, bank accounts and the rest when they exist.</>,
              rejected: <>Wi-Fi as a fourth tab (fits today, but each later place would need a decision and the bar stops fitting at five); a Recently Deleted tab that appears when needed (Apple: do not hide tab bar buttons; the bar would jump); the system’s own overflow (it folds whichever tabs do not fit, so which place is behind it changes).</>,
              why: <>The bar stays the same for everyone and nothing is hidden or disabled. The cost is one more tap to reach Wi-Fi than a tab would take; Codes and Cards, the places used at a moment’s notice, keep their tabs.</>,
            },
            {
              decision: <><strong>11. A: More stays a tab that shows a page, and the page looks like places, not items (owner, 2026-11-26).</strong> Inset grouped list, plain accent symbols, name, count, chevron; no subtitles, no tiles; Recently Deleted in its own group at the foot.</>,
              rejected: <>keeping the tiles and subtitles (they are what makes the rows look like items); a different name for the tab (the tab is only the doorway; the rows were the confusion).</>,
              why: <>It fixes the look the owner called confusing with standard controls, keeps the tab selected so the person knows where they are, and keeps one way to reach a place. The list matches the sidebar on iPad and Mac, so a place looks the same everywhere.</>,
            },
            {
              decision: <><strong>12. The list sits at the bottom of the page, right above the bar, and a long list opens scrolled to its foot.</strong> The large title stays at the top. <strong>Built differently:</strong> <code>defaultScrollAnchor(.bottom)</code> on a <code>List</code> does not rest a short list at the foot (checked on the iPhone 17 simulator, 2026-11-26), and the only ways to force it are custom scroll layout. The built list is at the top, under the large title, as in Apple's own apps; the frames above still show the owner's bottom-anchored idea and are kept so the owner can decide whether a custom layout is worth it.</>,
              rejected: <>a list at the top, as before (the travel the owner reported); a floating card of places (a custom control, and a second look for the same list).</>,
              why: <>A short list lands where the thumb already is. It is not what Apple's apps do (they top-anchor lists), so the gap between the title and the list is a departure from convention; it is the owner's request, and it is cheap to undo. Recently Deleted is last in every list, as on the sidebar, even though it is then nearest the thumb: the order stays the same everywhere.</>,
            },
            {
              decision: <><strong>13. B, a menu above the bar, is rejected.</strong></>,
              rejected: <>B as the replacement for the page.</>,
              why: <>Apple's tab bar guideline is for navigation, not actions, and a menu is closer to an action; More would have no page and so no selected state to return to, and VoiceOver would announce a tab that opens a menu. The platform has the pieces (tab popover, tab context menu, from iOS 18) but how they behave on the iPhone bar is unverified, and a popover may become a sheet. If it is ever revisited, the next step is a device prototype of <code>TabContent.popover</code>, not a custom tab bar.</>,
            },
            {
              decision: <><strong>14. C, a title menu, is rejected as the way into More.</strong> It is a native control, but it drops from the top.</>,
              rejected: <>C as a second way in beside More (a place should have one home); C instead of More (the finger travels as far as before).</>,
              why: <>The title All would also list places that are not All, which says the wrong thing. <code>toolbarTitleMenu</code> is documented for the navigation title; how it appears on a large title is not verified here.</>,
            },
          ]}
        />

        <Against>
          <li>A departs from Apple's habit in one place: the bottom-anchored list under a large title (decision 12). Everything else is a standard inset grouped list with SF Symbols in the accent colour, as in Files and Mail.</li>
          <li>More itself is the overflow pattern Apple asks apps to avoid. It was chosen on 2026-11-24 for room to grow; A makes it cheaper to use and does not remove it. Replacing More with a sidebar-adaptable tab bar is the guideline's own alternative and is not planned. Symbols for Notes, Custom Items and the other example rows are stand-ins; the real ones are chosen from SF Symbols when each place is built.</li>
          <li>Two type sizes inside the device. Tab labels are normally the smaller system tab-bar size; the mock keeps body size per the project rule. In the app, use the system tab bar as it is: it is a standard control, and the rule is about our own text.</li>
          <li>Codes shown in the clear in a list. Not against guidance, but a choice: anyone looking over a shoulder sees them. They are valid for seconds and useless without the password, and Apple Passwords shows them the same way.</li>
          <li>Otherwise none: a standard tab bar with a search-role tab on iPhone, a sidebar on iPad and Mac, labeled tabs, no actions in the bar.</li>
        </Against>

        <Section title="Left out on purpose">
          <ul>
            <li>An “Add code” button in the Codes tab needs “which login?” first. It is item 2 in the deferred list of <code>docs/verification-codes.md</code>.</li>
            <li>A home-screen widget or Control Center control for codes is the next step for “copy without opening”.</li>
          </ul>
        </Section>

        <History
          entries={[
          { date: '2026-11-26', text: <>Built on the iPhone: the plain list of places (inset grouped, accent symbols, counts, Recently Deleted apart) matches the A frames; the bottom anchoring does not (decision 12): the build is top-anchored because the platform's scroll anchor does not move a short list. Frames kept as drawn, pending the owner's word.</> },
          { date: '2026-11-26', text: <>The owner chose option A for the iPhone More tab; merged the More tab page here (it was <code>#/more-tab</code>). Replaces the old More list (grey tiles, subtitle under each name, count, chevron, list at the top of the screen) drawn on Wi-Fi and Recently Deleted. B (a menu above the bar) and C (a title menu) stay drawn as rejected. The bottom-bar strips and the More tab decision moved here from <a href="#/wifi-place">Wi-Fi and Recently Deleted</a>. The Recently Deleted table row now says it is a row in More, not an entry of the Filter menu.</> },
          { date: '2026-11-25', text: <>Owner: icon on the left, row-size header, no own chevron; the pull-down is replaced by the right-click menu (built that way, mock follows). The Mac and iPad sidebar frames show it.</> },
          { date: '2026-11-25', text: <>Shared Mac and iPad window: the sidebar now ends in a foot pinned to the bottom, with Add Vault and an icon-only Settings gear (opens the Settings window on the Mac, the Settings sheet on iPad); on iPad the gear left the sidebar toolbar and Add Vault is no longer the last row of the list. Replaces the iPad sidebar toolbar gear and the Add Vault list row in every frame of this page. See <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Review fixes to the shared Mac and iPad window: the Mac window is a Mac surface throughout, so its buttons are macOS push buttons (Unlock, Use Touch ID, Forgot Password, Copy Setup Link, Show QR Code), its switches are Mac switches, and its text is two sizes, the title (17 px) and the body (13 px), instead of 17, 22 and 13; the toolbar capsules keep the macOS 26 look. The Passwords vault shows 214 items in the sidebar count and the list heading, as Settings does, and the traffic lights are no longer hidden behind the sidebar. Replaces the iOS button styles in the Mac window and the count of 19.</> },
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
            { date: '2026-11-24', text: <>The Mac and iPad toolbar lost its All / Codes / Cards control. It repeated the sidebar, and the sidebar alone now chooses the place; ⌘1 to ⌘3 stay. Decided by the owner with the filter menu.</> },
            { date: '2026-11-24', text: <>The sidebar lost Recent, Most used and its Filters section: the first two are sort orders and the rest are in the Filter menu (see <a href="#/filter-and-sort">Filter and sort</a>). The “With code” filter was dropped because Codes is that list.</> },
            { date: '2026-11-24', text: <>The pill row left the iPhone All tab and the tab bar stayed. A drawing with no tab bar, search always visible and Codes and Cards inside one menu at the bottom was tried first; the owner kept the tab bar because Codes and Cards must stay one tap away.</> },
            { date: '2026-11-24', text: <>Search lost its pills: results are listed from the whole vault with no row to narrow them. Before, search showed the All screen with its pills and a type pill narrowed the results.</> },
            { date: '2026-11-24', text: <>Codes: “Recently copied” (up to three logins) became “Recently used” (up to five, used in the last 30 days), then “All codes” A to Z. The owner decided it with the same group on All and Cards.</> },
            { date: '2026-11-23', text: <>The countdown line left the Codes list at the owner's request, as a distraction, and its info bubble went with it. Before that it was one line, “New codes in 18 s”, with a ring. It had first carried an extra sentence in the last five seconds, which shifted the list; the owner changed it to a line that never changes size, and the sentence about the previous code moved into the bubble.</> },
            { date: '2026-11-23', text: <>A code setting that cannot make a code stays in the Codes list with no button and no message (owner). The row had first said so in place of the account.</> },
            { date: '2026-11-23', text: <>The pills scrolled away with the list and the collapsed tab bar named the active pill. That went with the pills on 2026-11-24.</> },
            { date: '2026-11-23', text: <>Search was first built as a bare results screen. The owner missed the old filter-in-place search, so it became the All screen with its pills, filtering in place. The 2026-11-24 entry above replaced that.</> },
            { date: '2026-11-23', text: <>iPad: the system top tab bar was drawn first and replaced by the Mac's toolbar control, so that iPad works exactly like the Mac (owner). An iPhone-style bottom bar on iPad was rejected as a custom control, not where iPad hands rest. The sidebar became always visible and lists Codes and Cards. Passwords-style tiles in the sidebar were rejected by the owner (keep our tabs).</> },
            { date: '2026-11-23', text: <>The first tab was drawn as “Vault” and renamed “All”. The pill that showed everything was briefly “A to Z” and is “All” again at the owner's request. “Passwords”, “Items”, “Verification codes” and “2FA” were considered.</> },
            { date: '2026-11-23', text: <>Cards became a third tab (see <a href="#/cards-tab">Cards tab</a>). The first version of this page had rejected it as a pill; the owner approved the tab afterwards.</> },
            { date: '2026-11-23', text: <>Codes was a filter pill that listed the logins with a code, each opening the login. It became its own tab whose rows show the live code, and the pill and the sidebar filter were removed. The owner approved the three places, the tab bar and the Codes list as drawn.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
