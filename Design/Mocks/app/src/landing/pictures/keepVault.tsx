import type { ReactNode } from 'react';
import type { Pictures } from '../Gallery';
import { byId, DOTS, type Item } from '../../data';
import { EyeIcon } from '../../icons';
import { IPad, IPhone, MacWindow } from '../../components/devices';
import { FieldRow } from '../../components/FieldRow';
import { Chevron, ItemIcon, ListRow } from '../../components/Rows';
import { Workspace, type WorkspaceCustom, type WorkspaceInit } from '../../components/Workspace';
import { Nav } from '../../screens/PhoneScreens';
import { BackButton, Row, ScreenTitle, VaultDevice, vaultTabs } from './vaultParts';

/* The fields, the sheet and the card page are drawn as pages/FieldMapping.tsx draws them. That page does not export them,
   so the minimum is copied here, without state. Fictional entry. */

interface Stored { key: string; value: string; secret?: boolean }
const stored: Stored[] = [
  { key: 'Name on Card', value: 'Alex Sample' },
  { key: 'Card No.', value: '4242 4242 4242 4242', secret: true },
  { key: 'Valid Thru', value: '08/2030' },
  { key: 'CVV', value: '007', secret: true },
  { key: 'Issuer phone', value: '202-555-0142' },
  { key: 'Website', value: 'example.test' },
];

/** The same entry before and after it is shown as a card. */
const asCustom: Item = { id: 20, name: 'Company Visa', account: 'Custom item', kind: 'custom', color: 2, uses: 0, fields: [] };
const asCard: Item = { ...asCustom, account: 'Visa •• 4242 · 08/30', kind: 'card', brand: 'Visa', last4: '4242', fields: [{ label: 'Expiry', value: '08/30' }] };

const roles = ['Card number', 'Expiry', 'Security code', 'Name on card'];
const sensitive = ['Card number', 'Security code'];
/** What Psss guessed from the field names; Valid Thru is left open so the choice is the visitor's, then mapped. */
const guessed: Record<string, string> = { 'Name on Card': 'Name on card', 'Card No.': 'Card number', CVV: 'Security code' };
const mapped: Record<string, string> = { ...guessed, 'Valid Thru': 'Expiry' };
const mmyy = (v: string) => v.replace(/^(\d{2})\/(?:20)?(\d{2})$/, '$1/$2');

function Identity() {
  return (
    <div className="ident">
      <ItemIcon item={asCustom} big />
      <div className="t">{asCustom.name}</div>
    </div>
  );
}

/** The page of the entry: as a custom item, or shown as a card. */
function ItemBody({ card }: { card?: boolean }) {
  if (card) {
    const get = (k: string) => stored.find((f) => f.key === k)!;
    const roleRows: [string, string][] = [['Card number', 'Card No.'], ['Expiry', 'Valid Thru'], ['Security code', 'CVV'], ['Name on card', 'Name on Card']];
    return (
      <>
        <Identity />
        <div className="icard">
          {roleRows.map(([label, key]) => <FieldRow key={label} label={label} value={label === 'Expiry' ? mmyy(get(key).value) : get(key).value} secret={sensitive.includes(label)} />)}
        </div>
        <div className="gh">Other fields</div>
        <div className="icard">
          {['Issuer phone', 'Website'].map((k) => <FieldRow key={k} label={k} value={get(k).value} />)}
        </div>
        <div className="delwrap"><button type="button" className="btn sq">Change how fields are used{'…'}</button></div>
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
      <div className="delwrap"><button type="button" className="btn sq">Show as Card or Login{'…'}</button></div>
    </>
  );
}

/** The sheet's content: what the entry is shown as, and what each stored field is used for. */
function SheetTop() {
  return (
    <>
      <div className="maphead">
        <div className="t">{asCustom.name}</div>
        <div className="s">Choose what each field is used for.</div>
      </div>
      <div className="icard">
        <div className="mapfield">
          <label className="l" htmlFor="lpv-kind">Show as</label>
          <select id="lpv-kind" className="mapsel" defaultValue="Card"><option>Card</option><option>Login</option><option>Custom item</option></select>
        </div>
      </div>
      <div className="maphelp" role="status">Matched from field names. Change any that are wrong. A card needs a card number. Field names and values stay as they are.</div>
    </>
  );
}

function SheetList({ r }: { r: Record<string, string> }) {
  return (
    <div className="icard">
      {stored.map((f) => {
        const role = r[f.key] ?? '';
        const concealed = !!f.secret || sensitive.includes(role);
        return (
          <div className="mapfield" key={f.key}>
            <div className="l">
              <div>{f.key}</div>
              <div className="s v">
                <span>{concealed ? DOTS : f.value}</span>
                {concealed && (
                  <button type="button" className="eye" aria-label={`Show ${f.key}`} data-tip={`Show ${f.key}`}><EyeIcon /></button>
                )}
              </div>
            </div>
            <select className={`mapsel${role ? '' : ' unused'}`} aria-label={`Use ${f.key} as`} defaultValue={role}>
              <option value="">Other field</option>
              {roles.map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function PhoneCustom() {
  return (
    <VaultDevice cue="showas">
      <IPhone tall>
        <Nav left={<BackButton label="Custom items" />} right={<button type="button" className="btn main">Edit</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}><ItemBody /></div>
      </IPhone>
    </VaultDevice>
  );
}

function PhoneSheet({ r, cue }: { r: Record<string, string>; cue: 'map' | 'save' }) {
  return (
    <VaultDevice cue={cue}>
      <IPhone tall>
        <Nav left={<button type="button" className="btn plain">Cancel</button>} right={<button type="button" className="btn pri main">Save</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>
          <SheetTop />
          <SheetList r={r} />
        </div>
      </IPhone>
    </VaultDevice>
  );
}

function PhoneCards() {
  const list = [byId(8), asCard, byId(6), byId(7)].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <VaultDevice>
      <IPhone tab="cards" tabs={vaultTabs}>
        <Nav right={<button type="button" className="btn">+ Add</button>} />
        <ScreenTitle>Cards</ScreenTitle>
        <div className="pbody tabpad">
          <div className="grp">
            {list.map((c) => <Row key={c.id} cue={c.id === asCard.id}><ListRow item={c} trailing={<Chevron />} /></Row>)}
          </div>
        </div>
      </IPhone>
    </VaultDevice>
  );
}

function PhoneCard() {
  return (
    <VaultDevice>
      <IPhone tab="cards" tabs={vaultTabs}>
        <Nav left={<BackButton label="Cards" />} right={<button type="button" className="btn main">Edit</button>} />
        <div className="pbody tabpad" style={{ overflow: 'auto' }}><ItemBody card /></div>
      </IPhone>
    </VaultDevice>
  );
}

/** The Mac and iPad window with the entry in the item column and, optionally, the sheet over the window. */
function wide(d: 'ipad' | 'mac', init: WorkspaceInit, extra: Item, custom: WorkspaceCustom): ReactNode {
  return d === 'ipad'
    ? <IPad><Workspace device="ipad" init={init} extra={[extra]} custom={custom} /></IPad>
    : <MacWindow><Workspace device="mac" init={init} extra={[extra]} custom={custom} /></MacWindow>;
}

function wideSheet(d: 'ipad' | 'mac'): ReactNode {
  const sheet = d === 'ipad' ? (
    <div className="sheetwrap">
      <div className="sheet">
        <div className="sheetbar">
          <button type="button" className="btn plain">Cancel</button>
          <button type="button" className="btn pri main">Save</button>
        </div>
        <SheetTop />
        <div className="sheetscroll"><SheetList r={mapped} /></div>
      </div>
    </div>
  ) : (
    <div className="sheetwrap">
      <div className="sheet">
        <SheetTop />
        <div className="sheetscroll"><SheetList r={mapped} /></div>
        <div className="sheetfoot">
          <button type="button" className="btn glass">Cancel</button>
          <button type="button" className="btn pri main">Save</button>
        </div>
      </div>
    </div>
  );
  return wide(d, { side: 'custom', sel: asCustom.id }, asCustom, { body: <ItemBody />, overlay: sheet });
}

const widePage = (d: 'ipad' | 'mac') => wide(d, { side: 'custom', sel: asCustom.id }, asCustom, { body: <ItemBody /> });
const wideCard = (d: 'ipad' | 'mac') => wide(d, { side: 'cards', sel: asCustom.id }, asCard, { body: <ItemBody card /> });

export function keepVaultPictures(): Pictures {
  return {
    iphone: [
      { caption: 'An entry Psss cannot read as a card shows every field by name.', screen: <PhoneCustom /> },
      { caption: 'Psss matched three fields from their names. Valid Thru is still Other field.', screen: <PhoneSheet r={guessed} cue="map" /> },
      { caption: 'Valid Thru is now the expiry. Field names and values stay as they are.', screen: <PhoneSheet r={mapped} cue="save" /> },
      { caption: 'The entry is in Cards, with its last four digits and expiry.', screen: <PhoneCards /> },
      { caption: 'The same file still opens in other KeePass apps, with its own field names.', screen: <PhoneCard /> },
    ],
    ipad: [
      { caption: 'Every field shows under the name the file gave it.', screen: widePage('ipad') },
      { caption: 'Each field gets a use. Names and values stay as they are.', screen: wideSheet('ipad') },
      { caption: 'The entry is in Cards. The file still opens in other apps.', screen: wideCard('ipad') },
    ],
    mac: [
      { caption: 'Every field shows under the name the file gave it.', screen: widePage('mac') },
      { caption: 'Each field gets a use. Names and values stay as they are.', screen: wideSheet('mac') },
      { caption: 'The entry is in Cards. The file still opens in other apps.', screen: wideCard('mac') },
    ],
  };
}
