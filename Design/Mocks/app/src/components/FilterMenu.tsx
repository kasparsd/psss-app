import { useState } from 'react';
import { CheckIcon, FilterIcon } from '../icons';
import { featApplies, featKeys, featNames, typeKeys, typeNames, type Feat, type TypeKey } from '../listing';

export interface Narrow { type: TypeKey; feats: Feat[] }

/**
 * The Filter menu: Show (one kind) and With (any number), and on iPhone
 * Recently Deleted last. Sort is its own button. On Mac and iPad the sidebar
 * is "Show", so the menu leaves that part out while the sidebar is visible.
 */
export function FilterMenu({ value, onChange, showTypes = true, extraTypes, open: open0 = false, onDeleted }: {
  value: Narrow;
  onChange: (v: Narrow) => void;
  /** Whether the menu lists the kinds (iPhone, or Mac and iPad with the sidebar hidden). */
  showTypes?: boolean;
  /** Places listed with the kinds (Mac and iPad with the sidebar hidden): label and what choosing it does. */
  extraTypes?: { label: string; on: boolean; pick: () => void }[];
  open?: boolean;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(open0);
  const placeOn = !!extraTypes?.some((x) => x.on);
  const active = (showTypes && value.type !== 'all') || value.feats.some((f) => featApplies(f, value.type));
  const toggle = (f: Feat) => onChange({ ...value, feats: value.feats.includes(f) ? value.feats.filter((x) => x !== f) : [...value.feats, f] });
  return (
    <span className="sortwrap">
      <button className={`ibtn${active ? ' active' : ''}`} aria-label="Filter" aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : 'Filter'} onClick={() => setOpen(!open)}>
        <FilterIcon />
      </button>
      {open && (
        <div className="pop" role="menu">
          {showTypes && (
            <>
              <div className="ph">Show</div>
              <div className="popgroup">
                {typeKeys.map((k) => (
                  <button key={k} role="menuitemradio" aria-checked={k === value.type && !placeOn} onClick={() => onChange({ ...value, type: k })}>
                    <span className="chk">{k === value.type && !placeOn && <CheckIcon />}</span>{typeNames[k]}
                  </button>
                ))}
                {extraTypes?.map((x) => (
                  <button key={x.label} role="menuitemradio" aria-checked={x.on} onClick={x.pick}>
                    <span className="chk">{x.on && <CheckIcon />}</span>{x.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className={`ph${showTypes ? ' sepd' : ''}`}>With</div>
          <div className="popgroup">
            {featKeys.map((f) => {
              const can = featApplies(f, value.type);
              return (
                <button key={f} role="menuitemcheckbox" aria-checked={can && value.feats.includes(f)} disabled={!can} onClick={() => toggle(f)}>
                  <span className="chk">{can && value.feats.includes(f) && <CheckIcon />}</span>{featNames[f]}
                </button>
              );
            })}
          </div>
          {showTypes && (
            <div className="popgroup sepd"><button onClick={onDeleted}><span className="chk" />Recently Deleted</button></div>
          )}
        </div>
      )}
    </span>
  );
}
