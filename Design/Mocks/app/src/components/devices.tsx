import { useEffect, useState, type ReactNode } from 'react';
import { AllGlyph, CardsGlyph, CloseIcon, CodesGlyph, SearchIcon } from '../icons';
import { CopyHost } from './copy';

export type Device = 'iphone' | 'ipad' | 'mac';
export type Place = 'all' | 'codes' | 'cards';
export const deviceNames: Record<Device, string> = { iphone: 'iPhone', ipad: 'iPad', mac: 'Mac' };

const places: [Place, string, ReactNode][] = [
  ['all', 'All', <AllGlyph key="a" />],
  ['codes', 'Codes', <CodesGlyph key="c" />],
  ['cards', 'Cards', <CardsGlyph key="d" />],
];

/** iOS 26 bottom bar: All / Codes / Cards pills, and the search tab detached at bottom right. */
export function TabBar({ tab, onTab, search }: { tab: Place | null; onTab?: (p: Place) => void; search?: string }) {
  if (search !== undefined) {
    return (
      <div className="tabbar up">
        <button className="circ" aria-label="Close search"><CloseIcon /></button>
        <div className="sfield"><SearchIcon />{search}</div>
      </div>
    );
  }
  return (
    <div className="tabbar">
      <div className="tabs" role="tablist">
        {places.map(([p, label, glyph]) => (
          <button key={p} role="tab" aria-selected={tab === p} className={`tab${tab === p ? ' on' : ''}`} onClick={() => onTab?.(p)}>
            {glyph}
            {label}
          </button>
        ))}
      </div>
      <button className="circ" aria-label="Search"><SearchIcon /></button>
    </div>
  );
}

/** iPhone frame: status bar, content, tab bar (omit `tab` for a screen without one, such as the editor). */
export function IPhone({ children, tab, onTab, search, pill, tall }: {
  children: ReactNode;
  tab?: Place | null;
  onTab?: (p: Place) => void;
  /** Draws the search tab open: the field above the keyboard. */
  search?: string;
  /** Draws a copy pill that is already showing. */
  pill?: string;
  /** Grow with the content instead of a fixed screen height. */
  tall?: boolean;
}) {
  const hasBar = tab !== undefined || search !== undefined;
  return (
    <div className={'phone dt'}>
      <div className={`scr${tall ? ' tall' : ''}`} data-bounds>
        <CopyHost initial={pill} className={hasBar ? 'above-tabbar' : ''}>
          <div className="sbar"><span>9:41</span><span>●●● 100%</span></div>
          {children}
          {hasBar && <TabBar tab={tab ?? null} onTab={onTab} search={search} />}
          {search !== undefined && <div className="kbd">Keyboard</div>}
        </CopyHost>
      </div>
    </div>
  );
}

/** iPad frame: bezel, status bar. Narrow-width iPad is drawn with IPhone instead. */
export function IPad({ children, pill }: { children: ReactNode; pill?: string }) {
  return (
    <div className="ipad dt">
      <div className="win">
        <CopyHost initial={pill}>
          <div className="sbar"><span>9:41</span><span>●●● 100%</span></div>
          {children}
        </CopyHost>
      </div>
    </div>
  );
}

/** Mac window with traffic lights and an optional menu bar (Psss › Settings… ⌘,). */
export function MacWindow({ children, menuBar, menuOpen: open0 = false, pill }: {
  children: ReactNode;
  menuBar?: boolean;
  menuOpen?: boolean;
  pill?: string;
}) {
  const [open, setOpen] = useState(open0);
  useEffect(() => {
    if (!open) return;
    const away = () => setOpen(false);
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [open]);
  return (
    <div className="macwrap dt">
      {menuBar && (
        <div className="menubar">
          <span />
          <button className={`app${open ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>Psss</button>
          <span>File</span><span>Edit</span><span>View</span><span>Item</span><span>Window</span><span>Help</span>
          {open && (
            <div className="amenu">
              <div className="mi">About Psss</div>
              <div className="msep" />
              <div className="mi hl">Settings…<span className="k">⌘,</span></div>
              <div className="msep" />
              <div className="mi">Lock Psss<span className="k">⌃⌘Q</span></div>
              <div className="mi">Quit Psss<span className="k">⌘Q</span></div>
            </div>
          )}
        </div>
      )}
      <div className="macwin has-lights" data-bounds>
        <CopyHost initial={pill}>
          <span className="lights"><i /><i /><i /></span>
          {children}
        </CopyHost>
      </div>
    </div>
  );
}
