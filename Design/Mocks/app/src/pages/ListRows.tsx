import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneAll, PhoneCodes, PhoneSearch } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function ListRows() {
  return (
    <DeviceProvider>
      <Page
        title="List rows"
        status={<><Approved on="2026-11-24" /> As drawn, with the three open points settled as drawn (the notes glyph leaves the rows). One change was made before approval (lines between rows on every platform, Mac included) and one after (iPhone lists are plain, like the Mac). The card row is on <a href="#/cards-tab">Cards tab</a>; what the lists show, their order and the Recently used group are on <a href="#/filter-and-sort">Filter and sort</a>.</>}
      >
        <Clarity
          intro={<p>One row draws every item in All, in Codes, in search results and in Cards. What a person must know on these screens:</p>}
          items={[
            ['Which thing?', 'An item of their vault. A row names it and says what it is; its trailing end shows the one thing you scan that list for: what a login has, a live code, a card\'s last four digits and expiry.'],
            ['What must they give?', 'A tap on the row opens the item. In Codes the code button copies instead.'],
            ['What can go wrong?', 'They do not know what a glyph means (each has a spoken label, a tooltip on Mac and a filter or a list of the same name). Two rows run together in a long list (a line separates them).'],
            ['How do they leave?', 'Back, or any other place. Looking at a list changes nothing.'],
          ]}
        />

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. All tab" caption="The rows sit directly on the screen, with a thin line between them that starts where the text starts. What a login has is at the trailing end, before the chevron: a filled glyph for a passkey and one for a verification code, each in its own column so they line up down the list. They are grey, not blue: they tell you something, they are not buttons. The notes have no glyph. A card shows its last four digits over its expiry.">
            <PhoneAll sort="name" />
          </Frame>
          <Frame phone label="B. Codes" caption="The code in a row is written the same way as on the login's page: digits of one width, medium weight, the two halves a narrow gap apart instead of a full space. It stays a tinted button at body size, because here it is what you tap. No glyph for the code: the code itself is in the row.">
            <PhoneCodes />
          </Frame>
          <Frame phone label="C. A search result" caption="A result that has a code shows it live as its button, so the code glyph is left out there; the passkey glyph stays. How search works is on the Places page.">
            <PhoneSearch />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="D. All"
            initial="mac"
            caption={{
              iphone: 'The iPhone tab, as in A.',
              ipad: 'iPad at regular width matches the Mac. At compact width it is the iPhone layout.',
              mac: 'The same rows with a line between them as on iPhone, none beside the selected row. Each glyph has a tooltip on hover. The selected row is the accent colour and the glyphs turn white.',
            }}
            render={(d) => renderDevice(d, <PhoneAll sort="name" />, { side: 'all', sel: 1, sort: 'name' })}
          />
          <DeviceView
            label="E. Codes"
            initial="mac"
            caption={{
              iphone: 'As in B.',
              ipad: 'As on the Mac.',
              mac: 'The code button and the code on the login\'s page are written the same way.',
            }}
            render={(d) => renderDevice(d, <PhoneCodes />, { side: 'codes', sel: 1 })}
          />
        </div>

        <Section title="3. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. Lines.</strong> Every item list, on iPhone, iPad and Mac, has a thin line between two rows of the same group, starting where the text starts (not under the icon). No line under the last row of a group or before a heading (“Expired”, “All codes”), and none beside the selected row on Mac and iPad. The rows sit directly on the screen on iPhone too, as on Mac: no card behind them and no extra inset at the sides. An item page keeps its cards.</>,
              rejected: <>no lines at all on Mac; a card behind the rows on iPhone.</>,
              why: <>Rows here have two lines of text, so without a rule the second line of one row and the name of the next run together in a long list. It is the system default for a list and what Apple's Passwords does on every device.</>,
            },
            {
              decision: <><strong>2. What a login has, at the trailing end.</strong> Filled glyphs for a passkey and a verification code, in fixed columns at the trailing end of the row (before the chevron on iPhone), grey, each with a spoken label and a tooltip on Mac. The glyph for notes is not in rows. In a result that shows the live code, the code glyph is left out.</>,
              rejected: <>the system accent colour for the glyphs (blue reads as a button); a tinted tile behind each glyph (competes with the item's own icon); a third column for notes (nobody picks a login by it).</>,
              why: <>After the name they read as part of the text and never lined up. A passkey glyph has a filter of the same name (With: Passkey in the Filter menu); the code glyph points to the Codes list.</>,
            },
            {
              decision: <><strong>3. One way to write a code.</strong> Digits of one width, medium weight, the halves a narrow gap apart (about a quarter of a digit, by spacing, not a space character). In list rows it is body size inside the tinted button; on the login's page it is the title size, the size of the item's name, in the primary colour.</>,
              rejected: <>the full space between the halves; the large-title size on the login's page (a third text size on that screen).</>,
              why: <>The same code should look like the same thing in both places. Copying and VoiceOver are unchanged: the copied and spoken value has no gap.</>,
            },
          ]}
        />

        <Against>
          <li><strong>Glyphs without words in list rows.</strong> Status symbols in a row are standard (Mail, Passwords); each has a spoken label, a tooltip on Mac and a filter or list with its name.</li>
        </Against>

        <History
          entries={[
            { date: '2026-11-24', text: <>iPhone lists became plain like the Mac: no card behind the rows and no extra inset at the sides. The owner extended the lines decision after approving it. Before, iPhone rows sat in a rounded card.</> },
            { date: '2026-11-24', text: <>Lines between rows on every platform, Mac included. The owner changed this before approving; the first drawing had no lines on the Mac. The line under the last card on Cards had been left over from when every row had one.</> },
            { date: '2026-11-24', text: <>Glyphs moved from after the name to the trailing end, in fixed columns, filled, a little larger and grey. After the name they read as part of the text and never lined up. The notes glyph left the rows (a third column for something nobody picks a login by). The accent colour and a tinted tile were rejected. The owner approved it as drawn.</> },
            { date: '2026-11-24', text: <>One way to write a code: the halves a narrow gap apart in digits of one width. Before, the list showed a full space and the login's page drew the code at the large-title size, a third text size on that screen. The owner approved the change.</> },
            { date: '2026-11-24', text: <>The With code filter was drawn beside the glyph for a code and then dropped the same day, because Codes is that list. The notes glyph's filter, With notes, stayed (see <a href="#/filter-and-sort">Filter and sort</a>).</> },
            { date: '2026-11-23', text: <>One row for All, Codes and Cards, because the owner found the three lists looked unrelated: the item icon, the name over one secondary line, and an optional accessory at the trailing end. The earlier rule that the name and a short account sit side by side was dropped; the name is always over the account.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
