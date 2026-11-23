import { Against, Approved, ChangeNote, Clarity, Decisions, Frame, Frames, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneCards, PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function CardsTab() {
  return (
    <DeviceProvider>
      <Page
        title="Cards tab"
        status={<><Approved /> (revised: rows that open the card's page). Not built yet; the earlier version (every card's fields on the tab) was approved and built. Extends the approved <a href="#/tab-bar-and-codes">tab bar and Codes</a> page.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'The payment cards saved in their vault. One row per card: its name, then the brand, last four digits and expiry.'],
            ['What must they give?', 'One tap on the card. Its page has a copy icon on every field (number, expiry, security code, name), so a checkout is: open the card, copy, copy, copy, back.'],
            ['What can go wrong?', 'The card has expired; a field was never filled in; there are no cards yet.'],
            ['How do they leave?', 'Back to the list, or any other tab. Copying changes nothing; each copy leaves the clipboard after 60 seconds, as passwords do.'],
          ]}
          intro={<p>The approved tab put every card's fields on one screen. With more than two cards that is a long scroll to find the right one, and the second line (“Visa ending 4417”) repeated the masked number below it. The list now only helps you find the card; the card's page does the copying, as on Mac and iPad.</p>}
        />
        <ChangeNote title="Changed from the approved version.">
          No field rows on the tab, no copy icons in the list, and the second line is “Visa •• 4417 · 08/28” (brand, last four, expiry) instead of “Visa ending 4417”. Expanding a card in place was considered and not drawn (see decisions). The Mac and iPad list uses the same row. Sample cards: Everyday Visa, Travel Mastercard (no security code), Business Amex, Old Visa (expired).
        </ChangeNote>

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. Cards tab" caption="One row per card, last used first. The second line is what you scan for: brand, last four digits, expiry. The whole row opens the card; there is no second tap target in it.">
            <PhoneCards />
          </Frame>
          <Frame phone label="B. The card's page" caption="Opened from the Cards tab, so Back says “Cards” and the Cards tab stays selected. Every field has its copy icon; number and security code stay masked until the eye.">
            <PhoneItem id={6} from="cards" />
          </Frame>
          <Frame phone label="C. Just copied" caption="Copying the number: the checkmark and the shared “Number copied” pill, for about two seconds, with a haptic. Copying counts as using the card, so it leads the list next time; the list never reorders while on screen.">
            <PhoneItem id={6} from="cards" copied="Number" pill="Number copied" />
          </Frame>
          <Frame phone label="D. An expired card" caption="Expired cards sort last under “Expired”, the second line says when it expired. Its page still has everything, to update or delete it.">
            <PhoneCards variant="expired" />
          </Frame>
          <Frame phone label="E. No cards yet" caption="“Add card” opens the editor for a new card. The tab is always present, like Codes.">
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
              mac: 'The same rows in the list column, with the card\'s page beside it. Only the second line changes, so the list reads the same on every device.',
            }}
            render={(d) => renderDevice(d, <PhoneCards />, { side: 'cards', sel: 6 })}
          />
        </div>

        <Section title="3. Decisions to approve" />
        <Decisions
          items={[
            {
              decision: <>The Cards tab lists one row per card; tapping a row opens the card's page, where every field has a copy icon.</>,
              rejected: <>every card's fields on the tab (the approved version); a card that expands in place, with a separate tap target for its page.</>,
              why: <>Rows are easy to scan and behave like All and Codes, and like Cards on Mac and iPad. The card's page already copies every field, so a checkout costs one extra tap, not one per field. Expanding in place would add a third way rows behave on iPhone and two tap targets in one row, which people hit by mistake and cannot tell apart.</>,
            },
            {
              decision: <>The second line is brand, last four digits and expiry: “Visa •• 4417 · 08/28”. Expired cards say “Expired 03/25”.</>,
              rejected: <>“Visa ending 4417” (repeats the masked number, says nothing about expiry).</>,
              why: <>These are what you check at a checkout to pick the right card, and none of them is secret enough to hide in a list.</>,
            },
            {
              decision: <>Order: last used first, expired cards last under “Expired”.</>,
              why: <>Cards are few, and the one you used last is usually the one you want. An expired number pasted into a checkout only fails later.</>,
            },
            {
              decision: <>The same row on iPhone, iPad and Mac (shared view).</>,
            },
            {
              decision: <>Unchanged from the approved version: Cards is a tab on iPhone (All, Codes, Cards, then search), the Cards pill is gone, “Credit cards” is called “Cards” everywhere, and the security code is an optional protected field.</>,
            },
          ]}
        />
        <Against>
          <li>None. A standard list with rows that push a detail page.</li>
        </Against>
      </Page>
    </DeviceProvider>
  );
}
