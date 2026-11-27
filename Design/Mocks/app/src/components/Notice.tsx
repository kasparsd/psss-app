import type { ReactNode } from 'react';

/**
 * A notice, drawn once (owner, 2026-11-24): a symbol and words for a message that is not a question, with no coloured box
 * (owner, 2026-11-26). A filled orange triangle for something that went wrong, a grey circled i for information, a spinner for progress; red is kept for deletion. The app's `LockNotice`
 * (App/Core/UnlockForm.swift) is this component. Used under the lock screen's password field, in the AutoFill picker and
 * in the browser popup. `action` is one visible button under the words.
 */
export function Notice({ kind, title, children, action }: { kind: 'progress' | 'warning' | 'info'; title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`lk-notice ${kind}`} role={kind === 'warning' ? 'alert' : 'status'}>
      <span className="lk-nicon" aria-hidden="true">{kind === 'progress' ? <span className="lk-spin" /> : <svg viewBox="0 0 24 24">{kind === 'warning' ? <><path className="tri" d="M12 4L21.5 20h-19z" /><path className="mark" d="M12 10v4M12 17v.01" /></> : <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v5M12 8v.01" />}</svg>}</span>
      <div>{title && <div style={{ fontWeight: 600 }}>{title}</div>}<div className={title ? 'lk-line' : undefined}>{children}</div>{action && <div style={{ marginTop: 8 }}>{action}</div>}</div>
    </div>
  );
}
