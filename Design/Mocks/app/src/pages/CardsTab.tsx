import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneCards, PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function CardsTab() {
  return (
    <DeviceProvider>
      <Page
        title="Cards tab"
        status={<><Approved on="2026-11-24" /> The Cards tab with rows that open the card's page was approved on 2026-11-23; the card row and the Recently used group were approved on 2026-11-24. The tab bar and the sidebar are on <a href="#/places">Places</a>; the item page and how a field copies are on <a href="#/item-page">Item page, Edit and toolbar</a> and <a href="#/copy-icons">Copying a field</a>.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'The payment cards saved in their vault. One row per card: its name over the brand, then the last four digits over the expiry at the trailing end.'],
            ['What must they give?', 'One tap on the card. Its page has a copy icon on every field (card number, expiry, security code, name on card), and a tap anywhere on a field copies it, so a checkout is: open the card, copy, copy, copy, back.'],
            ['What can go wrong?', 'The card has expired; a field was never filled in; there are no cards yet.'],
            ['How do they leave?', 'Back to the list, or any other tab. Copying changes nothing; each copy leaves the clipboard after 60 seconds, as passwords do.'],
          ]}
          intro={<p>The list only helps you find the card; the card's page does the copying, on iPhone, iPad and Mac alike. With more than two cards, every card's fields on one screen would be a long scroll to find the right one.</p>}
        />

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. Cards tab" caption="One row per card. With more than five cards a “Recently used” group leads (up to five, used in the last 30 days), then “All cards” A to Z. The name sits over the brand; the last four digits sit over the expiry, right-aligned in digits of one width, so both read down the list as columns. The whole row opens the card; there is no second tap target in it.">
            <PhoneCards />
          </Frame>
          <Frame phone label="B. The card's page" caption="Opened from the Cards tab, so Back returns to Cards and the Cards tab stays selected. Every field has its copy icon and copies when tapped; card number and security code stay hidden behind eight dots until the eye.">
            <PhoneItem id={6} from="cards" />
          </Frame>
          <Frame phone label="C. Just copied" caption="Copying the card number: the checkmark and the shared “Card number copied” pill, for about two seconds, with a haptic. Copying counts as using the card, so it can be in the group next time; the list never reorders while on screen.">
            <PhoneItem id={6} from="cards" copied="Card number" pill="Card number copied" />
          </Frame>
          <Frame phone label="D. An expired card, and a short list" caption="Expired cards come last under “Expired”, and the second line says “Visa · Expired”. This vault has three live cards, so there is no group and no “All cards” heading: a group above five rows or fewer would only repeat them. The card's page still has everything, to update it or move it to Recently Deleted.">
            <PhoneCards variant="short" />
          </Frame>
          <Frame phone label="E. No cards yet" caption="“Add card” opens the sheet for a new card. The tab is always present, like Codes.">
            <PhoneCards variant="empty" />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="F. Cards on every device"
            initial="mac"
            caption={{
              iphone: 'The iPhone tab, as in A.',
              ipad: 'iPad regular width matches the Mac. Compact width uses the iPhone tab bar with the Cards tab.',
              mac: 'Cards chosen in the sidebar; the same rows and the same group in the list column, with the card\'s page beside it. Expired cards come last. No Sort or Filter button: Cards keeps its own order. A card in the group and in “All cards” is selected once, in the group.',
            }}
            render={(d) => renderDevice(d, <PhoneCards />, { side: 'cards', sel: 6 })}
          />
        </div>

        <Section title="3. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. The Cards tab lists one row per card;</strong> tapping a row opens the card's page, where every field has a copy icon.</>,
              rejected: <>every card's fields on the tab (the first version); a card that expands in place, with a separate tap target for its page.</>,
              why: <>Rows are easy to scan and behave like All and Codes, and like Cards on Mac and iPad. The card's page already copies every field, so a checkout costs one extra tap, not one per field. Expanding in place would add a third way rows behave on iPhone and two tap targets in one row, which people hit by mistake and cannot tell apart.</>,
            },
            {
              decision: <><strong>2. The row:</strong> the name over the short brand (“Visa”; “Visa · Expired” once expired; “Card” when the brand is unknown). A card saved without a name is called by its brand and last four digits; at the trailing end, right-aligned in digits of one width, “•• 4417” over “08/28”. A missing part drops out. The same row is used in Cards, in All and in search.</>,
              rejected: <>“Visa ending 4417” (repeats the masked number, says nothing about expiry); “Visa •• 4417 · 08/28” in the second line (too wide beside a name on iPhone).</>,
              why: <>The brand, the last four digits and the expiry are what you check at a checkout to pick the right card, and none of them is secret enough to hide in a list. Two short right-aligned columns are what the eye runs down.</>,
            },
            {
              decision: <><strong>3. Order: “Recently used”, then “All cards” A to Z, then “Expired” last.</strong> The group holds up to five cards used in the last 30 days, most recently used first, and each is also in “All cards”. With five live cards or fewer there is no group and no “All cards” heading. Nothing moves while the list is on screen. Opening a card does not count as using it; a copy on its page does.</>,
              rejected: <>last used first (the previous order); everything used in the last 30 days (for a daily user that is most of the vault, and it pushes the list off the screen); a group under every order.</>,
              why: <>Cards are few, and one you used lately is usually the one you want. An expired number pasted into a checkout only fails later, so expired cards go last.</>,
            },
            {
              decision: <><strong>4. Cards is a place, not a filter:</strong> a tab on iPhone, a sidebar row on Mac and iPad, never in the Filter menu. “Credit cards” is called “Cards” everywhere (debit and gift cards are not credit cards). The security code is an optional protected field. + Add stays over the list.</>,
              why: <>Cards are looked up at a checkout, often in a hurry: one tap to the tab and one to the card is faster than finding them among every item.</>,
            },
          ]}
        />
        <Against>
          <li>None. A standard list with rows that push a detail page.</li>
        </Against>

        <History
          entries={[
            { date: '2026-11-24', text: <>The card's first field is labelled “Card number” (the pill says “Card number copied”), and a card can be saved without a name; it is then called by its brand and last four digits. Both follow the item page decisions the owner approved (see <a href="#/item-page">Item page, Edit and toolbar</a>). Before, the label was “Number” and a card needed a name.</> },
            { date: '2026-11-24', text: <>A “Recently used” group now leads the Cards tab, then “All cards” A to Z, then “Expired”. It replaces “last used first”. The owner decided it for All, Codes and Cards together; it holds up to five items used in the last 30 days and is left out when the list has five or fewer.</> },
            { date: '2026-11-24', text: <>The card row changed: the last four digits and the expiry moved to the trailing end, one over the other, and the second line keeps only the brand (“Visa · Expired” when expired). It replaced “Visa •• 4417 · 08/28” in the second line, which is too wide beside a name on iPhone. The owner approved it as drawn.</> },
            { date: '2026-11-24', text: <>Cards stays a tab and a sidebar row. The first drawing of the filter menu had put Codes and Cards in the menu with no tab bar; the owner kept the tabs.</> },
            { date: '2026-11-23', text: <>Revised the same day: rows that open the card's page replaced the first version, where every card's fields were on the tab with a copy icon each. With more than two cards that was a long scroll, and the second line “Visa ending 4417” repeated the masked number below it. The second line became “Visa •• 4417 · 08/28” (itself replaced on 2026-11-24). Expanding a card in place was considered and not drawn. The owner approved the revision.</> },
            { date: '2026-11-23', text: <>Cards became a third iPhone tab, between Codes and search. It had been rejected as a pill on the tab bar page; the owner approved the tab afterwards. The Cards pill left the pill row, “Credit cards” became “Cards”, and the security code became an optional protected field. The first version showed every card's fields on one screen, masked, with copy icons.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
