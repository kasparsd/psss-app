import { Against, Approved, ChangeNote, Clarity, Decisions, Frame, Frames, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneCards } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function CardsTab() {
  return (
    <DeviceProvider>
      <Page
        title="Cards tab"
        status={<><Approved /> as drawn. Being built. Extends the approved <a href="#/tab-bar-and-codes">tab bar and Codes</a> page.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'The payment cards saved in their vault, each with the fields a checkout asks for.'],
            ['What must they give?', 'Nothing. Each field has its own copy icon, so number, expiry, security code and name can be copied one after another without opening the card.'],
            ['What can go wrong?', 'The card has expired; a field was never filled in; there are no cards yet.'],
            ['How do they leave?', 'Any other tab. Copying changes nothing; each copy leaves the clipboard after 60 seconds, as passwords do.'],
          ]}
          intro={<p>Before this tab, the same fields were only on the card's page: open the card, copy, go back, next card. The tab puts every card's fields on one screen.</p>}
        />
        <ChangeNote>
          The card fields now use the shared field row from <a href="#/copy-icons">Copy icons</a>: a copy icon instead of a labelled Copy button, the checkmark and the shared “Number copied” pill instead of an in-row “Copied”, and an eye after the dots. The tab is called “All, Codes, Cards” (not “Vault”). The Mac and iPad frame is the current Toolbar and Edit layout. Sample cards: Everyday Visa, Travel Mastercard (no security code), Business Amex, Old Visa (expired).
        </ChangeNote>

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. Cards tab" caption="Every card, its fields on screen, each with a copy icon. The number shows its last four digits and the security code shows dots; copying works without revealing them, and the eye shows a value when the person wants to read it. A field that was never filled in has no row (the Mastercard has no security code saved).">
            <PhoneCards />
          </Frame>
          <Frame phone label="B. Just copied" caption="The icon becomes a checkmark and the shared pill names what was copied, for about two seconds, with a haptic, the same as on the card's page. Copying counts as using the card, so it leads the list next time; the list never reorders while on screen.">
            <PhoneCards variant="copied" />
          </Frame>
          <Frame phone label="C. An expired card" caption="Expired cards drop to the end, folded to one row with no copy icons, so an old number is not pasted by mistake. The card's page still has everything.">
            <PhoneCards variant="expired" />
          </Frame>
          <Frame phone label="D. No cards yet" caption="“Add card” opens the editor for a new card. The tab is always present, like Codes.">
            <PhoneCards variant="empty" />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="E. Cards on every device"
            initial="mac"
            caption={{
              iphone: 'The iPhone tab, as in A.',
              ipad: 'iPad regular width matches the Mac. Compact width uses the iPhone tab bar with the Cards tab.',
              mac: 'Cards is chosen in the toolbar control or the sidebar, selected in both; the card\'s page sits beside the list, so every field is one click away already. The only changes are the name (“Credit cards” becomes “Cards”, as on iPhone) and the order: expired cards sort last.',
            }}
            render={(d) => renderDevice(d, <PhoneCards />, { side: 'cards' })}
          />
        </div>

        <Section title="3. Decisions to approve" />
        <Decisions
          items={[
            {
              decision: <>Cards becomes a third tab on iPhone: All, Codes, Cards, then search.</>,
              rejected: <>copy buttons inside the rows of the Cards pill; leaving it to the card's page.</>,
              why: <>A checkout asks for four fields in a row, and before this each card meant open, copy, back. A pill whose rows suddenly carry buttons would be a surprise, the reason Codes became a tab. Honest caveat: people pay less often than they enter codes, so this tab is used less than Codes.</>,
            },
            {
              decision: <>Each field is the shared field row, with a copy icon, as on the card's page.</>,
              rejected: <>a row of four small buttons per card; a labelled Copy on every row (superseded by the approved copy icons).</>,
              why: <>Rows fit a phone at body size, need no new pattern, and keep each field's value (masked) visible so the person knows which one they copy.</>,
            },
            {
              decision: <>Number and security code stay masked here until the eye is pressed, as on the card's page; copying never needs the eye. (Changed from the earlier draft, which had no Show on this screen: the eye is part of the shared row, so the screen stays consistent.)</>,
            },
            {
              decision: <>Order: last used first, expired cards last and folded with no copy icons.</>,
              why: <>Cards are few, and the one you used last is usually the one you want. An expired number pasted into a checkout only fails later.</>,
            },
            {
              decision: <>The Cards pill leaves the iPhone pill row, and “Credit cards” is called “Cards” everywhere.</>,
              why: <>One way to reach it, one name. Debit and gift cards are not credit cards.</>,
            },
            {
              decision: <>Mac and iPad at regular width are unchanged apart from the name and the order.</>,
              why: <>The list and the card's page are side by side there, so a new view would add nothing.</>,
            },
            {
              decision: <>The security code row appears once cards can store one. It is a protected field in the card fields in items (KeePass-compatible) and has shipped; a card without one simply has no row.</>,
            },
            {
              decision: <>Tab count: three plus search now. A future Security tab would make five, Apple's limit on iPhone; when the audit ships, decide whether it is a tab or a section in All.</>,
              why: <>Keeps room without promising it.</>,
            },
          ]}
        />
        <Against>
          <li>None. A standard tab with grouped rows. Three content tabs plus search is within Apple's three to five.</li>
        </Against>
      </Page>
    </DeviceProvider>
  );
}
