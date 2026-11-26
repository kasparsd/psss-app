import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from '../icons';
import { DOTS, type Field } from '../data';
import { useCopied } from './copy';
import { Problem } from './Problem';

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
  /** A problem with this field's value, written under it. */
  notice?: ReactNode;
}

/**
 * The one field row: label above value, a copy icon at the trailing end
 * (its inset equals the row's leading padding), hidden values as a fixed
 * mask followed inline by an eye.
 */
export function FieldRow({ label, value, secret, mask = DOTS, shown: shown0 = false, copied: copied0 = false, display, noCopy, action, notice }: FieldRowProps) {
  const [shown, setShown] = useState(shown0);
  const [copied, setCopied] = useState(copied0);
  const notify = useCopied();
  // The whole row copies, except a web address, whose row opens it in the browser; the eye stays its own target.
  const tap = !noCopy;
  const link = tap && !secret && label === 'Website';
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
    <div className={`frow${tap ? ' tap' : ''}${tap && copied ? ' down' : ''}`} onClick={tap && !link ? copy : undefined}>
      <div className="fbody">
        <div className="s">{label}</div>
        <div className="vrow">
          {display ?? (
            <span className={`fval${secret && shown ? ' revealed mono' : ''}${link ? ' link' : ''}`} key={shown ? 'v' : 'm'}>
              {secret && !shown ? mask : value}
            </span>
          )}
          {secret && !display && (
            <button className="eye" onClick={(e) => { e.stopPropagation(); setShown(!shown); }} aria-label={`${shown ? 'Hide' : 'Show'} ${lower}`} data-tip={`${shown ? 'Hide' : 'Show'} ${lower}`}>
              {shown ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
        {notice && <Problem>{notice}</Problem>}
        {action && <div className="fact">{action}</div>}
      </div>
      {!noCopy && (
        <button className={`cp${copied ? ' done' : ''}`} onClick={(e) => { e.stopPropagation(); copy(); }} aria-label={`Copy ${lower}`} data-tip={`Copy ${lower}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </div>
  );
}

/** A field in the editor: label above an input, an optional action on the right of the input. */
export function EditRow({ label, value, placeholder, secret, mono, action, below, info }: {
  label: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
  /** A secret value is written in the monospaced face, so 1, l and I can be told apart. */
  mono?: boolean;
  action?: ReactNode;
  below?: ReactNode;
  info?: ReactNode;
}) {
  return (
    <div className="frow erow">
      <div className="fbody">
        <div className="s">{label}{info}</div>
        <div className="efield">
          <input className={secret || mono ? 'mono' : undefined} defaultValue={secret && value ? DOTS : value} placeholder={placeholder} aria-label={label} />
          {action}
        </div>
        {below && <div className="fact">{below}</div>}
      </div>
    </div>
  );
}

/**
 * A recognized field the item has not filled in. The label stays where it will be, the value line says "Not set" in the
 * secondary colour, and the row ends in a labelled "Add" (the accent colour, no fill: it is an invitation, not the
 * page's main action). Nothing to copy, so no copy icon. The whole row opens Edit with this field focused.
 */
export function UnsetRow({ label }: { label: string }) {
  return (
    <div className="frow tap unset" onClick={() => {}} role="button" tabIndex={0} aria-label={`${label}, not set. Add`}>
      <div className="fbody">
        <div className="s">{label}</div>
        <div className="vrow"><span className="fval s">Not set</span></div>
      </div>
      <button className="addlink" onClick={(e) => e.stopPropagation()}>Add</button>
    </div>
  );
}

/** The quieter variant: one row naming every field that is not filled in, with one labelled button. */
export function MoreRow({ labels }: { labels: string[] }) {
  return (
    <div className="frow">
      <div className="fbody">
        <div className="s">Not filled in</div>
        <div className="vrow"><span className="fval s">{labels.join(', ')}</span></div>
      </div>
      <button className="addlink">Add…</button>
    </div>
  );
}
