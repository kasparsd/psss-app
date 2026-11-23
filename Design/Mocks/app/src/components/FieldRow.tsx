import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from '../icons';
import { DOTS, type Field } from '../data';
import { useCopied } from './copy';

interface FieldRowProps extends Field {
  /** Start with the value shown. */
  shown?: boolean;
  /** Start with the checkmark showing (a frame that draws "just copied"). */
  copied?: boolean;
  /** Replace the value line, e.g. a live code. */
  display?: ReactNode;
  /** A row with nothing to copy has no copy icon. */
  noCopy?: boolean;
  /** Labelled buttons under the field they act on. */
  action?: ReactNode;
}

/**
 * The one field row: label above value, a copy icon at the trailing end
 * (its inset equals the row's leading padding), hidden values as a fixed
 * mask followed inline by an eye.
 */
export function FieldRow({ label, value, secret, mask = DOTS, shown: shown0 = false, copied: copied0 = false, display, noCopy, action }: FieldRowProps) {
  const [shown, setShown] = useState(shown0);
  const [copied, setCopied] = useState(copied0);
  const notify = useCopied();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    setCopied(true);
    notify(`${label} copied`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };
  const lower = label.toLowerCase();

  return (
    <div className="frow">
      <div className="fbody">
        <div className="s">{label}</div>
        <div className="vrow">
          {display ?? (
            <span className={`fval${secret && shown ? ' revealed' : ''}`} key={shown ? 'v' : 'm'}>
              {secret && !shown ? mask : value}
            </span>
          )}
          {secret && !display && (
            <button className="eye" onClick={() => setShown(!shown)} aria-label={`${shown ? 'Hide' : 'Show'} ${lower}`} data-tip={`${shown ? 'Hide' : 'Show'} ${lower}`}>
              {shown ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
        {action && <div className="fact">{action}</div>}
      </div>
      {!noCopy && (
        <button className={`cp${copied ? ' done' : ''}`} onClick={copy} aria-label={`Copy ${lower}`} data-tip={`Copy ${lower}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </div>
  );
}

/** A field in the editor: label above an input, an optional action on the right of the input. */
export function EditRow({ label, value, placeholder, secret, action, below, info }: {
  label: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
  action?: ReactNode;
  below?: ReactNode;
  info?: ReactNode;
}) {
  return (
    <div className="frow erow">
      <div className="fbody">
        <div className="s">{label}{info}</div>
        <div className="efield">
          <input defaultValue={secret && value ? DOTS : value} placeholder={placeholder} aria-label={label} />
          {action}
        </div>
        {below && <div className="fact">{below}</div>}
      </div>
    </div>
  );
}
