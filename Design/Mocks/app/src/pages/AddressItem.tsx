import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, MacWindow, type TabSpec } from '../components/devices';
import { AllGlyph, BackIcon, CardsGlyph, ChevronDownIcon, CodesGlyph, GearIcon, MoreGlyph, SidebarIcon, TrashGlyph, VaultsIcon, WifiGlyph } from '../icons';
import { EditRow, FieldRow, UnsetRow } from '../components/FieldRow';
import { Chevron, ItemIcon, ListHead, ListRow } from '../components/Rows';
import { Problem } from '../components/Problem';
import { Nav } from '../screens/PhoneScreens';
import { items as vaultItems, type Item } from '../data';
import './addr.css';

/* ---------- sample addresses (fictional) ---------- */

type CC = 'US' | 'LV' | 'ES' | 'SE' | '';
interface A {
  label?: string; name?: string; org?: string; street?: string; street2?: string;
  city?: string; region?: string; postal?: string; country?: CC;
  email?: string; phone?: string; notes?: string; color: Item['color'];
}
type Geo = 'city' | 'region' | 'postal';
const countries: Record<Exclude<CC, ''>, { name: string; city: string; region?: string; postal: string; order: Geo[] }> = {
  US: { name: 'United States', city: 'City', region: 'State', postal: 'ZIP code', order: ['city', 'region', 'postal'] },
  LV: { name: 'Latvia', city: 'City', postal: 'Postal code', order: ['postal', 'city'] },
  ES: { name: 'Spain', city: 'City', region: 'Province', postal: 'Postal code', order: ['postal', 'city', 'region'] },
  SE: { name: 'Sweden', city: 'City', postal: 'Postal code', order: ['postal', 'city'] },
};
/** The country of this device: what an address without a country is laid out as. */
const device: Exclude<CC, ''> = 'LV';

const home: A = { label: 'Home', name: 'Sam Rivers', street: '12 Harbour Road', city: 'Riga', postal: 'LV-1010', country: 'LV', email: 'sam@harbor.example', phone: '+371 2000 0000', color: 5 };
const work: A = { label: 'Work', name: 'Sam Rivers', org: 'Harbor Studio', street: '4 Quay Street', street2: 'Floor 3', city: 'Riga', postal: 'LV-1050', country: 'LV', email: 'sam@harborstudio.example', phone: '+371 6700 0000', color: 4 };
const parents: A = { label: 'Parents', name: 'Maria Karlsson', street: '2210 Maple Avenue', street2: 'Apt 4B', city: 'Portland', region: 'OR', postal: '97201', country: 'US', phone: '+1 503 555 0142', notes: 'Parcels go to the neighbour at 2214 if nobody answers.', color: 2 };
const cabin: A = { label: 'Cabin', street: 'Lake Road 7', city: 'Sigulda', postal: 'LV-2150', country: 'LV', color: 3 };
const jonas: A = { name: 'Jonas Karlsson', street: 'Vasagatan 9', city: 'Gothenburg', postal: '411 37', country: 'SE', color: 6 };
const casa: A = {
  label: 'Casa', name: 'Sam Rivers',
  street: 'Calle de la Constitución Española de mil novecientos setenta y ocho, número 14', street2: 'Edificio Torre del Parque, Escalera B, Planta 7, Puerta 12',
  city: 'Valencia', region: 'Valencia', postal: '46003', country: 'ES', phone: '+34 600 000 000', color: 1,
};
const nocountry: A = { label: 'Gift: Liene', name: 'Liene Ozola', street: 'Brivibas iela 21', street2: 'Dz. 8', city: 'Riga', postal: 'LV-1010', country: '', color: 3 };

const spec = (a: A) => countries[a.country || device];
const titleOf = (a: A) => a.label || a.name || a.street?.split('\n')[0] || 'Address';
const secondOf = (a: A) => [a.label ? a.name : undefined, a.city].filter(Boolean).join(' · ');
const streetOf = (a: A) => [a.street, a.street2].filter(Boolean).join('\n');
const tile = (a: A, id: number): Item => ({ id, name: titleOf(a), account: '', kind: 'custom', color: a.color, uses: 0, fields: [] });

/** The place rows in the order and under the names of the country. */
function geoRows(a: A): [string, string, Geo | 'region-extra'][] {
  const s = spec(a);
  const names: Record<Geo, string | undefined> = { city: s.city, region: s.region, postal: s.postal };
  const vals: Record<Geo, string | undefined> = { city: a.city, region: a.region, postal: a.postal };
  const rows = s.order.flatMap((k): [string, string, Geo | 'region-extra'][] => (vals[k] ? [[names[k]!, vals[k]!, k]] : []));
  // A region the country has no row for is kept and shown, never dropped.
  if (!s.region && a.region) rows.push(['Region', a.region, 'region-extra']);
  return rows;
}

const V = ({ children }: { children: ReactNode }) => <span className="fval" style={{ whiteSpace: 'pre-line' }}>{children}</span>;

/* ---------- the page ---------- */

function PageBody({ a }: { a: A }) {
  const t = titleOf(a);
  const street = streetOf(a);
  const hasAddress = !!(street || a.city || a.postal);
  return (
    <>
      <div className="ident"><ItemIcon item={{ name: t, color: a.color }} big /><div className="t">{t}</div></div>
      {(a.name || a.org) && (
        <div className="icard">
          {a.name && <FieldRow label="Full name" value={a.name} />}
          {a.org && <FieldRow label="Organization" value={a.org} />}
        </div>
      )}
      <div className="icard">
        {street && <FieldRow label="Street" value={street} display={<V>{street}</V>} />}
        {geoRows(a).map(([l, v]) => <FieldRow key={l} label={l} value={v} />)}
        {a.country ? <FieldRow label="Country" value={countries[a.country].name} /> : <UnsetRow label="Country" />}
        {hasAddress && <div className="frow"><button className="btn sq acc">Copy Address</button></div>}
      </div>
      {(a.email || a.phone) && (
        <div className="icard">
          {a.email && <FieldRow label="Email" value={a.email} />}
          {a.phone && <FieldRow label="Phone" value={a.phone} />}
        </div>
      )}
      {a.notes && <div className="icard"><FieldRow label="Notes" value={a.notes} /></div>}
    </>
  );
}

const back = (text: string) => (
  <button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>{text}</button>
);

function PhonePage({ a }: { a: A }) {
  return (
    <IPhone tall>
      <Nav left={back('Addresses')} right={<button className="btn main">Edit</button>} />
      <div className="pbody" style={{ overflow: 'visible' }}><PageBody a={a} /></div>
    </IPhone>
  );
}

/* ---------- the editor ---------- */

const countryList: [CC, string][] = [['', 'Not set'], ['LV', 'Latvia'], ['SE', 'Sweden'], ['ES', 'Spain'], ['US', 'United States']];
const CountrySelect = ({ value }: { value: CC }) => (
  <select className="mapsel adr-sel" aria-label="Country or region" defaultValue={value}>
    {countryList.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
  </select>
);

const emailWarn = 'This doesn’t look like an email address. It is saved as typed.';

/** The editor's fields in the same order as the page: name, address in the order of the country, contact, notes. */
function Fields({ a, warn }: { a: A; warn?: boolean }) {
  const s = spec(a);
  const val: Record<Geo, string | undefined> = { city: a.city, region: a.region, postal: a.postal };
  const geo = s.order.map((k) => ({ k, label: k === 'city' ? s.city : k === 'region' ? s.region! : s.postal }));
  return (
    <>
      <div className="icard">
        <EditRow label="Full name" value={a.name} />
        <EditRow label="Organization" value={a.org} />
      </div>
      <div className="icard">
        <EditRow label="Street" value={a.street} />
        <EditRow label="Apartment, suite" value={a.street2} />
        {geo.map((g) => <EditRow key={g.k} label={g.label} value={val[g.k]} />)}
        <div className="frow erow"><div className="fbody"><div className="s">Country or region</div><div className="efield"><CountrySelect value={a.country ?? ''} /></div></div></div>
      </div>
      <div className="icard">
        <EditRow label="Email" value={a.email} below={warn && <Problem>{emailWarn}</Problem>} />
        <EditRow label="Phone" value={a.phone} />
      </div>
      <div className="icard"><EditRow label="Notes" value={a.notes} /></div>
    </>
  );
}

const NameField = ({ a }: { a: A }) => (
  <div className="ident" style={{ paddingBottom: 10 }}>
    <ItemIcon item={{ name: titleOf(a) === 'Address' ? 'A' : titleOf(a), color: a.color }} big />
    <input className="t namefield" defaultValue={a.label ?? ''} placeholder={a.name || 'Address'} aria-label="Label" />
  </div>
);
const Need = ({ ok }: { ok: boolean }) => (
  <div className="adr-help">{ok ? 'Only a label or a full name is needed. Everything else is optional.' : 'Add a label such as Home, or a full name, to save. Everything else is optional.'}</div>
);

function PhoneEditor({ a, title, empty, warn }: { a: A; title: string; empty?: boolean; warn?: boolean }) {
  return (
    <IPhone tall>
      <Nav left={<button className="btn plain">Cancel</button>} mid={<strong>{title}</strong>} right={<button className="btn pri main" disabled={empty}>Save</button>} />
      <div className="pbody" style={{ overflow: 'visible' }}>
        <NameField a={a} />
        <Need ok={!empty} />
        <Fields a={a} warn={warn} />
      </div>
    </IPhone>
  );
}

/** The Mac sheet is a macOS form: labels trailing-aligned at the left, controls to their right. */
const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="adr-fr"><label>{label}</label><div>{children}</div></div>;
const In = ({ label, value }: { label: string; value?: string }) => <Row label={label}><input className="adr-in" defaultValue={value} aria-label={label} /></Row>;

function MacForm({ a }: { a: A }) {
  const s = spec(a);
  const val: Record<Geo, string | undefined> = { city: a.city, region: a.region, postal: a.postal };
  return (
    <>
      <div className="icard">
        <In label="Full name" value={a.name} />
        <In label="Organization" value={a.org} />
      </div>
      <div className="icard">
        <In label="Street" value={a.street} />
        <In label="Apartment, suite" value={a.street2} />
        {s.order.map((k) => <In key={k} label={k === 'city' ? s.city : k === 'region' ? s.region! : s.postal} value={val[k]} />)}
        <Row label="Country or region"><CountrySelect value={a.country ?? ''} /></Row>
      </div>
      <div className="icard">
        <In label="Email" value={a.email} />
        <In label="Phone" value={a.phone} />
      </div>
      <div className="icard"><In label="Notes" value={a.notes} /></div>
    </>
  );
}

/* ---------- the Mac window with the Addresses place ---------- */

const sides: [string, number][] = [['All', 214], ['Codes', 31], ['Cards', 6], ['Addresses', 5], ['Wi-Fi', 4], ['Logins', 168], ['Notes', 14], ['Custom items', 11]];

function MacAddr({ list, sel, body, overlay, editing }: { list: A[]; sel: number; body: ReactNode; overlay?: ReactNode; editing?: boolean }) {
  return (
    <MacWindow>
      <div className="ws dt macui adr-tall">
        <div className="ws-grid">
          <div className="col side" data-bounds>
            <div className="tbar"><span className="sp" /><button className="ibtn" aria-label="Hide sidebar" data-tip="Hide sidebar"><SidebarIcon /></button></div>
            <div className="scroll">
              <div className="vsec"><div className="vsh on"><span className="vhi" aria-hidden="true"><VaultsIcon /></span><span className="vhn">Passwords</span><span className="vhc" aria-hidden="true"><ChevronDownIcon /></span></div></div>
              {sides.map(([l, n]) => <div key={l} className={`sr${l === 'Addresses' ? ' sel' : ''}`}><i />{l}<span className="n">{n}</span></div>)}
              <div className="sr"><i />Recently Deleted<span className="n">3</span></div>
            </div>
            <div className="sfoot">
              <div className="sfadd-wrap"><button className="sfadd"><span className="sfp" aria-hidden="true">+</span>Add Vault</button></div>
              <button className="sfgear" aria-label="Settings" data-tip="Settings"><GearIcon /></button>
            </div>
          </div>
          <div className="col list" data-bounds>
            <div className="tbar"><span className="sp" /><button className="btn glass">+ Add Address</button></div>
            <div className="lh">Addresses<span> · {list.length} addresses</span></div>
            <div className="scroll">
              {list.map((a, i) => <ListRow key={i} mac item={tile(a, i)} sub={secondOf(a)} selected={i === sel} traits={false} />)}
            </div>
          </div>
          <div className="col det" data-bounds>
            <div className="tbar">
              {editing ? <><button className="btn glass">Cancel</button><button className="btn pri main">Save</button></> : <button className="btn glass main">Edit</button>}
              <label className="searchbox"><span className="s">Search all items</span></label>
            </div>
            <div className="scroll"><div className="dbody">{body}</div></div>
          </div>
        </div>
        {overlay}
      </div>
    </MacWindow>
  );
}

/* ---------- iPhone places ---------- */

const allT: TabSpec = ['all', 'All', <AllGlyph key="a" />];
const codesT: TabSpec = ['codes', 'Codes', <CodesGlyph key="c" />];
const cardsT: TabSpec = ['cards', 'Cards', <CardsGlyph key="d" />];
const moreT: TabSpec = ['more', 'More', <MoreGlyph key="m" />];
const bar = [allT, codesT, cardsT, moreT];

const PinGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);

const addKinds = ['Login', 'Card', 'Address', 'Note', 'Custom Item', 'Wi-Fi Network'];
function AddMenu() {
  return (
    <IPhone tab="all" tabs={bar}>
      <Nav
        left={<button className="ibtn flat" aria-label="Settings" data-tip="Settings"><GearIcon /></button>}
        right={
          <span className="navend">
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button className="btn" aria-haspopup="menu" aria-expanded>+ Add</button>
              <div className="pop" role="menu">
                {addKinds.map((k) => <button key={k} role="menuitem" className={k === 'Address' ? 'adr-new' : undefined}>{k}</button>)}
              </div>
            </span>
          </span>
        }
      />
      <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· 214 items</span></div></div>
      <div className="pbody tabpad"><div className="grp">{vaultItems.slice(0, 6).map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div></div>
    </IPhone>
  );
}

function MoreList() {
  const row = (glyph: ReactNode, name: string, sub: string, count: string, mark?: boolean) => (
    <div className="prow link">
      <div className={`ic c${mark ? 2 : 5}`} style={{ display: 'grid', placeItems: 'center' }}><span className="adr-glyph">{glyph}</span></div>
      <div className="grow"><div className="trunc">{name}</div><div className="s trunc">{sub}</div></div>
      <span className="s">{count}</span>
      <Chevron />
    </div>
  );
  return (
    <IPhone tab="more" tabs={bar}>
      <div className="lt"><div className="t">More</div></div>
      <div className="pbody tabpad">
        <div className="grp">
          {row(<PinGlyph />, 'Addresses', 'Where you live, work, ship to', '5', true)}
          {row(<WifiGlyph />, 'Wi-Fi', 'Network passwords', '4')}
          {row(<TrashGlyph />, 'Recently Deleted', 'Kept for 30 days', '3')}
        </div>
        <div className="hint">Places that are not in the bar are listed here.</div>
      </div>
    </IPhone>
  );
}

function PhoneList({ list, recent = 0 }: { list: A[]; recent?: number }) {
  const rows = (xs: A[], offset: number) => xs.map((a, i) => <ListRow key={i + offset} item={tile(a, i + offset)} sub={secondOf(a)} traits={false} trailing={<Chevron />} />);
  const sorted = list.slice().sort((x, y) => titleOf(x).localeCompare(titleOf(y)));
  return (
    <IPhone tab="more" tabs={bar}>
      <Nav left={back('More')} right={<button className="btn">+ Add address</button>} />
      <div className="lt"><div className="t">Addresses <span className="s" style={{ fontWeight: 400 }}>· {list.length} addresses</span></div></div>
      <div className="pbody tabpad">
        {recent > 0 && (<><ListHead>Recently used</ListHead><div className="grp">{rows(list.slice(0, recent), 100)}</div><ListHead>All addresses</ListHead></>)}
        <div className="grp">{rows(sorted, 0)}</div>
      </div>
    </IPhone>
  );
}

const more: A[] = [
  { label: 'Dad’s office', name: 'Jonas Karlsson', city: 'Gothenburg', color: 6 },
  { label: 'Gift: Liene', name: 'Liene Ozola', city: 'Riga', color: 3 },
  { label: 'Office Berlin', name: 'Sam Rivers', city: 'Berlin', color: 4 },
  { label: 'Sister', name: 'Elina Rivers', city: 'Tallinn', color: 1 },
  { label: 'Warehouse', name: 'Receiving', city: 'Daugavpils', color: 2 },
];

/* ---------- the page ---------- */

export function AddressItem() {
  return (
    <Page
      title="Addresses: a new item kind"
      status={<><strong>Approved by the owner, 2026-11-26.</strong> The Safari card-and-address fill (<a href="#/ios-safari-fill">Cards and addresses in Safari</a>) needs somewhere to read an address from, and the vault had none. This page draws the kind, where it lives and how it is stored, its page, editor and list row, how 1Password addresses come in, and the edge cases. Being built on iPhone, iPad and Mac.</>}
    >
      <Clarity
        intro={<p>An address is a place a person ships to or lives at, with the name, email and phone that go with it: the thing a delivery form asks for. Today the vault can hold one only as a custom item with fields typed by hand.</p>}
        items={[
          ['Which thing?', 'An address with a label (Home, Work, Parents), a full name, an optional organization, the street, city, region, postal code and country, an email and a phone number. A person can keep as many as they like.'],
          ['What must they give?', 'A label or a full name, nothing else. A cabin with only a street and a city is a good address. The form says so in one line instead of marking ten fields optional.'],
          ['Where does it live?', 'In the vault, like everything else: one ordinary KeePass entry marked as an address. Its parts are plain named fields (Street, City, Postal code and so on), so KeePassXC and Strongbox show them under those names and nothing is locked into Psss. Nothing is uploaded. It is encrypted with the rest of the vault and is not hidden behind an eye, because an address is read aloud and typed all the time.'],
          ['Who holds the key?', 'The vault password, as for every item. Addresses are never put in the system’s AutoFill suggestions or in search previews beyond the label, name and city a row shows.'],
          ['What can go wrong?', 'An email without an @ (a warning, still saved), a country that is not set (the page lays the address out as this device’s country would and offers Add), a very long street (wraps, never cut off), an import that has no label or name (called by its street, else “Address”).'],
          ['How do they leave?', 'Cancel in the editor, Move to Recently Deleted on the page (30 days to bring it back), or Export as KeePass: the entry stays readable anywhere.'],
        ]}
      />

      <Section title="1. Where addresses live">
        <p>Address becomes a sixth kind of item, next to Login, Card, Note, Custom Item and Wi-Fi Network. It is chosen in the + Add menu and found in a place of its own, the way Cards and Wi-Fi are: a row under Cards in the Mac and iPad sidebar, and a row in More on iPhone. Inside the place, + Add address starts the editor without a menu.</p>
      </Section>
      <Frames>
        <Frame phone label="1 · + Add, on any list" caption="Address sits after Card, because cards and addresses are what a checkout asks for. Login and Card stay on top; Wi-Fi Network and Note keep their place. The system draws this menu.">
          <AddMenu />
        </Frame>
        <Frame phone label="2 · More" caption="On iPhone the place is a row in More, above Wi-Fi: the bar stays All, Codes, Cards and More. It lists even when empty, so a new vault shows that addresses exist. The count is plain text.">
          <MoreList />
        </Frame>
        <Frame phone label="3 · The Addresses place" caption="One row per address, A to Z. The row is the label over the name and city (anatomy below). The back button says More. The label of + Add says what it adds, as + Add network does on Wi-Fi.">
          <PhoneList list={[home, work, parents, cabin, jonas]} />
        </Frame>
      </Frames>

      <Section title="How it is stored in the KeePass entry">
        <p>There is no address convention in KeePass: KeePassXC and Strongbox have no address template, and KeePassDX’s templates (credit card, ID card, Wi-Fi, email account, bank account, from memory) have none either. 1Password stores an address as one object with <code>street</code>, <code>city</code>, <code>state</code>, <code>zip</code> and <code>country</code> inside an Identity, which the importer already reads (<code>App/Core/Import/PlanBuilder.swift</code>) but flattens into one text block today. So the names below are plain English, like the card’s <code>Security code</code> and <code>Valid from</code>, and the kind is marked the way cards and Wi-Fi networks are, with <code>PSSS_TYPE</code>.</p>
        <table className="cmp">
          <thead><tr><th>Shown as</th><th>Stored in the entry as</th><th>Another KeePass app shows</th></tr></thead>
          <tbody>
            <tr><td>Label</td><td><code>Title</code></td><td>the entry’s name</td></tr>
            <tr><td>Full name</td><td><code>UserName</code></td><td>the user name, with its copy button, as a card’s name on card does</td></tr>
            <tr><td>Organization</td><td>custom string <code>Organization</code></td><td>a field of that name</td></tr>
            <tr><td>Street, Apartment or suite</td><td><code>Street</code>, one value, two lines</td><td>a two-line field; Fill splits the lines</td></tr>
            <tr><td>City</td><td><code>City</code></td><td>a field of that name</td></tr>
            <tr><td>State, Province, County…</td><td><code>Region</code></td><td>a field of that name (the page’s label depends on the country)</td></tr>
            <tr><td>ZIP code, Postal code</td><td><code>Postal code</code></td><td>a field of that name</td></tr>
            <tr><td>Country</td><td><code>Country</code>, the two-letter code (<code>US</code>, <code>LV</code>)</td><td>the code</td></tr>
            <tr><td>Email, Phone</td><td><code>Email</code>, <code>Phone</code></td><td>fields of those names</td></tr>
            <tr><td>Notes</td><td><code>Notes</code></td><td>the notes</td></tr>
            <tr><td>The kind</td><td><code>PSSS_TYPE</code> = <code>address</code> (hidden, never shown as a field)</td><td>nothing; an entry like any other</td></tr>
          </tbody>
        </table>
        <p>None of the strings is flagged protected: the whole vault file is encrypted, and an address is not a secret that needs hiding on screen. Search finds an address by label, name and city (the three the row shows) and never by street, email or phone, and none of them reaches the system’s credential index.</p>
      </Section>

      <Section title="2. The address page">
        <p>The page is the item page of every kind: the tile and label above, one card per group, a copy icon on every field and a tap anywhere on a row copies it. Groups, in order: name and organization; the address; email and phone; notes. The address group is laid out by the country: the rows that differ are City, State and ZIP code (United States) against Postal code and City (most of Europe). A field that was never filled in has no row, except Country, which shows “Not set” with Add because it decides the layout and what Fill sends. <strong>Copy Address</strong> is a labelled button in the address card: it copies the whole address as it is written on an envelope in that country.</p>
      </Section>
      <Frames>
        <Frame phone label="4 · A United States address" caption="Parents: street over apartment as one two-line value, then City, State, ZIP code and Country, the order a US form asks. Copy Address copies “Maria Karlsson, 2210 Maple Avenue, Apt 4B, Portland, OR 97201, United States” on separate lines. No email: no row, no gap.">
          <PhonePage a={parents} />
        </Frame>
        <Frame phone label="5 · A European address" caption="Home: Postal code before City, no State row because Latvia has none. The labels follow the country too (State, ZIP code, Province, Postcode). Email and Phone are their own group below, each copied with a tap.">
          <PhonePage a={home} />
        </Frame>
      </Frames>
      <Frames>
        <Frame label="6 · Mac, with the sidebar" caption="Addresses is a sidebar row under Cards, with Wi-Fi next to it and Recently Deleted last. The list column has one row per address; the page is the same one as on iPhone, in the item column, and Edit is the labelled button in its toolbar. + Add Address is in the list toolbar. iPad at regular width is the same window; at compact width it is the iPhone layout.">
          <MacAddr list={[cabin, home, jonas, parents, work]} sel={3} body={<PageBody a={parents} />} />
        </Frame>
      </Frames>
      <div className="prose">
        <p className="adr-sub"><strong>How the layout is chosen.</strong> The editor and the page use a short table of the countries whose forms differ from the default; the default is Postal code, then City. Copy Address is separate: it asks the system’s postal address formatter (<code>CNPostalAddressFormatter</code>, to verify on a device), which already knows the line order of every country.</p>
        <table className="cmp">
          <thead><tr><th>Country</th><th>Rows, in order</th></tr></thead>
          <tbody>
            <tr><td>United States</td><td>Street, City, State, ZIP code, Country</td></tr>
            <tr><td>Canada, Australia</td><td>Street, City, Province or State, Postal code, Country</td></tr>
            <tr><td>United Kingdom</td><td>Street, Town or city, Postcode, Country</td></tr>
            <tr><td>Spain, Italy</td><td>Street, Postal code, City, Province, Country</td></tr>
            <tr><td>Everywhere else, and no country</td><td>Street, Postal code, City, Country (the device’s country decides when none is set)</td></tr>
          </tbody>
        </table>
      </div>

      <Section title="3. The editor">
        <p>New Address is a sheet on iPhone and Mac. Editing an existing address is in place, like every item, with the same fields. The heading is the label field, grey placeholder showing what the address will be called anyway (the full name once one is typed, else “Address”). The fields keep the page’s order, so Country is last in view, edit and new, as in Contacts, and choosing a country re-orders and relabels the rows above it at once. A new address starts with this device’s country, so the order is right before anything is typed. A saved Region that the new country has no row for stays as a Region row.</p>
      </Section>
      <Frames>
        <Frame phone label="7 · New Address, nothing typed" caption="Save is off. One line under the heading says what is needed: a label or a full name. No field carries “(optional)”, because only this pair is asked and the line already says so. Layout is Latvia’s, the country of this device.">
          <PhoneEditor a={{ color: 5, country: 'LV' }} title="New Address" empty />
        </Frame>
        <Frame phone label="8 · Editing Parents, a warning" caption="The email has no @. A warning in the usual style appears under it; Save still works, because the address is what the person typed. Country is a standard pop-up menu of every region by name (the system draws it, the same on iPhone, iPad and Mac). Changing it from United States to Latvia would turn State and ZIP code into Postal code and City and keep the typed values.">
          <PhoneEditor a={{ ...parents, email: 'maria.karlsson' }} title="Edit Address" warn />
        </Frame>
      </Frames>
      <Frames>
        <Frame label="9 · Mac: New Address sheet" caption="A macOS form: labels trailing-aligned at the left, controls at their right, Country as a pop-up button, Cancel and Save at the foot, Save the default. The Mac has no system content types for these fields, so the sheet is plain text fields; iPhone gets the keyboard help in the table below.">
          <MacAddr
            list={[cabin, home, jonas, work]}
            sel={1}
            body={<PageBody a={home} />}
            overlay={
              <div className="sheetwrap">
                <div className="sheet">
                  <div className="maphead" style={{ textAlign: 'center' }}><div className="t">New Address</div></div>
                  <NameField a={{ color: 5, country: 'US', name: 'Maria Karlsson' }} />
                  <div className="maphelp" style={{ textAlign: 'center' }}>Only a label or a full name is needed. Everything else is optional.</div>
                  <div className="sheetscroll"><MacForm a={{ ...parents, label: undefined, email: undefined, notes: undefined }} /></div>
                  <div className="sheetfoot"><button className="btn glass">Cancel</button><button className="btn pri main">Save</button></div>
                </div>
              </div>
            }
          />
        </Frame>
      </Frames>
      <div className="prose">
        <p className="adr-sub"><strong>Keyboard help on iPhone and iPad.</strong> Each editor field sets the system text content type, so the keyboard offers the right suggestions (for example your own address from your contact card; the system does that on the device and Psss sees only what is tapped). The same names are the HTML <code>autocomplete</code> tokens the Safari fill writes. Whether the keyboard suggestions behave well beside the app’s other fields is a device check (the validation run saw the strong-password sheet over the app’s own password field, so this is tested field by field).</p>
        <table className="cmp">
          <thead><tr><th>Field</th><th>Keyboard</th><th>Content type (iOS)</th><th>Safari fill token</th></tr></thead>
          <tbody>
            <tr><td>Full name</td><td>Words capitalised</td><td><code>.name</code></td><td><code>name</code></td></tr>
            <tr><td>Organization</td><td>Words capitalised</td><td><code>.organizationName</code></td><td><code>organization</code></td></tr>
            <tr><td>Street</td><td>Words capitalised</td><td><code>.streetAddressLine1</code></td><td><code>address-line1</code></td></tr>
            <tr><td>Apartment, suite</td><td>Words capitalised</td><td><code>.streetAddressLine2</code></td><td><code>address-line2</code></td></tr>
            <tr><td>City</td><td>Words capitalised</td><td><code>.addressCity</code></td><td><code>address-level2</code></td></tr>
            <tr><td>State, Province, Region</td><td>Words capitalised</td><td><code>.addressState</code></td><td><code>address-level1</code></td></tr>
            <tr><td>ZIP code, Postal code</td><td>Default, no autocorrect</td><td><code>.postalCode</code></td><td><code>postal-code</code></td></tr>
            <tr><td>Country or region</td><td>A picker, not typing</td><td><code>.countryName</code> where a field is shown</td><td><code>country</code> (code), <code>country-name</code></td></tr>
            <tr><td>Email</td><td>Email address</td><td><code>.emailAddress</code></td><td><code>email</code></td></tr>
            <tr><td>Phone</td><td>Phone pad</td><td><code>.telephoneNumber</code></td><td><code>tel</code></td></tr>
          </tbody>
        </table>
        <p className="adr-sub"><strong>What is checked.</strong> Only that there is a label or a full name. Postal codes and phone numbers are never checked, because their formats differ by country and a wrong guess would block a real address. An email without an @ warns and saves. A country picked from the list is stored as its code; text that came in from an import and is not a known country or code is shown as written and kept.</p>
      </div>

      <Section title="4. The list row">
        <p>Frame 3 and the list column of frame 6 show it. The title is the label; the second line is the full name and the city, joined by a dot. It is the same row on iPhone, iPad and Mac, truncated at the end when long (it is a person’s text, so it cannot be shortened by rewording), and the page always shows the whole value. No street in the row: the street is the most private line and the label already tells two addresses apart.</p>
        <table className="cmp">
          <thead><tr><th>The address has</th><th>Title</th><th>Second line</th></tr></thead>
          <tbody>
            <tr><td>label, name, city</td><td>Home</td><td>Sam Rivers · Riga</td></tr>
            <tr><td>label, no name</td><td>Cabin</td><td>Sigulda</td></tr>
            <tr><td>name, no label</td><td>Jonas Karlsson</td><td>Gothenburg</td></tr>
            <tr><td>neither (an import)</td><td>the first street line, else “Address”</td><td>the city, if any</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="5. Import">
        <p>Only 1Password has addresses to bring in; Apple Passwords has none.</p>
        <table className="cmp">
          <thead><tr><th>Source</th><th>What becomes an Address</th><th>What happens to the rest</th></tr></thead>
          <tbody>
            <tr>
              <td>1Password (<code>identities.Identity</code>, category 004)</td>
              <td>The Identity item. Full name from first name, initial and last name; Organization from company; Street, City, Region, Postal code and Country from the address object (<code>street</code>, <code>city</code>, <code>state</code>, <code>zip</code>, <code>country</code>); Email from email; Phone from default phone, else cell, home, business.</td>
              <td>Every other field (birth date, occupation, other phones, user name…) stays under Other fields with its name, never offered by Fill. The label is the item’s title. Today’s importer makes these a custom item with the address as one text block; that goes.</td>
            </tr>
            <tr>
              <td>Apple Passwords</td>
              <td>Nothing. Its CSV export holds logins only (title, website, user name, password, notes, verification link), as <code>docs/items.md</code> records. Addresses stay in Contacts and Safari’s own AutoFill.</td>
              <td>The import sheet does not mention addresses, so nothing promises what the file cannot deliver.</td>
            </tr>
            <tr>
              <td>KeePass files from other apps</td>
              <td>An entry Psss wrote as an address is read back as one. Any other entry is a custom item; a later step lets “Show as” offer Address with the same role matching as for Card and Login.</td>
              <td>Field names and values are never changed.</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="6. Edge cases" />
      <Frames>
        <Frame phone label="10 · A very long street" caption="Casa: the street and the apartment line wrap at body size; nothing is cut and the type stays the same. The copy icon stays at the trailing edge. The list row (frame 3 style) cuts its second line at the end instead, and the page is where the whole value is read. Province appears after City because Spain’s order puts it there.">
          <PhonePage a={casa} />
        </Frame>
        <Frame phone label="11 · No country" caption="Gift: Liene has none. The page lays it out in this device’s order, shows Country as “Not set” with a labelled Add (the whole row opens Edit at that field), and Fill leaves a country field alone rather than guessing. Copy Address still works from what is there.">
          <PhonePage a={nocountry} />
        </Frame>
        <Frame phone label="12 · Many addresses" caption="Past five addresses a Recently used group leads (the last five used in 30 days, most recent first, each also in All addresses), then All addresses A to Z, as in Cards. Search finds a label, a name or a city. The title falls back to the name when there is no label (Jonas Karlsson).">
          <PhoneList list={[...more, home, work, parents, cabin, jonas].slice(0, 10)} recent={2} />
        </Frame>
      </Frames>

      <Section title="Depends on">
        <div className="isf-note" style={{ border: '1px dashed var(--sep)', borderRadius: 10, padding: '8px 10px' }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>A sixth kind in the Psss format (phase 2).</strong> The record format has four <code>type</code> values and no Wi-Fi or address kind (<code>docs/format-schema.md</code>); like Wi-Fi, an address exports as a custom item until a fifth value and its fields are decided. Phase 1, a KeePass vault, needs nothing.</li>
            <li><strong>The importer, <code>EntryMapping</code> and the vault model</strong> (<code>VaultItem</code> is one flat struct today) take the new kind; <code>docs/items.md</code>, <code>docs/experience.md</code> and Help follow on the same task, on every platform.</li>
            <li><strong>Device checks:</strong> the postal address formatter’s line order, and the keyboard suggestions on each field.</li>
          </ul>
        </div>
      </Section>

      <Section title="Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>1. Address is a kind of its own, called “Address”.</strong> It is a sixth entry in + Add, a place under Cards on Mac and iPad, and a row in More on iPhone; it is not in the Filter menu, as Cards and Wi-Fi are not.</>,
            rejected: <>leaving addresses as custom items (every address starts from a blank form, and Fill would have to guess which field is the street); “Identity” as the kind, as 1Password has (it pulls in birth date and ID numbers, which docs/items.md keeps outside the simplicity budget); a tab for it (the bar stays All, Codes, Cards, More).</>,
            why: <>A person adding a delivery address should see a form that asks for exactly that, and the Safari fill needs fields it can name. “Address” is the word a checkout uses.</>,
          },
          {
            decision: <><strong>2. One ordinary KeePass entry, with plain-named fields and <code>PSSS_TYPE</code> = <code>address</code>.</strong> Full name is the user name; Street, City, Region, Postal code, Country, Email and Phone are custom strings; two street lines are one value.</>,
            rejected: <>one multi-line “Address” string (what the importer produces today: cannot fill a field or reorder by country); a JSON blob in a field (unreadable elsewhere); 1Password’s own names (<code>defphone</code>, <code>zip</code>).</>,
            why: <>Other KeePass apps show every part under a name a person can read, nothing is lost on export, and the same entry keeps its meaning in Psss.</>,
          },
          {
            decision: <><strong>3. The country is stored as its two-letter code and shown by name.</strong></>,
            rejected: <>free text (“Latvia”, “Latvija”, “LV” all appear, and a form’s country list needs a code); the name only.</>,
            why: <>A code survives language changes and is what checkout selects want. An unrecognised imported value is kept and shown as written.</>,
          },
          {
            decision: <><strong>4. The layout follows the country, with Country last in view, edit and new.</strong> Rows re-order and relabel when it is chosen; a new address starts with the device’s country.</>,
            rejected: <>one fixed order (the US order is wrong across Europe and Asia); Country first (would break the rule that view, edit and new share one order).</>,
            why: <>Matches Contacts, so it is familiar, and the order a person sees is the order the form they are filling in will ask.</>,
          },
          {
            decision: <><strong>5. Only a label or a full name is required.</strong> Nothing is validated except that an email without an @ gets a warning. One line under the heading says so; fields do not say “(optional)”.</>,
            rejected: <>requiring street, city and country (blocks saving “Dad: phone and email”, or a cabin); checking postal codes and phone numbers (formats vary by country, a wrong guess blocks a real address); “(optional)” on ten fields (noise, and it hides the one real rule).</>,
            why: <>An address in a password manager is a convenience, not a form to pass. The cost is that a half-empty address can be saved; Fill leaves what is missing alone.</>,
          },
          {
            decision: <><strong>6. Copy Address is a labelled button, and every field also has its copy icon.</strong> The button copies the whole address as written on an envelope in that country. No eye: values are shown, not hidden.</>,
            rejected: <>a single formatted block as the only field (a checkout asks one field at a time); the whole address behind an icon-only button or a menu (AGENTS.md: important actions stay labelled); hiding the street behind the eye (it is read and typed constantly, and the vault is already locked).</>,
            why: <>Two ways to copy, each visible: one value for a form field, the whole for a letter or a note.</>,
          },
          {
            decision: <><strong>7. The row is label over name and city.</strong> No street in the row.</>,
            rejected: <>street and city (the most private line shown in every list); name only (two addresses of one person would look the same).</>,
            why: <>The label tells two addresses of one person apart and the name and city confirm which person and place. The Safari popup mock draws street and city as the second line; this page suggests name and city for it too, which the Safari page can adopt.</>,
          },
          {
            decision: <><strong>8. A field never filled in has no row, except Country.</strong></>,
            rejected: <>the login and card rule (a quiet “Not set” row with Add for each recognized field): eleven such rows would double the page. Edit lists every field.</>,
            why: <>Country changes the layout and what Fill sends, so it is worth a visible invitation; the rest can simply be missing.</>,
          },
          {
            decision: <><strong>9. Import: every 1Password Identity becomes an Address, and what has no place stays under Other fields.</strong> Apple Passwords has no addresses to import and the sheet does not suggest it.</>,
            rejected: <>keeping identities as custom items (the Safari fill could not use them); dropping the fields with no place (birth date and similar would be lost); reading “My Card” from Contacts as a first address (a Contacts permission prompt and far more data than the person asked to share).</>,
            why: <>The same data lands where it can be used and nothing is thrown away. <strong>Open for the owner:</strong> birth date and ID-like fields in an imported Identity then sit in an Address; the alternative is to import an Identity that has such fields as a custom item.</>,
          },
        ]}
      />
      <div className="prose">
        <p><strong>Questions for the owner.</strong> (a) Is “Address” the right kind, or the broader “Contact” or “Identity”? (b) The position in the + Add menu, after Card. (c) A saved Region that the chosen country has no row for stays visible as “Region”: right, or should changing the country clear it? (d) Decision 9’s open point on imported Identities.</p>
      </div>
      <Against>
        <li>None. Standard controls throughout: a native country pop-up menu (the system’s menu picker on iPhone and iPad, a pop-up button on Mac), the system keyboard types, a macOS form for the Mac sheet, and a More row and sidebar row like Wi-Fi’s. The address layout follows Apple’s Contacts.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-26', text: <>Built. Where the platform differs the frames follow the build: Country is the system’s standard pop-up menu on iPhone and iPad, not a pushed searchable list (a search field is a possible later step), so frame 8’s caption and the Against note were changed. Both schemes build and the unit tests pass; the check on the iPhone 17 and iPad Air 11-inch simulators has not been done yet (the simulator was not available to the build session), so no frame has been compared with a screenshot.</> },
          { date: '2026-11-26', text: <>Approved by the owner; build started. The Safari fill page now draws the row as full name and city, as decision 7 suggested. Nothing in the frames was replaced by the approval.</> },
          { date: '2026-11-25', text: <>New page, for the Safari card-and-address fill, which assumed an address item the vault does not have. Nothing replaced: today an address can only be a custom item with hand-made fields, and an imported 1Password Identity becomes a custom item with the address as one text block. Both are what this proposal would replace.</> },
        ]}
      />
    </Page>
  );
}
