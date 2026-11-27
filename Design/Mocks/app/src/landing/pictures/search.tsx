import type { ReactNode } from 'react';
import type { Pictures } from '../Gallery';
import type { Item } from '../../data';
import { SidebarIcon } from '../../icons';
import { IPhone, MacWindow } from '../../components/devices';
import { Chevron, EmptyState, ListRow } from '../../components/Rows';
import { FilterMenu } from '../../components/FilterMenu';
import { SortMenu } from '../../components/SortMenu';
import { VaultDevice } from './vaultParts';
import './keyboard.css';

/* The search rule, the pills and the rows are drawn as pages/SearchFields.tsx draws them. That page does not export
   them, so the minimum is copied here, without state. Fictional vault: the username on most logins is an address at the person's own domain. */

type FieldKey = 'name' | 'website' | 'username';
const fieldKeys: FieldKey[] = ['name', 'website', 'username'];
const fieldNames: Record<FieldKey, string> = { name: 'Name', website: 'Website', username: 'Username' };

interface Login { id: number; name: string; website: string; username: string; color: Item['color'] }
const vault: Login[] = [
  { id: 1, name: 'Harbor.net', website: 'harbor.net', username: 'sam', color: 1 },
  { id: 2, name: 'Harbor Admin', website: 'admin.harbor.net', username: 'sam', color: 2 },
  { id: 3, name: 'Harbor Status', website: 'status.harbor.net', username: 'sam', color: 5 },
  { id: 4, name: 'Gitforge', website: 'gitforge.example', username: 'sam@harbor.net', color: 3 },
  { id: 5, name: 'Northbank', website: 'northbank.example', username: 'sam@harbor.net', color: 4 },
  { id: 6, name: 'Paperly', website: 'paperly.example', username: 'sam@harbor.net', color: 6 },
  { id: 7, name: 'Railcard', website: 'railcard.example', username: 'sam@harbor.net', color: 2 },
  { id: 8, name: 'Shoply', website: 'shoply.example', username: 'sam@harbor.net', color: 1 },
  { id: 9, name: 'Streamly', website: 'streamly.example', username: 'sam@harbor.net', color: 5 },
  { id: 10, name: 'Tidemap', website: 'tidemap.example', username: 'sam.r', color: 3 },
];

const has = (l: Login, f: FieldKey, q: string) => !!q && l[f].toLowerCase().includes(q.toLowerCase());
const countFor = (q: string, f: FieldKey) => vault.filter((l) => has(l, f, q)).length;

/** A login is found when any chosen field has the text; with no pill chosen, any field does. */
function search(q: string, chosen: FieldKey[]): Login[] {
  const fields = chosen.length ? chosen : fieldKeys;
  return vault.filter((l) => fields.some((f) => has(l, f, q)));
}

function marked(text: string, q: string): ReactNode {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return text;
  return <>{text.slice(0, at)}<span className="hit">{text.slice(at, at + q.length)}</span>{text.slice(at + q.length)}</>;
}

function shownField(l: Login, q: string, chosen: FieldKey[]): FieldKey {
  const order: FieldKey[] = chosen.length ? chosen : ['username', 'website', 'name'];
  return order.find((f) => has(l, f, q)) ?? 'username';
}

const asItem = (l: Login): Item => ({ id: l.id, name: l.name, account: l.username, kind: 'login', color: l.color, uses: 0, fields: [] });
const foundLine = (chosen: FieldKey[]) => (chosen.length ? `Found in ${chosen.map((f) => fieldNames[f].toLowerCase()).join(' or ')}` : null);
const plural = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

function Pills({ q, chosen }: { q: string; chosen: FieldKey[] }) {
  return (
    <div className="fpills" role="group" aria-label="Found in">
      {fieldKeys.map((f) => {
        const n = countFor(q, f);
        const on = chosen.includes(f);
        return (
          <button key={f} type="button" className={`fpill${on ? ' on' : ''}`} disabled={n === 0 && !on} aria-pressed={on}>
            {fieldNames[f]}<span className="n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function Rows({ q, chosen, mac }: { q: string; chosen: FieldKey[]; mac?: boolean }) {
  const rows = search(q, chosen);
  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${chosen.map((f) => fieldNames[f].toLowerCase()).join(' or ')} matches “${q}”`}
        text="Other fields may still match."
        action="Search All Fields"
      />
    );
  }
  return (
    <div className={mac ? 'scroll' : 'grp'}>
      {rows.map((l) => (
        <ListRow key={l.id} item={asItem(l)} mac={mac} traits={false} sub={marked(l[shownField(l, q, chosen)], q)} trailing={mac ? undefined : <Chevron />} />
      ))}
    </div>
  );
}

/** The iPhone search tab: the library draws the field above the keyboard. `cue` rings the Website pill. */
function Phone({ q, chosen = [], cue }: { q: string; chosen?: FieldKey[]; cue?: boolean }) {
  const n = search(q, chosen).length;
  return (
    <VaultDevice cue={cue ? 'website' : undefined}>
      <IPhone search={q}>
        <div className="lt">
          <div className="t">Results <span className="s" style={{ fontWeight: 400 }}>· {plural(n)}</span></div>
          {foundLine(chosen) && <div className="s">{foundLine(chosen)}</div>}
        </div>
        <Pills q={q} chosen={chosen} />
        <div className="pbody tabpad"><Rows q={q} chosen={chosen} /></div>
      </IPhone>
    </VaultDevice>
  );
}

/** The Mac window while a search is typed, as pages/SearchFields.tsx draws it. */
function Mac({ q, chosen = [] }: { q: string; chosen?: FieldKey[] }) {
  const n = search(q, chosen).length;
  return (
    <MacWindow>
      <div className="ws dt noside">
        <div className="ws-grid">
          <div className="col side" data-bounds>
            <div className="tbar"><span className="sp" /></div>
            <div className="scroll">
              <div className="sh">Passwords</div>
              {['All', 'Codes', 'Cards', 'Logins', 'Notes', 'Custom items', 'Recently Deleted'].map((l) => <div key={l} className="sr"><i />{l}</div>)}
            </div>
          </div>
          <div className="col list" data-bounds>
            <div className="tbar">
              <button type="button" className="ibtn" aria-label="Show sidebar" data-tip="Show sidebar"><SidebarIcon /></button>
              <span className="viewopts">
                <SortMenu value="used" onChange={() => {}} />
                <span style={{ opacity: .45, pointerEvents: 'none' }}><FilterMenu value={{ type: 'all', feats: [] }} onChange={() => {}} /></span>
              </span>
              <span className="sp" />
              <button type="button" className="btn glass">+ Add</button>
            </div>
            <div className="lh">Search results<span> · {plural(n)}</span>{foundLine(chosen) && <div className="s">{foundLine(chosen)}</div>}</div>
            <Pills q={q} chosen={chosen} />
            <Rows q={q} chosen={chosen} mac />
          </div>
          <div className="col det" data-bounds>
            <div className="tbar">
              <label className="searchbox"><span style={{ opacity: 0 }} />
                <input defaultValue={q} aria-label="Search all items" readOnly />
              </label>
            </div>
            <div className="scroll"><EmptyState title="No item open" text="Choose an item in the list." /></div>
          </div>
        </div>
      </div>
    </MacWindow>
  );
}

/* Mac only on the wide side: the mock draws the pills in the Mac window, and the shared Mac and iPad workspace has no pills yet. */
export function searchPictures(): Pictures {
  return {
    iphone: [
      { caption: 'You remember harbor.net, not the name. The pills say where it matched.', screen: <Phone q="harbor.net" cue /> },
      { caption: 'Website keeps the three logins that live on harbor.net.', screen: <Phone q="harbor.net" chosen={['website']} /> },
      { caption: 'Nothing matches in a username, so that pill is dimmed with 0.', screen: <Phone q="gitforge" /> },
      { caption: 'If a chosen field stops matching, the screen says so and offers every field.', screen: <Phone q="harbor.netx" chosen={['website']} /> },
    ],
    mac: [
      { caption: 'The same pills sit under the title, above the rows.', screen: <Mac q="harbor.net" /> },
      { caption: 'Website keeps the three logins that live on harbor.net.', screen: <Mac q="harbor.net" chosen={['website']} /> },
    ],
  };
}
