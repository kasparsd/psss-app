import { CheckIcon, LockClosedIcon, LockOpenIcon, WarningIcon } from '../icons';

/**
 * One vault, as every page draws it (plan: docs/plans/vault-switcher-and-extension-style.md, section 1). A vault is a name, where its file is kept, and one of the person-facing states below.
 * Every menu, list and row in the mocks is built from `VaultRowData`, so the words and the glyph are the same on every page.
 */
export type VaultState = 'open' | 'locked' | 'needs-password' | 'not-downloaded' | 'not-found' | 'unreadable';

export interface VaultRowData { name: string; location: string; state: VaultState }

/** The glyph at the row's trailing end. */
export type VaultGlyph = 'open' | 'closed' | 'warning';

export interface VaultStateInfo {
  /** The person-facing state (plan section 1): Unlocked, Locked, Needs password, Not available. */
  label: string;
  glyph: VaultGlyph;
  /** Replaces the location line; none for Open and Locked (they show where the file is kept). */
  subtitle?: string;
  /** The spoken label of the glyph. */
  spoken: string;
}

export const stateInfo: Record<VaultState, VaultStateInfo> = {
  open: { label: 'Unlocked', glyph: 'open', spoken: 'Unlocked' },
  locked: { label: 'Locked', glyph: 'closed', spoken: 'Locked' },
  'needs-password': { label: 'Needs password', glyph: 'closed', subtitle: 'Needs vault password', spoken: 'Locked, needs vault password' },
  'not-downloaded': { label: 'Not available', glyph: 'warning', subtitle: 'Not downloaded yet', spoken: 'Not available, not downloaded yet' },
  'not-found': { label: 'Not available', glyph: 'warning', subtitle: 'Not found', spoken: 'Not available, not found' },
  unreadable: { label: 'Not available', glyph: 'warning', subtitle: 'Can’t be read', spoken: 'Not available, can’t be read' },
};

/** The second line of a vault's row: the state's words when it has some, otherwise where the file is kept. */
export const vaultSubtitle = (v: VaultRowData) => stateInfo[v.state].subtitle ?? v.location;

/** A vault in the state where the person cannot use it at all (the Not available group). */
export const isUnavailable = (s: VaultState) => stateInfo[s].glyph === 'warning';

/** The sample vaults used on every page: Passwords (iCloud Drive) and Work (Work.kdbx). Archive (Not found) appears only where that state is drawn. */
export const passwordsVault: VaultRowData = { name: 'Passwords', location: 'iCloud Drive', state: 'locked' };
export const workVault: VaultRowData = { name: 'Work', location: 'Work.kdbx', state: 'locked' };
export const archiveVault: VaultRowData = { name: 'Archive', location: 'Archive.kdbx', state: 'not-found' };
export const sampleVaults: VaultRowData[] = [passwordsVault, workVault];

/** One vault of each state, for the page that shows them all at once. */
export const everyState: VaultRowData[] = [
  { ...passwordsVault, state: 'open' },
  workVault,
  { name: 'Family', location: 'Family.kdbx', state: 'needs-password' },
  { name: 'Travel', location: 'Travel.kdbx', state: 'not-downloaded' },
  archiveVault,
  { name: 'Taxes', location: 'Taxes.kdbx', state: 'unreadable' },
];

/** The glyph at the trailing end of a vault's row: open padlock, closed padlock or warning triangle. Secondary colour (orange for the warning), spoken label. */
export function VaultStateMark({ state, inline }: { state: VaultState; inline?: boolean }) {
  const { glyph, spoken } = stateInfo[state];
  return (
    <span role="img" aria-label={spoken} data-tip={spoken} style={{ marginLeft: inline ? 0 : 'auto', paddingLeft: inline ? 0 : 14, color: glyph === 'warning' ? '#ff9f0a' : 'var(--lab2)', display: 'inline-grid', width: 32, flex: 'none' }}>
      <span className="lockg">{glyph === 'open' ? <LockOpenIcon /> : glyph === 'closed' ? <LockClosedIcon /> : <WarningIcon />}</span>
    </span>
  );
}

/** The rows a menu draws by default: the sample vaults, the current one open unless this is a lock screen, then `extra`. */
export function menuRows({ current = passwordsVault.name, locked = false, extra = [] }: { current?: string; locked?: boolean; extra?: VaultRowData[] }): VaultRowData[] {
  return [...sampleVaults, ...extra].map((v) => (v.state === 'locked' && !locked && v.name === current ? { ...v, state: 'open' as const } : v));
}

/**
 * The vault menu, drawn once: a header naming the current vault and Lock [name] (the app's dropdown; not on a lock screen), then one row per vault: a check on the current vault, its name, under it
 * where it is kept or the state's words, a padlock or warning glyph at the trailing end; then Add Vault… (app and lock screen only: `addVault`).
 *
 * `locked` is the lock screen's menu: the header says “Vault”, there is no Lock item, `current` is the vault that will open. `vaults` replaces the default rows (the state page draws every state);
 * `extra` adds rows after the sample vaults (the lock screen's “Archive”). `inline` draws the menu in the page flow instead of hanging from a control.
 */
export function VaultMenu({ onPick, align = 'left', locked = false, current = passwordsVault.name, extra = [], vaults, onChoose, inline, addVault = true, picker, states, shift = 0 }: {
  onPick?: () => void;
  align?: 'left' | 'center' | 'right';
  locked?: boolean;
  current?: string;
  extra?: VaultRowData[];
  vaults?: VaultRowData[];
  onChoose?: (name: string) => void;
  inline?: boolean;
  addVault?: boolean;
  /** The AutoFill and browser variant: header “Vault”, no Lock, no Add Vault…, state subtitles. `states` overrides a named vault's state. */
  picker?: boolean;
  states?: Record<string, VaultState>;
  /** Pixels to move a right-aligned menu outward, so it clears the screen edge when its control sits inside padding. */
  shift?: number;
}) {
  const pos = inline ? { position: 'static' as const } : align === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : align === 'right' ? { right: -shift, left: 'auto' as const } : { left: 0, right: 'auto' as const };
  const rows = (vaults ?? menuRows({ current, locked, extra })).map((v) => (states?.[v.name] ? { ...v, state: states[v.name] } : v));
  if (picker) { locked = true; addVault = false; }
  return (
    <div className={`pop${locked && !picker ? ' lk-menu' : ''}`} role="menu" style={{ minWidth: 260, ...pos }}>
      <div className="ph">{locked ? 'Vault' : current}</div>
      {!locked && (
        <>
          <button role="menuitem" onClick={onPick}><span className="chk"><span className="lockg" style={{ display: 'inline-grid', width: 14, height: 14 }}><LockClosedIcon /></span></span>Lock {current}</button>
          <div className="ph sepd" style={{ padding: 0 }} />
        </>
      )}
      {rows.map((v) => (
        <button key={v.name} role="menuitemradio" aria-checked={v.name === current} onClick={() => (onChoose ? onChoose(v.name) : onPick?.())}>
          <span className="chk">{v.name === current && <CheckIcon />}</span>
          <span><div>{v.name}</div><div className="s">{vaultSubtitle(v)}</div></span>
          <VaultStateMark state={v.state} />
        </button>
      ))}
      {addVault && (
        <>
          <div className="ph sepd" />
          <button onClick={onPick}><span className="chk" />Add Vault…</button>
        </>
      )}
    </div>
  );
}
