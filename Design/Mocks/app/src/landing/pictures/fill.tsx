import type { ReactNode } from 'react';
import { IPad, IPhone, MacWindow } from '../../components/devices';
import { ListRow } from '../../components/Rows';
import { Caret, InfoBtn } from '../../components/loginParts';
import { Nav } from '../../screens/PhoneScreens';
import { LockClosedIcon } from '../../icons';
import type { Item } from '../../data';
import type { Pictures } from '../Gallery';
import '../../pages/autofill.css';
import './signin.css';
import './keyboard.css';

/**
 * Pictures `fill`: three accounts for one site, told apart in the picker.
 * Drawn from `pages/Autofill.tsx` (the picker on iPhone, the sheet on iPad and
 * Mac) and `pages/AutofillLessons.tsx` (the rows). The Safari page, keyboard
 * and ring are shared with codeFill.tsx and codeSetup.tsx.
 * Pure pictures: fixed fictional data, no state, no handlers.
 */

/* ---------- fictional data ---------- */

const login = (id: number, name: string, account: string, color: Item['color']): Item =>
  ({ id, name, account, kind: 'login', color, uses: 0, fields: [] });

/** Three logins for one site, told apart by name and address (fictional example.com addresses). */
export const accounts: Item[] = [
  login(101, 'Lumen (Personal)', 'sam@personal.example.com', 1),
  login(102, 'Lumen (Work)', 'sam@work.example.com', 2),
  login(103, 'Lumen (School)', 'sam@school.example.com', 3),
];

/** The account the pictures choose. */
const CHOSEN = 1;

export const SITE_HOST = 'lumen.example.com';

/* ---------- pieces the three sign-in galleries share ---------- */

/** Safari's address pill, then the page as a white card. The site is named in the pill and in the page's heading. */
export function SafariPage({ host = SITE_HOST, path = '', children }: { host?: string; path?: string; children: ReactNode }) {
  return (
    <div className="lpd-safari">
      <div className="lpd-url"><LockClosedIcon /><span>{host}{path}</span></div>
      <div className="lpd-page">{children}</div>
    </div>
  );
}

/** The site's own mark and name, as the first line of its page. */
export const Brand = () => (
  <div className="lpd-brand">
    <div className="ic c4" aria-hidden>L</div>
    <div className="t">Lumen</div>
  </div>
);

/** The system keyboard, drawn as a block: a suggestion bar above keys that are only labelled. */
export function Keyboard({ bar }: { bar?: ReactNode }) {
  return (
    <div className="lpd-kbd">
      {bar && <div className="lpd-kbar">{bar}</div>}
      <div className="lpd-keys">Keyboard</div>
    </div>
  );
}

/** Add the ring class to the one thing being touched. */
export const cue = (on: boolean | undefined, extra = '') => `${extra}${on ? `${extra ? ' ' : ''}lpd-cue` : ''}`;

/** A text field as a picture: its text, or its placeholder dimmed. */
export const FieldBox = ({ value, placeholder, className = '' }: { value?: string; placeholder?: string; className?: string }) => (
  <div className={`lpd-input${value ? '' : ' ph'}${className ? ` ${className}` : ''}`}>{value || placeholder}</div>
);

/** iPad or Mac window with the page the pictures are about. `sheet` is drawn over it, dimmed behind, as `pages/Autofill.tsx` draws a sheet. */
export function WideStage({ device, children, sheet }: { device: 'ipad' | 'mac'; children: ReactNode; sheet?: ReactNode }) {
  const inner = (
    <div className="lpd-wide" data-device={device}>
      {children}
      {sheet && <div className="sheetwrap"><div className="sheet" style={{ width: 'min(100%, 440px)' }}>{sheet}</div></div>}
    </div>
  );
  return device === 'ipad' ? <IPad>{inner}</IPad> : <MacWindow>{inner}</MacWindow>;
}

/** Safari in a wide window: the address pill, then the page's card. */
export function WidePage({ device, host = SITE_HOST, path = '', children }: { device: 'ipad' | 'mac'; host?: string; path?: string; children: ReactNode }) {
  return (
    <div className="lpd-wpage">
      <div className={`lpd-wbar${device === 'mac' ? ' mac' : ''}`}>
        <div className="lpd-url"><LockClosedIcon /><span>{host}{path}</span></div>
      </div>
      <div className="lpd-wbody"><div className="lpd-wcard">{children}</div></div>
    </div>
  );
}

/* ---------- the sign-in form ---------- */

type FillStep = 'empty' | 'filled';

/** Lumen's sign-in page, empty (the ring on the password field) or filled with the chosen account. */
function SignIn({ step }: { step: FillStep }) {
  const filled = step === 'filled';
  const pick = accounts[CHOSEN];
  return (
    <>
      <Brand />
      <div className="t">Sign in to Lumen</div>
      <div className="lpd-lab">Email<FieldBox value={filled ? pick.account : undefined} placeholder="you@example.com" /></div>
      <div className="lpd-lab">Password<FieldBox value={filled ? '••••••••••' : undefined} placeholder="Password" className={cue(!filled)} /></div>
      <button type="button" className="btn pri wide" disabled={!filled}>Sign in</button>
    </>
  );
}

const PhoneForm = ({ step }: { step: FillStep }) => (
  <IPhone>
    <SafariPage><SignIn step={step} /></SafariPage>
  </IPhone>
);

/* ---------- the picker ---------- */

const Head = ({ children }: { children: ReactNode }) => <div className="af-h">{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div className="af-help">{children}</div>;

/** The search field, focused: the accent ring and a caret, as `pages/Autofill.tsx` draws it. */
const SearchField = () => (
  <div className="sfield" style={{ width: '100%', boxShadow: '0 0 0 2px var(--accent)' }}>
    <Caret /><span className="s" style={{ marginLeft: 4 }}>Search all items</span>
  </div>
);

const FOOT = 'Tap a login to fill it. Tap the info button for its details.';

/** The three accounts, as the app draws a row: name over address, the (i) at the end. The ring marks the one being touched. */
function Rows({ mac, touched }: { mac?: boolean; touched?: number }) {
  return (
    <div className="grp">
      {accounts.map((it, i) => {
        const row = <ListRow key={it.id} item={it} mac={mac} traits={false} trailing={<InfoBtn name={it.name} />} />;
        return touched === i ? <div key={it.id} className={mac ? 'lpd-cue-row' : 'lpd-cue-in'}>{row}</div> : row;
      })}
    </div>
  );
}

/** iPhone: the picker with the search field over the keyboard (frame A of the AutoFill page). */
function PhonePicker({ touched }: { touched?: number }) {
  return (
    <IPhone>
      <Nav left={<button type="button" className="btn glass">Cancel</button>} mid={<strong>Choose a Login</strong>} />
      <div className="pbody" style={{ flex: 1 }}>
        <Head>For This Site</Head>
        <Rows touched={touched} />
        <Foot>{FOOT}</Foot>
      </div>
      <div className="lpd-pin"><SearchField /></div>
      <div className="kbd" style={{ position: 'relative', height: 150 }}>Keyboard</div>
    </IPhone>
  );
}

/** iPad and Mac: the same sheet, title on top, then the search field, the heading and the card, Cancel at the foot. */
function WideSheet({ touched }: { touched?: number }) {
  return (
    <>
      <div className="maphead" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}><div className="t">Choose a Login</div></div>
      <div style={{ padding: '0 0 8px' }}><SearchField /></div>
      <div className="sheetscroll">
        <Head>For This Site</Head>
        <Rows mac touched={touched} />
        <Foot>{FOOT}</Foot>
      </div>
      <div className="sheetfoot"><button type="button" className="btn glass">Cancel</button></div>
    </>
  );
}

/* ---------- the pictures ---------- */

const wide = (device: 'ipad' | 'mac') => [
  { caption: 'Lumen wants a password, and you have three accounts here.', screen: <WideStage device={device}><WidePage device={device}><SignIn step="empty" /></WidePage></WideStage> },
  { caption: 'Psss lists them with name and address. Nothing fills until you choose.', screen: <WideStage device={device} sheet={<WideSheet touched={CHOSEN} />}><WidePage device={device}><SignIn step="empty" /></WidePage></WideStage> },
  { caption: 'Work is in the form. The password stays hidden.', screen: <WideStage device={device}><WidePage device={device}><SignIn step="filled" /></WidePage></WideStage> },
];

export function fillPictures(): Pictures {
  return {
    iphone: [
      { caption: 'Lumen wants a password, and you have three accounts here.', screen: <PhoneForm step="empty" /> },
      { caption: 'Psss lists them with name and address. Nothing fills until you choose.', screen: <PhonePicker touched={CHOSEN} /> },
      { caption: 'Work is in the form. The password stays hidden.', screen: <PhoneForm step="filled" /> },
    ],
    ipad: wide('ipad'),
    mac: wide('mac'),
  };
}

/** The hero: one iPhone screen, the picker open with the three accounts. */
export function FillHero() {
  return <PhonePicker />;
}
