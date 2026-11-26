import { useState, type ReactNode } from 'react';
import { SidebarIcon } from '../icons';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, MacWindow } from '../components/devices';
import { Chevron, EmptyState, ListRow } from '../components/Rows';
import type { Item } from '../data';
import { SortMenu } from '../components/SortMenu';
import { FilterMenu } from '../components/FilterMenu';

type FieldKey = 'name' | 'website' | 'username';
const fieldKeys: FieldKey[] = ['name', 'website', 'username'];
const fieldNames: Record<FieldKey, string> = { name: 'Name', website: 'Website', username: 'Username' };

interface Login { id: number; name: string; website: string; username: string; color: Item['color'] }

/** Fictional. The person's username everywhere is an email at their own domain, which is also the website of a few logins. */
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

const value = (l: Login, f: FieldKey) => l[f];
const has = (l: Login, f: FieldKey, q: string) => !!q && value(l, f).toLowerCase().includes(q.toLowerCase());

/** The search rule: a login is found when any chosen field contains the text; with no pill chosen, any field does. */
function search(q: string, chosen: FieldKey[]): Login[] {
  const fields = chosen.length ? chosen : fieldKeys;
  return vault.filter((l) => fields.some((f) => has(l, f, q)));
}
const countFor = (q: string, f: FieldKey) => vault.filter((l) => has(l, f, q)).length;

/** The text with the part that matched in the primary colour, the rest secondary. */
function marked(text: string, q: string): ReactNode {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return text;
  return <>{text.slice(0, at)}<span className="hit">{text.slice(at, at + q.length)}</span>{text.slice(at + q.length)}</>;
}

/** The field a row shows under its name: a chosen pill's field, otherwise the first field that matched (username first). */
function shownField(l: Login, q: string, chosen: FieldKey[]): FieldKey {
  const order: FieldKey[] = chosen.length ? chosen : ['username', 'website', 'name'];
  return order.find((f) => has(l, f, q)) ?? 'username';
}

const asItem = (l: Login): Item => ({ id: l.id, name: l.name, account: l.username, kind: 'login', color: l.color, uses: 0, fields: [] });

function Pills({ q, chosen, onToggle }: { q: string; chosen: FieldKey[]; onToggle?: (f: FieldKey) => void }) {
  return (
    <div className="fpills" role="group" aria-label="Found in">
      {fieldKeys.map((f) => {
        const n = countFor(q, f);
        const on = chosen.includes(f);
        return (
          <button key={f} className={`fpill${on ? ' on' : ''}`} disabled={n === 0 && !on} aria-pressed={on} onClick={() => onToggle?.(f)}>
            {fieldNames[f]}<span className="n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Only when a pill is chosen: with none, the line would say nothing new. */
const foundLine = (chosen: FieldKey[]) =>
  chosen.length ? `Found in ${chosen.map((f) => fieldNames[f].toLowerCase()).join(' or ')}` : null;

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
        <ListRow
          key={l.id}
          item={asItem(l)}
          mac={mac}
          traits={false}
          sub={marked(value(l, shownField(l, q, chosen)), q)}
          trailing={mac ? undefined : <Chevron />}
        />
      ))}
    </div>
  );
}

function PhoneSearchFields({ q, chosen: c0 = [], live }: { q: string; chosen?: FieldKey[]; live?: boolean }) {
  const [chosen, setChosen] = useState<FieldKey[]>(c0);
  const toggle = (f: FieldKey) => setChosen((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));
  const n = search(q, chosen).length;
  return (
    <IPhone search={q}>
      <div className="lt">
        <div className="t">Results <span className="s" style={{ fontWeight: 400 }}>· {n} item{n === 1 ? '' : 's'}</span></div>
        {foundLine(chosen) && <div className="s">{foundLine(chosen)}</div>}
      </div>
      <Pills q={q} chosen={chosen} onToggle={live ? toggle : undefined} />
      <div className="pbody tabpad"><Rows q={q} chosen={chosen} /></div>
    </IPhone>
  );
}

function MacSearchFields({ q, chosen: c0 = [] }: { q: string; chosen?: FieldKey[] }) {
  const [chosen, setChosen] = useState<FieldKey[]>(c0);
  const toggle = (f: FieldKey) => setChosen((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));
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
              <button className="ibtn" aria-label="Show sidebar" data-tip="Show sidebar"><SidebarIcon /></button>
              <span className="viewopts">
                <SortMenu value="used" onChange={() => {}} />
                <span style={{ opacity: .45, pointerEvents: 'none' }}><FilterMenu value={{ type: 'all', feats: [] }} onChange={() => {}} /></span>
              </span>
              <span className="sp" />
              <button className="btn glass">+ Add</button>
            </div>
            <div className="lh">Search results<span> · {n} item{n === 1 ? '' : 's'}</span>{foundLine(chosen) && <div className="s">{foundLine(chosen)}</div>}</div>
            <Pills q={q} chosen={chosen} onToggle={toggle} />
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

export function SearchFields() {
  return (
    <Page
      title="Search: find in a field"
      status={<><strong>Approved by the owner, 2026-11-24</strong> (“approved, build it”, then “keep default Apple pills”: the app uses the system's own toggle buttons, so the frames show their look only roughly). Drawn after the owner searched for their own domain and got every login that uses it as a username, with the few that have it as a website lost among them. Pills under the search field narrow the results to the field that matched. The sample vault is fictional: the username on most logins is <code>sam@harbor.net</code>, and three logins live on <code>harbor.net</code>.</>}
    >
      <Clarity
        items={[
          ['Which thing?', <>The results of a search. Three pills (Name, Website, Username) under the search field say where the text was found and how many results found it there. Choosing a pill keeps only those results.</>],
          ['What must they give?', <>Nothing. The pills are optional: with none chosen, every field is searched as today. Choose one or more to narrow; choose again to let go. Nothing is stored: the pills reset when the search is cleared.</>],
          ['What can go wrong?', <>A pill is greyed out because nothing matches in that field (it cannot be chosen, and its count is 0). A chosen pill matches nothing after more typing: the screen names the field and the text and offers Search All Fields.</>],
          ['How do they leave?', <>Tap a chosen pill again, or Search All Fields. Clearing the search removes them. Nothing in the vault changes.</>],
        ]}
      />

      <Section title="1. iPhone" />
      <Frames>
        <Frame phone label="A. Search for harbor.net" caption="Nine results, and the pills say why: one found in the name, three in the website, six in the username. Under each name the row shows the field that matched, with the matching part darker: most rows are a username, so the three websites are easy to miss without the pills.">
          <PhoneSearchFields q="harbor.net" />
        </Frame>
        <Frame phone label="B. Website chosen" caption="Three logins that live on harbor.net. The line under the title says what is in force (“Found in website”), the chosen pill is filled in the accent colour, and each row now shows its website.">
          <PhoneSearchFields q="harbor.net" chosen={['website']} />
        </Frame>
        <Frame phone label="C. A field with no match is dimmed" caption="“gitforge” is in one name and one website, in no username. Username is dimmed with 0 and cannot be chosen, so no choice leads to an empty list.">
          <PhoneSearchFields q="gitforge" />
        </Frame>
        <Frame phone label="D. Two pills" caption="Website and Name together: found in either. Choosing more pills shows more, never fewer, the opposite of the Filter menu's With. The line under the title says “website or name”.">
          <PhoneSearchFields q="harbor.net" chosen={['website', 'name']} />
        </Frame>
        <Frame phone label="E. A chosen field stops matching" caption="Website was chosen, then more was typed. The pill stays filled so the person sees what is narrowing the list, and the empty state names the field and the text.">
          <PhoneSearchFields q="harbor.netx" chosen={['website']} />
        </Frame>
        <Frame phone label="F. Try it" caption="Choose and release the pills. The text is fixed in the mock; in the app it is whatever is typed.">
          <PhoneSearchFields q="harbor.net" live />
        </Frame>
      </Frames>

      <Section title="2. Mac and iPad" />
      <Frames>
        <Frame label="G. Mac and iPad" caption="The same pills in the list column under the title line, above the rows. The one search field stays in the toolbar. Click a pill to choose it, click again to let go. Press Tab to reach the pills from the search field; each reads as a toggle button (“Website, 3, not selected”).">
          <MacSearchFields q="harbor.net" />
        </Frame>
      </Frames>

      <Section title="3. Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>1. Three pills: Name, Website, Username.</strong> They are the fields search reads today (the title, the website, the username and the name made from what the item holds). Each shows how many of the current results match in that field; the counts can add to more than the results, because one login can match in two fields.</>,
            rejected: <>Notes, Tags, Card number and custom values (search does not read them, and the notes and secrets must stay out of search, see <code>docs/items.md</code>); showing all pills always, with no counts (the person would have to try each one); hiding the pills with no match (the row would jump while typing).</>,
          },
          {
            decision: <><strong>2. A pill with no match is dimmed, not hidden, and cannot be chosen.</strong> Its count reads 0. The three pills stay where they are while the text changes, so a thumb never meets a different pill than it aimed for.</>,
          },
          {
            decision: <><strong>3. Any number can be chosen, and more pills show more.</strong> A login is found when any chosen field has the text. None chosen means every field. This is the reverse of With in the Filter menu (there, more narrows), so the line under the title says “website or name” to keep the two apart.</>,
            rejected: <>one choice only (Website or Username but never both; a segmented “scope” control would be that); “all of” (a login would have to have the text in each chosen field, which is almost never what anyone means).</>,
          },
          {
            decision: <><strong>4. Each row shows the field that matched.</strong> The second line is the chosen pill's field; with none chosen, the first field that matched (username, then website, then name), with the matching part in the primary colour and the rest secondary. Same two type sizes, no badges.</>,
            why: <>Without it, the three websites and the six usernames look the same: a name over <code>sam</code> or <code>sam@harbor.net</code>, and the person cannot see why Gitforge was found.</>,
          },
          {
            decision: <><strong>5. They live under the search results' title line, in every place a search shows.</strong> iPhone: the search tab. Mac and iPad: the list column while a search is typed. Search still covers the whole vault, so the Filter button's Show and With stay off while searching, as today.</>,
          },
          {
            decision: <><strong>6. Nothing is remembered.</strong> The pills reset when the search is cleared or left, like the text. A search that was narrowed last time would hide results the next time with nothing on screen to say so.</>,
          },
        ]}
      />

      <Against>
        <li><strong>The pills are custom controls.</strong> Apple's native tools for narrowing a search are search scopes (a segmented control under the field, one choice at a time) and search tokens (a chip in the field, added from suggestions). Scopes cannot dim a choice, show a count or allow two choices, which is what this problem needs. Tokens hide the options until the person types. If the owner prefers the native control, the fallback is scopes: Any, Name, Website, Username, with no counts and none dimmed.</li>
        <li><strong>The pills take a row of the screen above the keyboard.</strong> They stay under the title line while the results scroll. Check on the smallest iPhone that the title, its line and the pills still leave room for several rows.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-25', text: <>Mac frames redrawn with macOS push buttons (grey rounded rectangle, 13 px, primary-coloured text; accent fill and white text for the default button) instead of the iOS tinted capsule, and the sidebar of Mac and iPad frames now starts with the vault’s section header (“Passwords”, a disclosure chevron), as Mail shows an account, with Add Vault at its foot. Replaces the iOS capsule look on the Mac and the plain sidebar. Nothing else on this page changed; see <a href="#/vault-switcher">Vaults</a>.</> },
          { date: '2026-11-24', text: <>The “Found in any field” line was removed. With no pill chosen it said nothing the pills do not; the line now appears only while a pill is chosen. The owner asked.</> },
          { date: '2026-11-24', text: <>The owner approved the pills and asked for the default Apple look: the app draws them as standard system toggle buttons (capsule, system accent when on, dimmed when disabled), with no custom fills. The frames keep the same layout; their colours are a sketch of that look.</> },
          { date: '2026-11-24', text: <>First drawing. The owner searched for their own domain: it is the username of many logins and the website of a few, and the few were lost. They asked for pills by field, enabled where the current results match, and a mock first. Pills for more fields than search reads (notes, tags) were not drawn, because search would have to start reading them.</> },
        ]}
      />
    </Page>
  );
}
