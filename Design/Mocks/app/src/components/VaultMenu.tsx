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

/** The sample vaults used on every page, in the one fixed order (Settings › Vaults, the order they were added): Passwords (iCloud Drive), Work (Work.kdbx), then Archive (Not found) appears only where that state is drawn. */
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

/** The rows a menu draws by default: the sample vaults, every vault in `open` (default: the current one) shown open unless this is a lock screen, then `extra`. Several vaults can be open at once (owner, 2026-11-25). */
export function menuRows({ current = passwordsVault.name, locked = false, extra = [], open }: { current?: string; locked?: boolean; extra?: VaultRowData[]; open?: string[] }): VaultRowData[] {
  const openNames = open ?? [current];
  return [...sampleVaults, ...extra].map((v) => (v.state === 'locked' && !locked && openNames.includes(v.name) ? { ...v, state: 'open' as const } : v));
}

/** The three ways to add a vault, as direct menu items (no chooser sheet). Each opens its own flow. */
export const addItems = ['New Vault…', 'Open Vault File…', 'Import from Apple Passwords…'];

/**
 * The vault menu, drawn once (owner, 2026-11-25). Vaults always appear in the same order, the order of Settings › Vaults (the order they were added); the open vault never jumps to the top.
 * A vault that is open has no padlock in the app's menu; a locked one has the closed padlock (owner, 2026-11-25: several vaults can be open at once, so the closed one is what stands out). The picker keeps its open padlock.
 * In the app (iPhone and iPad capsule): one row per vault in that order (a check on the current vault, its name, under it where it is kept or the state's words, a padlock or warning glyph at the trailing end), a divider,
 * a section header with the current vault's name holding Vault Settings… and Lock [name] (and Lock All Vaults when two or more vaults are open), a divider, then the three add items (New Vault…, Open Vault File…, Import from Apple Passwords…). It is there even with one vault.
 *
 * `locked` is the lock screen's menu (every platform): the header says “Vault”, there is no section, Vault Settings… or Lock item (nothing is open), `current` is the vault that will open, and the add items follow the rows.
 * `vaults` replaces the default rows (the state page draws every state); `extra` adds rows after the sample vaults (the lock screen's “Archive”). `inline` draws the menu in the page flow instead of hanging from a control.
 */
export function VaultMenu({ onPick, align = 'left', locked = false, current = passwordsVault.name, extra = [], vaults, onChoose, inline, addVault = true, picker, states, shift = 0, single, open }: {
  onPick?: () => void;
  align?: 'left' | 'center' | 'right';
  locked?: boolean;
  current?: string;
  extra?: VaultRowData[];
  vaults?: VaultRowData[];
  onChoose?: (name: string) => void;
  inline?: boolean;
  addVault?: boolean;
  /** The AutoFill and browser variant: header “Vault”, no Lock, no add items, state subtitles. `states` overrides a named vault's state. */
  picker?: boolean;
  states?: Record<string, VaultState>;
  /** Pixels to move a right-aligned menu outward, so it clears the screen edge when its control sits inside padding. */
  shift?: number;
  /** One vault only: the list holds just the current vault. */
  single?: boolean;
  /** The names of the vaults that are open (default: only the current one). Open vaults have an open padlock, locked ones a closed one; with two or more open the menu also offers Lock All Vaults. */
  open?: string[];
}) {
  const pos = inline ? { position: 'static' as const } : align === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : align === 'right' ? { right: -shift, left: 'auto' as const } : { left: 0, right: 'auto' as const };
  const rows = (vaults ?? menuRows({ current, locked, extra, open })).filter((v) => !single || v.name === current).map((v) => (states?.[v.name] ? { ...v, state: states[v.name] } : v));
  if (picker) { locked = true; addVault = false; }
  const openCount = rows.filter((v) => v.state === 'open').length;
  const item = (l: string) => <button key={l} role="menuitem" onClick={onPick}><span className="chk" />{l}</button>;
  const sep = <div className="ph sepd" style={{ padding: 0 }} />;
  return (
    <div className={`pop${locked && !picker ? ' lk-menu' : ''}`} role="menu" style={{ minWidth: 260, ...pos }}>
      {locked && <div className="ph">Vault</div>}
      {rows.map((v) => (
        <button key={v.name} role="menuitemradio" aria-checked={v.name === current} onClick={() => (onChoose ? onChoose(v.name) : onPick?.())}>
          <span className="chk">{v.name === current && <CheckIcon />}</span>
          <span><div>{v.name}</div><div className="s">{vaultSubtitle(v)}</div></span>
          {(v.state !== 'open' || picker) && <VaultStateMark state={v.state} />}
        </button>
      ))}
      {!locked && (
        <>
          {sep}
          <div className="ph" style={{ paddingTop: 6 }}>{current}</div>
          {item('Vault Settings…')}
          {item(`Lock ${current}`)}
          {openCount >= 2 && item('Lock All Vaults')}
        </>
      )}
      {addVault && (
        <>
          {sep}
          {addItems.map(item)}
        </>
      )}
    </div>
  );
}
