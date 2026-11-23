import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Item } from '../data';
import { ChevronIcon } from '../icons';
import { InfoButton, topics } from './InfoButton';

export function ItemIcon({ item, big }: { item: Pick<Item, 'name' | 'color'>; big?: boolean }) {
  return <div className={`ic c${item.color}${big ? ' big' : ''}`} aria-hidden>{item.name[0]}</div>;
}

export const Chevron = () => <span className="chev"><ChevronIcon /></span>;

/** A list row: icon, name over account, something at the trailing end. */
export function ListRow({ item, sub, trailing, selected, onClick, mac }: {
  item: Item;
  sub?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Mac and iPad rows are rounded and selectable. */
  mac?: boolean;
}) {
  return (
    <div className={mac ? `mrow${selected ? ' sel' : ''}` : 'prow link'} onClick={onClick} data-id={item.id}>
      <ItemIcon item={item} />
      <div className="grow">
        <div className="trunc">{item.name}</div>
        <div className="s trunc">{sub ?? item.account}</div>
      </div>
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
      {copied ? 'Copied' : code}
    </button>
  );
}

/** A Codes row. `copied` draws the "just copied" state. */
export function CodeRow({ item, mac, selected, onClick, copied }: { item: Item; mac?: boolean; selected?: boolean; onClick?: () => void; copied?: boolean }) {
  if (item.brokenCode) {
    return <ListRow item={item} mac={mac} selected={selected} onClick={onClick} sub="Can't make a code. Open the login to replace it." trailing={mac ? undefined : <Chevron />} />;
  }
  const long = !!item.period && item.period !== 30;
  return (
    <ListRow
      item={item}
      mac={mac}
      selected={selected}
      onClick={onClick}
      sub={long ? <>Every {item.period} s</> : undefined}
      trailing={<CodePill code={item.code!} long={long} copied={copied} />}
    />
  );
}

/** One countdown for the whole list. It never changes size, only the seconds. */
export function CodesCountdown({ seconds = 18, period = 30, bubble }: { seconds?: number; period?: number; bubble?: boolean }) {
  return (
    <div className="clock">
      <span className="ring" style={{ ['--p' as string]: `${Math.round((seconds / period) * 100)}%` }} />
      New codes in {seconds} s
      <InfoButton topic={topics.codes} open={bubble} />
    </div>
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
