import type { Item } from '../data';

/* Drawing parts the AutoFill picker page and the browser extension page share: sample logins, the match line, the pills and Fill. */

const login = (id: number, name: string, account: string, color: Item['color'], passkey = false): Item =>
  ({ id, name, account, kind: 'login', color, uses: 0, fields: [], passkey });

export const gitforge = { ...login(1, 'Gitforge', 'sam.r', 2, true), code: '482 913' } as Item;
export const gitforge2 = login(2, 'Gitforge (work)', 'sam@work.example', 4);
export const hosting = login(3, 'Git Hosting Co', 'sam.r', 5);

/** A row's second line while searching: the matching part of the field that matched, in the primary colour and bold. */
export const Hit = ({ before = '', hit, after = '' }: { before?: string; hit: string; after?: string }) => (
  <>{before}<strong style={{ color: 'var(--lab)' }}>{hit}</strong>{after}</>
);

export const Pills = ({ counts, on = [] }: { counts: [string, number][]; on?: string[] }) => (
  <div className="fpills" role="group" aria-label="Found in">
    {counts.map(([f, n]) => (
      <button key={f} className={`fpill${on.includes(f) ? ' on' : ''}`} disabled={n === 0 && !on.includes(f)}>{f} <span className="n">{n}</span></button>
    ))}
  </div>
);

export const FillBtn = ({ label = 'Fill', main }: { label?: string; main?: boolean }) => (
  <button className={`btn${main ? ' pri' : ''}`}>{label}</button>
);

export const Caret = () => <span aria-hidden style={{ display: 'inline-block', width: 2, height: '1.1em', background: 'var(--accent)', verticalAlign: 'text-bottom', marginLeft: 1 }} />;

/** A login whose name equals its account: the row's second line is the website instead (the app's list rule). */
export const harbor = login(4, 'sam@harbor.example', 'sam@harbor.example', 3);
