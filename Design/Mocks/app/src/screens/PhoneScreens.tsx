import type { ReactNode } from 'react';
import { byId, cardItems } from '../data';
import { BackIcon, ClockIcon, GearIcon, StarIcon } from '../icons';
import { ItemCard } from '../components/ItemCard';
import { Chevron, CodeRow, CodesCountdown, EmptyState, ListRow } from '../components/Rows';
import { IPhone } from '../components/devices';

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
const Setup = () => <button className="ibtn flat" aria-label="Setup" data-tip="Setup"><GearIcon /></button>;
const Add = () => <button className="btn">+ Add</button>;
const Title = ({ children }: { children: ReactNode }) => <div className="lt"><div className="t">{children}</div></div>;

type Pill = 'Recent' | 'Most used' | 'All' | 'Logins' | 'Notes';
const pillRow: Pill[] = ['Recent', 'Most used', 'All', 'Logins', 'Notes'];

export function Pills({ on }: { on: Pill }) {
  return (
    <div className="pills">
      {pillRow.map((p) => (
        <span key={p} className={`pill${p === on ? ' on' : ''}`}>
          {p === 'Recent' && <ClockIcon />}
          {p === 'Most used' && <StarIcon />}
          {p}
        </span>
      ))}
    </div>
  );
}

/** All tab: today's list and pills, with the new bar. The Codes and Cards pills are gone: they are tabs. */
export function PhoneAll({ search, on = 'Recent', ids = [1, 2, 10, 3, 6], codes }: { search?: string; on?: Pill; ids?: number[]; codes?: boolean }) {
  return (
    <IPhone tab="all" search={search}>
      {search === undefined && <Nav left={<Setup />} right={<Add />} />}
      <Title>{on}</Title>
      <Pills on={on} />
      <div className="pbody">
        <div className="grp">
          {ids.map((id) => {
            const it = byId(id);
            return <ListRow key={id} item={it} trailing={codes && it.code ? <span className="codepill" style={{ cursor: 'default' }}>{it.code}</span> : <Chevron />} />;
          })}
        </div>
      </div>
    </IPhone>
  );
}

export type CodesVariant = 'normal' | 'copied' | 'last5' | 'empty' | 'broken' | 'bubble';

/** Codes tab: every login with a code, live. */
export function PhoneCodes({ variant = 'normal' }: { variant?: CodesVariant }) {
  if (variant === 'empty') {
    return (
      <IPhone tab="codes">
        <Title>Codes</Title>
        <EmptyState title="No verification codes yet" text="When a website offers two-step verification, open its login in Psss, tap Edit, then Add code. Its six-digit codes then appear here." action="Show logins" />
      </IPhone>
    );
  }
  const seconds = variant === 'last5' ? 4 : variant === 'copied' ? 17 : 18;
  const recent = [byId(1), byId(5)];
  const rest = variant === 'broken'
    ? [byId(4), byId(14), byId(5)]
    : variant === 'last5'
      ? [byId(4), byId(13)]
      : [byId(4), byId(1), byId(5)];
  return (
    <IPhone tab="codes">
      <Title>Codes</Title>
      <CodesCountdown seconds={seconds} bubble={variant === 'bubble'} />
      <div className="pbody tabpad">
        {variant !== 'broken' && (
          <>
            <div className="sec" style={{ padding: '2px 4px 6px' }}>Recently copied</div>
            <div className="grp">
              {recent.map((it) => <CodeRow key={it.id} item={it} copied={variant === 'copied' && it.id === 1} />)}
            </div>
          </>
        )}
        {recent.length > 0 && <div className="sec" style={{ padding: '2px 4px 6px' }}>All codes</div>}
        <div className="grp">
          {rest.map((it) => <CodeRow key={it.id} item={it} />)}
        </div>
        <div className="hint">Tap a code to copy it. Tap the name to open the login.</div>
      </div>
    </IPhone>
  );
}

export type CardsVariant = 'normal' | 'expired' | 'empty';

/** Cards tab: one row per card to scan; a tap opens the card's page, as everywhere else. */
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
  const live = cardItems.filter((c) => !c.expired);
  const expired = cardItems.filter((c) => c.expired);
  return (
    <IPhone tab="cards">
      <Nav right={<Add />} />
      <Title>Cards</Title>
      <div className="pbody tabpad">
        <div className="grp">
          {live.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}
        </div>
        {variant === 'expired' && (
          <>
            <div className="sec" style={{ padding: '2px 4px 6px' }}>Expired</div>
            <div className="grp">
              {expired.map((c) => <ListRow key={c.id} item={c} trailing={<Chevron />} />)}
            </div>
          </>
        )}
      </div>
    </IPhone>
  );
}

/** An item page, or its editor. The editor has no tab bar. */
export function PhoneItem({ id = 1, mode = 'view', shown, copied, pill, from = 'all' }: { id?: number; mode?: 'view' | 'edit'; shown?: string[]; copied?: string; pill?: string; from?: 'all' | 'cards' }) {
  const item = byId(id);
  if (mode === 'edit') {
    return (
      <IPhone tall>
        <Nav left={<button className="btn plain">Cancel</button>} right={<button className="btn plain" style={{ fontWeight: 600 }}>Save</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>
          <ItemCard item={item} mode="edit" onDelete={() => {}} />
        </div>
      </IPhone>
    );
  }
  return (
    <IPhone tab={from} pill={pill}>
      <Nav
        left={<button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>{from === 'cards' ? 'Cards' : 'All'}</button>}
        right={<button className="btn">Edit</button>}
      />
      <div className="pbody tabpad" style={{ overflow: 'auto' }}>
        <ItemCard item={item} shown={shown} copied={copied} />
      </div>
    </IPhone>
  );
}

/** Search tab: the All screen with its pills, the field above the keyboard. */
export function PhoneSearch({ text = 'g', pill = 'All' as Pill }: { text?: string; pill?: Pill }) {
  const narrowed = pill === 'Logins';
  const ids = narrowed ? [1, 10] : [1, 10, 3];
  return (
    <IPhone tab="all" search={text}>
      <Title>{pill}</Title>
      <Pills on={pill} />
      <div className="pbody">
        <div className="grp">
          {ids.map((id) => {
            const it = id === 10 ? { ...byId(10), name: 'Gitforge work', account: 's.r@company.example' } : id === 3 ? { ...byId(3), name: 'Garage door' } : byId(id);
            return <ListRow key={id} item={it} trailing={it.code ? <span className="codepill" style={{ cursor: 'default' }}>{it.code}</span> : <Chevron />} />;
          })}
        </div>
      </div>
    </IPhone>
  );
}

