import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Item } from '../data';
import { ChevronIcon, CodeTraitGlyph, PasskeyGlyph } from '../icons';

export function ItemIcon({ item, big }: { item: Pick<Item, 'name' | 'color'>; big?: boolean }) {
  return <div className={`ic c${item.color}${big ? ' big' : ''}`} aria-hidden>{item.name[0]}</div>;
}

export const Chevron = () => <span className="chev"><ChevronIcon /></span>;

/** A code as the app writes it everywhere: digits of one width, the two halves a narrow gap apart. */
export function CodeDigits({ code, big }: { code: string; big?: boolean }) {
  return (
    <span className={`digits${big ? ' big' : ''}`} aria-label={code}>
      {code.split(' ').map((g, i) => <span key={i} aria-hidden>{g}</span>)}
    </span>
  );
}

/**
 * What a login has, at the trailing end of its row: a passkey, a verification
 * code. Each glyph has its own column (the code is the last one), so they line
 * up down the list. `code={false}` leaves the code glyph out where the live
 * code is already in the row.
 */
export function TraitGlyphs({ item, code = true }: { item: Item; code?: boolean }) {
  const hasCode = !!item.code || !!item.brokenCode;
  if (!item.passkey && !hasCode) return null;
  return (
    <span className="traits">
      {item.passkey && <span className="trait" role="img" aria-label="Has a passkey" data-tip="Has a passkey"><PasskeyGlyph /></span>}
      {code && (hasCode
        ? <span className="trait" role="img" aria-label="Has a verification code" data-tip="Has a verification code"><CodeTraitGlyph /></span>
        : <span className="trait" aria-hidden />)}
    </span>
  );
}

const shortBrand = (b?: string) => (b === 'American Express' ? 'Amex' : b ?? 'Card');

/** A card's last four digits over its expiry, right-aligned so both read down the list as columns. */
function CardEnd({ item }: { item: Item }) {
  const expiry = item.fields.find((f) => f.label === 'Expiry')?.value;
  return (
    <span className="cardend">
      {item.last4 && <span>•• {item.last4}</span>}
      {expiry && <span className="s">{expiry}</span>}
    </span>
  );
}

/** A list row: icon, name over account, something at the trailing end. */
export function ListRow({ item, sub, trailing, selected, onClick, mac, traits = true, wrap }: {
  item: Item;
  sub?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Mac and iPad rows are rounded and selectable. */
  mac?: boolean;
  /** The glyphs for what a login has. 'passkey' leaves the code glyph out. */
  traits?: boolean | 'passkey';
  /** Let the second line wrap instead of cutting it (a line that must be read whole: “Saved for …”). */
  wrap?: boolean;
}) {
  const card = item.kind === 'card' && !sub;
  const second = sub ?? (card ? `${shortBrand(item.brand)}${item.expired ? ' · Expired' : ''}` : item.account);
  return (
    <div className={mac ? `mrow${selected ? ' sel' : ''}` : 'prow link'} onClick={onClick} data-id={item.id}>
      <ItemIcon item={item} />
      <div className="grow">
        <div className="trunc">{item.name}</div>
        <div className={wrap ? 's' : 's trunc'}>{second}</div>
      </div>
      {card && <CardEnd item={item} />}
      {traits && !card && <TraitGlyphs item={item} code={traits !== 'passkey'} />}
      {trailing}
    </div>
  );
}

/** The code is the button. It reads "Copied" for a moment after a click. */
export function CodePill({ code, long, copied: c0 = false }: { code: string; long?: boolean; copied?: boolean }) {
  const [copied, setCopied] = useState(c0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`codepill${long ? ' long' : ''}`}
      aria-label="Copy code"
      onClick={(e) => {
        e.stopPropagation();
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Copied' : <CodeDigits code={code} />}
    </button>
  );
}

/** A Codes row. `copied` draws the "just copied" state. */
export function CodeRow({ item, mac, selected, onClick, copied }: { item: Item; mac?: boolean; selected?: boolean; onClick?: () => void; copied?: boolean }) {
  if (item.brokenCode) {
    // No button and no message: the row opens the login, whose code row explains it.
    return <ListRow item={item} mac={mac} selected={selected} onClick={onClick} traits={false} trailing={mac ? undefined : <Chevron />} />;
  }
  const long = !!item.period && item.period !== 30;
  return (
    <ListRow
      item={item}
      mac={mac}
      selected={selected}
      onClick={onClick}
      traits={false}
      sub={long ? <>Every {item.period} s</> : undefined}
      trailing={<CodePill code={item.code!} long={long} copied={copied} />}
    />
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: string }) {
  return (
    <div className="empty">
      <div className="t">{title}</div>
      {text && <div>{text}</div>}
      {action && <button className="btn pri">{action}</button>}
    </div>
  );
}

/** A heading over a group of rows ("Recently used", "All items", "Expired"). */
export const ListHead = ({ children, mac }: { children: ReactNode; mac?: boolean }) => (
  <div className={mac ? 'mhead' : 'sec'} style={mac ? undefined : { padding: '2px 4px 6px' }}>{children}</div>
);
