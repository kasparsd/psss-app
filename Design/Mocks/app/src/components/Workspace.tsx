import { useEffect, useMemo, useRef, useState } from 'react';
import { deletedItems, items as sampleItems, type Item } from '../data';
import { GearIcon, SearchIcon, SidebarIcon } from '../icons';
import { ItemCard } from './ItemCard';
import { CodeRow, CodesCountdown, EmptyState, ListRow } from './Rows';
import { UndoBanner } from './UndoBanner';
import type { Place } from './devices';

export type SideKey = 'recent' | 'most' | 'all' | 'codes' | 'cards' | 'logins' | 'notes' | 'custom' | 'deleted' | 'passkeys' | 'withnotes';

/** Sidebar rows, in the order the owner approved. */
const mainRows: [SideKey, string][] = [
  ['recent', 'Recent'], ['most', 'Most used'], ['all', 'All'], ['codes', 'Codes'], ['cards', 'Cards'],
  ['logins', 'Logins'], ['notes', 'Secure notes'], ['custom', 'Custom items'], ['deleted', 'Recently Deleted'],
];
const filterRows: [SideKey, string][] = [['passkeys', 'Passkeys'], ['withnotes', 'With notes']];
const titles: Record<SideKey, string> = Object.fromEntries([...mainRows, ...filterRows]) as Record<SideKey, string>;

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
  /** Start with the Codes info bubble open. */
  bubble?: boolean;
  /** Draw the Mac menu bar with the Psss menu open (Mac only). */
  menu?: boolean;
}

const placeOf = (s: SideKey): Place => (s === 'codes' ? 'codes' : s === 'cards' ? 'cards' : 'all');
const az = (a: Item, b: Item) => a.name.localeCompare(b.name);

function listFor(entries: Entry[], side: SideKey, q: string): Entry[] {
  const live = entries.filter((i) => !i.gone);
  if (q) {
    const w = q.toLowerCase();
    return live.filter((i) => `${i.name} ${i.account}`.toLowerCase().includes(w)).sort(az);
  }
  switch (side) {
    case 'recent': return live.filter((i) => i.recent);
    case 'most': return [...live].sort((a, b) => b.uses - a.uses);
    case 'all': return [...live].sort(az);
    case 'codes': return live.filter((i) => i.code || i.brokenCode).sort(az);
    case 'cards': return live.filter((i) => i.kind === 'card').sort((a, b) => Number(!!a.expired) - Number(!!b.expired) || b.uses - a.uses);
    case 'logins': return live.filter((i) => i.kind === 'login').sort(az);
    case 'notes': return live.filter((i) => i.kind === 'note').sort(az);
    case 'custom': return live.filter((i) => i.kind === 'custom').sort(az);
    case 'passkeys': return live.filter((i) => i.passkey).sort(az);
    case 'withnotes': return live.filter((i) => i.kind === 'note' || i.fields.some((f) => f.label === 'Notes')).sort(az);
    case 'deleted': return entries.filter((i) => i.gone);
  }
}

/**
 * The Mac / iPad proposal "Toolbar and Edit": three columns, a toolbar per
 * column. Interactive; `init` draws any state without a click.
 */
export function Workspace({ device, init = {}, empty = false }: { device: 'mac' | 'ipad'; init?: WorkspaceInit; empty?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(() => [
    ...sampleItems.map((i) => ({ ...i })),
    ...deletedItems.map((d) => ({ ...d, gone: d.deletedAgo })),
  ]);
  const [side, setSide] = useState<SideKey>(init.side ?? 'recent');
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
  const rows = useMemo(() => listFor(pool, side, q), [pool, side, q]);
  const sel = rows.find((r) => r.id === selId) ?? rows[0] ?? null;
  const count = (k: SideKey) => listFor(pool, k, '').length;
  const place = placeOf(side);
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
    const next = rows.filter((r) => r.id !== sel.id);
    setEntries((es) => es.map((e) => (e.id === sel.id ? { ...e, gone: 'Deleted just now' } : e)));
    setSelId(next.length ? next[Math.min(idx, next.length - 1)].id : null);
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
  const codesList = side === 'codes' && !q;

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
            {mainRows.map(([k, l]) => (
              <div key={k} className={`sr${side === k && !q ? ' sel' : ''}`} onClick={() => go(k)}>
                <i />{l}{k !== 'recent' && k !== 'most' && <span className="n">{count(k)}</span>}
              </div>
            ))}
            <div className="sh">Filters</div>
            {filterRows.map(([k, l]) => (
              <div key={k} className={`sr${side === k && !q ? ' sel' : ''}`} onClick={() => go(k)}>
                <i />{l}<span className="n">{count(k)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="col list" data-bounds>
          <div className="tbar">
            {!showSide && <button className="ibtn" aria-label="Show sidebar" data-tip="Show sidebar" onClick={() => setShowSide(true)}><SidebarIcon /></button>}
            <span className="segc" role="tablist">
              {(['all', 'codes', 'cards'] as Place[]).map((p) => (
                <button key={p} role="tab" aria-selected={!q && place === p} className={!q && place === p ? 'on' : ''} onClick={() => go(p)}>
                  {p === 'all' ? 'All' : p === 'codes' ? 'Codes' : 'Cards'}
                </button>
              ))}
            </span>
            <span className="sp" />
            <button className="btn glass">+ Add</button>
          </div>
          <div className="lh">{listTitle}<span> · {rows.length} {noun}{rows.length === 1 ? '' : 's'}</span></div>
          {rows.length === 0 ? (
            q ? <EmptyState title="No matches" text="Try another word." />
              : inDeleted ? <EmptyState title="Nothing deleted" text="Items you delete stay here for 30 days." />
              : <EmptyState title="Nothing here yet" text="Use + Add to create an item." />
          ) : (
            <div className="scroll">
              {codesList && <CodesCountdown bubble={init.bubble} />}
              {rows.map((r) =>
                codesList ? (
                  <CodeRow key={r.id} item={r} mac selected={sel?.id === r.id} onClick={() => { setSelId(r.id); setPristine(false); }} />
                ) : (
                  <ListRow key={r.id} item={r} mac selected={sel?.id === r.id} sub={inDeleted ? r.gone : undefined} onClick={() => { setSelId(r.id); setPristine(false); }} />
                ),
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

