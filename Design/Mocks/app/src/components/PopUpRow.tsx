import type { ReactNode } from 'react';

/** The stacked up and down chevrons at the right of a macOS pop-up button. */
export const PopChevrons = () => (
  <span className="mchev" aria-hidden="true">
    <svg viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 4.5 4 2l2.5 2.5" /><path d="M1.5 7.5 4 10l2.5-2.5" /></svg>
  </span>
);

/**
 * The pop-up row, drawn once (owner, 2026-11-24). A label on the left and a value or control on the right, as the system draws a
 * pop-up row in a Form. On iPhone and iPad it is a rounded grey row with the value in the accent colour; on the Mac the label with a
 * colon and the control, a macOS pop-up button (`.mbtn.popup`, chevrons at the right), form one unit centred in the column (owner, 2026-11-25; it was pinned to the
 * centre line and looked shifted right). The app's PopUpRow (App/Core/VaultSwitcher.swift) is this component. Used for Vault and Key file on
 * the lock screens and for Vault in the AutoFill picker.
 *
 * `value` is the text; `chevrons` adds the pop-up arrows (a menu opens); `menu` is drawn under the value when open.
 */
export function PopUpRow({ label, value, chevrons, mac, menu, ariaLabel, tip, width, trailing }: {
  label: string;
  value: ReactNode;
  chevrons?: boolean;
  mac?: boolean;
  menu?: ReactNode;
  ariaLabel?: string;
  tip?: string;
  width?: number | string;
  /** Extra controls after the value (the key file's remove button). */
  trailing?: ReactNode;
}) {
  const v = <>{value}{chevrons && (mac ? <PopChevrons /> : <span style={{ opacity: 0.7 }}> ⌃⌄</span>)}</>;
  return (
    <div className={mac ? 'pur mac' : 'pur'} style={width ? { width } : undefined}>
      <span className="pur-l">{mac ? `${label}:` : label}</span>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button className={mac ? `mbtn${chevrons ? ' popup' : ''}` : 'pur-val'} aria-label={ariaLabel} aria-haspopup={chevrons ? 'menu' : undefined} aria-expanded={chevrons ? !!menu : undefined} data-tip={menu ? undefined : tip}>{v}</button>
        {trailing}
        {menu}
      </span>
    </div>
  );
}
