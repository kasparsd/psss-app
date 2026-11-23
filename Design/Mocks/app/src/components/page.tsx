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

export const Approved = ({ on = '2026-11-23', children }: { on?: string; children?: ReactNode }) => (
  <><strong>Approved {on}</strong>{children}</>
);
export const Proposed = ({ on = '2026-11-23', children }: { on?: string; children?: ReactNode }) => (
  <><strong>Proposed {on}</strong>{children}</>
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

export const Prose = ({ children }: { children: ReactNode }) => <div className="prose">{children}</div>;
export const Section = ({ title, children }: { title: string; children?: ReactNode }) => (
  <><h2>{title}</h2>{children && <div className="prose">{children}</div>}</>
);

/** What changed on this page compared with the earlier static mock. */
export const ChangeNote = ({ children }: { children: ReactNode }) => (
  <div className="note"><strong>Changed from the static mock.</strong> {children}</div>
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
