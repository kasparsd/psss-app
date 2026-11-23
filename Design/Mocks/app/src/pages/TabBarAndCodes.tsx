import { Against, Approved, ChangeNote, Clarity, Decisions, Frame, Frames, Page, Prose, Section } from '../components/page';
import { DeviceView } from '../components/DeviceSwitcher';
import { PhoneAll, PhoneCodes, PhoneSearch } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function TabBarAndCodes() {
  return (
    <Page
      title="Tab bar on iPhone and a Codes view"
      status={
        <>
          <Approved /> as drawn, with the tab bar shrinking on scroll and the pills scrolling with the list (decision 9). Being built. Plan: <code>docs/plans/tab-bar-and-codes.md</code>.
        </>
      }
    >
      <Clarity
        intro={<p>What a person must know here, before any layout:</p>}
        items={[
          ['Which thing?', <>Their vault, split in places: everything in it (<strong>All</strong>), the six-digit codes that some logins carry (<strong>Codes</strong>) and their <strong>Cards</strong>. Search covers all of them.</>],
          ['What must they give?', 'Nothing. A code is copied with one tap, without opening the login.'],
          ['What can go wrong?', 'The code changes while they switch apps; a login\'s code setting cannot make a code; the vault has no codes yet.'],
          ['How do they leave?', 'Tap the All tab. Nothing is changed by looking at or copying a code. A copied code leaves the clipboard after 60 seconds, as passwords do.'],
        ]}
      />
      <Prose><p>Before this page, “Codes” was one of the filter pills. It listed the logins that have a code, and each row opened the login, where the code is. This page promotes it to its own tab whose rows show the live code.</p></Prose>
      <ChangeNote>
        Frames use the shared components. The tabs are All, Codes and Cards (the Cards tab was added by <a href="#/cards-tab">Cards tab</a> after this page was drawn); the pill row is Recent, Most used, All, Logins, Notes, with no Codes or Cards pill. Item rows use the current sample vault. The Mac and iPad frame is the Toolbar and Edit layout, and it has an iPhone and an iPad option. The candidates table now lists Cards as a tab and the first tab as “All”. Everything else is carried over.
      </ChangeNote>

      <Section title="1. iPhone" />
      <Frames>
        <Frame phone label="A. All tab (today's screen, new bar)" caption="The list, pills, Setup and Add stay as they are. The floating search field becomes the search tab at the trailing end, as iOS 26 draws it. The “Codes” and “Cards” pills are removed: they are tabs now.">
          <PhoneAll />
        </Frame>
        <Frame phone label="B. Codes tab" caption="Every login with a code, live. One countdown for the whole list, since 30-second codes all change together. The code is the button; the rest of the row opens the login. Copying a code counts as using the login, so it moves to the top.">
          <PhoneCodes />
        </Frame>
        <Frame phone label="C. Just copied" caption="The button reads “Copied” for about two seconds, with a haptic, then shows the code again. The list does not reorder while the person is looking at it; Gitforge moves up next time the tab opens.">
          <PhoneCodes variant="copied" />
        </Frame>
        <Frame phone label="D. Last five seconds" caption="Copy still copies the current code. The line under the title always reads the same, with only the seconds counting down, so nothing moves when a code is about to change (changed 2026-11-23 at the owner's request; it first showed an extra sentence in the last five seconds, which shifted the list). A code with a different period or length says so in its row, the only place a row carries its own timing.">
          <PhoneCodes variant="last5" />
        </Frame>
        <Frame phone label="E. Search: the All screen, filtered" caption="The search button opens the All screen with its pills, the field ready at the bottom. Typing filters the list in place. From Recent or Most used it searches the whole vault and the All pill lights up, so the highlight is honest. A result with a code shows it live, so “git” finds the Gitforge code from any tab.">
          <PhoneSearch />
        </Frame>
        <Frame phone label="E2. A type pill narrows the search" caption="Tapping a type pill while typing narrows the results to it; the note drops out. Close (✕) clears the text and returns to the tab the person came from; the chosen pill stays chosen in the All tab.">
          <PhoneSearch pill="Logins" />
        </Frame>
        <Frame phone label="F. No codes yet" caption="The tab is always there, so a new vault shows what it is for. “Show logins” switches to the All tab with the Logins pill.">
          <PhoneCodes variant="empty" />
        </Frame>
        <Frame phone label="G. A code that cannot be made" caption="An imported code setting Psss cannot use (unknown type, broken key) stays in the list, says so in place of the account, and opens the login, where Replace code is.">
          <PhoneCodes variant="broken" />
        </Frame>
      </Frames>

      <Section title="2. Mac and iPad" />
      <div className="frames">
        <DeviceView
          label="H. Codes on every device"
          initial="mac"
          caption={{
            iphone: 'The Codes tab, as in B.',
            ipad: 'iPad regular width works like the Mac, with Codes in the segmented control and the sidebar. Compact width (Slide Over, narrow Split View) uses the iPhone tab bar. The Codes list, its copy button, countdown, sorting and copy are one shared view on all three.',
            mac: 'No tab bar on Mac: the segmented control above the list and the sidebar are the navigation, and both show Codes. The list shows live codes with the same copy button. Selecting a row shows the login beside it, as every other list does; ⌘C copies the selected row\'s code.',
          }}
          render={(d) => renderDevice(d, <PhoneCodes />, { side: 'codes' })}
        />
      </div>

      <Section title="3. What else could be a tab" />
      <div className="prose">
        <p>Apple's guidance: tabs are for top-level places a person moves between, never actions; three to five on iPhone; each one always visible and never empty without explanation. Each candidate against that:</p>
        <table className="cmp">
          <thead><tr><th>Candidate</th><th>Verdict</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>All</td><td>Tab</td><td>Everything in the vault, with today's pills. The home.</td></tr>
            <tr><td>Codes</td><td>Tab</td><td>A different job (copy a code in seconds) with a different row. Apple Passwords also gives codes their own place.</td></tr>
            <tr><td>Cards</td><td>Tab (added later, see <a href="#/cards-tab">Cards tab</a>)</td><td>A different job (four fields in a row at a checkout) with a different row. This page first rejected it as a pill; the owner approved the tab afterwards.</td></tr>
            <tr><td>Search</td><td>Tab (search role)</td><td>iOS 26 puts search as a separate button at the trailing end of the tab bar. It replaces today's floating search field, so the bottom of the screen does not carry two bars.</td></tr>
            <tr><td>Security (weak, reused, found in a breach)</td><td>Later, fourth or fifth tab</td><td>A real place with its own list and its own job. Not built: the on-device audit is under Later in the roadmap. Add the tab when the audit ships, not before; an empty or “coming soon” tab breaks the honesty rule.</td></tr>
            <tr><td>Passkeys, Notes</td><td>No, pills</td><td>Filters of the same list with the same rows. As tabs they would split search and duplicate the pills.</td></tr>
            <tr><td>Recent, Most used</td><td>No, pills</td><td>Already the default view of the All tab.</td></tr>
            <tr><td>Family / shared groups</td><td>No, pills</td><td>The approved sharing design keeps groups inside one vault, so a group is a filter of the same list. Revisit only if separate vaults become a thing a person switches between.</td></tr>
            <tr><td>Recently Deleted</td><td>No</td><td>Rare, and a recovery place. Stays at the end of the pills and in the sidebar.</td></tr>
            <tr><td>Setup</td><td>No</td><td>Settings, not a place in the vault. The gear stays top left on iPhone and beside the sidebar button on iPad; on Mac it is Psss › Settings… (⌘,).</td></tr>
            <tr><td>Add, Password generator</td><td>No</td><td>Actions. Apple's guidance rules out actions in a tab bar. Add stays labeled at the top; the generator lives in the editor.</td></tr>
          </tbody>
        </table>
      </div>

      <Section title="4. Decisions to approve" />
      <Decisions
        items={[
          {
            decision: <>A tab bar on iPhone with All, Codes, Cards and the search tab.</>,
            rejected: <>keeping only the Codes pill, and making its rows show codes.</>,
            why: <>The pill costs nothing to build but sits sixth in a row that scrolls, and a pill that changes what rows do is a surprise. A tab is one tap, in thumb reach, from anywhere.</>,
          },
          {
            decision: <>The tabs are called “All”, “Codes” and “Cards”.</>,
            rejected: <>“Vault” (drawn first), “Passwords”, “Items”, “Verification codes”, “2FA”.</>,
            why: <>“All” is plainer and does not suggest codes and cards are outside the vault; the vault holds cards and notes, so “Passwords” is not true. The All tab keeps an “All” pill (the owner's choice), so the word means everything in both places.</>,
          },
          {
            decision: <>Search is the iOS 26 search tab, and it shows the All screen with its pills: typing filters that list in place. Recent and Most used search the whole vault; a type pill narrows it. Results show a live code where there is one, so search also finds codes.</>,
            rejected: <>a bare results screen without pills (built first, 2026-11-23; the owner missed the old filter-in-place search); search that follows the tab it was opened from; a search field at the top of each tab; dropping the tab bar.</>,
            why: <>It keeps the old behaviour people liked, with Apple's search placement.</>,
          },
          {
            decision: <>The code itself is the copy button; the rest of the row opens the login.</>,
            rejected: <>the whole row copies with an info button to open the login; a separate “Copy” label beside the code.</>,
            why: <>A visible code in a tinted button reads as tappable, and a row that opens its item behaves like every other row in the app. A separate label does not fit beside a six-digit code on a phone. The line under the list says it once.</>,
          },
          {
            decision: <>One countdown for the list, under the title.</>,
            rejected: <>a ring on every row, as on the item page.</>,
            why: <>Thirty-second codes change together, so a dozen rings say the same thing. A row carries its own timing only when its period differs.</>,
          },
          {
            decision: <>Copy always copies the current code; the countdown line is short (“New codes in 18 s”) with an info button whose bubble says most sites also accept the code just before (see <a href="#/inline-help">inline help</a>).</>,
            rejected: <>copying the next code near the end; hiding the code near the end.</>,
            why: <>A code that is not valid yet fails everywhere; many sites still accept a code shortly after it changes. Saying when it changes, in a line that never changes size, lets the person choose without the list moving. RFC 6238 recommends allowing one earlier code for delay, so “most sites” and “usually” stay cautious.</>,
          },
          {
            decision: <>Order: recently copied (up to three), then all codes A to Z. No reordering while on screen.</>,
            rejected: <>by most used; A to Z only.</>,
            why: <>The code you want is usually the one you just used on another device, and a list that jumps under a thumb causes wrong copies.</>,
          },
          {
            decision: <>The “Codes” filter pill and sidebar filter are removed; Codes moves to the control above the list and the top of the Mac and iPad sidebar.</>,
            why: <>One way to reach it, named the same everywhere.</>,
          },
          {
            decision: <>The tab bar shrinks on scroll down; the pills scroll away with the list and come back at the top. The collapsed bar names the active filter, so context stays. Tapping the All tab again or the status bar returns to the top. While search is focused the pills stay, as today.</>,
            rejected: <>pills pinned under the navigation bar; pills moved into the tab bar's accessory area.</>,
            why: <>Apple's content filters scroll with their content, and the minimize behaviour exists to give a long list its height back.</>,
          },
        ]}
      />

      <Against>
        <li>Two type sizes inside the device. Tab labels are normally the smaller system tab-bar size; the mock keeps body size per the project rule. In the app, use the system tab bar as it is: it is a standard control, and the rule is about our own text.</li>
        <li>Codes shown in the clear in a list. Not against guidance, but a choice: anyone looking over a shoulder sees them. They are valid for seconds and useless without the password, and Apple Passwords shows them the same way.</li>
        <li>Otherwise none: a standard TabView with a search-role tab on iPhone, sidebar on iPad and Mac, labeled tabs, no actions in the bar.</li>
      </Against>

      <Section title="5. Open for the owner">
        <ul>
          <li>An “Add code” button in the Codes tab needs “which login?” first. It is item 2 in the deferred list of <code>docs/verification-codes.md</code>; leave it out of this change.</li>
          <li>A home-screen widget or Control Center control for codes is the next step after this for “copy without opening”. Out of scope here.</li>
        </ul>
      </Section>
    </Page>
  );
}
