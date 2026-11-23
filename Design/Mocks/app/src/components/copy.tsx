import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon } from '../icons';

const NotifyContext = createContext<(text: string) => void>(() => {});

/** Call from a field row: shows the shared "Copied" pill in the nearest device frame. */
export const useCopied = () => useContext(NotifyContext);

/** The one pill for every copy in the app: a checkmark and what was copied. */
export function CopiedPill({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`cpill ${className}`} role="status">
      <CheckIcon />
      {text}
    </div>
  );
}

/**
 * Wrap the content of a device frame (which must be position: relative).
 * `initial` shows the pill without a click, for frames that draw that state.
 */
export function CopyHost({ initial, className, children }: { initial?: string; className?: string; children: ReactNode }) {
  const [text, setText] = useState<string | null>(initial ?? null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback((t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), 2000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {text && <CopiedPill key={text} text={text} className={className} />}
    </NotifyContext.Provider>
  );
}
