import type { ReactNode } from 'react';

/**
 * A notice, drawn once (owner, 2026-11-24): a small tinted card with a filled symbol for a message that is not a question. Orange
 * for something that went wrong, blue for information, a spinner for progress; red is kept for deletion. The app's `LockNotice`
 * (App/Features/VaultFileViews.swift) is this component. Used under the lock screen's password field, in the AutoFill picker and
 * in the browser popup. `action` is one visible button inside the card.
 */
export function Notice({ kind, title, children, action }: { kind: 'progress' | 'warning' | 'info'; title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`lk-notice ${kind}`} role={kind === 'warning' ? 'alert' : 'status'}>
      <span className="lk-nicon" aria-hidden="true">{kind === 'progress' ? <span className="lk-spin" /> : kind === 'warning' ? '⚠︎' : 'i'}</span>
      <div>{title && <div style={{ fontWeight: 600 }}>{title}</div>}<div className={title ? 'lk-line' : undefined}>{children}</div>{action && <div style={{ marginTop: 8 }}>{action}</div>}</div>
    </div>
  );
}
