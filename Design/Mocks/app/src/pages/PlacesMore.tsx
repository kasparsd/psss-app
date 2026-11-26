import type { ReactNode } from 'react';
import { IPhone, type TabSpec } from '../components/devices';
import { AllGlyph, CardsGlyph, ChevronDownIcon, CodesGlyph, MoreGlyph, TrashGlyph, WifiGlyph } from '../icons';
import { Chevron, ListRow } from '../components/Rows';
import { Nav } from '../screens/PhoneScreens';
import { items as vaultItems } from '../data';
import './placesmore.css';

export const bar: TabSpec[] = [
  ['all', 'All', <AllGlyph key="a" />],
  ['codes', 'Codes', <CodesGlyph key="c" />],
  ['cards', 'Cards', <CardsGlyph key="d" />],
  ['more', 'More', <MoreGlyph key="m" />],
];

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const PinG = () => svg(<><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></>);
const NoteG = () => svg(<><path d="M6 3.5h9l3.5 3.5v13.5H6z" /><path d="M9 11h6M9 14.5h6M9 18h3.5" /></>);
const CustomG = () => svg(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
const PersonG = () => svg(<><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 10h4M14 13.5h3" /></>);
const BankG = () => svg(<><path d="M3.5 9.5 12 4l8.5 5.5zM6 11v6M10 11v6M14 11v6M18 11v6M4 19.5h16" /></>);
const KeyG = () => svg(<><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H20M17 12v3M20 12v2.5" /></>);
const Wifi = () => <WifiGlyph />;
const Trash = () => <TrashGlyph />;

export interface Place { name: string; sym: ReactNode; n?: number }
export const addresses: Place = { name: 'Addresses', sym: <PinG />, n: 5 };
export const wifi: Place = { name: 'Wi-Fi', sym: <Wifi />, n: 4 };
export const deleted: Place = { name: 'Recently Deleted', sym: <Trash />, n: 3 };
export const five: Place[] = [addresses, { name: 'Custom Items', sym: <CustomG />, n: 7 }, { name: 'Notes', sym: <NoteG />, n: 12 }, wifi];
export const many: Place[] = [
  addresses,
  { name: 'Bank Accounts', sym: <BankG />, n: 2 },
  { name: 'Custom Items', sym: <CustomG />, n: 7 },
  { name: 'Identities', sym: <PersonG />, n: 3 },
  { name: 'Notes', sym: <NoteG />, n: 12 },
  { name: 'Insurance', sym: <BankG />, n: 4 },
  { name: 'Memberships', sym: <PersonG />, n: 6 },
  { name: 'Passports', sym: <PersonG />, n: 2 },
  { name: 'Software Licences', sym: <KeyG />, n: 9 },
  { name: 'Vehicles', sym: <CustomG />, n: 2 },
  wifi,
];

function Group({ places }: { places: Place[] }) {
  return (
    <div className="mt-group">
      {places.map((p) => (
        <div key={p.name} className="mt-row">
          <span className="mt-sym">{p.sym}</span>
          <span className="grow trunc">{p.name}</span>
          {p.n ? <span style={{ color: 'var(--lab2)' }}>{p.n}</span> : null}
          <Chevron />
        </div>
      ))}
    </div>
  );
}

/** A: the page, styled as places. `places` is the group above Recently Deleted, which stands alone at the foot. */
export function OptionA({ places, top }: { places: Place[]; top?: boolean }) {
  return (
    <IPhone tab="more" tabs={bar}>
      <div className="lt"><div className="t">More</div></div>
      <div className={`mt-body${top ? ' top' : ''}`}>
        <Group places={places} />
        <Group places={[deleted]} />
      </div>
    </IPhone>
  );
}

/** What is underneath while a menu from the bar is open: the page that was on screen, here All. */
function AllBehind({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <>
      {title ?? <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· 214 items</span></div></div>}
      <div className="pbody tabpad"><div className="grp">{vaultItems.slice(0, 7).map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div></div>
      {children}
    </>
  );
}

const menuRows = (rows: Place[], withDeleted = true) => (
  <>
    {rows.map((p) => (
      <div key={p.name} className="mt-mi"><span className="grow">{p.name}</span>{p.n ? <span style={{ color: 'var(--lab2)' }}>{p.n}</span> : null}<span className="mt-sym">{p.sym}</span></div>
    ))}
    {withDeleted && <><div className="mt-sep" /><div className="mt-mi"><span className="grow">Recently Deleted</span><span style={{ color: 'var(--lab2)' }}>3</span><span className="mt-sym"><Trash /></span></div></>}
  </>
);

export function OptionB() {
  return (
    <div className="mt-light">
      <IPhone tab="more" tabs={bar}>
        <AllBehind>
          <div className="mt-dim" />
          <div className="mt-menu" role="menu">{menuRows([addresses, { name: 'Notes', sym: <NoteG />, n: 12 }, { name: 'Custom Items', sym: <CustomG />, n: 7 }, wifi])}</div>
        </AllBehind>
      </IPhone>
    </div>
  );
}

export function OptionC() {
  const mid = <span className="mt-title">All <ChevronDownIcon /></span>;
  const places: Place[] = [{ name: 'All', sym: <AllGlyph /> }, { name: 'Codes', sym: <CodesGlyph /> }, { name: 'Cards', sym: <CardsGlyph /> }, addresses, wifi];
  return (
    <div className="mt-light">
      <IPhone tab="all" tabs={bar}>
        <Nav mid={mid} />
        <div className="pbody tabpad"><div className="grp">{vaultItems.slice(0, 7).map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div></div>
        <div className="mt-dim" />
        <div className="mt-menu top" role="menu">{menuRows(places)}</div>
      </IPhone>
    </div>
  );
}

export function MoreSidebar() {
  const row = (p: Place, sel?: boolean) => (
    <div className={`mt-sr${sel ? ' sel' : ''}`}><span className="mt-sym">{p.sym}</span><span>{p.name}</span>{p.n !== undefined && <span className="n">{p.n}</span>}</div>
  );
  return (
    <div className="mt-light dt">
      <div className="mt-side">
        <div className="mt-sh">Passwords</div>
        {row({ name: 'All', sym: <AllGlyph />, n: 214 }, true)}
        {row({ name: 'Codes', sym: <CodesGlyph />, n: 41 })}
        {row({ name: 'Cards', sym: <CardsGlyph />, n: 6 })}
        {row(addresses)}
        {row(wifi)}
        {row(deleted)}
      </div>
    </div>
  );
}

/** One bar on its own, so the layouts can be compared side by side. */
export function Strip({ label, tabs, tab, note }: { label: string; tabs: TabSpec[]; tab: string; note: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="s" style={{ marginBottom: 6 }}><strong>{label}</strong></div>
      <div className="dt" style={{ position: 'relative', height: 78, maxWidth: 402, background: 'var(--screen)', borderRadius: 18, overflow: 'hidden' }}>
        <div className="tabbar" style={{ bottom: 12 }}>
          <div className="tabs" role="tablist">
            {tabs.map(([id, text, glyph]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}`}>
                {glyph}
                {text}
              </button>
            ))}
          </div>
          <button className="circ" aria-label="Search"><span style={{ display: 'inline-flex', width: 20, height: 20 }}><SearchSvg /></span></button>
        </div>
      </div>
      <div className="s" style={{ marginTop: 6 }}>{note}</div>
    </div>
  );
}
const SearchSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
);


export const stripTabs = {
  all: ['all', 'All', <AllGlyph key="a" />] as TabSpec,
  codes: ['codes', 'Codes', <CodesGlyph key="c" />] as TabSpec,
  cards: ['cards', 'Cards', <CardsGlyph key="d" />] as TabSpec,
  wifi: ['wifi', 'Wi-Fi', <WifiGlyph key="w" />] as TabSpec,
  trash: ['trash', 'Deleted', <TrashGlyph key="t" />] as TabSpec,
  more: ['more', 'More', <MoreGlyph key="m" />] as TabSpec,
};
