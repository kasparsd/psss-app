import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deletedItems, items as sampleItems, type Item } from '../data';
import { ChevronDownIcon, GearIcon, LockClosedIcon, SearchIcon, SidebarIcon, VaultsIcon } from '../icons';
import { VaultMenu, addItems } from './VaultMenu';
import { VaultCapsule } from './VaultCapsule';
import { ItemCard } from './ItemCard';
import { CodeRow, EmptyState, ListHead, ListRow } from './Rows';
import { UndoBanner } from './UndoBanner';
import { BioPrompt } from './BioPrompt';
import { PasswordField, UnlockRow } from './UnlockRow';
import { Notice } from './Notice';
import { LockIcon } from '../pages/UnlockScreen';
import { allHeading, allSections, featLine, listOne, sortItems, withRecent, type Feat, type SortKey, type TypeKey } from '../listing';
import { FilterMenu } from './FilterMenu';
import { SortMenu } from './SortMenu';

export type SideKey = 'all' | 'codes' | 'cards' | 'logins' | 'notes' | 'custom' | 'deleted';

/** The sidebar: the places, then the kinds, then Recently Deleted. */
const sideRows: [SideKey, string][] = [
  ['all', 'All'], ['codes', 'Codes'], ['cards', 'Cards'],
  ['logins', 'Logins'], ['notes', 'Notes'], ['custom', 'Custom items'],
];
const titles: Record<SideKey, string> = { ...Object.fromEntries(sideRows), deleted: 'Recently Deleted' } as Record<SideKey, string>;
const oneType = (s: SideKey): TypeKey => (s === 'logins' || s === 'notes' || s === 'custom' ? s : 'all');
/** The lists the Sort menu orders: All and its kinds. Codes, Cards and Recently Deleted keep their own order. */
const sortable = (s: SideKey) => s !== 'codes' && s !== 'cards' && s !== 'deleted';

type Entry = Item & { gone?: string };

export interface WorkspaceInit {
  side?: SideKey;
  sel?: number;
  editing?: boolean;
  /** The clipboard holds an image: the editor offers Paste under the setup key. */
  pasteImage?: boolean;
  showSide?: boolean;
  q?: string;
  /** Field labels that start shown on the open item. */
  shown?: string[];
  /** Field label that starts with its checkmark on the open item. */
  copied?: string;
  /** Start with the Undo banner showing after a delete. */
  undo?: boolean;
  /** Start with the help bubble on the passkey heading open. */
  bubble?: boolean;
  /** Draw the Mac menu bar with the Psss menu open (Mac only). */
  menu?: boolean;
  /** The order of the All list, what it must have, and whether the Sort and Filter menus start open. */
  sort?: SortKey;
  sortOpen?: boolean;
  feats?: Feat[];
  filterOpen?: boolean;
  /**
   * Vaults as sidebar sections, the way Mail shows accounts (owner, 2026-11-25). Several vaults can be open at once (owner, 2026-11-25). `one` (default): one section, expanded. `two`: Passwords open and expanded, Work locked and collapsed with a lock.
   * `both`: Passwords and Work are both open, each section expanded with its places. `locked`: the window is locked (auto-lock locks every vault): every section is collapsed with a lock and the content area shows the unlock form for Passwords (the last used).
   */
  vaults?: 'one' | 'two' | 'both';
  locked?: boolean;
  /**
   * A vault just added with Open Vault File… (owner, 2026-11-25): it is at the end of the list as a locked section, and pairs with `unlock` to show its first unlock form (password only; Touch ID is not offered until it has been unlocked once).
   * The file's password is never asked inside the add flow.
   */
  added?: string;
  /** The person chose this locked vault: the content area (list and detail columns) shows its unlock form. */
  unlock?: string;
  /** A menu drawn open: the context menu of an open vault's section header (`context`, Passwords) or of a locked one (`context-locked`, Work), or the Add Vault menu at the foot of the sidebar. */
  sideMenu?: 'context' | 'context-locked' | 'add' | 'capsule';
  /** Mac: the system's Touch ID prompt is drawn over the unlock form (it appears by itself when the form becomes active). */
  bioPrompt?: boolean;
  /** The unlock form has no Use Touch ID (Face ID) button: Touch ID is off for this vault. */
  noBio?: boolean;
  /** A state of the unlock form: not recognised, the password being checked, a wrong password, or the vault changed elsewhere. */
  unlockState?: 'failed' | 'checking' | 'wrong' | 'changed';
}

/** The Passwords vault holds 214 items in every frame of every page (Settings says so too); the sample list below has fewer rows, so the totals are drawn, not counted. */
export const vaultTotal = 214;
/** Work holds 38 items; its places show the same sample rows, so its total is drawn too. */
const workTotal = 38;

const az = (a: Item, b: Item) => a.name.localeCompare(b.name);

/** The list of a place or kind, before Sort and With. Codes and Cards keep their own order. */
function listFor(entries: Entry[], side: SideKey): Entry[] {
  const live = entries.filter((i) => !i.gone);
  switch (side) {
    case 'codes': return live.filter((i) => i.code || i.brokenCode).sort(az);
    case 'cards': return live.filter((i) => i.kind === 'card').sort((a, b) => Number(!!a.expired) - Number(!!b.expired) || az(a, b));
    case 'deleted': return entries.filter((i) => i.gone);
    default: return listOne(live, oneType(side), [], 'name');
  }
}

/**
 * The Mac and iPad window: three columns, a toolbar per column. Interactive;
 * `init` draws any state without a click.
 */
/** A page that draws its own item column: the body, whether it is being edited, and a sheet over the window. */
export interface WorkspaceCustom { body: ReactNode; editing?: boolean; overlay?: ReactNode }

/**
 * A vault's section header in the sidebar (owner, 2026-11-25, as built): a plain label at the size of a sidebar row, icon on the left (a closed padlock when locked, the vault glyph when open), then the name; nothing after the name.
 * The vault on screen (its places, or its unlock form) is in the primary colour, the others secondary. No own chevron: the system's disclosure chevron appears on hover for an open vault only (a locked vault shows none).
 * The vault's actions are the right-click menu (long-press on iPad), opened at the pointer.
 */
function VaultHeader({ name, open, locked, sel, onClick, onContext }: { name: string; open?: boolean; locked?: boolean; sel?: boolean; onClick?: () => void; onContext?: (at: { x: number; y: number }) => void }) {
  return (
    <div className={`vsh${sel || open ? ' on' : ''}`} role="button" aria-expanded={open ? true : undefined} aria-label={locked ? `${name}, locked` : name} data-tip={locked ? `${name} is locked. Choose it to unlock.` : `${name}. Right-click for vault actions.`} onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        const host = e.currentTarget.parentElement as HTMLElement;
        const r = host.getBoundingClientRect();
        const k = r.width ? host.offsetWidth / r.width : 1;
        onContext?.({ x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k });
      }}>
      <span className="vhi" aria-hidden="true">{locked ? <LockClosedIcon /> : <VaultsIcon />}</span>
      <span className="vhn">{name}</span>
      {open && <span className="vhc" aria-hidden="true"><ChevronDownIcon /></span>}
    </div>
  );
}

/**
 * The sidebar's foot, pinned to the bottom of the sidebar on Mac and iPad (on iPad the safe-area bar of the sidebar list), not a row of the list (owner, 2026-11-25):
 * the labeled Add Vault control with its menu (the three ways to add a vault), and at its trailing end an icon-only gear that opens app Settings (Mac: the Settings window, as ⌘, does; iPad: the Settings sheet).
 * Both are the system’s glass buttons, as in the toolbar (a capsule and a circle), with no divider or bar behind them.
 * The gear is in the sidebar, not in a window toolbar, so Apple's note against settings buttons in a toolbar does not apply. It has the accessibility label and the tooltip “Settings”.
 */
function SidebarFoot({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="sfoot">
      <div className="sfadd-wrap">
        <button className="sfadd" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}><span className="sfp" aria-hidden="true">+</span>Add Vault</button>
        {open && (
          <div className="pop vadd" role="menu">
            {addItems.map((l) => <button key={l} role="menuitem" onClick={onToggle}>{l}</button>)}
          </div>
        )}
      </div>
      <button className="sfgear" aria-label="Settings" data-tip="Settings"><GearIcon /></button>
    </div>
  );
}

/**
 * A locked vault chosen in the sidebar (or the locked window): the window swaps to two columns, the sidebar and the unlock form, which fills the place of the list and detail columns (as built: the app icon, “Unlock Work”, the field, the Unlock row, Forgot Password and Help; no intro line). The other open vaults stay open, and the section of this one expands after it unlocks.
 * One row under the field: Unlock, the default button, disabled until a password is typed, then Use Touch ID (Face ID on iPad). On the Mac the system's Touch ID prompt appears by itself when this form becomes active.
 */
function UnlockPane({ name, bio, state, onUnlock }: { name: string; bio?: 'Touch ID' | 'Face ID'; state?: 'failed' | 'checking' | 'wrong' | 'changed'; onUnlock?: () => void }) {
  const [pw, setPw] = useState(state === 'checking' ? '••••••••••••' : state === 'wrong' ? 'hunter2hunter2' : '');
  return (
    <div className="col unlockpane" data-bounds>
      <div className="lk">
        <LockIcon />
        <div className="lk-title">Unlock {name}</div>
        <div className="lk-form">
          <PasswordField value={pw} onChange={setPw} dim={state === 'checking'} />
          <UnlockRow bio={bio} typed={pw.length > 0} busy={state === 'checking'} onUnlock={onUnlock} />
          {state === 'checking' && (
            <Notice kind="progress" title="Checking your vault password…">This takes a moment on purpose: it makes guessing your vault password very slow. Keep this window open.</Notice>
          )}
          {state === 'wrong' && (
            <Notice kind="warning" action={<button className="btn sq">Choose Key File…</button>}>That didn’t open {name}. Check Caps Lock and your keyboard language. If this vault uses a key file, choose it too.</Notice>
          )}
          {state === 'changed' && <Notice kind="info">The vault was changed by another app or device and needs your vault password again.</Notice>}
          {state === 'failed' && bio && <Notice kind="info">{bio} didn’t recognise you. Try again, or enter the vault password.</Notice>}
          <div className="lk-help">
            <button className="btn sq">Forgot Password</button>
            <button className="btn sq">Help</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Workspace({ device, init = {}, empty = false, extra, custom }: {
  device: 'mac' | 'ipad';
  init?: WorkspaceInit;
  empty?: boolean;
  /** Items this page adds to the sample vault. */
  extra?: Item[];
  custom?: WorkspaceCustom;
}) {
  const [entries, setEntries] = useState<Entry[]>(() => [
    ...sampleItems.map((i) => ({ ...i })),
    ...(extra ?? []).map((i) => ({ ...i })),
    ...deletedItems.map((d) => ({ ...d, gone: d.deletedAgo })),
  ]);
  const [side, setSide] = useState<SideKey>(init.side ?? 'all');
  const [sort, setSort] = useState<SortKey>(init.sort ?? 'used');
  const [feats, setFeats] = useState<Feat[]>(init.feats ?? []);
  const [selId, setSelId] = useState<number | null>(init.sel ?? null);
  const [editing, setEditing] = useState(init.editing ?? false);
  const [showSide, setShowSide] = useState(init.showSide ?? true);
  const [unlocking, setUnlocking] = useState<string | null>(init.locked ? 'Passwords' : init.unlock ?? null);
  const [ctx, setCtx] = useState<string | null>(init.sideMenu === 'context' ? 'Passwords' : init.sideMenu === 'context-locked' ? 'Work' : null);
  /** Where the context menu opens: at the pointer, inside the section. The drawn frames put it a little right of the name. */
  const [ctxAt, setCtxAt] = useState<{ x: number; y: number }>({ x: 96, y: 22 });
  const [vault, setVault] = useState<string>('Passwords');
  const [workUnlocked, setWorkUnlocked] = useState(init.vaults === 'both');
  const [capMenu, setCapMenu] = useState(init.sideMenu === 'capsule');
  const [addMenu, setAddMenu] = useState(init.sideMenu === 'add');
  const twoVaults = init.vaults === 'two' || init.vaults === 'both' || !!init.locked || !!init.unlock || !!init.added;
  const openVaultLocked = !!init.locked;
  const passOpen = !openVaultLocked;
  const workOpen = workUnlocked && !init.locked;
  /** Open vaults, in the fixed order. */
  const openNames = [...(passOpen ? ['Passwords'] : []), ...(workOpen ? ['Work'] : [])];
  const [q, setQ] = useState(init.q ?? '');
  const [draftState, setDraft] = useState<string | null | undefined>(undefined);
  const [pristine, setPristine] = useState(true);
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(
    init.undo ? { id: 0, name: 'Gitforge' } : null,
  );
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const pool = empty ? [] : entries;
  const live = useMemo(() => pool.filter((i) => !i.gone), [pool]);
  /** What the list shows: the Recently used group (if any) above every listed item. */
  const { recent, main: rows } = useMemo(() => {
    if (q) {
      const w = q.toLowerCase();
      return { recent: [] as Entry[], main: sortItems(live.filter((i) => `${i.name} ${i.account}`.toLowerCase().includes(w)), sort) };
    }
    if (sortable(side)) return allSections(live, oneType(side), feats, sort);
    const list = listFor(pool, side);
    if (side === 'codes') return withRecent(list);
    if (side === 'cards') return withRecent(list.filter((i) => !i.expired), list);
    return { recent: [] as Entry[], main: list };
  }, [pool, live, side, q, sort, feats]);
  const shownFirst = recent[0] ?? rows[0] ?? null;
  const sel = rows.find((r) => r.id === selId) ?? shownFirst;
  const count = (k: SideKey, v: string = vault) => (k === 'all' && !empty ? (v === 'Work' ? workTotal : vaultTotal) : listFor(pool, k).length);
  const draft = draftState === undefined ? (sel?.code ?? null) : draftState;

  const go = (s: SideKey) => { setSide(s); setQ(''); setEditing(false); setPristine(false); };
  const startEdit = () => {
    if (!sel) return;
    setDraft(undefined);
    setEditing(true);
  };
  const save = () => {
    if (sel) setEntries((es) => es.map((e) => (e.id === sel.id ? { ...e, code: draft ?? undefined, brokenCode: false } : e)));
    setEditing(false);
  };
  const remove = () => {
    if (!sel) return;
    const idx = rows.indexOf(sel);
    const left = rows.filter((r) => r.id !== sel.id);
    setEntries((es) => es.map((e) => (e.id === sel.id ? { ...e, gone: 'Deleted just now' } : e)));
    setSelId(left.length ? left[Math.min(idx, left.length - 1)].id : null);
    setEditing(false);
    setUndo({ id: sel.id, name: sel.name });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 10000);
  };
  const restore = (id: number) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, gone: undefined } : e)));
    if (side !== 'deleted') setSelId(id);
  };

  const total = !empty && !q && side === 'all' && feats.length === 0 ? (vault === 'Work' ? workTotal : vaultTotal) : rows.length;
  const noun = q ? 'item' : side === 'codes' ? 'code' : side === 'cards' ? 'card' : 'item';
  const listTitle = q ? 'Search results' : titles[side];
  const mac = device === 'mac';
  const isEditing = custom ? !!custom.editing : editing;
  const inDeleted = side === 'deleted' && !q;
  const filterLine = !q && sortable(side) ? featLine(feats, oneType(side)) : '';
  /** With two or more vaults open the list says which vault the place belongs to. */
  const line = filterLine;
  const codesList = side === 'codes' && !q;
  const cardsList = side === 'cards' && !q;
  const allHead = side === 'codes' ? 'All codes' : side === 'cards' ? 'All cards' : allHeading(oneType(side));
  // An item in the group and in the list below is selected once: in the group.
  const inGroup = (id: number) => recent.some((r) => r.id === id);
  const row = (r: Entry, inRecent: boolean) => {
    const selected = sel?.id === r.id && (inRecent || !inGroup(r.id));
    const pick = () => { setSelId(r.id); setPristine(false); };
    return codesList
      ? <CodeRow key={r.id} item={r} mac selected={selected} onClick={pick} />
      : <ListRow key={r.id} item={r} mac selected={selected} traits={!inDeleted} sub={inDeleted ? r.gone : undefined} onClick={pick} />;
  };
  const expiredRows = cardsList ? rows.filter((r) => r.expired) : [];
  const mainRows = cardsList ? rows.filter((r) => !r.expired) : rows;

  /** One vault's section of the sidebar: the header (its actions are the right-click menu), and its places when the vault is open. */
  const section = (name: string, isOpen: boolean) => (
    <Fragment key={name}>
      <div className="vsec">
        <VaultHeader name={name} open={isOpen} locked={!isOpen} sel={unlocking === name} onClick={() => (isOpen ? undefined : setUnlocking(name))} onContext={(at) => { setCtxAt(at); setCtx(name); }} />
        {ctx === name && (
          <div className="pop vctx" role="menu" style={{ left: ctxAt.x, top: ctxAt.y }}>
            <button role="menuitem">Vault Settings…</button>
            <button role="menuitem">{isOpen ? `Lock ${name}` : `Unlock ${name}…`}</button>
            {mac && <><div className="ph sepd" style={{ padding: 0 }} /><button role="menuitem">Show in Finder</button></>}
            {!mac && <div className="ph sepd" style={{ padding: 0 }} />}
            <button role="menuitem">Remove Vault…</button>
          </div>
        )}
      </div>
      {isOpen && (
        <>
          {sideRows.map(([k, l]) => (
            <div key={k} className={`sr${vault === name && side === k && !q && !unlocking ? ' sel' : ''}`} onClick={() => { setUnlocking(null); setVault(name); go(k); }}>
              <i />{l}<span className="n">{count(k, name)}</span>
            </div>
          ))}
          <div className={`sr${vault === name && side === 'deleted' && !q && !unlocking ? ' sel' : ''}`} onClick={() => { setUnlocking(null); setVault(name); go('deleted'); }}>
            <i />Recently Deleted<span className="n">{count('deleted', name)}</span>
          </div>
        </>
      )}
    </Fragment>
  );

  return (
    <div className={`ws dt${showSide ? '' : ' noside'}${isEditing ? ' editing' : ''}${mac ? ' macui' : ' ipadws'}`}>
      <div className="ws-grid">
        <div className="col side" data-bounds>
          <div className="tbar">
            <span className="sp" />
            <button className="ibtn" aria-label="Hide sidebar" data-tip="Hide sidebar" onClick={() => setShowSide(false)}><SidebarIcon /></button>
          </div>
          <div className="scroll">
            {section('Passwords', passOpen)}
            {twoVaults && section('Work', workOpen)}
            {init.added && section(init.added, false)}
          </div>
          <SidebarFoot open={addMenu} onToggle={() => setAddMenu(!addMenu)} />
        </div>

        {unlocking ? (
          <UnlockPane name={unlocking} bio={unlocking === init.added || init.noBio ? undefined : mac ? 'Touch ID' : 'Face ID'} state={init.unlockState} onUnlock={unlocking === 'Work' && !openVaultLocked ? () => { setWorkUnlocked(true); setVault('Work'); setSide('all'); setUnlocking(null); } : undefined} />
        ) : (<>
        <div className="col list" data-bounds>
          <div className="tbar">
            {!showSide && <button className="ibtn" aria-label="Show sidebar" data-tip="Show sidebar" onClick={() => setShowSide(true)}><SidebarIcon /></button>}
            {!mac && !showSide && <button className="ibtn" aria-label="Settings" data-tip="Settings"><GearIcon /></button>}
            {!mac && !showSide && <span onClick={() => setCapMenu(!capMenu)}><VaultCapsule open={capMenu} menu={<VaultMenu single={!twoVaults} current={vault} open={openNames} onPick={() => setCapMenu(false)} />} /></span>}
            {/* Sort and Filter share one capsule: both change how the list is shown. + Add stands apart at the trailing edge, next to Edit. On the Mac Sort and Filter are at the column’s start; iPadOS keeps them beside + Add. */}
            {!mac && <span className="sp" />}
            <span className="viewopts">
            {(q || sortable(side)) && <SortMenu value={sort} onChange={setSort} open={init.sortOpen} />}
            {(sortable(side) || !showSide) && !inDeleted && (
              <FilterMenu
                showTypes={!showSide}
                extraTypes={[{ label: 'Codes', on: side === 'codes', pick: () => go('codes') }, { label: 'Cards', on: side === 'cards', pick: () => go('cards') }]}
                open={init.filterOpen}
                value={{ type: oneType(side), feats }}
                onChange={(v) => { setFeats(v.feats); if (!showSide && (v.type !== oneType(side) || !sortable(side))) go(v.type); }}
                onDeleted={() => go('deleted')}
              />
            )}
            </span>
            {mac && <span className="sp" />}
            <button className="btn glass">{inDeleted ? 'Delete All…' : '+ Add'}</button>
          </div>
          <div className="lh">{listTitle}<span> · {total} {noun}{total === 1 ? '' : 's'}</span>{line && <div className="s">{line}</div>}</div>
          {rows.length === 0 ? (
            q ? <EmptyState title="No matches" text="Try another word." />
              : inDeleted ? <EmptyState title="Nothing deleted" text="Items you delete stay here for 30 days." />
              : <EmptyState title="Nothing here yet" text="Use + Add to create an item." />
          ) : (
            <div className="scroll">
              {recent.length > 0 && (
                <>
                  <ListHead mac>Recently used</ListHead>
                  {recent.map((r) => row(r, true))}
                  <ListHead mac>{allHead}</ListHead>
                </>
              )}
              {mainRows.map((r) => row(r, false))}
              {expiredRows.length > 0 && (
                <Fragment>
                  <ListHead mac>Expired</ListHead>
                  {expiredRows.map((r) => row(r, false))}
                </Fragment>
              )}
              {codesList && <div className="s" style={{ padding: '10px 18px' }}>{mac ? 'Click a code to copy it, or press ⌘C.' : 'Tap a code to copy it. Tap the name to open the login.'}</div>}
            </div>
          )}
        </div>

        <div className="col det" data-bounds>
          <div className="tbar">
            {sel && (isEditing ? (
              <>
                <button className="btn glass" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn pri main" onClick={save}>Save</button>
              </>
            ) : inDeleted ? (
              <button className="btn glass" onClick={() => restore(sel.id)}>Restore</button>
            ) : (
              <button className="btn glass main" onClick={startEdit}>Edit</button>
            ))}
            <label className="searchbox">
              <SearchIcon />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPristine(false); }} placeholder="Search all items" aria-label="Search all items" />
            </label>
          </div>
          <div className="scroll">
            {custom ? (
              <div className="dbody">{custom.body}</div>
            ) : sel ? (
              <div className="dbody">
                <ItemCard
                  key={`${sel.id}-${editing}`}
                  item={sel}
                  mode={editing ? 'edit' : 'view'}
                  shown={pristine ? init.shown : undefined}
                  copied={pristine ? init.copied : undefined}
                  bubble={pristine ? init.bubble : undefined}
                  code={editing ? { draft, add: () => setDraft('246 810'), remove: () => setDraft(null) } : undefined}
                  onPasteCodeImage={editing && init.pasteImage ? () => setDraft('348 692') : undefined}
                  onSetUpCode={() => { setDraft(null); setEditing(true); }}
                  onDelete={inDeleted ? undefined : remove}
                />
              </div>
            ) : (
              <EmptyState title="No item open" text="Choose an item in the list." />
            )}
          </div>
        </div>
        </>)}
      </div>
      {custom?.overlay}
      {mac && init.bioPrompt && unlocking && <BioPrompt bio="Touch ID" reason={`Psss wants to unlock ${unlocking}`} mac sheet />}
      {undo && (
        <UndoBanner
          text={`“${undo.name}” moved to Recently Deleted`}
          onUndo={() => { if (undo.id) restore(undo.id); setUndo(null); }}
        />
      )}
    </div>
  );
}
