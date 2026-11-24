import { useState } from 'react';
import { CheckIcon, SortIcon } from '../icons';
import { sortKeys, sortNames, type SortKey } from '../listing';

/**
 * The Sort menu of the All list: the standard sort symbol before Filter and + Add, as in
 * Apple's Passwords. The menu names the orders; a checkmark shows the chosen one.
 */
export function SortMenu({ value, onChange, open: open0 = false }: { value: SortKey; onChange: (k: SortKey) => void; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  return (
    <span className="sortwrap">
      <button className="ibtn" aria-label={`Sort, ${sortNames[value]}`} aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : 'Sort'} onClick={() => setOpen(!open)}>
        <SortIcon />
      </button>
      {open && (
        <div className="pop" role="menu">
          <div className="ph">Sort by</div>
          {sortKeys.map((k) => (
            <button key={k} role="menuitemradio" aria-checked={k === value} onClick={() => { onChange(k); setOpen(false); }}>
              <span className="chk">{k === value && <CheckIcon />}</span>
              {sortNames[k]}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
