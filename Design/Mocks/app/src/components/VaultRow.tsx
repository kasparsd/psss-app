import type { ReactNode } from 'react';
import { PopUpRow } from './PopUpRow';
import { Notice } from './Notice';
import { ChevronDownIcon, VaultsIcon, WarningIcon } from '../icons';

/**
 * The Vault row, drawn once (plan: docs/plans/vault-switcher-and-extension-style.md, sections 2 and 3). It is the vault picker on the lock screen, on every AutoFill screen
 * (list, values, codes, text, save) and, compact, in the browser popup's header. Shown with two or more vaults; the lock screen shows it always.
 *
 * - `unlocked`: “Vault” and the current vault's name with ⌃⌄. Nothing else.
 * - `locked`: the same, and a labeled **Unlock** button at the row's trailing end. AutoFill and the browser popup only; the lock screen is itself the unlock.
 * - `unavailable`: the same as unlocked, with the orange warning glyph at the row's trailing end (as in the menu) and no Unlock button. A notice below (`VaultNotice`) says which state and what Psss will do. The row stays so another vault is one tap away.
 *
 * `variant`: `phone` is the rounded grey pop-up row (iPhone, and iPad's sheet in compact width); `mac` is the label with a colon and a bordered pop-up button (Mac and iPad sheet); `compact` is
 * the popup header's form: the vault glyph (outside, at the left, as a label), then the name with a chevron as a plain select-style button, and Unlock beside it. `menu` is drawn under the name when open (pass a `VaultMenu`).
 */
export type VaultRowState = 'unlocked' | 'locked' | 'unavailable';

const unlockBtn = <button className="btn pri">Unlock</button>;
/** The Mac's Unlock: the default push button (accent fill, white text). */
const unlockMac = <button className="mbtn default">Unlock</button>;
const warnGlyph = (
  <span role="img" aria-label="Not available" data-tip="Not available" style={{ color: '#ff9f0a', display: 'inline-grid', width: 22, flex: 'none' }}><span className="lockg"><WarningIcon /></span></span>
);

export function VaultRow({ name = 'Passwords', state, variant, menu }: { name?: string; state: VaultRowState; variant: 'phone' | 'mac' | 'compact'; menu?: ReactNode }) {
  const aria = `Vault: ${name}. Switch vault`;
  const unlock = state === 'locked' ? (variant === 'mac' ? unlockMac : unlockBtn) : state === 'unavailable' ? warnGlyph : undefined;
  if (variant === 'compact') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="vglyph" aria-hidden="true"><VaultsIcon /></span>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button className="btn sq" aria-label="Vault" aria-haspopup="menu" aria-expanded={!!menu} data-tip={menu ? undefined : `Vault: ${name}. Switch vault`}>{name} <span className="vgc" aria-hidden="true"><ChevronDownIcon /></span></button>
            {menu}
          </span>
        </span>
        {unlock}
      </span>
    );
  }
  if (variant === 'mac') {
    return <PopUpRow label="Vault" value={name} chevrons mac ariaLabel={aria} tip="Switch vault" menu={menu} trailing={unlock} />;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}><PopUpRow label="Vault" value={name} chevrons ariaLabel={aria} tip="Switch vault" menu={menu} /></div>
      {unlock}
    </div>
  );
}

/** Why the current vault cannot be used right now, in one notice under the Vault row. `unlock` puts the Unlock button in the notice (with one vault there is no Vault row to carry it). */
export type NeedsPasswordWhy = 'off' | 'changed' | 'locked-out';
export type VaultNoticeKind = 'locked' | 'needs-password' | 'cancelled' | 'not-downloaded' | 'not-found' | 'unreadable';

const whyText = (why: NeedsPasswordWhy, bio: string, name: string) =>
  why === 'off' ? `${bio} is off for ${name}.` : why === 'changed' ? `${bio} changed since ${name} was set up.` : `${bio} is locked out right now.`;

export function VaultNotice({ kind, name = 'Passwords', bio = 'Face ID', unlock, why = 'off' }: { kind: VaultNoticeKind; name?: string; bio?: 'Face ID' | 'Touch ID'; unlock?: boolean; why?: NeedsPasswordWhy }) {
  const action = unlock ? unlockBtn : undefined;
  switch (kind) {
    case 'locked': return <Notice kind="info" action={action}>{name} is locked. Choose Unlock to use {bio}.</Notice>
    case 'needs-password': return <Notice kind="info" action={action}>{whyText(why, bio, name)} Unlock with the vault password.</Notice>;
    case 'cancelled': return <Notice kind="info" action={action}>{bio} was cancelled.</Notice>;
    case 'not-downloaded': return <Notice kind="warning">{name} isn’t downloaded yet. Open Psss to download it.</Notice>;
    case 'not-found': return <Notice kind="warning">{name} can’t be found. Open Psss to locate it.</Notice>;
    case 'unreadable': return <Notice kind="warning">{name} can’t be read. Open Psss for details.</Notice>;
  }
}
