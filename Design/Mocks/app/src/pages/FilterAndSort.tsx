import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneAll } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function FilterAndSort() {
  return (
    <DeviceProvider>
      <Page
        title="Filter and sort"
        status={<><Approved on="2026-11-24" /> As drawn, with Sort and Filter as dropdowns before + Add on every device ("approved, build it"), and the Recently used group at the top of All, Codes and Cards. The places are on <a href="#/places">Places</a>, the rows on <a href="#/list-rows">List rows</a>.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'The All list of the vault. Three separate choices that can be mixed: the kind of item (Show), what an item has (With) and the order (Sort). Its title says what it is showing now: “Logins · 2 items”, and the line under it “With passkey, most used first”.'],
            ['What must they give?', 'One tap for a place. For All: open Filter or Sort beside + Add and choose. Any of the three, in any mix. The order is a view setting: it changes nothing in the vault.'],
            ['What can go wrong?', 'They forget a filter is on and think items are missing (the title line names it, the button is filled, and search covers the whole vault). A combination matches nothing (the screen says which, with Show All Items). They cannot tell why the list is in this order (the Sort menu has a checkmark on the order in use).'],
            ['How do they leave?', 'Show All Items, or All in the menu. Nothing in the vault changes.'],
          ]}
        />

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. All tab" caption="Two buttons sit before + Add at the top: Sort and Filter. The title carries the count. In the default order, “Recently used”, a group of up to five items used in the last 30 days leads, then every item A to Z under “All items”; an item in the group is in the list too.">
            <PhoneAll />
          </Frame>
          <Frame phone label="B. The Filter menu" caption="Show picks one kind. With picks any number of things an item must have. The menu stays open while you tick things under With. Recently Deleted is last: it is a place, not a filter. Cards and codes are not in this menu, because they are tabs.">
            <PhoneAll menuOpen />
          </Frame>
          <Frame phone label="C. The Sort menu" caption="The standard sort symbol opens a menu of four orders, with a checkmark on the one in use. “Recently used” is what the list opens with: it means the group on top and the full list under it. Sort never hides anything, so it does not fill the Filter button.">
            <PhoneAll sortOpen />
          </Frame>
          <Frame phone label="D. A sort order chosen: no group" caption="Most used, Recently changed and Name each show one plain list, with no “Recently used” group and no headings. Here: Name. The group belongs to the default order only, so a person who chose an order sees exactly that order.">
            <PhoneAll sort="name" />
          </Frame>
          <Frame phone label="E. Logins, with a passkey, most used first" caption="All three at once. The title names the kind and count; the line under it names what else is in force. The Filter button is filled while the list is not showing everything. In the default order the group would follow the filter: recent items among the ones that match.">
            <PhoneAll type="logins" feats={['passkey']} sort="most" />
          </Frame>
          <Frame phone label="F. What cannot apply is dimmed" caption="A custom item cannot have a passkey, so that entry is dimmed and ignored while Custom is shown, and comes back with All or Logins. That stops most combinations that could only ever be empty.">
            <PhoneAll type="custom" feats={['passkey']} menuOpen />
          </Frame>
          <Frame phone label="G. Nothing matches" caption="A combination can still match nothing. The screen says which one in words and offers the way back in one tap.">
            <PhoneAll type="custom" feats={['notes']} />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="H. The sidebar chooses the kind"
            initial="mac"
            caption={{
              iphone: 'As in A.',
              ipad: 'As on the Mac, with the Setup gear beside the sidebar button. At compact width it is the iPhone layout.',
              mac: 'The sidebar lists All, Codes, Cards, then the kinds, then Recently Deleted, and has no Filters section. Over the list: Sort, then Filter, then + Add, the same buttons as on iPhone; Filter holds With. The group and the list work as on iPhone, and an item in both is selected once, in the group. Codes and Cards have no Sort or Filter button because they keep their own order.',
            }}
            render={(d) => renderDevice(d, <PhoneAll />, { side: 'all', sel: 1 })}
          />
          <DeviceView
            label="I. The Filter menu on Mac"
            initial="mac"
            caption={{
              iphone: 'As in E, with the menu open.',
              ipad: 'As on the Mac.',
              mac: 'Logins chosen in the sidebar, “Passkey” ticked in the Filter menu, “Most used” chosen with the Sort button. The line under the list title names both. Mac and iPad also list these under View.',
            }}
            render={(d) => renderDevice(d, <PhoneAll type="logins" feats={['passkey']} sort="most" menuOpen />, { side: 'logins', feats: ['passkey'], sort: 'most', filterOpen: true })}
          />
          <DeviceView
            label="J. The Sort menu on Mac"
            initial="mac"
            caption={{
              iphone: 'As in C.',
              ipad: 'The same menu. With a hardware keyboard, View › Sort By lists the same orders.',
              mac: 'The same four orders, in the Sort button before Filter and + Add. Mac also lists them under View › Sort By, the usual place on a Mac.',
            }}
            render={(d) => renderDevice(d, <PhoneAll sortOpen />, { side: 'all', sel: 1, sortOpen: true })}
          />
          <DeviceView
            label="K. A sort order chosen: no group"
            initial="mac"
            caption={{
              iphone: 'As in D.',
              ipad: 'As on the Mac.',
              mac: 'Name chosen: one plain list, no group and no headings. The first item opens by itself.',
            }}
            render={(d) => renderDevice(d, <PhoneAll sort="name" />, { side: 'all', sel: 1, sort: 'name' })}
          />
          <DeviceView
            label="L. Sidebar hidden"
            initial="mac"
            caption={{
              iphone: 'The iPhone has no sidebar; its Filter menu always lists the kinds (as in B).',
              ipad: 'As on the Mac.',
              mac: 'With the sidebar hidden, the Filter menu also lists the places and kinds, so nothing is out of reach.',
            }}
            render={(d) => renderDevice(d, <PhoneAll menuOpen />, { side: 'all', sel: 1, showSide: false, filterOpen: true })}
          />
        </div>

        <Section title="3. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. Two menus in place of the pills.</strong> What the pills held is split in two: a Filter menu (Show a kind, With what an item has) and a Sort menu. The places (All, Codes, Cards) stay in the tab bar and the sidebar.</>,
              rejected: <>the pill row; no tab bar, with everything in one menu at the bottom of the iPhone screen (drawn first); the Recent and Most used pills.</>,
              why: <>The pill row showed three and a half of eight choices and mixed kinds, orders and “has” in one row. What is listed and in which order are two questions, and one row answered both, so “my most used logins” could not be asked.</>,
            },
            {
              decision: <><strong>2. Three choices that combine.</strong> <em>Show</em> All, Logins, Notes, Custom items (one) and <em>With</em> Passkey, Notes (any number; an item must have all that are ticked) in the Filter menu; <em>Sort by</em> Recently used, Most used, Recently changed, Name (one) in the Sort menu. Recently Deleted is the last entry of the Filter menu on iPhone. Sort orders All, each of its filters and search results, and is remembered on the device. The list does not reorder while you look at it; a new order applies when you choose it or the list next appears.</>,
              rejected: <>“any of” for With (ticking more would show more); newest or oldest first as a second choice in the menu (four orders that each have one sensible direction do not need it); a “With code” filter (Codes is that list).</>,
            },
            {
              decision: <><strong>3. A “Recently used” group in the default order only.</strong> In the default order, “Recently used”, All shows a group headed “Recently used” (up to five items used in the last 30 days, most recently used first), then a list headed “All items” (“All logins”, “All notes”, “All custom items” under a kind) with every listed item A to Z, including those in the group. The Sort menu keeps its four entries. Most used, Recently changed and Name show one plain list with no group and no headings. The group follows the Filter: it holds recent items among what Show and With list. There is no group while searching, and none when the list has five items or fewer, because it would only repeat the list; then there are no headings either. Nothing moves while the list is on screen. Codes and Cards have the same group (see <a href="#/places">Places</a> and <a href="#/cards-tab">Cards tab</a>).</>,
              rejected: <>everything used in the last 30 days (for a daily user that is most of the vault, and it pushes the list off the screen); three items, as Codes had; a group under every sort order.</>,
              why: <>The default order used to put every used item first and the rest by name, which is one long list with no seam. A short group on top finds what you use lately, and the list below stays complete and predictable.</>,
            },
            {
              decision: <><strong>4. Where the buttons are.</strong> Sort and Filter share one capsule, and + Add stands in its own beside it, in that order on every device. Sort and Filter both change how the list is shown; + Add makes something, so it is kept apart. iPhone: at the top right of the All tab; Setup stays top left. Mac and iPad: the same buttons over the list; the sidebar lists All, Codes, Cards, Logins, Notes, Custom items and Recently Deleted, and has no Filters section. With the sidebar hidden the Filter menu also lists the places and kinds. The View menu on Mac and iPad lists every Show, With and Sort by choice with its checkmark.</>,
              rejected: <>Sort inside the Filter menu (three taps to change the order, and one button for two different questions); With and Sort by as tick rows in the Mac and iPad sidebar (drawn and dropped: visible and one click, but a different control from iPhone, a longer sidebar, and settings among places; the owner chose the same dropdowns everywhere); the sort or filter button at the bottom beside search, as in Passwords (the tab bar is there); the Recent and Most used sidebar rows.</>,
            },
            {
              decision: <><strong>5. Guards against an empty or forgotten filter.</strong> A With entry that cannot apply to the chosen kind is dimmed and ignored. The title is the kind and count; a line under it names every With and any order other than Recently used. The Filter button is filled with the accent colour while anything is narrowed. An empty result names the combination and has “Show All Items”. Search always covers the whole vault.</>,
            },
            {
              decision: <><strong>6. Codes, Cards and Recently Deleted keep their own order</strong> and have no Sort or Filter button. + Add shows on All and Cards.</>,
            },
            {
              decision: <><strong>7. Remembered.</strong> Show, With and Sort by are remembered on the device.</>,
            },
          ]}
        />

        <Against>
          <li><strong>Filter and Sort are buttons without a word.</strong> The standard symbols, as in Mail and Passwords, each with a spoken label and a tooltip. The project rule prefers words; “Sort” and “Filter” as text beside “+ Add” are tight on iPhone.</li>
          <li><strong>Filters are in a menu on iPhone,</strong> against the project rule that important things stay visible. Logins, Notes, Custom items, Passkey and Notes take two taps instead of one. They are used far less than Codes and Cards, which stay one tap away, and the title line and the filled button keep the current state on screen.</li>
          <li><strong>Sort is at the top on iPhone, not at the bottom as in Passwords.</strong> Passwords has a toolbar at the bottom of its list. Psss has the tab bar there, and Apple's guidance keeps actions out of a tab bar. On Mac and iPad it is in the same place as in Passwords.</li>
        </Against>

        <History
          entries={[
          { date: '2026-11-25', text: <>Shared Mac and iPad window: the sidebar now ends in a foot pinned to the bottom, with Add Vault and an icon-only Settings gear (opens the Settings window on the Mac, the Settings sheet on iPad); on iPad the gear left the sidebar toolbar and Add Vault is no longer the last row of the list. Replaces the iPad sidebar toolbar gear and the Add Vault list row in every frame of this page. See <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Review fixes to the shared Mac and iPad window: the Mac window is a Mac surface throughout, so its buttons are macOS push buttons (Unlock, Use Touch ID, Forgot Password, Copy Setup Link, Show QR Code), its switches are Mac switches, and its text is two sizes, the title (17 px) and the body (13 px), instead of 17, 22 and 13; the toolbar capsules keep the macOS 26 look. The Passwords vault shows 214 items in the sidebar count and the list heading, as Settings does, and the traffic lights are no longer hidden behind the sidebar. Replaces the iOS button styles in the Mac window and the count of 19. With the iPad sidebar hidden (frame L) the gear comes before the vault capsule, after the sidebar button, and the list column is wider so + Add is not cut off.</> },
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
            { date: '2026-11-24', text: <>Sort and Filter were put in one capsule, with + Add in its own. Before, the three were drawn as three separate buttons. All three in one capsule, as Apple's Passwords does with its sort button and +, was considered and not chosen: + Add has a word and does a different kind of thing. The owner decided.</> },
            { date: '2026-11-24', text: <>Each kind got one name everywhere: Logins, Cards, Notes, Custom items (singular: Note, Custom item). Before, the sidebar and titles said “Secure notes” where the pills and the menu said “Notes”, and the menu said “Custom” where the sidebar said “Custom items”. The owner chose the names after the review of the iPhone and iPad screens found the two spellings.</> },
            { date: '2026-11-24', text: <>A “Recently used” group was added at the top of All in the default order, with a full list under it headed “All items”. Before, the default order was every used item first and then the rest by name. The group is limited to five items used in the last 30 days; “everything used in the last 30 days” was rejected because for a daily user it is most of the vault. A group under every sort order was rejected too. The owner decided it for All, Codes and Cards together.</> },
            { date: '2026-11-24', text: <>The owner approved the filter menu ("approved, build it") with Sort and Filter as dropdowns before + Add on every device. A Mac and iPad version with With and Sort by as tick rows in the sidebar had been drawn and was dropped.</> },
            { date: '2026-11-24', text: <>Sort became its own button again, before Filter and + Add, after an owner question; the Filter menu then held only Show and With. Sort inside the Filter menu had needed three taps and made one button answer two questions.</> },
            { date: '2026-11-24', text: <>The tab bar came back and the pills went. The owner said Codes and Cards must stay one tap away, so one menu beside + Add replaced the pill row, and the Mac and iPad toolbar lost its All / Codes / Cards control.</> },
            { date: '2026-11-24', text: <>The menu was refined to the owner's model of three choices that combine: the kind, the order, and what an item has. A version that made Codes a “With: Verification code” entry with live code rows was drawn and then dropped, because Codes is its own place. “With code” left the filters for the same reason.</> },
            { date: '2026-11-24', text: <>The first drawing of “one list” had no tab bar, one menu at the bottom of the iPhone screen holding everything, and the sidebar on Mac and iPad. The owner liked the idea (“much better”) and then asked for the refinements above.</> },
            { date: '2026-11-24', text: <>The first drawing of this change, approved as drawn the same morning, kept a pill row: All, Logins, Notes, Custom, With passkey, With code, With notes and Recently Deleted, with a Sort menu before + Add. Recent and Most used had moved from pills to sort orders. The owner settled three open points as drawn: With code kept (dropped later the same day), the notes glyph left the rows, and the sort button is the bare symbol. The filter menu replaced the pills the same day.</> },
            { date: '2026-11-23', text: <>Before that, Recent and Most used were pills, and the iPhone pill row held Recent, Most used, All, Logins and Notes. Codes and Cards had been pills too and left on 2026-11-23, when they became tabs. The sidebar listed Recent, Most used, All, Codes, Cards, the kinds and Recently Deleted, then Filters (Passkeys, With notes).</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
