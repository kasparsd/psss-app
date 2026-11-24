import { useState } from 'react';
import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceSwitcher, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import type { Device } from '../components/devices';
import { PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function ItemPage() {
  const [device, setDevice] = useState<Device>('mac');
  const [empty, setEmpty] = useState(false);
  return (
    <DeviceProvider>
      <Page
        title="Item page, Edit and toolbar"
        status={<><Approved on="2026-11-24" /> The toolbar per column on Mac and iPad, Edit and Delete Item were approved on 2026-11-23, modelled on Apple's Passwords; the icon and name above the card, Edit in place and the groups were approved on 2026-11-24, and the owner changed the verification code group on the same day. How a field copies is on <a href="#/copy-icons">Copying a field</a>.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'One item of the vault: a login, a card, a secure note or a custom item. The page opens with its icon and name, then its values in groups.'],
            ['What must they give?', 'Nothing to read it. To change it, one labelled Edit; Save or Cancel to finish. Delete Item is at the bottom of the fields, saying where the item goes.'],
            ['What can go wrong?', 'They change something by accident (Edit is explicit and the rest of the window is dimmed while it is on); they delete something (it goes to Recently Deleted for 30 days, with Undo); they leave half an edit (Cancel after a change asks “Discard Changes?”).'],
            ['How do they leave?', 'Back on iPhone, or choose another item on Mac and iPad. Nothing is saved until Save.'],
          ]}
        />

        <Section title="1. The item page" />
        <Frames>
          <Frame phone label="A. A login on iPhone" caption="The icon and name stand above the card, on the page itself, centred. Then one card per group: the username and password (with the clipboard note under it); everything about the verification code under the heading “Verification code” (the code at the size of the item's name, its setup key, Copy Setup Link and Show QR Code, with a warning below); the website and notes; the passkey. A heading above and a note below belong to one card, so it is clear what the warning is about.">
            <PhoneItem id={1} whole />
          </Frame>
          <Frame phone label="B. A password shown" caption="A secret that is shown in the clear is written in the monospaced system face at body size, so that 1, l and I, and 0 and O, can be told apart. This password has all of them. The eight dots are unchanged, and the username, website, notes and names stay in the normal face.">
            <PhoneItem id={1} whole shown={['Password']} />
          </Frame>
          <Frame phone label="C. A card" caption="The same page for a card: the values you copy at a checkout in one group (number, expiry, security code, name on card). Rows with nothing to copy have no copy icon, and a field that was never filled in has no row (the Mastercard has no security code saved).">
            <PhoneItem id={7} whole />
          </Frame>
        </Frames>
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="D. The same page on Mac and iPad"
            initial="mac"
            caption={{
              iphone: 'As in A.',
              ipad: 'As on the Mac.',
              mac: 'The item column draws the same groups. The first item opens by itself, its icon centred above its name.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} whole />, { side: 'all', sel: 1 })}
          />
        </div>

        <Section title="2. Edit changes the page in place" />
        <div className="frames">
          <Frame phone label="E. Editing a login on iPhone" caption="Edit turns the page you were reading into fields, in the same place and order. Cancel and Save take the place of Back and Edit, and the tab bar is hidden until one of them is tapped. The code's action sits on the right of its field on the same line (“Replace code” once a code is set); “Remove code”, being destructive, is on its own row below. Delete Item closes the form. Nothing slides up over the page.">
            <PhoneItem id={1} mode="edit" />
          </Frame>
          <Frame phone label="F. A login without a code" caption="“Add code” sits on the right of the setup key field. Press it and it becomes “Replace code”, with “Remove code” below.">
            <PhoneItem id={2} mode="edit" />
          </Frame>
          <DeviceView
            label="G. Editing in place on Mac and iPad"
            initial="mac"
            caption={{
              iphone: 'As in E.',
              ipad: 'As on the Mac.',
              mac: 'The item column turns into the editor; Cancel and Save take the place of Edit. The sidebar, the list and search are dimmed and do not react until Save or Cancel, so a half-edited login cannot be left by accident. The icon and name stay above the card.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} mode="edit" />, { side: 'all', sel: 1, editing: true })}
          />
        </div>

        <Section title="3. Clickable prototype (Mac and iPad)" />
        <div className="prose">
          <p>The same window, working. Click the sidebar rows, the items, Edit (and Delete Item inside it), Set Up Code…, the sidebar button, search, the copy icons, the eye, Sort and Filter. Switching device restarts it.</p>
        </div>
        <div className="ctl">
          <span>Device <DeviceSwitcher label="Device" value={device} options={['mac', 'ipad']} onChange={setDevice} /></span>
          <label><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Empty list</label>
        </div>
        <div className="stagebox" style={{ maxWidth: 1000 }}>
          {renderDevice(device, null, { side: 'all' }, { menuBar: true, empty })}
        </div>
        <p className="prose muted">Mac: click “Psss” in the menu bar to see Settings. iPad: the Setup gear sits beside the sidebar button. Northbank has no code, so its page shows “Set Up Code…”.</p>

        <Section title="4. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. The icon and name stand above the card,</strong> on the page itself, centred, on every device. The cards below hold only the fields.</>,
              rejected: <>the icon and name as the first row inside the card (how the mocks drew it from the toolbar and Edit page until 2026-11-24).</>,
              why: <>It reads as who the item is, apart from what it holds.</>,
            },
            {
              decision: <><strong>2. Secrets shown in the clear are monospaced.</strong> A revealed password, card number, security code, setup key or custom item value on the item page, and the same fields while typing, in edit mode and in the new-item sheet, are written in the monospaced system face (the face of the verification code digits) at body size, never a third size. The eight hidden dots are unchanged. Usernames, websites, notes and names keep the normal face.</>,
              rejected: <>the normal face, where l, 1 and I look the same, and so do 0 and O.</>,
              why: <>A person who has to read a password out or type it on another device must be able to tell the characters apart.</>,
            },
            {
              decision: <><strong>3. The item page keeps its cards, and a card is a group.</strong> Lists are plain; an item page is a form. Groups, in this order: the values you copy to sign in or pay (username, password; for a card: number, expiry, security code, name); the verification code with everything that belongs to it (the code, setup key, Copy Setup Link, Show QR Code; or “None” with Set Up Code…) under the heading “Verification code”; website and notes; passkey. A group may have a heading above and one note below. The clipboard note sits under the first group.</>,
              rejected: <>plain rows on the item page, compared with the cards on 2026-11-24 (the headings still separate the groups, but the notes under a group float between two sets of rows, the buttons have no container and the first group runs straight on from the icon and name); one card for every field with the website and notes inside it.</>,
              why: <>A list is many of the same thing, where a card behind the rows adds nothing. An item page is a few different things, and the card is what says which rows, heading and warning belong together. It also shows the area that copies when tapped. This is the grouped form Apple uses for a detail page (Passwords, Contacts, Settings).</>,
            },
            {
              decision: <><strong>4. Edit changes the page in place.</strong> Edit turns the open item's rows into fields where they are. Cancel and Save replace Edit (and Back on iPhone). Until one of them is chosen the rest of the window is dimmed and does not react, and iPhone hides the tab bar. Cancel after a change asks “Discard Changes?”. Adding a new item still opens a sheet.</>,
              rejected: <>the sheet that slides over the item; fields that are always editable, as in Notes (a password could be changed by a stray keystroke, and a tap on a row copies it).</>,
              why: <>This is what Apple's Passwords and Contacts do: an explicit Edit that changes the page you are on. A sheet is Apple's pattern for making something new, which is why Add keeps it.</>,
            },
            {
              decision: <><strong>5. Delete Item</strong> is a red button at the bottom of the fields, with “Moves this item to Recently Deleted. You can bring it back for 30 days.” It asks nothing more; Undo follows for 10 seconds. There is no Delete button in any toolbar. Mac also has Edit › Delete (⌘⌫).</>,
              why: <>As in Passwords. Delete is one deliberate step away and never beside Edit.</>,
            },
            {
              decision: <><strong>6. Editor actions sit on the field they act on.</strong> “Add code” (“Replace code” once a code is set) is on the right of the setup key field, on the same line; “Remove code”, being destructive, is on its own row below. A login without a code shows “None” with a labelled Set Up Code… button under it, which opens the editor at the code step.</>,
              why: <>One place to look for a field's action, and rows that line up on both edges.</>,
            },
            {
              decision: <><strong>7. The toolbar follows the columns,</strong> as in Passwords. Over the sidebar: the sidebar button (iPad also the Setup gear; Mac has Psss › Settings… ⌘,). Over the list: Sort, Filter and + Add with its label; the list's title and count are the first line of the list. Over the item: a labelled <strong>Edit</strong>, then search (“Search all items”). While editing, Cancel and Save take Edit's place. In Recently Deleted the item column offers a labelled Restore. No “⋯” menus.</>,
              rejected: <>one toolbar across the window; Edit floating at the bottom right (an iPhone pattern); a “⋯” menu for Delete (a symbol nobody reads); an All / Codes / Cards control over the list (see <a href="#/places">Places</a>).</>,
              why: <>Each control sits above what it changes, and Edit is where people who use Passwords already look. iPhone keeps Edit at the top right of its item page.</>,
            },
            {
              decision: <><strong>8. The item column is never empty.</strong> The first item opens by itself when a list appears, a place or filter changes or the open item is deleted; the person's own choice per place is restored. Opening an item this way does not count as using it. Only an empty list shows “No item open”, and Edit disappears.</>,
              rejected: <>hiding the column until something is selected (showing and hiding it would make the list jump under the pointer).</>,
            },
            {
              decision: <><strong>9. Search is in the toolbar over the item column</strong> and searches the whole vault from any place, with live codes in the results and no scope bar. Return opens the top result.</>,
              rejected: <>searching only the selected place, as Passwords does.</>,
              why: <>One search that always finds everything, so a missing result never comes from a hidden scope.</>,
            },
          ]}
        />

        <Against>
          <li>None in the structure: per-column toolbars, a labelled Edit and an Edit that changes the page in place are what Apple's Passwords does.</li>
          <li><strong>Where Psss differs from Passwords, on purpose:</strong> a copy icon is visible on every field, and a tap copies at once (Passwords hides copying behind a click on the value); the first item opens by itself (Passwords shows “No Item Selected”); search covers the whole vault (Passwords searches the selected place); + Add has a label (Passwords uses a bare +). The labelled + Add departs from the compact toolbar convention, by the app's rule that important actions carry words.</li>
        </Against>

        <History
          entries={[
            { date: '2026-11-24', text: <>Secrets shown in the clear became monospaced, at body size: revealed values on the item page and the same fields in the editor and the new-item sheet. In the normal face, l, 1 and I look the same, and so do 0 and O. The owner decided it; the eight hidden dots did not change.</> },
            { date: '2026-11-24', text: <>The verification code and everything about it became one group under the heading “Verification code”: the code, the setup key, Copy Setup Link, Show QR Code and the warning, as the second card on a login's page after the username and password, then website and notes, then passkey. The owner changed decision 3 this way after approving cards as groups. Before, the code sat in the first card with its setup lower down.</> },
            { date: '2026-11-24', text: <>The item page keeps its cards, one per group. Plain rows were drawn beside them and rejected; the owner approved the cards. Before, one card held every field, with the website and notes inside it.</> },
            { date: '2026-11-24', text: <>Edit now changes the page in place; the sheet that slid over the item was a shortcut and is gone. Adding a new item keeps its sheet. The owner approved it.</> },
            { date: '2026-11-24', text: <>The icon and name moved out of the card to stand above it. In the mocks they had been the first row inside the card since the toolbar and Edit page.</> },
            { date: '2026-11-24', text: <>The list toolbar lost its All / Codes / Cards control and gained Sort and Filter before + Add (see <a href="#/places">Places</a> and <a href="#/filter-and-sort">Filter and sort</a>).</> },
            { date: '2026-11-23', text: <>The toolbar and Edit prototype was approved with all the owner's updates, modelled on Apple's Passwords. It replaced the floating Edit and the single window-wide toolbar tried earlier the same day. The editor was a sheet then.</> },
            { date: '2026-11-23', text: <>The detail column is never empty: the first item opens by itself. Search is global (owner, for consistency: one search that always finds everything).</> },
            { date: '2026-11-23', text: <>No “⋯” menus (owner: a symbol with no words does not say what is inside). Delete Item lives inside Edit, a login without a code shows Set Up Code…, and a code that cannot be made offers Replace Code….</> },
            { date: '2026-11-23', text: <>The code row sat inside the first card, after the password, because it is used after the username and password. The 2026-11-24 entry moved it into its own group. The icon and name had a row of copy buttons under them, removed at the owner's request: the fields below hold all the data, each with its own copy.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
