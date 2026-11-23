import { Against, Approved, ChangeNote, Clarity, Decisions, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneAll, PhoneCards, PhoneCodes } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function TabsOnMacAndIpad() {
  return (
    <DeviceProvider>
      <Page
        title="Tabs on Mac and iPad"
        status={
          <>
            <Approved /> as drawn. Redrawn 2026-11-23 to the owner's later decisions: iPad works like the Mac, the sidebar is always visible and lists Codes and Cards, the first tab is “All” (not “Vault”), and the first item opens by itself. Redrawn again 2026-11-23 to the <a href="#/toolbar-and-edit">toolbar and Edit prototype</a>, modelled on Apple's Passwords: the toolbar follows the columns, All / Codes / Cards and + Add sit above the list, and Edit sits above the open item. The places and sidebar stay as approved. Changes the Mac and iPad part of the approved <a href="#/tab-bar-and-codes">tab bar and Codes</a> and <a href="#/cards-tab">Cards</a> pages.
          </>
        }
      >
        <Clarity
          items={[
            ['Which thing?', 'The same three places on every device: All (everything in the vault), Codes, Cards. Only the control differs: a tab bar at the bottom on iPhone; on iPad and Mac a segmented control at the top of the list column, kept in step with the sidebar.'],
            ['What must they give?', 'One click or tap. On Mac also ⌘1, ⌘2 and ⌘3, listed in the View menu.'],
            ['How do they leave?', 'Pick another place. Search in the toolbar always searches the whole vault, from any of the three.'],
          ]}
        />
        <ChangeNote>
          Built from the shared components, so it follows the current decisions: every field on an item page ends with a copy icon, hidden values show eight dots and an eye, and the sidebar lists Recent, Most used, All, Codes, Cards, Logins, Secure notes, Custom items, Recently Deleted and the Filters (Passkeys, With notes). Every Mac and iPad frame is clickable. iPhone pills no longer include Codes or Cards: they are tabs.
        </ChangeNote>
        <p className="prose muted">Each view has its own switch to compare devices; the switch below sets all of them at once.</p>
        <PageDeviceSwitch />

        <Section title="1. All" />
        <div className="frames">
          <DeviceView
            label="All"
            initial="mac"
            caption={{
              iphone: 'The list, pills, Setup and Add stay as they are. The floating search field becomes the search tab at the trailing end, as iOS 26 draws it. The “Codes” and “Cards” pills are gone: they are tabs now.',
              ipad: 'iPad works exactly like the Mac: the same control, sidebar and toolbars, plus a Setup gear beside the sidebar button because the iPad has no app menu.',
              mac: 'All is chosen, with Recent in the sidebar. The toolbar above each column holds that column\'s controls: + Add over the list, Edit and search over the item. The first item opens by itself, its icon centred above its name.',
            }}
            render={(d) => renderDevice(d, <PhoneAll />, { side: 'recent' })}
          />
        </div>

        <Section title="2. Codes" />
        <div className="frames">
          <DeviceView
            label="Codes"
            initial="mac"
            caption={{
              iphone: 'Every login with a code, live. One countdown for the whole list, since 30-second codes all change together. The code is the button; the rest of the row opens the login. Copying a code counts as using the login, so it moves to the top.',
              ipad: 'Codes on iPad. At compact width (Slide Over, narrow Split View) the iPhone tab bar at the bottom takes over.',
              mac: 'Codes chosen in the control and the sidebar. The sidebar stays visible in every place; the person can still hide it with its button. The first code\'s login opens beside the list.',
            }}
            render={(d) => renderDevice(d, <PhoneCodes />, { side: 'codes' })}
          />
        </div>

        <Section title="3. Cards" />
        <div className="frames">
          <DeviceView
            label="Cards"
            initial="mac"
            caption={{
              iphone: 'Every card, its fields on screen, each with a copy icon. The number shows its last four digits and the security code shows dots; copying works without revealing them. A field that was never filled in has no row (the Mastercard has no security code saved).',
              ipad: 'iPad shows Cards the same way as the Mac, with the Setup gear beside the sidebar button.',
              mac: 'Cards works the same way: chosen in both, the first card open beside the list. Expired cards sort last.',
            }}
            render={(d) => renderDevice(d, <PhoneCards />, { side: 'cards' })}
          />
        </div>

        <Section title="4. Decisions to approve" />
        <Decisions
          items={[
            {
              decision: <>The same three places everywhere: All, Codes, Cards. iPhone: tab bar at the bottom. iPad and Mac: a segmented control in the toolbar above the list, beside + Add, with ⌘1 to ⌘3 in the View menu on Mac; the always-visible sidebar lists Codes and Cards too and shows the same selection.</>,
              rejected: <>Passwords-style tiles in the sidebar (owner: keep our tabs at the top); native window tabs.</>,
              why: <>One model to learn, each platform's own control.</>,
            },
            {
              decision: <>The toolbar follows the columns, as in Passwords. Over the sidebar: the sidebar button (iPad also the Setup gear; Mac has Psss › Settings… ⌘,). Over the list: All / Codes / Cards and + Add with its label; the list's title and count are its first line. Over the item: a labelled <strong>Edit</strong>, then search (“Search all items”). While editing, Cancel and Save take Edit's place and a red “Delete Item” sits at the bottom of the form (Mac also Edit › Delete ⌘⌫). The item's card starts with its icon centred above its name. No “⋯” menus.</>,
              rejected: <>one toolbar across the window with All / Codes / Cards centred; Edit floating at the bottom right (an iPhone pattern); a “⋯” menu for Delete (a symbol nobody reads).</>,
              why: <>Each control sits above what it changes, and Edit is where people who use Passwords already look. iPhone keeps Edit at the top right of its item page.</>,
            },
            {
              decision: <>The detail pane is never empty: the first item opens by itself when a list appears, a place or filter changes or the open item is deleted; the person's own choice per place is restored. Opening an item this way does not count as using it.</>,
              rejected: <>hiding the pane until something is selected. Showing and hiding it would make the list jump under the pointer, and SwiftUI's split view keeps its detail column.</>,
            },
            { decision: <>Toolbar search stays and searches the whole vault from any place, with live codes in results, as approved.</> },
          ]}
        />

        <Against>
          <li>Mac and iPad: none in the structure. Per-column toolbars and a labelled Edit are what Apple's Passwords does; a segmented control for switching views is an accepted Mac pattern (Calendar). The labelled “+ Add” departs from the compact toolbar convention, by the app's rule that important actions carry words.</li>
        </Against>
      </Page>
    </DeviceProvider>
  );
}
