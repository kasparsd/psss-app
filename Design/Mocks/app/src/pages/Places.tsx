import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneAll, PhoneCodes, PhoneSearch } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function Places() {
  return (
    <DeviceProvider>
      <Page
        title="Places: All, Codes, Cards"
        status={
          <>
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
              ipad: 'iPad at regular width works exactly like the Mac, with a Setup gear beside the sidebar button because the iPad has no app menu. At compact width (Slide Over, narrow Split View) it uses the iPhone tab bar.',
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

        <Section title="3. What else could be a tab" />
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
              <tr><td>Recently Deleted</td><td>No</td><td>Rare, and a recovery place. The last entry of the Filter menu on iPhone and the last row of the sidebar on Mac and iPad.</td></tr>
              <tr><td>Setup</td><td>No</td><td>Settings, not a place in the vault. The gear stays top left on iPhone and beside the sidebar button on iPad; on Mac it is Psss › Settings… (⌘,).</td></tr>
              <tr><td>Add, Password generator</td><td>No</td><td>Actions. Apple's guidance rules out actions in a tab bar. Add stays labeled at the top; the generator lives in the editor.</td></tr>
            </tbody>
          </table>
        </div>

        <Section title="4. Decisions" />
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
          ]}
        />

        <Against>
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
