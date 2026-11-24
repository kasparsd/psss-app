import { useState, type ReactNode } from 'react';
import { byId, cardItems, codeItems, items } from '../data';
import { BackIcon, GearIcon } from '../icons';
import { ItemCard, type CodeEdit } from '../components/ItemCard';
import { Chevron, CodePill, CodeRow, EmptyState, ListHead, ListRow } from '../components/Rows';
import { FilterMenu } from '../components/FilterMenu';
import { SortMenu } from '../components/SortMenu';
import { IPhone } from '../components/devices';
import { allHeading, allSections, featLine, listOne, typeNames, withRecent, type Feat, type SortKey, type TypeKey } from '../listing';

/** Top bar: Setup at the leading end on the All tab, labelled actions at the trailing end. */
export function Nav({ left, mid, right }: { left?: ReactNode; mid?: ReactNode; right?: ReactNode }) {
  return (
    <div className="nav">
      <div>{left}</div>
      <div className="mid">{mid}</div>
      <div>{right}</div>
    </div>
  );
}
const Add = () => <button className="btn">+ Add</button>;
const Title = ({ children }: { children: ReactNode }) => <div className="lt"><div className="t">{children}</div></div>;

const sortLine: Record<SortKey, string> = { used: '', most: 'most used first', changed: 'recently changed first', name: 'by name' };
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The All tab: Setup at the top left; Sort, Filter and + Add at the top
 * right. The title says what is listed, the line under it what else is in
 * force. In the default order a Recently used group leads. Clickable.
 */
export function PhoneAll({ type = 'all', feats = [], sort = 'used', menuOpen, sortOpen }: {
  type?: TypeKey;
  feats?: Feat[];
  sort?: SortKey;
  /** Draw the Filter or Sort menu already open. */
  menuOpen?: boolean;
  sortOpen?: boolean;
}) {
  const [choice, setChoice] = useState({ type, feats, sort });
  const { recent, main } = allSections(items, choice.type, choice.feats, choice.sort);
  const line = featLine(choice.feats, choice.type);
  const what = `${choice.type === 'all' ? 'items' : choice.type === 'custom' ? 'custom items' : typeNames[choice.type].toLowerCase()}${line ? ` ${line.toLowerCase()}` : ''}`;
  return (
    <IPhone tab="all">
      <Nav
        left={<button className="ibtn flat" aria-label="Setup" data-tip="Setup"><GearIcon /></button>}
        right={
          <span className="navend">
            <span className="viewopts">
              <SortMenu value={choice.sort} onChange={(k) => setChoice({ ...choice, sort: k })} open={sortOpen} />
              <FilterMenu value={choice} onChange={(v) => setChoice({ ...choice, ...v })} open={menuOpen} />
            </span>
            <Add />
          </span>
        }
      />
      <div className="lt">
        <div className="t">{typeNames[choice.type]} <span className="s" style={{ fontWeight: 400 }}>· {main.length} item{main.length === 1 ? '' : 's'}</span></div>
        {(line || sortLine[choice.sort]) && <div className="s">{cap([line, sortLine[choice.sort]].filter(Boolean).join(', '))}</div>}
      </div>
      {main.length === 0 ? (
        <div className="empty" style={{ paddingBottom: 110 }}>
          <div className="t">No {what}</div>
          <button className="btn pri" onClick={() => setChoice({ ...choice, type: 'all', feats: [] })}>Show All Items</button>
        </div>
      ) : (
        <div className="pbody tabpad">
          {recent.length > 0 && (
            <>
              <ListHead>Recently used</ListHead>
              <div className="grp">{recent.map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div>
              <ListHead>{allHeading(choice.type)}</ListHead>
            </>
          )}
          <div className="grp">{main.map((it) => <ListRow key={it.id} item={it} trailing={<Chevron />} />)}</div>
        </div>
      )}
    </IPhone>
  );
}

/** Search tab: results from the whole vault in the order chosen for All, the field above the keyboard. */
export function PhoneSearch({ text = 'g', sort = 'name' }: { text?: string; sort?: SortKey }) {
  const word = text.toLowerCase();
  const found = listOne(items, 'all', [], sort).filter((i) => `${i.name} ${i.account}`.toLowerCase().includes(word));
  return (
    <IPhone search={text}>
      <div className="lt">
        <div className="t">Results <span className="s" style={{ fontWeight: 400 }}>· {found.length} item{found.length === 1 ? '' : 's'}</span></div>
      </div>
      <div className="pbody tabpad">
        <div className="grp">
          {found.map((it) => (it.code
            ? <ListRow key={it.id} item={it} traits="passkey" trailing={<CodePill code={it.code} />} />
            : <ListRow key={it.id} item={it} trailing={<Chevron />} />))}
        </div>
      </div>
    </IPhone>
  );
}

export type CodesVariant = 'normal' | 'copied' | 'empty' | 'broken';

/** Codes tab: every login with a code, live. A Recently used group leads when the list is long enough. */
export function PhoneCodes({ variant = 'normal' }: { variant?: CodesVariant }) {
  if (variant === 'empty') {
    return (
      <IPhone tab="codes">
        <Title>Codes</Title>
        <EmptyState title="No verification codes yet" text="When a website offers two-step verification, open its login in Psss, tap Edit, then Add code. Its six-digit codes then appear here." action="Show logins" />
      </IPhone>
    );
  }
  // The "broken" frame lists a short vault (one code that cannot be made), so it has no group.
  const list = (variant === 'broken' ? codeItems.filter((i) => i.id === 4 || i.id === 14 || i.id === 5) : codeItems).slice().sort((a, b) => a.name.localeCompare(b.name));
  const { recent } = withRecent(list);
  return (
    <IPhone tab="codes">
      <Title>Codes</Title>
      <div className="pbody tabpad">
        {recent.length > 0 && (
          <>
            <ListHead>Recently used</ListHead>
            <div className="grp">
              {recent.map((it) => <CodeRow key={it.id} item={it} copied={variant === 'copied' && it.id === 1} />)}
            </div>
            <ListHead>All codes</ListHead>
          </>
        )}
        <div className="grp">
          {list.map((it) => <CodeRow key={it.id} item={it} />)}
        </div>
        <div className="hint">Tap a code to copy it. Tap the name to open the login.</div>
      </div>
    </IPhone>
  );
}

export type CardsVariant = 'normal' | 'expired' | 'empty' | 'short';

/**
 * Cards tab: one row per card to scan; a tap opens the card's page. A Recently
 * used group leads when there are more than five cards; `short` draws a vault
 * with four, which has none. Expired cards come last.
 */
export function PhoneCards({ variant = 'normal' }: { variant?: CardsVariant }) {
  if (variant === 'empty') {
    return (
      <IPhone tab="cards">
        <Nav right={<Add />} />
        <Title>Cards</Title>
        <EmptyState title="No cards yet" text="Save a card here to copy its number, expiry and security code at a checkout. It stays encrypted in your vault." action="Add card" />
      </IPhone>
    );
  }
  const az = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const live = (variant === 'short' ? cardItems.filter((c) => c.id <= 9) : cardItems).filter((c) => !c.expired).sort(az);
  const expired = cardItems.filter((c) => c.expired);
  const { recent } = withRecent(live);
  return (
    <IPhone tab="cards">
      <Nav right={<Add />} />
      <Title>Cards</Title>
      <div className="pbody tabpad">
        {recent.length > 0 && (
          <>
            <ListHead>Recently used</ListHead>
            <div className="grp">{recent.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}</div>
            <ListHead>All cards</ListHead>
          </>
        )}
        <div className="grp">{live.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}</div>
        {variant !== 'normal' && (
          <>
            <ListHead>Expired</ListHead>
            <div className="grp">{expired.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}</div>
          </>
        )}
      </div>
    </IPhone>
  );
}

/** An item page, or its editor. `whole` draws the page as tall as its content, without a tab bar. */
export function PhoneItem({ id = 1, mode = 'view', shown, copied, pill, from = 'all', whole, bubble, fresh, unnamed, code, onPasteCodeImage }: {
  id?: number;
  mode?: 'view' | 'edit';
  shown?: string[];
  copied?: string;
  pill?: string;
  from?: 'all' | 'cards';
  whole?: boolean;
  bubble?: boolean;
  /** Draw the sheet for a new item: no name typed, nothing to move to Recently Deleted. */
  fresh?: boolean;
  /** The item has no name of its own: it is called by its site, card or first words. */
  unnamed?: boolean;
  code?: CodeEdit;
  onPasteCodeImage?: () => void;
}) {
  const item = byId(id);
  if (mode === 'edit') {
    return (
      <IPhone tall>
        <Nav left={<button className="btn plain">Cancel</button>} right={<button className="btn pri main">Save</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>
          <ItemCard item={item} mode="edit" onDelete={fresh ? undefined : () => {}} unnamed={fresh || unnamed} bubble={bubble} code={code} onPasteCodeImage={onPasteCodeImage} />
        </div>
      </IPhone>
    );
  }
  const back = (
    <button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>{from === 'cards' ? 'Cards' : 'All'}</button>
  );
  if (whole) {
    return (
      <IPhone tall>
        <Nav left={back} right={<button className="btn main">Edit</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>
          <ItemCard item={item} shown={shown} copied={copied} bubble={bubble} unnamed={unnamed} />
        </div>
      </IPhone>
    );
  }
  return (
    <IPhone tab={from} pill={pill}>
      <Nav left={back} right={<button className="btn main">Edit</button>} />
      <div className="pbody tabpad" style={{ overflow: 'auto' }}>
        <ItemCard item={item} shown={shown} copied={copied} bubble={bubble} unnamed={unnamed} />
      </div>
    </IPhone>
  );
}
