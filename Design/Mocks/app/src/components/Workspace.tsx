import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { deletedItems, items as sampleItems, type Item } from '../data';
import { GearIcon, SearchIcon, SidebarIcon } from '../icons';
import { ItemCard } from './ItemCard';
import { CodeRow, EmptyState, ListHead, ListRow } from './Rows';
import { UndoBanner } from './UndoBanner';
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
  showSide?: boolean;
  q?: string;
  /** Field labels that start shown on the open item. */
  shown?: string[];
  /** Field label that starts with its checkmark on the open item. */
  copied?: string;
  /** Start with the Undo banner showing after a delete. */
  undo?: boolean;
  /** Start with the help bubble on the clipboard line open. */
  bubble?: boolean;
  /** Draw the Mac menu bar with the Psss menu open (Mac only). */
  menu?: boolean;
  /** The order of the All list, what it must have, and whether the Sort and Filter menus start open. */
  sort?: SortKey;
  sortOpen?: boolean;
  feats?: Feat[];
  filterOpen?: boolean;
}

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
export function Workspace({ device, init = {}, empty = false }: { device: 'mac' | 'ipad'; init?: WorkspaceInit; empty?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(() => [
    ...sampleItems.map((i) => ({ ...i })),
    ...deletedItems.map((d) => ({ ...d, gone: d.deletedAgo })),
  ]);
  const [side, setSide] = useState<SideKey>(init.side ?? 'all');
  const [sort, setSort] = useState<SortKey>(init.sort ?? 'used');
  const [feats, setFeats] = useState<Feat[]>(init.feats ?? []);
  const [selId, setSelId] = useState<number | null>(init.sel ?? null);
  const [editing, setEditing] = useState(init.editing ?? false);
  const [showSide, setShowSide] = useState(init.showSide ?? true);
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
  const count = (k: SideKey) => listFor(pool, k).length;
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

  const noun = q ? 'item' : side === 'codes' ? 'code' : side === 'cards' ? 'card' : 'item';
  const listTitle = q ? 'Search results' : titles[side];
  const mac = device === 'mac';
  const inDeleted = side === 'deleted' && !q;
  const line = !q && sortable(side) ? featLine(feats, oneType(side)) : '';
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

  return (
    <div className={`ws dt${showSide ? '' : ' noside'}${editing ? ' editing' : ''}${mac ? '' : ' ipadws'}`}>
      <div className="ws-grid">
        <div className="col side" data-bounds>
          <div className="tbar">
            <span className="sp" />
            {!mac && <button className="ibtn" aria-label="Setup" data-tip="Setup"><GearIcon /></button>}
            <button className="ibtn" aria-label="Hide sidebar" data-tip="Hide sidebar" onClick={() => setShowSide(false)}><SidebarIcon /></button>
          </div>
          <div className="scroll">
            <div className="sh">Sam's vault</div>
            {sideRows.map(([k, l]) => (
              <div key={k} className={`sr${side === k && !q ? ' sel' : ''}`} onClick={() => go(k)}>
                <i />{l}<span className="n">{count(k)}</span>
              </div>
            ))}
            <div className={`sr${side === 'deleted' && !q ? ' sel' : ''}`} onClick={() => go('deleted')}>
              <i />Recently Deleted<span className="n">{count('deleted')}</span>
            </div>
          </div>
        </div>

        <div className="col list" data-bounds>
          <div className="tbar">
            {!showSide && <button className="ibtn" aria-label="Show sidebar" data-tip="Show sidebar" onClick={() => setShowSide(true)}><SidebarIcon /></button>}
            <span className="sp" />
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
            <button className="btn glass">+ Add</button>
          </div>
          <div className="lh">{listTitle}<span> · {rows.length} {noun}{rows.length === 1 ? '' : 's'}</span>{line && <div className="s">{line}</div>}</div>
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
            {sel && (editing ? (
              <>
                <button className="btn glass" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn glass save" onClick={save}>Save</button>
              </>
            ) : inDeleted ? (
              <button className="btn glass" onClick={() => restore(sel.id)}>Restore</button>
            ) : (
              <button className="btn glass" onClick={startEdit}>Edit</button>
            ))}
            <label className="searchbox">
              <SearchIcon />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPristine(false); }} placeholder="Search all items" aria-label="Search all items" />
            </label>
          </div>
          <div className="scroll">
            {sel ? (
              <div className="dbody">
                <ItemCard
                  key={`${sel.id}-${editing}`}
                  item={sel}
                  mode={editing ? 'edit' : 'view'}
                  shown={pristine ? init.shown : undefined}
                  copied={pristine ? init.copied : undefined}
                  bubble={pristine ? init.bubble : undefined}
                  code={editing ? { draft, add: () => setDraft('246 810'), remove: () => setDraft(null) } : undefined}
                  onSetUpCode={() => { setDraft(null); setEditing(true); }}
                  onDelete={inDeleted ? undefined : remove}
                />
              </div>
            ) : (
              <EmptyState title="No item open" text="Choose an item in the list." />
            )}
          </div>
        </div>
      </div>
      {undo && (
        <UndoBanner
          text={`“${undo.name}” moved to Recently Deleted`}
          onUndo={() => { if (undo.id) restore(undo.id); setUndo(null); }}
        />
      )}
    </div>
  );
}
