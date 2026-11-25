import type { ReactNode } from 'react';
import { ChevronDownIcon, VaultsIcon } from '../icons';

/** The vault name as the capsule shows it: the tail cut with an ellipsis after about 11 characters (“Family Passwords” becomes “Family Pass…”). */
export const shortVaultName = (n: string) => (n.length > 12 ? `${n.slice(0, 11).trimEnd()}…` : n);

/**
 * The vault button of the iPhone toolbar, and of the iPad toolbar while the sidebar is hidden (owner, 2026-11-25): a standard glass capsule at the top left, next to the gear,
 * with the vault glyph, the vault's name (tail-truncated) and a small chevron. It is labeled, not icon-only, and shown even with one vault. Its spoken label is “Vault: <full name>”.
 * `menu` is the shared `VaultMenu`, drawn under the capsule when open, from the capsule's left edge; on iPhone its width is capped so it stays inside the screen (see `.vcap-menu` in styles.css).
 */
export function VaultCapsule({ name = 'Passwords', open, menu }: { name?: string; open?: boolean; menu?: ReactNode }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn glass vcap" aria-label={`Vault: ${name}`} aria-haspopup="menu" aria-expanded={!!open} data-tip={open ? undefined : `Vault: ${name}`}>
        <span className="vcg" aria-hidden="true"><VaultsIcon /></span>
        <span className="vcn">{shortVaultName(name)}</span>
        <span className="vcc" aria-hidden="true"><ChevronDownIcon /></span>
      </button>
      {open && <div className="vcap-menu" style={{ position: 'absolute', top: 40, left: 0, zIndex: 60 }}>{menu}</div>}
    </span>
  );
}
