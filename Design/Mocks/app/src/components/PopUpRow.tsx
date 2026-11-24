import type { ReactNode } from 'react';

/**
 * The pop-up row, drawn once (owner, 2026-11-24). A label on the left and a value or control on the right, as the system draws a
 * pop-up row in a Form. On iPhone and iPad it is a rounded grey row with the value in the accent colour; on the Mac the label is
 * right-aligned with a colon in a narrow column and the control, a bordered pop-up button, sits right beside it (HIG, Forms). The app's PopUpRow (App/Core/VaultSwitcher.swift) is this component. Used for Vault and Key file on
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
  const v = <>{value}{chevrons && <span style={{ opacity: 0.7 }}> ⌃⌄</span>}</>;
  return (
    <div className={mac ? 'pur mac' : 'pur'} style={width ? { width } : undefined}>
      <span className="pur-l">{mac ? `${label}:` : label}</span>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <button className={mac ? 'btn' : 'pur-val'} aria-label={ariaLabel} aria-haspopup={chevrons ? 'menu' : undefined} aria-expanded={chevrons ? !!menu : undefined} data-tip={menu ? undefined : tip}>{v}</button>
        {trailing}
        {menu}
      </span>
    </div>
  );
}
