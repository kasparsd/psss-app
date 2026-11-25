import { useState, type ReactNode } from 'react';
import { Against, Approved, Clarity, Decisions, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { IPad, IPhone, MacWindow, type Device } from '../components/devices';
import { EditRow, FieldRow } from '../components/FieldRow';
import { Problem } from '../components/Problem';
import { ItemIcon } from '../components/Rows';
import { Workspace, type WorkspaceCustom, type WorkspaceInit } from '../components/Workspace';
import { DOTS, type Item } from '../data';
import { BackIcon, EyeIcon, EyeOffIcon } from '../icons';
import { Nav } from '../screens/PhoneScreens';

/** The fields KeePass stored on the entry, with the names they were given. Fictional. */
interface Stored { key: string; value: string; secret?: boolean }
const stored: Stored[] = [
  { key: 'Name on Card', value: 'Alex Sample' },
  { key: 'Card No.', value: '4242 4242 4242 4242', secret: true },
  { key: 'Valid Thru', value: '08/2030' },
  { key: 'CVV', value: '007', secret: true },
  { key: 'Issuer phone', value: '202-555-0142' },
  { key: 'Website', value: 'example.test' },
];

/** The same entry before and after it is shown as a card, for the list in the Mac and iPad window. */
const asCustom: Item = { id: 20, name: 'Company Visa', account: 'Custom item', kind: 'custom', color: 2, uses: 0, fields: [] };
const asCard: Item = { ...asCustom, account: 'Visa •• 4242 · 08/30', kind: 'card', brand: 'Visa', last4: '4242', fields: [{ label: 'Expiry', value: '08/30' }] };
/** The same card when the saved card number is empty and the expiry is not a date: its list row simply has less to show. */
const asCardProblems: Item = { ...asCustom, account: 'Card', kind: 'card', fields: [{ label: 'Expiry', value: '13/2030' }] };

type Kind = 'Card' | 'Login' | 'Custom item';
interface Spec { roles: string[]; required: string; suggest: Record<string, string> }
const specs: Record<Kind, Spec> = {
  Card: {
    roles: ['Card number', 'Expiry', 'Security code', 'Name on card'],
    required: 'Card number',
    suggest: { 'Card No.': 'Card number', 'Valid Thru': 'Expiry', CVV: 'Security code', 'Name on Card': 'Name on card' },
  },
  Login: { roles: ['Username', 'Password', 'Website'], required: '', suggest: { Website: 'Website' } },
  'Custom item': { roles: [], required: '', suggest: {} },
};
const sensitive = ['Password', 'Security code', 'Card number'];

/** Which role each stored field has: the suggestion from its name, or none. The value is not looked at. */
function suggested(kind: Kind, fields: Stored[], missing = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const role = specs[kind].suggest[f.key] ?? '';
    out[f.key] = missing && role === specs[kind].required ? '' : role;
  }
  return out;
}

// ---------- the item page ----------

function Identity({ editing }: { editing?: boolean }) {
  return (
    <div className="ident">
      <ItemIcon item={asCustom} big />
      {editing
        ? <input className="t namefield" defaultValue={asCustom.name} aria-label="Name" />
        : <div className="t">{asCustom.name}</div>}
    </div>
  );
}

/** The page of the entry: as a custom item, shown as a card, or being edited. */
type PageState = 'custom' | 'card' | 'problems' | 'edit';
function ItemBody({ state }: { state: PageState }) {
  if (state === 'edit') {
    return (
      <>
        <Identity editing />
        <div className="gh">Other fields</div>
        <div className="icard">
          {stored.map((f) => <EditRow key={f.key} label={f.key} value={f.value} secret={f.secret} mono={f.secret} />)}
        </div>
        <div className="delwrap"><button className="btn sq" disabled>Show as Card or Login…</button></div>
        <div className="delnote">Save your changes first.</div>
      </>
    );
  }
  if (state === 'card' || state === 'problems') {
    const bad = state === 'problems';
    const get = (k: string) => stored.find((f) => f.key === k)!;
    const roleRows: [string, string][] = [['Card number', 'Card No.'], ['Expiry', 'Valid Thru'], ['Security code', 'CVV'], ['Name on card', 'Name on Card']];
    return (
      <>
        <Identity />
        <div className="icard">
          {roleRows.map(([label, key]) => {
            if (bad && label === 'Card number') {
              return <FieldRow key={label} label={label} value="" display={<span className="s">Empty</span>} noCopy notice="The card number is empty. Use Edit to add it." />;
            }
            if (bad && label === 'Expiry') {
              return <FieldRow key={label} label={label} value="13/2030" notice="This does not look like an expiry date. Use Edit to correct it." />;
            }
            return <FieldRow key={label} label={label} value={get(key).value} secret={sensitive.includes(label)} />;
          })}
        </div>
        <div className="gh">Other fields</div>
        <div className="icard">
          {['Issuer phone', 'Website'].map((k) => <FieldRow key={k} label={k} value={get(k).value} />)}
        </div>
        <div className="delwrap"><button className="btn sq">Change how fields are used…</button></div>
      </>
    );
  }
  return (
    <>
      <Identity />
      <div className="gh">Other fields</div>
      <div className="icard">
        {stored.map((f) => <FieldRow key={f.key} label={f.key} value={f.value} secret={f.secret} />)}
      </div>
      <div className="delwrap"><button className="btn sq">Show as Card or Login…</button></div>
    </>
  );
}

function PhonePage({ state }: { state: PageState }) {
  return (
    <IPhone tall>
      {state === 'edit'
        ? <Nav left={<button className="btn plain">Cancel</button>} right={<button className="btn pri main">Save</button>} />
        : (
          <Nav
            left={<button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>{state === 'card' || state === 'problems' ? 'Cards' : 'Custom items'}</button>}
            right={<button className="btn main">Edit</button>}
          />
        )}
      <div className="pbody" style={{ overflow: 'visible' }}>
        <ItemBody state={state} />
      </div>
    </IPhone>
  );
}

function wide(d: Exclude<Device, 'iphone'>, init: WorkspaceInit, extra: Item, custom: WorkspaceCustom) {
  return d === 'ipad'
    ? <IPad><Workspace device="ipad" init={init} extra={[extra]} custom={custom} /></IPad>
    : <MacWindow><Workspace device="mac" init={init} extra={[extra]} custom={custom} /></MacWindow>;
}

/** An item page on every device. */
function renderPage(d: Device, state: PageState): ReactNode {
  if (d === 'iphone') return <PhonePage state={state} />;
  const card = state === 'card' || state === 'problems';
  return wide(d, { side: card ? 'cards' : 'custom', sel: asCustom.id }, state === 'problems' ? asCardProblems : card ? asCard : asCustom, { body: <ItemBody state={state} />, editing: state === 'edit' });
}

// ---------- the sheet ----------

function MappingSheet({ device, kind0 = 'Card', missing = false }: { device: Device; kind0?: Kind; missing?: boolean }) {
  const fields = stored;
  const [kind, setKind] = useState<Kind>(kind0);
  const [roles, setRoles] = useState<Record<string, string>>(() => suggested(kind0, fields, missing));
  const [shown, setShown] = useState<string[]>([]);
  const spec = specs[kind];
  const lacks = !!spec.required && !Object.values(roles).includes(spec.required);
  // Only the structure is checked here. A value that is empty or in the wrong format never stops Save: the item page marks it.
  const blocked = lacks;
  const help = lacks
    ? `Choose which field is the ${spec.required.toLowerCase()}.`
    : spec.roles.length
      ? `Matched from field names. Change any that are wrong.${spec.required ? ` A ${kind.toLowerCase()} needs a ${spec.required.toLowerCase()}.` : ''} Field names and values stay as they are.`
      : 'A custom item shows every field under its own name. Field names and values stay as they are.';
  const saveLabel = 'Save';

  const pick = (key: string, role: string) => {
    const next = { ...roles };
    if (role) for (const k of Object.keys(next)) if (next[k] === role) next[k] = '';
    next[key] = role;
    setRoles(next);
    setShown((s) => s.filter((k) => k !== key));
  };
  const chooseKind = (k: Kind) => { setKind(k); setRoles(suggested(k, fields)); setShown([]); };

  const top = (
    <>
      <div className="maphead">
        <div className="t">{asCustom.name}</div>
        <div className="s">Choose what each field is used for.</div>
      </div>
      <div className="icard">
        <div className="mapfield">
          <label className="l" htmlFor={`kind-${device}-${kind0}-${missing}`}>Show as</label>
          <select id={`kind-${device}-${kind0}-${missing}`} className="mapsel" value={kind} onChange={(e) => chooseKind(e.target.value as Kind)}>
            <option>Card</option><option>Login</option><option>Custom item</option>
          </select>
        </div>
      </div>
      <div className="maphelp" role="status">{lacks ? <Problem>{help}</Problem> : help}</div>
    </>
  );
  const list = (
    <>
      <div className="icard">
        {fields.map((f) => {
          const role = roles[f.key] ?? '';
          const concealed = !!f.value && (!!f.secret || sensitive.includes(role));
          const open = shown.includes(f.key);
          return (
            <div className="mapfield" key={f.key}>
              <div className="l">
                <div>{f.key}</div>
                <div className="s v">
                  <span className={concealed && open ? 'mono' : undefined}>{!f.value ? 'Empty' : concealed && !open ? DOTS : f.value}</span>
                  {concealed && (
                    <button className="eye" aria-label={`${open ? 'Hide' : 'Show'} ${f.key}`} data-tip={`${open ? 'Hide' : 'Show'} ${f.key}`}
                      onClick={() => setShown(open ? shown.filter((k) => k !== f.key) : [...shown, f.key])}>
                      {open ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  )}
                </div>
              </div>
              {spec.roles.length > 0 && (
                <select className={`mapsel${role ? '' : ' unused'}`} aria-label={`Use ${f.key} as`} value={role} onChange={(e) => pick(f.key, e.target.value)}>
                  <option value="">Other field</option>
                  {spec.roles.map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  if (device === 'iphone') {
    return (
      <IPhone tall>
        <Nav left={<button className="btn plain">Cancel</button>} right={<button className="btn pri main" disabled={blocked}>{saveLabel}</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>
          {top}
          {list}
        </div>
      </IPhone>
    );
  }
  const sheet = device === 'ipad' ? (
    <div className="sheetwrap">
      <div className="sheet">
        <div className="sheetbar">
          <button className="btn plain">Cancel</button>
          <button className="btn pri main" disabled={blocked}>{saveLabel}</button>
        </div>
        {top}
        <div className="sheetscroll">{list}</div>
      </div>
    </div>
  ) : (
    <div className="sheetwrap">
      <div className="sheet">
        {top}
        <div className="sheetscroll">{list}</div>
        <div className="sheetfoot">
          <button className="btn glass">Cancel</button>
          <button className="btn pri main" disabled={blocked}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
  return wide(device, { side: 'custom', sel: asCustom.id }, asCustom, { body: <ItemBody state="custom" />, overlay: sheet });
}

// ---------- the page ----------

export function FieldMapping() {
  return (
    <DeviceProvider>
      <Page
        title="KeePass field mapping"
        status={<><Approved on="2026-11-24" /> The layout of the sheet and the button below Other fields were approved in review. The native sheet and button still have the older layout, one row per role, and are to be rebuilt from this page.</>}
      >
        <Clarity
          items={[
            ['Which thing?', 'One item that came from a KeePass file, whose fields Psss does not recognize as a card or a login. Its page lists every field under the name it is stored with. The sheet says which of those fields is the card number, the expiry and so on.'],
            ['What must they give?', 'Nothing to read it. To change how it is shown, one choice at the top (Show as: Card, Login or Custom item) and, for each field, what it is used as. Only the card number is required. The sheet starts from a guess made from the field names.'],
            ['Where does it live?', 'In the same vault file, as one extra record that says which stored field plays which role. Nothing is uploaded. Field names and values are never changed or renamed, so other KeePass apps still see the original fields.'],
            ['What can go wrong?', 'No field is the card number (Save is off and the help line says so). A value is empty or in the wrong format (saving still works; the item page marks the value and Edit corrects it). The vault changed elsewhere while the sheet was open (the vault is reopened and the choices are made again). A field changed outside Psss and no longer fits (the page says “Review fields…”).'],
            ['How do they leave?', 'Cancel throws the choices away. Choosing Custom item and saving shows every field under its own name again. Nothing is deleted either way.'],
          ]}
        />
        <PageDeviceSwitch />

        <Section title="1. The item page" />
        <div className="frames">
          <DeviceView
            label="A. A custom item"
            caption={{
              iphone: 'Every field is under Other fields, with the name it is stored under, its value, the eye for hidden values and the copy icon, as on every item page. Below them one button, “Show as Card or Login…”, in plain words. Edit is the labeled button in the navigation bar, not a second one in the page.',
              ipad: 'The same page in the item column. iPad works like the Mac.',
              mac: 'The same page in the item column. Edit is in the item column\'s toolbar, as for every item; the button below Other fields opens the sheet.',
            }}
            render={(d) => renderPage(d, 'custom')}
          />
          <DeviceView
            label="B. Shown as a card"
            caption={{
              iphone: 'After saving, the fields assigned to the card come first, in the order a checkout asks for them and under the role\'s name: Card number, Expiry, Security code, Name on card. The rest stay under Other fields. The button now reads “Change how fields are used…”.',
              ipad: 'The item now appears in Cards, with its last four digits and expiry in the list row.',
              mac: 'The item now appears in Cards, with its last four digits and expiry in the list row. Other KeePass apps still show the original field names.',
            }}
            render={(d) => renderPage(d, 'card')}
          />
          <DeviceView
            label="C. Shown as a card, with problems"
            caption={{
              iphone: 'Saving the mapping never checks the values, so a card can be saved with a card number that is empty or an expiry that is not a date. The item page then says so, under the row it is about: a warning symbol and words in the normal text colour, with “Use Edit to …” naming the fix. An empty value shows “Empty” and has no copy icon, because there is nothing to copy. A value in the wrong format is shown as it is stored.',
              ipad: 'The list row shows only what the card has: with no number and no readable expiry it drops those parts and shows the name and “Card”.',
              mac: 'As on iPad. The notices stay until the value is corrected in Edit, and Edit is the labeled button in the item column\'s toolbar.',
            }}
            render={(d) => renderPage(d, 'problems')}
          />
        </div>

        <Section title="2. Edit changes the values" />
        <div className="frames">
          <DeviceView
            label="D. Editing a custom item"
            caption={{
              iphone: 'Edit is the same as for every item: Cancel and Save take the place of Back and Edit, and each stored value becomes a field. Hidden values stay masked while editing. “Show as Card or Login…” is off until the changes are saved or cancelled, so the sheet never opens over a half-edited page.',
              ipad: 'As on the Mac. The sidebar, the list and search are dimmed while the page is edited.',
              mac: 'Cancel and Save take the place of Edit in the item column\'s toolbar. The sidebar, the list and search are dimmed while the page is edited.',
            }}
            render={(d) => renderPage(d, 'edit')}
          />
        </div>

        <Section title="3. The sheet" />
        <div className="frames">
          <DeviceView
            label="E. Show as Card"
            caption={{
              iphone: 'The sheet is titled with the item and says what it is for. Show as comes first, then one row per stored field: its name and value on the left, a menu on the right that says what it is used as. “Other field” in grey means no role. The assignments were matched from the field names, and the line under Show as says so. It stands at the top, where the choice was made, so it is still found when there are many fields. Cancel and Save are in the system toolbar. The menus can be tried here.',
              ipad: 'A form sheet over the window, with Cancel and Save in the sheet\'s own toolbar, as on iPhone.',
              mac: 'A sheet attached to the window. On Mac the actions are at the bottom of the form: Cancel, and Save, the default button. The title, Show as and its line stay fixed at the top and the buttons at the bottom; only the list of fields scrolls, so the line is never scrolled away.',
            }}
            render={(d) => <MappingSheet device={d} />}
          />
          <DeviceView
            label="F. The card number is missing"
            caption={{
              iphone: 'Nothing is marked Card number, so Save is off and the line under Show as says what to do, with the warning symbol: “Choose which field is the card number.” There is no message in the rows, because the problem is not in any one row. The requirement was already stated in the same line before anything went wrong.',
              ipad: 'As on iPhone: the toolbar\'s Save is off, and the line under Show as names the missing field. The list scrolls below it.',
              mac: 'The default button is off, and the line under Show as names the missing field. It stays in view while the list scrolls.',
            }}
            render={(d) => <MappingSheet device={d} missing />}
          />
          <DeviceView
            label="G. Show as Custom item"
            caption={{
              iphone: 'Custom item has no roles, so the menus go away and every field keeps its own name. This is also how a mapping is undone. The help line says what saving changes.',
              ipad: 'As on iPhone.',
              mac: 'As on iPhone. The sheet keeps its size so the window does not jump.',
            }}
            render={(d) => <MappingSheet device={d} kind0="Custom item" />}
          />
        </div>

        <Section title="4. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. The sheet lists the stored fields, and a menu on each says what it is used as.</strong> The field name and its value are on the left, the role (or Other field) on the right.</>,
              rejected: <>one row per role with a “From field” selector and the value shown under it (built first, 2026-11-24).</>,
              why: <>People know which of their fields is the expiry more easily than they can remember which field to pick for each role. The value is part of the row, so no separate preview is needed, and a field that is not used is visible as such. The menu has no visible label; it shows its current value, and its accessibility label is “Use Valid Thru as”.</>,
            },
            {
              decision: <><strong>2. A field with no role says “Other field”, in secondary colour.</strong> It is never blank.</>,
              rejected: <>an empty menu.</>,
              why: <>A blank control looks unfilled or broken and has nothing for VoiceOver to read. “Other field” also says where the field ends up: the Other fields section on the item page. The grey colour lets the assigned roles stand out.</>,
            },
            {
              decision: <><strong>3. A role belongs to one field.</strong> Choosing it moves it from the field that had it, and that field falls back to Other field.</>,
              why: <>Duplicate assignments cannot happen, so there is no conflict state. The row that changed is on the same screen. On VoiceOver the move is announced.</>,
            },
            {
              decision: <><strong>4. Only the card number is required, and a login requires nothing.</strong> A missing required role turns Save off and is named in the help line.</>,
              rejected: <>requiring a password for a login.</>,
              why: <>A login can be a username and a website only, or have only a passkey. The line under Show as is the one place for a message that belongs to no row, so the rows stay quiet.</>,
            },
            {
              decision: <><strong>5a. A problem stands where it is.</strong> A problem of one value (an empty card number, an expiry that is not a date) is a notice under that row on the item page. A problem of no one row (no field is the card number) is the line under Show as, written the same way. Both are the app's ProblemText: a warning symbol and the words in the normal text colour, with VoiceOver reading “Warning: …” as it appears.</>,
              rejected: <>red text, and one message for every problem at the foot of the sheet.</>,
              why: <>This is the convention of every other sheet in the app (“Problems are not red” in the experience notes). The person is looking at the field, so the words belong beside it.</>,
            },
            {
              decision: <><strong>5b. The help line is under Show as, at the top, not under the list.</strong> It says how the first guess was made and, when there is a problem with no row, what to choose. For a card, the same line says before anything goes wrong that it needs a card number.</>,
              rejected: <>a line under the list, which is off screen with many fields; a strip pinned over the bottom of the sheet, which covers rows and is not a standard control; a Save that stays on and fails when tapped.</>,
              why: <>The requirement comes from the Show as choice, so the explanation stands under it, as a section footer does in a form. On Mac the top and the buttons are fixed and only the list scrolls. Problems with a value are not on the sheet at all (decision 5c).</>,
            },
            {
              decision: <><strong>5c. Saving a mapping never checks values.</strong> A field that is empty or in the wrong format can still be given a role. The item page then marks it with a notice under that row and names the fix: “Use Edit to add it”, “Use Edit to correct it”. An empty value shows “Empty” with no copy icon.</>,
              rejected: <>blocking Save when the chosen field is empty, with a notice in the sheet's row (built first, 2026-11-24).</>,
              why: <>Mapping says what a field is, and Edit changes what it holds; tying them together stops someone who only wants the right type. KeePass data is often untidy, and a card with a typo is still a card. The first guess can then follow the field's name alone, so a card number field is found even when it has no value yet. Only the structure is checked: a card needs a field marked as the card number, and without one Save is off.</>,
            },
            {
              decision: <><strong>5. The type is called “Show as”.</strong> The button says just “Save”, as it does everywhere else; “Show as” already says what is saved.</>,
              rejected: <>“Item type” (the mapping is not a type of item the person creates) and “Store as” (nothing is stored differently).</>,
              why: <>Field names and values stay as they are, and only how the item is shown changes. “Show as” says that, so the button needs no suffix. An earlier draft said “Save as Card”, “Save as Login” and “Save as Custom Item”; the owner chose plain Save.</>,
            },
            {
              decision: <><strong>6. One button below Other fields opens the sheet.</strong> “Show as Card or Login…” on a custom item, “Change how fields are used…” once it is shown as a card or login, and “Review fields…” when a mapped field changed.</>,
              rejected: <>separate “Show as Card” and “Show as Login” buttons, and the jargon “Map fields…”.</>,
              why: <>The Show as menu in the sheet is the one place to choose, so extra buttons would repeat it. A custom item is whatever is not a login, card or note, so most of them should stay custom, and one quiet button does not push them. The sheet opens with its best guess selected.</>,
            },
            {
              decision: <><strong>7. The sheet names the item, not the vault or the file.</strong> A line under the title says what it is for.</>,
              why: <>The sheet opens from the item, inside the vault, so a vault and file name would only add noise. The help line says what saving changes instead: field names and values stay as they are.</>,
            },
            {
              decision: <><strong>8. Edit is the toolbar button every item has.</strong> The custom item page has no Edit button of its own.</>,
              why: <>An in-page Edit would be a second way to do what the toolbar already does. In Edit, the mapping button is off until the changes are saved.</>,
            },
            {
              decision: <><strong>9. Custom item hides the menus,</strong> and Note is not offered.</>,
              why: <>Custom item has no roles to choose, and choosing it is how a mapping is undone. An entry with only notes opens as a Note by itself, so mapping to Note would add a choice with nothing to assign.</>,
            },
          ]}
        />

        <Against>
          <li><strong>The role menus have no visible label.</strong> The field name on the left names the row, the menu shows its current value, and its accessibility label says “Use … as”. Apple's menu pickers normally carry a label. A repeated label on every row would only add noise.</li>
          <li><strong>“Other field” is shown in secondary colour inside a control.</strong> Apple's menu pickers show their value in the tint colour. Grey is used for the value that means “no role”, so it does not compete with the assigned ones.</li>
        </Against>

        <History
          entries={[
          { date: '2026-11-25', text: <>Owner: icon on the left, row-size header, no own chevron; the pull-down is replaced by the right-click menu (built that way, mock follows). The Mac and iPad sidebar frames show it.</> },
          { date: '2026-11-25', text: <>Shared Mac and iPad window: the sidebar now ends in a foot pinned to the bottom, with Add Vault and an icon-only Settings gear (opens the Settings window on the Mac, the Settings sheet on iPad); on iPad the gear left the sidebar toolbar and Add Vault is no longer the last row of the list. Replaces the iPad sidebar toolbar gear and the Add Vault list row in every frame of this page. See <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-25', text: <>Review fixes to the shared Mac and iPad window: the Mac window is a Mac surface throughout, so its buttons are macOS push buttons (Unlock, Use Touch ID, Forgot Password, Copy Setup Link, Show QR Code), its switches are Mac switches, and its text is two sizes, the title (17 px) and the body (13 px), instead of 17, 22 and 13; the toolbar capsules keep the macOS 26 look. The Passwords vault shows 214 items in the sidebar count and the list heading, as Settings does, and the traffic lights are no longer hidden behind the sidebar. Replaces the iOS button styles in the Mac window and the count of 19.</> },
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
            { date: '2026-11-24', text: <>Saving a mapping no longer checks values. The sheet's row notice for an empty field was removed, with its frame. An empty or badly formatted value is marked on the item page instead (new frame C), under its own row, and corrected in Edit. The first guess goes back to following the field names alone, even for an empty field. Only the card number needing a field stays a reason for Save to be off. The owner pointed out that mapping and values are separate concerns.</> },
            { date: '2026-11-24', text: <>Moved the help line from under the list to under the Show as row, because with many fields it was off screen exactly when Save was off. On Mac the top and the buttons are now fixed and only the list scrolls. The same line says a card needs a card number. The first guess skips fields with no value, so a row notice only follows the person's own choice. Pinning the line over the bottom and a Save that fails when tapped were rejected. A “(required)” mark in the menu was tried and dropped: the selected value shows it too, which clipped the menu on iPhone and squeezed the field names.</> },
            { date: '2026-11-24', text: <>The sheet's button is plain “Save”. It had been “Save as Card”, “Save as Login” and “Save as Custom Item”. The owner chose plain Save: the Show as row above already says what is saved, and every other Save in the app is plain.</> },
            { date: '2026-11-24', text: <>Added the inline notice, first as a row notice in the sheet for a required role on an empty field. Replaced the same day: see the entry about values above. The missing-field line keeps the same style (warning symbol, normal text colour). A role belongs to one field, so duplicates cannot happen and need no notice.</> },
            { date: '2026-11-24', text: <>The page moved from a static HTML page into the mocks app, so it is drawn on iPhone, iPad and Mac from the shared device frames, field rows and workspace. The sheet is drawn as the system sheet toolbar on iPhone and iPad, and with the actions at the bottom on Mac.</> },
            { date: '2026-11-24', text: <>Kept “Other field” as the menu value for a field with no role instead of leaving the menu blank, because a blank control reads as unfilled or broken and VoiceOver has nothing to say. It uses the secondary text colour.</> },
            { date: '2026-11-24', text: <>The detail page no longer has its own Edit button in the body. Edit is the labeled toolbar button that every item has. The Map fields… button became “Show as Card or Login…” on a custom item (plain words) and “Change how fields are used…” once an item is shown as a card or login. One button opens the sheet, whose Show as menu is the single place to choose.</> },
            { date: '2026-11-24', text: <>Renamed Item type to Show as, because nothing is stored differently. The sheet gets the line “Choose what each field is used for.” where the vault name was. Login no longer requires a password. The help line says the assignments were matched from field names. Fields without a value show Empty.</> },
            { date: '2026-11-24', text: <>Removed the vault and file name from the sheet, which opens from the item and already sits inside that vault. The help line now says what saving changes: field names and values stay, only how the item is shown changes.</> },
            { date: '2026-11-24', text: <>Turned the sheet around. It lists the stored fields with their values on the left and a menu on the right that says what each one is used as, instead of one row per role with a From field selector. The “From field” label, the separate value preview, the optional suffixes and the unassigned-fields note went. A role belongs to one field, so duplicate-assignment conflicts no longer exist. The conflict state became “The card number is missing”, shown in the single help line under the actions.</> },
            { date: '2026-11-24', text: <>Moved mapping conflicts into each affected field row so the message stays beside the selector that fixes it. Replaced the same day (see above).</> },
            { date: '2026-11-24', text: <>Removed the Stored value caption so the preview stands on its own. The inline eye matches the reveal control in item details.</> },
            { date: '2026-11-24', text: <>Moved Map fields below Other fields because changing roles is occasional. Edit changes stored custom values. Each assignment labelled the selector From field and previewed the stored value below it.</> },
            { date: '2026-11-24', text: <>The native app now shows Other fields and saves assignments with the original KeePass keys. The native sheet places Cancel and Save in the system toolbar on iPhone and iPad.</> },
            { date: '2026-11-24', text: <>Added a browser preview of the proposed detail, mapping and conflict states, as a static page. The sample vault and its fields are synthetic.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
