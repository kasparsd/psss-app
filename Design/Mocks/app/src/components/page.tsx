import type { ReactNode } from 'react';

/** Page shell: crumb, title, status line. */
export function Page({ title, status, children }: { title: string; status: ReactNode; children: ReactNode }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <div className="prose"><p className="status">{status}</p></div>
      {children}
    </main>
  );
}

/** The status line: who approved the current decisions, and when. */
export const Approved = ({ on = '2026-11-24', children }: { on?: string; children?: ReactNode }) => (
  <><strong>Approved by the owner, {on}.</strong>{children}</>
);

/** The clarity bullets: Which thing? / What must they give? / How do they leave? */
export function Clarity({ items, intro }: { items: [string, ReactNode][]; intro?: ReactNode }) {
  return (
    <div className="prose">
      {intro}
      <ul className="clarity">
        {items.map(([q, a]) => (
          <li key={q}><strong>{q}</strong> {a}</li>
        ))}
      </ul>
    </div>
  );
}

export const Section = ({ title, children }: { title: string; children?: ReactNode }) => (
  <><h2>{title}</h2>{children && <div className="prose">{children}</div>}</>
);

export const Frames = ({ children }: { children: ReactNode }) => <div className="frames">{children}</div>;

/** A labelled frame with its caption. `phone` fixes the width for iPhone frames. */
export function Frame({ label, caption, phone, children }: { label: string; caption?: ReactNode; phone?: boolean; children: ReactNode }) {
  return (
    <figure className={`fig ${phone ? 'w-phone' : 'w-wide'}`}>
      <div className="lbl">{label}</div>
      <div className="stagebox">{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export interface DecisionItem { decision: ReactNode; rejected?: ReactNode; why?: ReactNode }
export function Decisions({ items }: { items: DecisionItem[] }) {
  return (
    <div className="prose">
      <ul className="dec">
        {items.map((d, i) => (
          <li key={i}>
            {d.decision}
            {d.rejected && <> <span className="rej"><strong>Rejected:</strong> {d.rejected}</span></>}
            {d.why && <> <span className="why">{d.why}</span></>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const Against = ({ children }: { children: ReactNode }) => (
  <Section title="Against Apple's guidance"><ul>{children}</ul></Section>
);

export interface HistoryEntry { date: string; text: ReactNode }

/**
 * The last section of every page: a dated log in words, newest first. What
 * was tried or changed, what replaced it, why, and who decided. No frames.
 */
export function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <>
      <h2>History</h2>
      <div className="prose">
        <p className="muted">Newest first. Within one day the order follows the working log. Nothing here is drawn: the frames above show only what holds today.</p>
        <ul className="hist">
          {entries.map((e, i) => (
            <li key={i}><time dateTime={e.date}>{e.date}</time><span>{e.text}</span></li>
          ))}
        </ul>
      </div>
    </>
  );
}
