import { useState } from 'react';
import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceSwitcher, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { IPhone, type Device } from '../components/devices';
import { Nav, PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function ItemPage() {
  const [device, setDevice] = useState<Device>('mac');
  const [empty, setEmpty] = useState(false);
  return (
    <DeviceProvider>
      <Page
        title="Item page, Edit and toolbar"
        status={<><Approved on="2026-11-24" /> The toolbar per column on Mac and iPad and an explicit Edit were approved on 2026-11-23, modelled on Apple's Passwords. On 2026-11-24 the owner approved the icon and name above the card, Edit in place, the groups and the verification code group, and later the same day the field order, “Move to Recently Deleted” and names that are optional, with the heading as the name field. How a field copies is on <a href="#/copy-icons">Copying a field</a>.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'One item of the vault: a login, a card, a note or a custom item. The page opens with its icon and name, then its values in groups, in the order they are asked for. An item with no name of its own is called by what it holds: a login by its website, a card by its brand and last four digits, a note by its first words.'],
            ['What must they give?', 'Nothing to read it. To change it, one labelled Edit; Save or Cancel to finish. A name is never required: the heading under the icon is where one is typed, and left empty it shows what the item is called anyway. “Move to Recently Deleted” is at the bottom of the fields while editing, and says where the item goes.'],
            ['What can go wrong?', 'They change something by accident (Edit is explicit and the rest of the window is dimmed while it is on); they move an item to Recently Deleted (it stays there for 30 days, with Undo right after); they leave half an edit (Cancel after a change asks “Discard Changes?”).'],
            ['How do they leave?', 'Back on iPhone, or choose another item on Mac and iPad. Nothing is saved until Save.'],
          ]}
        />

        <Section title="1. The item page" />
        <Frames>
          <Frame phone label="A. A login on iPhone" caption="The icon and name stand above the card, on the page itself, centred. Then one card per group. First Website, Username and Password, with the clipboard note under them. Then everything about the verification code under the heading “Verification code”: the code at the size of the item's name, its setup key, Copy Setup Link and Show QR Code, with a warning below. Then Notes, then the passkey. A heading above and a note below belong to one card, so it is clear what the warning is about.">
            <PhoneItem id={1} whole />
          </Frame>
          <Frame phone label="B. A password shown" caption="A secret that is shown in the clear is written in the monospaced system face at body size, so that 1, l and I, and 0 and O, can be told apart. This password has all of them. The eight dots are unchanged, and the username, website, notes and names stay in the normal face.">
            <PhoneItem id={1} whole shown={['Password']} />
          </Frame>
          <Frame phone label="C. A card" caption="The same page for a card. The values you copy at a checkout are one group, in the order a checkout asks for them: Card number, Expiry, Security code, Name on card. Notes, when a card has them, are a card of their own below. A field that was never filled in has no row.">
            <PhoneItem id={6} whole />
          </Frame>
          <Frame phone label="D. A login with no name" caption="This login was saved without a name, so it is called by its website, northbank.example. The heading looks the same as a name that was typed. With no website it would be called by its username.">
            <PhoneItem id={2} whole unnamed />
          </Frame>
        </Frames>
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="E. The same page on Mac and iPad"
            initial="mac"
            caption={{
              iphone: 'As in A.',
              ipad: 'As on the Mac.',
              mac: 'The item column draws the same groups in the same order. The first item opens by itself, its icon centred above its name.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} whole />, { side: 'all', sel: 1 })}
          />
        </div>

        <Section title="2. Edit changes the page in place" />
        <div className="frames">
          <Frame phone label="F. Editing a login on iPhone" caption="Edit turns the page you were reading into fields, in the same groups and the same order. The name is changed where it is read: the heading under the icon becomes a field, and there is no Name row in any card. Cancel and Save take the place of Back and Edit, and the tab bar is hidden until one of them is tapped. The code's action sits on the right of its field on the same line (“Replace code” once a code is set); “Remove code”, being destructive, is on its own row below. “Move to Recently Deleted” closes the form, in the default colour, with “You can bring it back for 30 days.” under it. Nothing slides up over the page.">
            <PhoneItem id={1} mode="edit" />
          </Frame>
          <Frame phone label="G. A login without a code" caption="“Add code” sits on the right of the setup key field. Press it and it becomes “Replace code”, with “Remove code” below.">
            <PhoneItem id={2} mode="edit" />
          </Frame>
          <Frame phone label="Paste a verification-code image" caption="Try Paste with a QR screenshot, an unrelated image, and an empty clipboard. The mock uses fictional clipboard contents. On iPhone, iPad and Mac, a row “From QR code in screenshot” with the system Paste button at its right appears under Setup key when the clipboard holds an image. The system button cannot be renamed, so the row says what it reads. The sheet then shows the issuer, the account and a live code from the decoded QR. See I for Mac and iPad.">
            <PasteCodeDemo />
          </Frame>
          <Frame phone label="H. Editing a card" caption="The same for a card: its name in the heading, then Card number, Expiry, Security code and Name on card, then Notes. Every field of a card has its place here, filled in or not.">
            <PhoneItem id={6} mode="edit" />
          </Frame>
          <DeviceView
            label="I. Editing in place on Mac and iPad"
            initial="mac"
            caption={{
              iphone: 'As in F, with Paste because the clipboard holds an image.',
              ipad: 'As on the Mac. Paste is the system Paste button, in the same place as on iPhone.',
              mac: 'Paste, the system button with the clipboard symbol, shows under the setup key while the clipboard holds an image. The item column turns into the editor; Cancel and Save take the place of Edit. The sidebar, the list and search are dimmed and do not react until Save or Cancel, so a half-edited login cannot be left by accident. The icon stays above the card and the name under it becomes a field. “Move to Recently Deleted” is the last thing in the column.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} mode="edit" onPasteCodeImage={() => {}} />, { side: 'all', sel: 1, editing: true, pasteImage: true })}
          />
        </div>

        <Section title="3. A new item" />
        <Frames>
          <Frame phone label="J. A new login with no name" caption="A new item opens as a sheet over the list, with the same groups in the same order as Edit. It can be saved without a name. The heading field then shows in grey what the item will be called: its website, or its username when there is no website, here northbank.example. The grey name follows the fields as they are typed. Typing in the heading replaces it with a name of your own, in the normal colour, and clearing the heading brings the grey one back. There is nothing to move to Recently Deleted yet, so that button is not here.">
            <PhoneItem id={2} mode="edit" fresh />
          </Frame>
        </Frames>
        <p className="prose muted">A new card is called by its brand and last four digits (“Visa •• 4417”), a new note by its first words. Mac and iPad show the same sheet over the window.</p>

        <Section title="4. Fields not filled in yet" />
        <Clarity
          items={[
            ['What is it?', 'A field Psss recognizes for this kind of item (a card’s Valid from, PIN or Card issuer; a login’s Website, Username or Password) that this item has no value for. It is drawn as a quiet row so a person sees it exists and can be filled in.'],
            ['Where does it live?', 'Nowhere yet: no value is stored, and none is written to the file until one is typed. Looking at the page never changes the vault.'],
            ['How do they act?', 'Press the row or its “Add”. The page turns to Edit in place with that field focused. There is nothing to copy, so there is no copy icon.'],
          ]}
        />
        <Frames>
          <Frame phone label="K. A card with fields not filled in (approved, A)" caption="Every field Psss knows for a card has its row, in the same place whether filled or not, so filling one in never moves another. A row not filled in says “Not set” in the secondary colour and ends in a labelled “Add”. Card type is read from the number and shown only when the file stores one (this file says “mc”, the page says Mastercard).">
            <PhoneItem id={7} whole unset="rows" />
          </Frame>
          <Frame phone label="L. The quieter variant (B)" caption="The same card with the empty fields gathered into one row, “Not filled in”, with one “Add…” that opens Edit at the first of them. Shorter, but it hides which field is which until Edit.">
            <PhoneItem id={7} whole unset="summary" />
          </Frame>
          <Frame phone label="M. A card with everything" caption="Nothing is missing, so no row says “Not set” and the page looks as it does today, with Valid from, PIN and Card issuer filled in. Compare K: the filled rows are in the same places.">
            <PhoneItem id={6} whole unset="rows" />
          </Frame>
        </Frames>
        <p className="prose muted">Mac and iPad draw the same rows in the item column, with a pointer cursor and the system hover highlight; “Add” is a plain accent-coloured text button there too. Only recognized fields appear. A custom item and a note have none, and fields Psss does not know stay under Other fields, filled in only.</p>

        <Section title="5. Clickable prototype (Mac and iPad)" />
        <div className="prose">
          <p>The same window, working. Click the sidebar rows, the items, Edit (and Move to Recently Deleted inside it), Set Up Code…, the sidebar button, search, the copy icons, the eye, Sort and Filter. Switching device restarts it.</p>
        </div>
        <div className="ctl">
          <span>Device <DeviceSwitcher label="Device" value={device} options={['mac', 'ipad']} onChange={setDevice} /></span>
          <label><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Empty list</label>
        </div>
        <div className="stagebox" style={{ maxWidth: 1000 }}>
          {renderDevice(device, null, { side: 'all' }, { menuBar: true, empty })}
        </div>
        <p className="prose muted">Mac: click “Psss” in the menu bar to see Settings. iPad: the Setup gear sits at the foot of the sidebar. Northbank has no code, so its page shows “Set Up Code…”.</p>

        <Section title="6. Decisions" />
        <Decisions
          items={[
              {
                decision: <><strong>Edit is wider, Save is the accent button.</strong> Edit keeps the default button colour and is a little wider than the buttons beside it, on iPhone, iPad and Mac. While editing, Save takes its place, filled with the system accent colour, and Cancel is plain.</>,
                rejected: <>Edit filled with the accent colour (drawn first: it looked like Save); Edit at the ordinary width (easy to miss on Mac).</>,
                why: <>The accent marks the one button that commits something. Edit only opens the fields, so it is made easier to hit, not louder.</>,
              },
            {
              decision: <><strong>1. The icon and name stand above the card,</strong> on the page itself, centred, on every device. The cards below hold only the fields.</>,
              rejected: <>the icon and name as the first row inside the card (how the mocks drew it from the toolbar and Edit page until 2026-11-24).</>,
              why: <>It reads as who the item is, apart from what it holds.</>,
            },
            {
              decision: <><strong>2. Names are optional for every kind, and the heading is the name field.</strong> Any item can be saved without a name. Without one it is called: a login by its website's host, else its username, else “Login”; a card by its brand and last four digits (“Visa •• 4417”), else “Card”; a note by its first words; a custom item by its website's host, else its username, else “Custom item”. While editing or adding, the heading under the icon is the name field. With no name of its own it shows the derived name in grey, as a placeholder that follows the other fields as they are typed. A typed name shows in the normal colour, and clearing it returns to the grey derived name. Outside editing the heading looks the same whether the name was typed or derived. There is no Name row in any card.</>,
              rejected: <>a required name (“Title”) for cards, notes and custom items, and “Untitled” for an item without one; the name as the first field of the form; the name as a row in a last card with Notes (drawn first the same day; the owner asked for the heading itself to be the field).</>,
              why: <>Most items are named after something they already hold, and asking for it again is a step people skip or fill with the same word. A name is changed where it is read.</>,
            },
            {
              decision: <><strong>3. Secrets shown in the clear are monospaced.</strong> A revealed password, card number, security code, setup key or custom item value on the item page, and the same fields while typing, in edit mode and in the new-item sheet, are written in the monospaced system face (the face of the verification code digits) at body size, never a third size. The eight hidden dots are unchanged. Usernames, websites, notes and names keep the normal face.</>,
              rejected: <>the normal face, where l, 1 and I look the same, and so do 0 and O.</>,
              why: <>A person who has to read a password out or type it on another device must be able to tell the characters apart.</>,
            },
            {
              decision: <><strong>4. The item page keeps its cards, a card is a group, and the order is the same in view, edit and new.</strong> Lists are plain; an item page is a form. A login: Website, Username, Password in the first card; then the “Verification code” group (Code, Setup key, Copy Setup Link, Show QR Code and the warning, or “None” with Set Up Code…; in edit “Setup key (optional)” with Add code or Replace code, and Remove code); then Notes; then Passkey. A card: Card number, Expiry, Security code, Name on card; then Notes. A note: the note. A custom item: Website, Username, Value; then Notes. A group may have a heading above and one note below. The clipboard note sits under the first group.</>,
              rejected: <>Website and Notes together below the verification code group (approved the same morning; the website ended up far down the page); the website as a line under the name in the heading (it would repeat the name whenever the item is called by its site, and could not be copied like a field); plain rows on the item page, compared with the cards on 2026-11-24 (the headings still separate the groups, but the notes under a group float between two sets of rows, the buttons have no container and the first group runs straight on from the icon and name); one card for every field.</>,
              why: <>Website, username and password say which login it is, and sign-in pages ask for them in that order. The code is asked for next. Notes can be long, so they sit below everything that is copied. A list is many of the same thing, where a card behind the rows adds nothing. An item page is a few different things, and the card is what says which rows, heading and warning belong together. It also shows the area that copies when tapped. This is the grouped form Apple uses for a detail page (Passwords, Contacts, Settings).</>,
            },
            {
              decision: <><strong>5. Edit changes the page in place.</strong> Edit turns the open item's rows into fields where they are, and the heading into the name field. Cancel and Save replace Edit (and Back on iPhone). Until one of them is chosen the rest of the window is dimmed and does not react, and iPhone hides the tab bar. Cancel after a change asks “Discard Changes?”. Adding a new item still opens a sheet, with the same heading, groups and order.</>,
              rejected: <>the sheet that slides over the item; fields that are always editable, as in Notes (a password could be changed by a stray keystroke, and a tap on a row copies it).</>,
              why: <>This is what Apple's Passwords and Contacts do: an explicit Edit that changes the page you are on. A sheet is Apple's pattern for making something new, which is why Add keeps it.</>,
            },
            {
              decision: <><strong>6. “Move to Recently Deleted”</strong> is a button in the default colour, not red, at the bottom of the fields while editing, with the line “You can bring it back for 30 days.” under it. It asks nothing more; Undo follows for 10 seconds. There is no such button in any toolbar. The Mac menu item uses the same words: Edit › Move to Recently Deleted (⌘⌫). “Delete Now…” and “Delete All…” in Recently Deleted stay red, because they cannot be undone.</>,
              rejected: <>“Move to Trash”, as in Finder and Mail (the place is called Recently Deleted here, as in Apple's Passwords, Notes and Photos); a red “Delete Item” (red for something that destroys nothing).</>,
              why: <>The button names where the item goes, which is what the Undo message says too (“moved to Recently Deleted”). Red is kept for what is permanent. It is one deliberate step away and never beside Edit.</>,
            },
            {
              decision: <><strong>7. Editor actions sit on the field they act on.</strong> “Add code” (“Replace code” once a code is set) is on the right of the setup key field. When the clipboard holds an image, the next row offers Paste, which opens the existing code preview or explains what went wrong. “Remove code” is on its own row. A login without a code shows “None” with a labelled Set Up Code… button under it, which opens the editor at the code step.</>,
              why: <>One place to look for a field's action, and rows that line up on both edges.</>,
            },
            {
              decision: <><strong>8. The toolbar follows the columns,</strong> as in Passwords. Over the sidebar: the sidebar button (the Settings gear is in the sidebar foot on Mac and iPad; the Mac also has Psss › Settings… ⌘,). Over the list: Sort and Filter, and at the trailing edge + Add with its label, next to Edit; the list's title and count are the first line of the list. Over the item: a labelled <strong>Edit</strong>, then search (“Search all items”). While editing, Cancel and Save take Edit's place. In Recently Deleted the item column offers a labelled Restore. No “⋯” menus.</>,
              rejected: <>one toolbar across the window; Edit floating at the bottom right (an iPhone pattern); a “⋯” menu holding the delete action (a symbol nobody reads); an All / Codes / Cards control over the list (see <a href="#/places">Places</a>).</>,
              why: <>Each control sits above what it changes, and Edit is where people who use Passwords already look. iPhone keeps Edit at the top right of its item page.</>,
            },
            {
              decision: <><strong>9. The item column is never empty.</strong> The first item opens by itself when a list appears, a place or filter changes or the open item is moved to Recently Deleted; the person's own choice per place is restored. Opening an item this way does not count as using it. Only an empty list shows “No item open”, and Edit disappears.</>,
              rejected: <>hiding the column until something is selected (showing and hiding it would make the list jump under the pointer).</>,
            },
            {
              decision: <><strong>10. Search is in the toolbar over the item column</strong> and searches the whole vault from any place, with live codes in the results and no scope bar. Return opens the top result.</>,
              rejected: <>searching only the selected place, as Passwords does.</>,
              why: <>One search that always finds everything, so a missing result never comes from a hidden scope.</>,
            },
            {
              decision: <><strong>12. Recognized fields that are not filled in show as quiet “Not set” rows with an “Add” (approved by the owner, 2026-11-24, as A in section 4; built).</strong> They keep their canonical place, there is nothing to copy, and pressing one opens Edit at that field. Notes, the verification code (which already says “None” with Set Up Code…) and fields Psss does not recognize are not part of it.</>,
              rejected: <>showing only filled fields and letting Edit be the only place the others appear (nobody learns that Valid from or PIN exist); one “Not filled in” row naming them all (B: shorter, but it names fields without showing where they go); a dashed or tinted placeholder row (decorative, and it competes with the accent button); hiding the rows behind a setting (the point is to be seen).</>,
              why: <>A person can only fill in what they know exists. The rows are quiet so a card that has most of its fields still reads as a card; they hold their place so nothing moves when one is filled in. “Add” is labelled text, because important actions are not icon-only.</>,
            },
          ]}
        />

        <Against>
          <li>None in the structure: per-column toolbars, a labelled Edit and an Edit that changes the page in place are what Apple's Passwords does.</li>
          <li><strong>Where Psss differs from Passwords, on purpose:</strong> the button that removes an item says “Move to Recently Deleted” in the default colour (Passwords has a red Delete); a copy icon is visible on every field, and a tap copies at once (Passwords hides copying behind a click on the value); the first item opens by itself (Passwords shows “No Item Selected”); search covers the whole vault (Passwords searches the selected place); + Add has a label (Passwords uses a bare +). The labelled + Add departs from the compact toolbar convention, by the app's rule that important actions carry words.</li>
        </Against>

        <History
          entries={[
          { date: '2026-11-26', text: <>Owner: on Mac and iPad + Add moved to the trailing edge of the list column, apart from Sort and Filter and next to Edit, so adding and editing sit together. Replaces + Add directly beside Sort and Filter there; iPhone is unchanged.</> },
          { date: '2026-11-25', text: <>Owner: icon on the left, row-size header, no own chevron; the pull-down is replaced by the right-click menu (built that way, mock follows). The Mac and iPad sidebar frames show it.</> },
          { date: '2026-11-25', text: <>Shared Mac and iPad window: the sidebar now ends in a foot pinned to the bottom, with Add Vault and an icon-only Settings gear (opens the Settings window on the Mac, the Settings sheet on iPad); on iPad the gear left the sidebar toolbar and Add Vault is no longer the last row of the list. Replaces the iPad sidebar toolbar gear and the Add Vault list row in every frame of this page. See <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Review fixes to the shared Mac and iPad window: the Mac window is a Mac surface throughout, so its buttons are macOS push buttons (Unlock, Use Touch ID, Forgot Password, Copy Setup Link, Show QR Code), its switches are Mac switches, and its text is two sizes, the title (17 px) and the body (13 px), instead of 17, 22 and 13; the toolbar capsules keep the macOS 26 look. The Passwords vault shows 214 items in the sidebar count and the list heading, as Settings does, and the traffic lights are no longer hidden behind the sidebar. Replaces the iOS button styles in the Mac window and the count of 19.</> },
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
            { date: '2026-11-24', text: <>Added section 4, “Fields not filled in yet”: recognized fields with no value, drawn as “Not set” rows with an “Add” (A), against one “Not filled in” row (B). Variant A was approved by the owner the same day and built; B was dropped. The card gained Valid from, PIN and Card issuer in the editor and Card type on the page. Rows that were not filled in used to have no row at all.</>, },
            { date: '2026-11-24', text: <>The line “Copies are cleared after 60 seconds”, with its info button, left the item page at the owner's request. The explanation stays in Help, under Copying. It was the first group's footer; the page now goes straight from the first card to the next group.</>, },
            { date: '2026-11-24', text: <>“Move to Recently Deleted” left its card and now stands on the page below the last card, centred, with its line under it. It acts on the whole item, not on a field of a group, so a group background made it look like a row. Before, it sat right-aligned in a card of its own.</> },
            { date: '2026-11-24', text: <>The Paste row gained its label, “From QR code in screenshot”. A button reading “Extract from clipboard screenshot” was rejected: only the system Paste control reads the clipboard without an “Allow Paste” prompt, and it cannot be renamed. The frame now draws the copied image and the decoded issuer and account.</> },
            { date: '2026-11-24', text: <>Paste sits on its own row under the setup key, with the label “From QR code in screenshot” at its left and the system Paste button at its right, because the field is too narrow on iPhone for a second button on its line. It is shown only while the clipboard holds an image, so the rows below move when it appears. That is accepted, because the clipboard changes only after the person copied something.</> },
            { date: '2026-11-24', text: <>The setup key gained a contextual Paste row. Previously, image paste was available only after opening Add code or Replace code. The new row takes a copied screenshot straight to the existing preview or error.</> },
            { date: '2026-11-24', text: <>The heading under the icon became the name field while editing or adding, at the owner's request. Left empty, it shows the derived name in grey. Earlier the same day the name was drawn as a row in a last card with Notes, and before that it was the first field of the form. Both are gone: no card has a Name row.</> },
            { date: '2026-11-24', text: <>Names became optional for every kind. Before, only a login could go without one, and cards, notes and custom items needed a name (“Title”) before Save; “Untitled” was considered for an item without one and rejected. An item with no name is now called by what it holds: its website or username, its brand and last four digits, or its first words. The owner approved it.</> },
            { date: '2026-11-24', text: <>“Move to Recently Deleted”, in the default colour, replaced the red “Delete Item” button, and the Mac menu item Edit › Delete took the same words. Red had marked something that destroys nothing; it now stays for “Delete Now…” and “Delete All…” in Recently Deleted. “Move to Trash” was rejected because the place is called Recently Deleted. The owner approved it.</> },
            { date: '2026-11-24', text: <>Website moved up into the first card, before Username and Password, and Notes became a card of its own below the verification code group. Website and Notes together below the code group had been approved the same morning; the website ended up far down the page. The order is now the same in view, edit and new, and a card reads Card number, Expiry, Security code, Name on card. The owner approved it.</> },
            { date: '2026-11-24', text: <>Edit became wider than the buttons beside it and kept the default colour; Save is the one accent-filled button, shown only while editing. An accent-filled Edit was drawn first the same day and dropped by the owner: it looked like Save, and the accent should mean “this commits”. Before that, Edit was a plain toolbar button of ordinary width, easy to miss beside the search field on Mac.</> },
            { date: '2026-11-24', text: <>Secrets shown in the clear became monospaced, at body size: revealed values on the item page and the same fields in the editor and the new-item sheet. In the normal face, l, 1 and I look the same, and so do 0 and O. The owner decided it; the eight hidden dots did not change.</> },
            { date: '2026-11-24', text: <>The verification code and everything about it became one group under the heading “Verification code”: the code, the setup key, Copy Setup Link, Show QR Code and the warning, as the second card on a login's page after the username and password, then website and notes, then passkey (the website moved into the first card later the same day). The owner changed the groups decision this way after approving cards as groups. Before, the code sat in the first card with its setup lower down.</> },
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

function PasteCodeDemo() {
  const [clipboard, setClipboard] = useState('qr');
  const [step, setStep] = useState<'edit' | 'collect' | 'preview' | 'error' | 'saved'>('edit');
  const [saved, setSaved] = useState(false);
  const paste = () => setStep(clipboard === 'qr' ? 'preview' : 'error');
  const back = () => setStep('edit');
  return (
    <>
      <div className="ctl">
        <span aria-hidden="true" title="The copied image" style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(5, 5px)', gap: 1, padding: 3, background: '#fff', borderRadius: 3, marginRight: 8, verticalAlign: 'middle', opacity: clipboard === 'empty' ? 0.2 : 1 }}>
          {Array.from({ length: 25 }, (_, i) => <i key={i} style={{ width: 5, height: 5, background: clipboard === 'photo' ? (i % 7 < 3 ? '#8a8' : '#cde') : ([0,1,2,4,5,6,10,12,14,18,20,22,23,24,3,8,16].includes(i) ? '#000' : '#fff') }} />)}
        </span>
        <label>Clipboard <select value={clipboard} onChange={(event) => setClipboard(event.target.value)}>
          <option value="qr">QR screenshot</option>
          <option value="photo">Unrelated image</option>
          <option value="empty">Empty</option>
        </select></label>
      </div>
      {step === 'edit' ? (
        <PhoneItem id={2} mode="edit" onPasteCodeImage={clipboard === 'empty' ? undefined : paste}
          code={{ draft: saved ? 'saved' : null, add: () => setStep('collect'), remove: () => setSaved(false) }} />
      ) : (
        <IPhone tall>
          <Nav left={step !== 'saved' && <button className="btn plain" onClick={back}>Cancel</button>} mid="Add verification code" />
          <div className="pbody" style={{ padding: 20, textAlign: 'center' }}>
            {step === 'preview' && <>
              <h3>Found a code for Northbank</h3>
              <p style={{ opacity: 0.6 }}>sam.r</p>
              <p className="mono">348 692</p>
              <p>Type this code into the site to finish turning on two-step verification. It saves to Northbank in your vault, on this device.</p>
              {saved && <p>This login already has a code. Saving replaces it.</p>}
              <button className="btn pri" onClick={() => { setSaved(true); setStep('saved'); }}>{saved ? 'Replace code' : 'Save code'}</button>
            </>}
            {(step === 'collect' || step === 'error') && <>
              <p>Copy the setup key or QR code from the site. Psss reads it on this device. Nothing is uploaded.</p>
              <button className="btn" disabled={clipboard === 'empty'} onClick={paste}>Paste</button>
              {step === 'error' && <p role="status">No QR code found in that image. Try a sharper screenshot, or paste the setup key.</p>}
            </>}
            {step === 'saved' && <>
              <h3>Code saved to Northbank.</h3>
              <button className="btn pri" onClick={back}>Done</button>
            </>}
          </div>
        </IPhone>
      )}
    </>
  );
}
