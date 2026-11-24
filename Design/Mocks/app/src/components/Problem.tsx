import type { ReactNode } from 'react';

/** A problem, as the app writes it everywhere (ProblemText): a warning symbol and the words in the primary colour, not red. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <div className="problem" role="status">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v5" /><circle cx="12" cy="17.6" r=".5" fill="currentColor" /></svg>
      <span><span className="sr">Warning: </span>{children}</span>
    </div>
  );
}
