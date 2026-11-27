import './hero.css';
import { items } from '../../data';
import { AllGlyph, CardsGlyph, CodesGlyph, GearIcon, MoreGlyph } from '../../icons';
import { IPhone, MacWindow, type TabSpec } from '../../components/devices';
import { Chevron, ListHead, ListRow } from '../../components/Rows';
import { Workspace, vaultTotal } from '../../components/Workspace';
import { Nav } from '../../screens/PhoneScreens';
import { allSections } from '../../listing';
import { BarMark } from '../../pages/MacMenuBar';
import { Caret, FillBtn, gitforge, harbor } from '../../components/loginParts';
import type { Item } from '../../data';

/*
 * The lead picture: one vault on three devices. The Mac window under the menu
 * bar (with the Psss item at its right end), the iPhone in front of the
 * window's lower left, and the browser popup hanging from a strip of toolbar
 * over its upper right. A picture only: no state, effects or handlers of its
 * own. Copied instead of imported, because the page files do not export them:
 * the popup's rows, search field and footer (pages/BrowserExtension.tsx) and
 * the phone's tab bar list (landing/pictures/vaultParts.tsx).
 */

const tabs: TabSpec[] = [
  ['all', 'All', <AllGlyph key="a" />],
  ['codes', 'Codes', <CodesGlyph key="c" />],
  ['cards', 'Cards', <CardsGlyph key="d" />],
  ['more', 'More', <MoreGlyph key="m" />],
];

/** The All list as the phone draws it: the same order and groups as the Mac list. */
function PhoneList() {
  const { recent, main } = allSections(items, 'all', [], 'used');
  return (
    <IPhone tab="all" tabs={tabs}>
      <Nav
        left={<button type="button" className="ibtn flat" aria-label="Settings"><GearIcon /></button>}
        right={<button type="button" className="btn">+ Add</button>}
      />
      <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· {vaultTotal} items</span></div></div>
      <div className="pbody tabpad">
        {recent.length > 0 && (
          <>
            <ListHead>Recently used</ListHead>
            <div className="grp">{recent.map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div>
            <ListHead>All items</ListHead>
          </>
        )}
        <div className="grp">{main.map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div>
      </div>
    </IPhone>
  );
}

function PopupRow({ item, sub, last }: { item: Item; sub?: string; last?: boolean }) {
  return (
    <div className={`xp-row${last ? ' last' : ''}`}>
      <div className={`ic c${item.color}`} aria-hidden>{item.name[0]}</div>
      <div className="grow"><div className="trunc">{item.name}</div>{sub && <div className="s trunc">{sub}</div>}</div>
      <FillBtn />
    </div>
  );
}

/** A strip of browser toolbar with the Psss button, and the popup hanging from it in its normal filling state. */
function BrowserPopup() {
  return (
    <div className="xb macui lph-browser">
      <div className="xb-bar">
        <div className="xb-url"><span aria-hidden>🔒</span> gitforge.example/login</div>
        <span className="xb-btn" aria-label="Psss">p</span>
      </div>
      <div className="xp" role="dialog" aria-label="Psss">
        <div className="xp-h"><div className="t">Psss</div></div>
        <div className="xp-search" style={{ boxShadow: '0 0 0 2px var(--accent)' }}><span className="s" aria-hidden>⌕</span><Caret /><span className="s">Search all logins</span></div>
        <div className="s" style={{ padding: '0 2px' }}>For This Site</div>
        <div className="xp-card">
          <PopupRow item={gitforge} sub="sam.r" />
          <PopupRow item={harbor} last />
        </div>
        <div className="xp-foot"><button type="button" className="btn">Settings</button></div>
      </div>
    </div>
  );
}

export function HeroArt() {
  return (
    <div className="lph" role="img" aria-label="Psss on an iPhone, in a Mac window with its menu bar item, and in a browser popup, all showing the same vault.">
      <div className="lph-fit" inert aria-hidden="true">
        <div className="lph-stage">
          <div className="lph-mac">
            <MacWindow menuBar>
              <Workspace device="mac" init={{ side: 'all', sel: 1 }} />
            </MacWindow>
            <div className="lph-bar-end"><span className="lph-mark"><BarMark /></span><span>Thu 09:41</span></div>
          </div>
          <BrowserPopup />
          <div className="lph-phone"><PhoneList /></div>
        </div>
      </div>
    </div>
  );
}
