import type { ReactNode } from 'react';
import { IPad, IPhone } from '../../components/devices';
import { Notice } from '../../components/Notice';
import { VaultRow, VaultNotice } from '../../components/VaultRow';
import { BioPrompt } from '../../components/BioPrompt';
import { Caret, FillBtn, Hit, Pills, gitforge, gitforge2, harbor, hosting } from '../../components/loginParts';
import { Mark } from '../../pages/Logo';
import { cardItems, type Item } from '../../data';
import type { Pictures } from '../Gallery';
import type { Topic, TopicGroup } from '../Topics';
import '../../pages/isf.css';
import './browser.css';

/**
 * Pictures for the group "In the browser": the Mac toolbar popup (four topics'
 * worth of it) and the card fill in Safari on iPhone and iPad.
 *
 * Drawn from `pages/BrowserExtension.tsx` (the popup, frames A, B, C, H to K)
 * and `pages/IosSafariFill.tsx` (frames 1, 2, 3b, 9, 15a). Those pages do not
 * export their pieces, so the following are copied here without their state
 * and handlers: the browser strip with its toolbar button (`Browser`), the
 * popup's header, row, search field and footer (`XHead`, `XRow`, `XSearch`,
 * `XFoot`), Safari's chrome on iPhone and its popup sheet (`SafariPhone`,
 * `PHead`), the checkout form and the iPad toolbar with its popover. The
 * library's own parts (`VaultRow`, `VaultNotice`, `Notice`, `BioPrompt`,
 * `Pills`, `FillBtn`, the sample logins) are imported.
 * Pure pictures: fixed fictional data, no state, no handlers.
 */

/* ======================= the Mac browser and its popup ======================= */

type Ring = 'button' | 'fill' | 'search' | 'other';

/**
 * A browser window cropped to its toolbar and the top of a page, with the popup hanging from the Psss button.
 * `clear` shows the page undimmed (no popup over it). `ring` marks the one thing being touched.
 */
function Browser({ children, title = 'Sign in · Gitforge', url = 'gitforge.example/login', badge, closed, prompt, ring, email, password, clear }: {
  children?: ReactNode; title?: string; url?: string; badge?: boolean; closed?: boolean; prompt?: ReactNode; ring?: Ring;
  email?: string; password?: string; clear?: boolean;
}) {
  return (
    <div className="lpb-crop">
      <div className={`xb macui dt lpb-xb${clear || closed ? ' lpb-clear' : ''}`} data-ring={ring}>
        <div className="xb-bar">
          <span className="lights"><i /><i /><i /></span>
          <div className="xb-url"><span aria-hidden>🔒</span> {url}</div>
          <span className="xb-btn" role="img" aria-label={badge ? 'Psss, unlocked' : 'Psss'} style={{ position: 'relative' }}>p{badge && <i className="xb-badge" aria-hidden="true">✓</i>}</span>
        </div>
        <div className="xb-page">
          <div className="t">{title}</div>
          <div className="s">Email</div><div className="xb-in lpb-in">{email}</div>
          <div className="s">Password</div><div className="xb-in lpb-in">{password}</div>
        </div>
        {!closed && children && <div className="xp" role="img" aria-label="Psss">{children}</div>}
        {prompt}
      </div>
    </div>
  );
}

/** The popup's header: “Psss”, and with two vaults the vault glyph and name, Unlock beside it when the vault is locked. */
const XHead = ({ vault = 'Passwords', unlock }: { vault?: string; unlock?: boolean }) => (
  <div className="xp-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <div style={{ flex: 1, minWidth: 0 }}><div className="t">Psss</div></div>
    <VaultRow name={vault} state={unlock ? 'locked' : 'unlocked'} variant="compact" />
  </div>
);

function XRow({ item, sub, button, last, wrap }: { item: Item; sub?: ReactNode; button: ReactNode; last?: boolean; wrap?: boolean }) {
  return (
    <div className={`xp-row${last ? ' last' : ''}`}>
      <div className={`ic c${item.color}`} aria-hidden>{item.name[0]}</div>
      <div className="grow"><div className="trunc">{item.name}</div>{sub && <div className={wrap ? 's' : 's trunc'}>{sub}</div>}</div>
      {button}
    </div>
  );
}

/** The popup's footer: one labelled Settings button at the trailing end. */
const XFoot = () => <div className="xp-foot"><button type="button" className="btn">Settings</button></div>;

/** The popup's search, focused: the accent ring and a caret. `off` dims it (a locked vault). */
const XSearch = ({ q, off }: { q?: string; off?: boolean }) => (
  <div className="xp-search" style={off ? { opacity: 0.5 } : { boxShadow: '0 0 0 2px var(--accent)' }}>
    <span className="s" aria-hidden>⌕</span>{q}{!off && <Caret />}{!q && <span className="s">Search all logins</span>}
  </div>
);

const Head = ({ children }: { children: ReactNode }) => <div className="s" style={{ padding: '0 2px' }}>{children}</div>;

/** The Fill button, ringed when it is the one being touched. */
const Fill = ({ ring }: { ring?: boolean }) => (ring ? <span className="lpb-ring"><FillBtn /></span> : <FillBtn />);

/** Frame A: the logins for this site. */
const ForThisSite = ({ ring }: { ring?: boolean }) => (
  <>
    <XHead />
    <XSearch />
    <Head>For This Site</Head>
    <div className="xp-card">
      <XRow item={gitforge} sub="sam.r" button={<Fill ring={ring} />} />
      <XRow item={harbor} button={<FillBtn />} last />
    </div>
    <XFoot />
  </>
);

const counts: [string, number][] = [['Name', 2], ['Website', 3], ['Username', 0]];

/** Frame B: searching “git”, with this site's logins first and another site's under Other Matches. */
const SearchGit = ({ ring }: { ring?: 'search' | 'other' }) => (
  <>
    <XHead />
    <div className={ring === 'search' ? 'lpb-ring-in' : undefined}><XSearch q="git" /></div>
    <Pills counts={counts} />
    <Head>For This Site</Head>
    <div className="xp-card">
      <XRow item={gitforge} sub="sam.r" button={<FillBtn />} />
      <XRow item={gitforge2} sub="sam@work.example" button={<FillBtn />} last />
    </div>
    <Head>Other Matches</Head>
    <div className={`xp-card${ring === 'other' ? ' lpb-ring-in' : ''}`}>
      <XRow item={hosting} sub={<>Saved for <Hit hit="git" after="hosting.example" /></>} button={<FillBtn />} last wrap />
    </div>
    <XFoot />
  </>
);

/** Frame C: nothing for this site in this vault. */
const NothingHere = () => (
  <>
    <XHead />
    <XSearch />
    <Head>For This Site</Head>
    <Notice kind="info" title="No logins for this site">Passwords has none for this site. Search all logins above, or choose another vault.</Notice>
    <XFoot />
  </>
);

/** Frame K: Work is open, its login listed. */
const WorkOpen = () => (
  <>
    <XHead vault="Work" />
    <XSearch />
    <Head>For This Site</Head>
    <div className="xp-card"><XRow item={gitforge2} sub="sam@work.example" button={<FillBtn main />} last /></div>
    <XFoot />
  </>
);

/* ============================ Safari on iPhone ============================ */

type Missed = 'expiry';

/** A labelled box of the checkout page. */
const In = ({ label, value, on }: { label: string; value?: string; on?: boolean }) => (
  <div>
    <div className="isf-lbl">{label}</div>
    <div className={`isf-in${on ? ' on' : ''}`}>{value}</div>
  </div>
);

/** The card checkout page. `filled` shows what Fill wrote; `cvv` marks the security code filled; `missed` names a field left empty. */
function Checkout({ filled, cvv, missed }: { filled?: boolean; cvv?: boolean; missed?: Missed }) {
  return (
    <div className="isf-page"><div className="t">Pay · Harbor Shop</div>
      <In label="Name on card" value={filled ? 'Sam Rivers' : undefined} />
      <In label="Card number" value={filled ? '4929 3741 0268 4417' : undefined} />
      <div className="isf-row2"><In label="Expiry" value={filled && missed !== 'expiry' ? '08/28' : undefined} /><In label="Security code" value={cvv ? '•••' : undefined} /></div>
    </div>
  );
}

/** Safari on iPhone: the page, the address bar with the page menu button at its left, and (when asked) the page menu or Psss's popup sheet. */
function SafariPhone({ filled, cvv, missed, menu, sheet }: { filled?: boolean; cvv?: boolean; missed?: Missed; menu?: boolean; sheet?: ReactNode }) {
  return (
    <IPhone>
      <Checkout filled={filled} cvv={cvv} missed={missed} />
      <div className="isf-safari">
        <span className="isf-circ" aria-hidden>‹</span>
        <div className="isf-cap"><span className={`isf-pm${menu ? ' on lpb-ring' : ''}`} role="img" aria-label="Page menu"><b /><i /></span><span className="isf-url">harborshop.example</span><span aria-hidden>↻</span></div>
        <span className="isf-circ" aria-hidden>⧉</span>
      </div>
      {menu && (
        <div className="isf-menu" role="img" aria-label="Page menu">
          {['Share', 'Add to Bookmarks', 'Add Bookmark to…'].map((r) => <div key={r} className="isf-mi">{r}</div>)}
          <div className="isf-msep" />
          {['Find on Page', 'Page Zoom', 'Notify Me', 'Hide Distracting Items'].map((r) => <div key={r} className="isf-mi">{r}</div>)}
          <div className="isf-msep" />
          <div className="isf-mi hl lpb-ring-in"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="isf-mark"><Mark u={0.22} mask /></span>Psss</span></div>
          <div className="isf-mi">Describe Extension</div>
          <div className="isf-mi">Manage Extensions</div>
        </div>
      )}
      {sheet && <><div className="isf-dim" /><div className="isf-sheet" role="img" aria-label="Psss"><div className="isf-grab" />{sheet}</div></>}
    </IPhone>
  );
}

/** The popup's header on iPhone and iPad: the mark, the vault, and Safari's own Done. */
const PHead = () => (
  <div className="isf-h">
    <span className="isf-mark" aria-label="Psss"><Mark u={0.3} mask /></span>
    <span className="sp" />
    <VaultRow name="Passwords" state="unlocked" variant="compact" />
    <span className="isf-done">Done</span>
  </div>
);

const Gh = ({ children }: { children: ReactNode }) => <div className="isf-grp-h">{children}</div>;

const cards = cardItems.filter((c) => !c.expired).slice(0, 2);
const cardSub = (c: Item) => `${c.brand === 'American Express' ? 'Amex' : c.brand} •• ${c.last4} · ${c.account.split('· ')[1]}`;
const home: Item = { id: 31, name: 'Home', account: '', kind: 'custom', color: 5, uses: 0, fields: [] } as Item;
const work: Item = { id: 32, name: 'Work', account: '', kind: 'custom', color: 4, uses: 0, fields: [] } as Item;

const CardList = ({ ring }: { ring?: boolean }) => (
  <>
    <Gh>Cards for This Page</Gh>
    <div className="xp-card">
      {cards.map((c, i) => <XRow key={c.id} item={c} sub={cardSub(c)} button={<Fill ring={ring && i === 0} />} last={i === cards.length - 1} />)}
    </div>
  </>
);
const AddressList = () => (
  <>
    <Gh>Addresses for This Page</Gh>
    <div className="xp-card">
      <XRow item={home} sub="Sam Rivers · Riga" button={<FillBtn />} />
      <XRow item={work} sub="Sam Rivers · Riga" button={<FillBtn />} last />
    </div>
  </>
);

const Result = ({ children, title, kind = 'info' }: { children: ReactNode; title: string; kind?: 'info' | 'warning' }) => (
  <div className="isf-pad"><Notice kind={kind} title={title}>{children}</Notice></div>
);

/* ============================ Safari on iPad ============================ */

/** Safari on iPad: the toolbar with the extension button (a puzzle piece), a page with a delivery and a payment form, and the popup as a popover under the button. */
function SafariPad({ ring, filled, missed, popover }: { ring?: boolean; filled?: boolean; missed?: Missed; popover?: ReactNode }) {
  return (
    <div className="lpb-padfit">
      <IPad>
        <div className="isf-ipad lpb-pad">
          <div className="isf-itool">
            <span aria-hidden>‹ ›</span><span className="url">🔒 harborshop.example</span>
            <span className={`pz${popover || ring ? ' on' : ''}${ring ? ' lpb-ring' : ''}`} role="img" aria-label="Extensions">⧉</span><span aria-hidden>⇪</span>
          </div>
          <div className="isf-ibody">
            <div><div className="t">Delivery</div><In label="Full name" value="Sam Rivers" /><In label="Street address" value="12 Harbour Road" /></div>
            <div>
              <div className="t">Pay</div>
              <In label="Name on card" value={filled ? 'Sam Rivers' : undefined} />
              <In label="Card number" value={filled ? '4929 3741 0268 4417' : undefined} />
              <div className="isf-row2"><In label="Expiry" value={filled && missed !== 'expiry' ? '08/28' : undefined} /><In label="Security code" value={filled ? '•••' : undefined} /></div>
            </div>
          </div>
          {popover && <div className="isf-pop" role="img" aria-label="Psss">{popover}</div>}
        </div>
      </IPad>
    </div>
  );
}

/* ================================ pictures ================================ */

const toolbarFill: Pictures = {
  mac: [
    { caption: 'A sign-in page, and a Psss button in the browser’s toolbar.', screen: <Browser clear ring="button" /> },
    { caption: 'The popup lists the logins for this site, each with its own Fill.', screen: <Browser ring="fill"><ForThisSite ring /></Browser> },
    { caption: 'The form is filled. The password stays hidden.', screen: <Browser closed email="sam.r" password="••••••••••" /> },
  ],
};

const otherSite: Pictures = {
  mac: [
    { caption: 'Nothing saved for this site in this vault, and the popup says so.', screen: <Browser title="Sign in · Cloudnest" url="cloudnest.example/login"><NothingHere /></Browser> },
    { caption: 'A search for “git” lists this site’s logins first.', screen: <Browser ring="search"><SearchGit ring="search" /></Browser> },
    { caption: 'Under Other Matches, each login says which site it was saved for.', screen: <Browser ring="other"><SearchGit ring="other" /></Browser> },
  ],
};

const locked: Pictures = {
  mac: [
    { caption: 'Work is locked. Unlock sits beside the vault’s name.', screen: <Browser><XHead vault="Work" unlock /><XSearch off /><VaultNotice kind="locked" name="Work" bio="Touch ID" /><XFoot /></Browser> },
    { caption: 'Touch ID asks. The popup closes while it does, and nothing is wrong.', screen: <Browser closed prompt={<BioPrompt bio="Touch ID" reason="Unlock Work" mac />} /> },
    { caption: 'A small check on the toolbar button says the vault is open.', screen: <Browser closed badge clear ring="button" /> },
    { caption: 'The next click lists Work’s login for this site.', screen: <Browser><WorkOpen /></Browser> },
  ],
};

const checkout: Pictures = {
  iphone: [
    { caption: 'A checkout page, and Psss in Safari’s page menu.', screen: <SafariPhone menu /> },
    { caption: 'Cards and addresses for this page are listed, each with Fill.', screen: <SafariPhone sheet={<><PHead /><CardList ring /><AddressList /></>} /> },
    { caption: 'Name, number, expiry and security code are in the form.', screen: <SafariPhone filled cvv sheet={<><PHead /><Result title="Filled Everyday Visa">Name on card, card number, expiry and security code are in the form.</Result></>} /> },
    { caption: 'If the page misses a field, Psss names the one it left empty.', screen: <SafariPhone filled cvv missed="expiry" sheet={<><PHead /><Result kind="warning" title="Partly filled Everyday Visa">Name on card, card number and security code are in the form. Expiry was not filled. Type it on the page.</Result></>} /> },
  ],
  ipad: [
    { caption: 'A checkout page, and an extension button in Safari’s toolbar.', screen: <SafariPad ring /> },
    { caption: 'The popup opens as a popover under it, with the cards for this page.', screen: <SafariPad popover={<><PHead /><CardList ring /></>} /> },
    { caption: 'The card is filled in, and the popover says what went in.', screen: <SafariPad filled popover={<><PHead /><Result title="Filled Everyday Visa">Name on card, card number, expiry and security code are in the form.</Result></>} /> },
    { caption: 'A field the page would not take is named, to type by hand.', screen: <SafariPad filled missed="expiry" popover={<><PHead /><Result kind="warning" title="Partly filled Everyday Visa">Name on card, card number and security code are in the form. Expiry was not filled. Type it on the page.</Result></>} /> },
  ],
};

const prototypeNote = 'The toolbar popup is built and tested in Chrome and Firefox against a stand-in for the Mac app, and the Mac app answers it for open vaults. It is a prototype outside the first release, and the Safari version has not yet run in Safari.';

export function browserTopics(): Topic[] {
  return [
    {
      id: 'browser-fill',
      quote: 'This browser doesn’t offer to fill anything.',
      elsewhere: 'Some browsers may not offer the system’s password fill, and then you copy and paste.',
      saves: 'One button in the toolbar lists the logins for the site, and fills the one you choose.',
      title: 'Filling a login from the browser toolbar',
      status: 'coming',
      statusNote: prototypeNote,
      pictures: toolbarFill,
    },
    {
      id: 'browser-other-site',
      quote: 'It found a login. Is it really for this site?',
      elsewhere: 'A search result that does not say which site it was saved for lets a lookalike address pass for the real one.',
      saves: 'Every result says which site it was saved for, so a lookalike address is easy to spot.',
      title: 'Telling this site’s logins from the rest',
      status: 'coming',
      statusNote: prototypeNote,
      pictures: otherSite,
    },
    {
      id: 'browser-locked',
      quote: 'The vault locked. Now I have to leave the page.',
      elsewhere: 'When the vault is locked, a popup that can only point you to the app sends you away from the page you were signing in to.',
      saves: 'Unlock with Touch ID without leaving the page. The next click lists the logins.',
      title: 'Unlocking from the browser popup',
      status: 'coming',
      statusNote: 'The popup, its Unlock button and the Touch ID steps are drawn and built in the popup. Unlocking the real vault of the Mac app from the popup is not built yet, and reopening the popup after Touch ID has not been checked in a real browser.',
      pictures: locked,
    },
    {
      id: 'checkout-card',
      quote: 'Checkout. I’m typing my card number again.',
      elsewhere: 'On iPhone and iPad the system fills logins from a password manager, but not card numbers or addresses, so a checkout is typed in by hand.',
      saves: 'Choose a card or an address in Safari and it fills the form, and says what it could not.',
      title: 'Filling a card at checkout in Safari',
      status: 'coming',
      statusNote: 'The Safari popup and the app side are built, but only in test builds: iPhone and iPad release builds leave them out until it is switched on, and it has not been seen on a device yet.',
      pictures: checkout,
    },
  ];
}

export function browserGroup(): TopicGroup {
  return {
    id: 'in-the-browser',
    heading: 'In the browser',
    lead: 'Psss in the toolbar of a Mac browser, and in Safari on iPhone and iPad.',
    topics: browserTopics(),
  };
}
