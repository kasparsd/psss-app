import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { Chevron, CodePill, ItemIcon, ListRow } from '../components/Rows';
import { FieldRow } from '../components/FieldRow';
import { CopyHost } from '../components/copy';
import { VaultMenu, passwordsVault, workVault } from '../components/VaultMenu';
import { PopChevrons } from '../components/PopUpRow';
import { BackIcon, EyeIcon, EyeOffIcon, SearchIcon } from '../icons';
import { byId, items, type Field, type Item } from '../data';
import './mbm.css';

/** The monochrome small mark (mock #/small-mark, outline): the system draws a menu bar template image in one colour. */
export const BarMark = () => (
  <svg width="15" height="15" viewBox="0 0 56 56" aria-hidden>
    <circle cx="28" cy="28" r="24.5" fill="none" stroke="currentColor" strokeWidth="7" />
    <circle cx="28" cy="28" r="10" fill="currentColor" />
  </svg>
);

/** A Mac screen: the menu bar with our item, one app in front, and whatever is open on top. */
export function Desk({ app = 'Safari', open, onMark, onAway, children, front, short, gone }: {
  app?: string; open?: boolean; onMark?: () => void; onAway?: () => void; children?: ReactNode; front?: ReactNode; short?: boolean;
  /** Psss has quit, so its menu bar item is not there. */
  gone?: boolean;
}) {
  return (
    <div className={`mbm-desk dt macui${short ? ' short' : ''}`} onClick={(e) => { const t = e.target as Element; if (t.isConnected && !t.closest('.mbm-panel, .mbm-mark')) onAway?.(); }}>
      <div className="mbm-bar">
        <strong>{app}</strong><span>File</span><span>Edit</span><span>View</span>
        <span className="grow" />
        {!gone && <button className={`mbm-mark${open ? ' open' : ''}`} onClick={onMark} aria-label="Psss" title="Psss"><BarMark /></button>}
        <span>100%</span><span>Thu 09:41</span>
      </div>
      {front}
      {children}
    </div>
  );
}

export type Front = 'Safari' | 'Chrome' | 'Firefox' | 'Zen' | 'Slack' | 'Terminal';
/** What macOS has let Psss ask Safari or Chrome: the address of the front tab. 'off': Not Now was pressed. */
export type PageAccess = 'ask' | 'allowed' | 'denied' | 'off';
export type Tab = 'search' | 'generate' | 'new';
type VaultName = 'Passwords' | 'Work';

const tabs: [Tab, string][] = [['search', 'Search'], ['generate', 'Generate'], ['new', 'New Login']];

/** Browsers macOS can be asked for the page. */
const scriptable = (f: Front) => f === 'Safari' || f === 'Chrome';
/** Browsers that tell the page only through the Psss extension. */
const extensionOnly = (f: Front) => f === 'Firefox' || f === 'Zen';
/** Where Set Up goes for now. Safari’s extension is inside the app, so it has no card. */
const extensionPage = (f: Front) => `psss.app/#${f.toLowerCase()}`;

function FrontApp({ app, site, url }: { app: Front; site: string; url?: string }) {
  if (app === 'Terminal') {
    return <div className="mbm-app term" aria-hidden><div>sam@mac ~ % ssh deploy@build.example</div><div>deploy@build.example’s password: ▌</div></div>;
  }
  return (
    <div className="mbm-app" aria-hidden>
      <div className="mbm-url">{url ?? (app === 'Slack' ? 'Slack · Sign in to your workspace' : `${site}/sign-in`)}</div>
      {url ? <div className="mbm-form"><strong>Psss for {app}</strong></div> : <div className="mbm-form"><div>Email or username</div><i /><div>Password</div><i /></div>}
    </div>
  );
}

const login = (id: number, name: string, account: string, site: string, color: Item['color'], code?: string): Item => ({
  id, name, account, kind: 'login', color, code, uses: 3,
  fields: [{ label: 'Username', value: account }, { label: 'Password', value: 'orchid-quartz-delta-47', secret: true }, { label: 'Website', value: site }],
});
const slack = login(201, 'Slack', 'sam@harbor.example', 'slack.example', 6, '221 087');
const build = login(202, 'build.example', 'deploy', 'build.example', 4);
const workItems = [login(301, 'Gitforge', 'sam.rivera@harbor.example', 'gitforge.example', 1, '118 402'), login(302, 'Payroll', 'sam.r', 'payroll.example', 5)];
const vaultItems: Record<VaultName, Item[]> = {
  Passwords: [...items, slack, build],
  Work: workItems,
};
const recentOf: Record<VaultName, Item[]> = { Passwords: [byId(5), byId(2), byId(6)], Work: workItems };

const siteOf = (i: Item) => i.fields.find((f) => f.label === 'Website')?.value;

/** Every value of an item, as its page lists them: for a login the code follows the password. */
function fieldsOf(item: Item): Field[] {
  if (item.kind !== 'login') return item.fields;
  const first = ['Username', 'Password', 'Website'];
  const list = [...first.flatMap((l) => item.fields.filter((f) => f.label === l)), ...item.fields.filter((f) => !first.includes(f.label))];
  if (item.code) list.splice(2, 0, { label: 'Verification code', value: item.code });
  return list;
}
/** What Return copies. */
const mainField = (item: Item) => (item.kind === 'login' ? 'Password' : item.kind === 'card' ? 'Card number' : (item.fields.find((f) => f.secret) ?? item.fields[0]).label);
const valueOf = (item: Item, label: string) => item.fields.find((f) => f.label === label)?.value;
/** The site of a typed address, as the app compares it (the mock’s short version of the app’s rules). */
const hostOf = (web: string) => web.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '');
/** A saved site covers itself and its own subdomains, never its parent (the app’s SiteMatch rules, shortened). */
const covers = (saved: string, host: string) => !!saved && (host === saved || (saved.includes('.') && host.endsWith(`.${saved}`)));

/** The item’s own page inside the panel, as on iPhone: Back, who it is, every value with its own button. */
function ItemPage({ item, paste, front, otherSite, revealed, onBack, onPaste, onShow }: {
  item: Item; paste: boolean; front: Front; otherSite?: string; revealed: Set<string>; onBack: () => void; onPaste: (label: string) => void; onShow: () => void;
}) {
  // A two-finger swipe to the right goes back, the page following the fingers (the app uses the system’s swipe tracking).
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let by = 0, rest = 0;
    const settle = () => { by = 0; el.style.transform = ''; };
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      // The browser must not take the swipe for its own history.
      e.preventDefault();
      by = Math.max(0, by - e.deltaX);
      el.style.transform = by ? `translateX(${by}px)` : '';
      window.clearTimeout(rest);
      if (by > 140) { settle(); latest.current(); } else rest = window.setTimeout(settle, 160);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { window.clearTimeout(rest); el.removeEventListener('wheel', wheel); };
  }, []);
  return (
    <div className="mbm-detail" ref={root}>
      <div className="mbm-who">
        <button className="mbtn mbm-back" onClick={onBack} title="Esc or ←"><BackIcon />Back</button>
        <ItemIcon item={item} />
        <h3 className="trunc">{item.name}</h3>
      </div>
      {otherSite && <div className="mbm-note">Saved for <strong>{otherSite}</strong>, not the page in front.</div>}
      <div className="icard">
        {fieldsOf(item).map((f) => (
          <FieldRow key={`${item.id}-${f.label}`} {...f} shown={revealed.has(`${item.id}-${f.label}`)}
            onShown={(shown) => { const key = `${item.id}-${f.label}`; if (shown) revealed.add(key); else revealed.delete(key); }}
            action={!paste || f.label === 'Website' ? undefined : (
              <button className="mbtn" onClick={(e) => { e.stopPropagation(); onPaste(f.label); }} aria-label={`Paste ${f.label.toLowerCase()} into ${front}`} title={`Paste into ${front}`}>Paste</button>
            )} />
        ))}
      </div>
      <button className="mbtn" onClick={onShow}>Show in Psss</button>
    </div>
  );
}

/* ---------- Generate ---------- */

type GenKind = 'strong' | 'random' | 'words' | 'pin' | 'key';
type Separator = '-' | ' ' | '.' | '';
interface GenSettings { random: number; numbers: boolean; symbols: boolean; words: number; separator: Separator; capitals: boolean; wordNumber: boolean; wordSymbol: boolean; pin: number; bytes: number; format: 'hex' | 'base64' }
interface Gen { set: GenSettings; values: Record<GenKind, string> }

const wordList = ['harbor', 'lantern', 'quiet', 'maple', 'orbit', 'plume', 'cobalt', 'fern', 'quill', 'granite', 'lark', 'meadow'];
function draw(from: string | string[], n: number): string[] {
  const r = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(r, (v) => from[v % from.length]);
}
/** Mock output only; the app uses its own generator (App/Core/PasswordGenerator.swift). */
function make(kind: GenKind, s: GenSettings): string {
  const letters = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  if (kind === 'words') {
    const list = draw(wordList, s.words).map((w) => (s.capitals ? w[0].toUpperCase() + w.slice(1) : w));
    if (s.wordNumber) list[list.length - 1] += draw('23456789', 1)[0];
    if (s.wordSymbol) list[list.length - 1] += draw('!#%+=?', 1)[0];
    return list.join(s.separator);
  }
  if (kind === 'pin') return draw('0123456789', s.pin).join('');
  if (kind === 'key') {
    const bytes = crypto.getRandomValues(new Uint8Array(s.bytes));
    return s.format === 'hex' ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') : btoa(String.fromCharCode(...bytes));
  }
  if (kind === 'random') return draw(`${letters}${s.numbers ? '23456789' : ''}${s.symbols ? '!#%+=?' : ''}`, s.random).join('');
  return [0, 1, 2].map(() => draw(`${letters}23456789`, 6).join('')).join('-');
}
const kinds: GenKind[] = ['strong', 'random', 'words', 'pin', 'key'];
const defaults: GenSettings = { random: 20, numbers: true, symbols: false, words: 6, separator: '-', capitals: true, wordNumber: true, wordSymbol: false, pin: 6, bytes: 32, format: 'hex' };
/** New values for every kind, with these settings. */
function newGen(set: GenSettings = defaults): Gen {
  return { set, values: Object.fromEntries(kinds.map((k) => [k, make(k, set)])) as Record<GenKind, string> };
}

const Slider = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) => (
  <label className="mbm-slider"><span>{label}</span><input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} /><span className="mbm-num">{value}</span></label>
);
/** A toggle in a grouped form: its label, and the system switch at the trailing end. */
const Toggle = ({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) => (
  <div className="mbm-toggle"><span>{label}</span><button type="button" className={`mbm-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}><i /></button></div>
);
function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mbm-seg"><span>{label}</span><div className="switch" role="group" aria-label={label}>{options.map(([v, l]) => <button type="button" key={l} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div></div>
  );
}

/** Every kind on one page, each with its value, its controls and its buttons. */
function Generate({ gen, onGen, paste, startAt, onPaste, onCopy, onSave }: { gen: Gen; onGen: (g: Gen) => void; paste: boolean; startAt?: GenKind; onPaste: (what: string) => void; onCopy: (what: string) => void; onSave: (value: string) => void }) {
  const s = gen.set;
  const change = (kind: GenKind, part: Partial<GenSettings>) => { const set = { ...s, ...part }; onGen({ set, values: { ...gen.values, [kind]: make(kind, set) } }); };
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = top.current?.closest<HTMLElement>('.mbm-main');
    const block = top.current?.querySelector<HTMLElement>(`[data-kind="${startAt}"]`);
    if (main && block) main.scrollTop += block.getBoundingClientRect().top - main.getBoundingClientRect().top - 8;
  }, [startAt]);
  const weak = (more: string) => <div className="mbm-note alert">Weaker than the recommended password. A machine trying a trillion guesses a second would need about 25 years. {more}</div>;
  const block = (kind: GenKind, title: string, noun: string, controls?: ReactNode) => (
    <section className="mbm-group mbm-genblock" data-kind={kind} aria-label={title}>
      <div className="mbm-genhead">
        <div className="mbm-head">{title}</div>
        <button className="mbtn" onClick={() => onCopy(noun)} aria-label={`Copy ${title}`}>Copy</button>
        {paste && <button className="mbtn" onClick={() => onPaste(noun)} aria-label={`Paste ${title}`}>Paste</button>}
        <button className="mbtn" onClick={() => change(kind, {})} aria-label={`New ${title}`}>New</button>
      </div>
      <div className="mbm-gen">{gen.values[kind]}</div>
      {controls}
      {(kind === 'strong' || kind === 'random' || kind === 'words') && <div className="mbm-row2"><button className="mbtn" onClick={() => onSave(gen.values[kind])} aria-label={`Save ${title} as a new login`}>Save as Login…</button></div>}
    </section>
  );
  return (
    <div className="mbm-body" ref={top}>
      {block('strong', 'Strong Password', 'Password')}
      {block('random', 'Random Characters', 'Password', <>
        <Slider label="Characters" value={s.random} min={12} max={64} onChange={(random) => change('random', { random })} />
        <Toggle label="Numbers" on={s.numbers} onChange={(numbers) => change('random', { numbers })} />
        <Toggle label="Symbols" on={s.symbols} onChange={(symbols) => change('random', { symbols })} />
        {s.random * Math.log2(48 + (s.numbers ? 8 : 0) + (s.symbols ? 6 : 0)) < 71 && weak('Make it longer.')}
      </>)}
      {block('words', 'Words', 'Password', <>
        <Slider label="Words" value={s.words} min={4} max={7} onChange={(words) => change('words', { words })} />
        <label className="mbm-toggle"><span>Separator</span><select className="mbm-select" value={s.separator} onChange={(e) => change('words', { separator: e.target.value as Separator })}><option value="-">Hyphen</option><option value=" ">Space</option><option value=".">Period</option><option value="">None</option></select></label>
        <Toggle label="Capitals" on={s.capitals} onChange={(capitals) => change('words', { capitals })} />
        <Toggle label="Number" on={s.wordNumber} onChange={(wordNumber) => change('words', { wordNumber })} />
        <Toggle label="Symbol" on={s.wordSymbol} onChange={(wordSymbol) => change('words', { wordSymbol })} />
        {s.words < 6 && weak('Add a word.')}
      </>)}
      {block('pin', 'PIN', 'PIN', <Slider label="Digits" value={s.pin} min={4} max={12} onChange={(pin) => change('pin', { pin })} />)}
      {block('key', 'Key', 'Key', <>
        <Slider label="Bytes" value={s.bytes} min={16} max={64} onChange={(bytes) => change('key', { bytes })} />
        <Segments<'hex' | 'base64'> label="Format" value={s.format} options={[['hex', 'Hex'], ['base64', 'Base64']]} onChange={(format) => change('key', { format })} />
        <div className="s">{s.bytes * 8} random bits, for tokens and secrets.</div>
      </>)}
    </div>
  );
}

/* ---------- New Login ---------- */

/** What has been typed into New Login. `web` stays unset until edited, so it follows the page. Each vault has its own. */
export interface Draft { name?: string; web?: string; webTyped?: boolean; user: string; password: string; shown?: boolean; saved?: boolean }
const emptyDraft: Draft = { user: '', password: '' };
const dirty = (d: Draft) => !d.saved && !!(d.name || d.user || d.password || (d.webTyped && d.web));

function NewLogin({ vault, site, draft, onDraft, onCopy, onShow, readOnly, failed }: { vault: VaultName; site?: string; draft: Draft; onDraft: (d: Draft) => void; onCopy: (what: string) => void; onShow: () => void; readOnly?: boolean; failed?: boolean }) {
  const { user, password, saved, shown } = draft;
  const web = draft.web ?? site ?? '';
  const host = hostOf(web);
  // Once something is typed the website stays put, so the draft never moves to another site.
  const set = (part: Partial<Draft>) => onDraft({ ...draft, web: draft.web ?? (part.web === undefined && (part.user !== undefined || part.password !== undefined || part.name !== undefined) ? web : undefined), ...(part.web !== undefined ? { webTyped: true } : {}), ...part });
  const itemHost = (i: Item) => hostOf(siteOf(i) ?? '');
  // The exact site comes before one that only covers a subdomain.
  const matches = vaultItems[vault].filter((i) => i.kind === 'login' && covers(itemHost(i), host) && i.account === user).sort((a, b) => Number(itemHost(b) === host) - Number(itemHost(a) === host));
  const exact = matches.find((i) => valueOf(i, 'Password') === password);
  const same = exact ?? matches[0];
  const already = !!exact;
  const label = same && (same.account ? `${same.name} (${same.account})` : same.name);
  const named = !!(draft.name?.trim() || host);
  const can = !!password && named && !readOnly;
  const where = vault === 'Passwords' ? 'iCloud Drive' : 'Work.kdbx';
  if (saved) {
    return (
      <div className="mbm-center" role="status">
        <div className="t">Saved to {vault}</div>
        <button type="button" className="mbtn default" onClick={() => onCopy('Password')}>Copy Password</button>
        <button type="button" className="mbtn" onClick={onShow}>Show in Psss</button>
        <button type="button" className="mbtn" onClick={() => onDraft(emptyDraft)}>Add Another</button>
      </div>
    );
  }
  return (
    <form className="mbm-body mbm-newlogin" onSubmit={(e) => { e.preventDefault(); if (can && !already) set({ saved: true }); }}>
      {failed && <div className="mbm-group mbm-failed" role="alert"><span>Couldn’t save to {vault}. Nothing was changed.</span><button type="button" className="mbtn" disabled={!can} onClick={() => set({ saved: true })}>Try Again</button></div>}
      <div className="mbm-group mbm-fields">
        <label className="mapfield"><span className="l">Name</span><input className="mbm-in" value={draft.name ?? ''} placeholder={host || 'Name or website'} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="mapfield"><span className="l">Website</span><input className="mbm-in" value={web} placeholder="Optional" onChange={(e) => set({ web: e.target.value })} /></label>
        <label className="mapfield"><span className="l">Username</span><input className="mbm-in" value={user} placeholder="Optional" onChange={(e) => set({ user: e.target.value })} /></label>
        <div className="mapfield"><span className="l">Password</span><input className="mbm-in mbm-pwin" aria-label="Password" type={shown ? 'text' : 'password'} value={password} placeholder="Required" onChange={(e) => set({ password: e.target.value })} />
          <button type="button" className="eye" aria-label={shown ? 'Hide password' : 'Show password'} title={shown ? 'Hide password' : 'Show password'} onClick={() => set({ shown: !shown })}>{shown ? <EyeOffIcon /> : <EyeIcon />}</button></div>
        <div className="mapfield"><button type="button" className="mbtn" onClick={() => set({ password: make('strong', newGen().set), shown: true })}>Use a Strong Password</button></div>
      </div>
      <div className="s mbm-footnote">Saved in {vault} ({where}). Add a code, notes or other fields in Psss.</div>
      {readOnly && <div className="mbm-note alert" role="alert">{vault} is read-only, so nothing can be saved to it. Choose another vault.</div>}
      {!!password && !named && <div className="s">Enter a name or a website.</div>}
      {already && <div className="mbm-note">{label} already has this password.</div>}
      {same && !already && !!password && <div className="s">Replaces the password of {label}. The old one stays under Previous passwords.</div>}
      <div className="mbm-group mbm-save">
        {same && !already
          ? <><button type="button" className="mbtn" disabled={!can} onClick={() => set({ saved: true })}>Save as New</button><button className="mbtn default" disabled={!can}>Update {label}</button></>
          : <button className="mbtn default" disabled={!can || already}>Save Login</button>}
      </div>
    </form>
  );
}

/* ---------- the panel ---------- */

export type Problem = 'wrong' | 'cancelled' | 'password' | 'not-downloaded' | 'not-found' | 'unreadable';

export interface PanelProps {
  front?: Front;
  site?: string;
  access?: PageAccess;
  /** The Psss extension in the browser in front has talked to the app. */
  extension?: boolean;
  /** That extension is connected, but the browser has not let it read tab addresses. */
  tabsDenied?: boolean;
  /** Not Now was pressed on the extension card. */
  dismissed?: boolean;
  /** Set Up: open this address in the browser in front. */
  onSetUp?: (url: string) => void;
  /** Later feature: Paste is on. */
  paste?: boolean;
  /** Later feature: Paste is offered and not yet on. */
  offerPaste?: boolean;
  tab?: Tab;
  vault?: VaultName;
  locked?: boolean;
  /** Start with the vault menu open. */
  menu?: boolean;
  query?: string;
  /** Start with this item’s page open. */
  detail?: number;
  /** Scroll Generate to this kind. */
  genAt?: GenKind;
  saved?: boolean;
  /** The other app changed before pasting. */
  moved?: boolean;
  noVault?: boolean;
  centered?: boolean;
  draft?: Draft;
  /** A new login waiting while another unsaved one is in the way. */
  incoming?: Draft;
  readOnly?: boolean;
  saveFailed?: boolean;
  /** Why the vault can’t be opened as usual. */
  problem?: Problem;
  /** Locked because the lock time passed while away. */
  away?: boolean;
  /** Both vaults are open. */
  bothOpen?: boolean;
  /** The browser has not answered with the page yet. */
  waiting?: boolean;
  /** Generate starts with settings weaker than the recommended password. */
  weak?: boolean;
  /** Open Psss or its Settings window. */
  onOpen?: (window: string) => void;
  /** The prototype's panel takes the keyboard. */
  live?: boolean;
  /** Closed in the prototype: kept, so vaults stay as they were. It opens on Search again. */
  hidden?: boolean;
  onQuit?: () => void;
  onClose?: () => void;
}

/**
 * The panel under the menu bar item, and the same panel in the middle of the screen when the shortcut opens it. It keeps the
 * other app in front. The vault switcher and the three tabs are always at the top.
 */
export function Panel(p: PanelProps) {
  const { front = 'Safari', site = 'gitforge.example', centered, live, moved, noVault, onClose } = p;
  const [tab, setTab] = useState<Tab>(p.tab ?? 'search');
  const [vault, setVault] = useState<VaultName>(p.vault ?? 'Passwords');
  const [open, setOpen] = useState<Record<VaultName, boolean>>({ Passwords: !p.locked && !p.problem && !p.away, Work: !!p.bothOpen || (p.vault === 'Work' && !p.locked && !p.problem) });
  // Why a vault can’t be opened as usual stays with that vault; a failed attempt is only about the last try.
  const [reasons, setReasons] = useState<Partial<Record<VaultName, Exclude<Problem, 'wrong' | 'cancelled'>>>>(
    p.problem && p.problem !== 'wrong' && p.problem !== 'cancelled' ? { [p.vault ?? 'Passwords']: p.problem } : {});
  const [failure, setFailure] = useState(p.problem === 'wrong' || p.problem === 'cancelled' ? p.problem : undefined);
  const [away, setAway] = useState(!!p.away);
  const [password, setPassword] = useState('');
  const [menu, setMenu] = useState(!!p.menu);
  const [query, setQuery] = useState(p.query ?? '');
  /** The id of the item the person picked; unset until then. */
  const [sel, setSel] = useState<number>();
  /** The item whose page is open in the Search tab. */
  const [opened, setOpened] = useState(p.detail);
  /** Values the eye has shown, kept until a lock. */
  const revealed = useRef(new Set<string>());
  const [done, setDone] = useState<string>();
  // One draft for each vault, so nothing typed for one is saved to another.
  const [drafts, setDrafts] = useState<Record<VaultName, Draft>>({ Passwords: p.draft ?? { ...emptyDraft, saved: p.saved, ...(p.saved ? { password: 'orchid-quartz-delta-47' } : {}) }, Work: emptyDraft });
  const draft = drafts[vault];
  const setDraft = (d: Draft) => setDrafts({ ...drafts, [vault]: d });
  const [incomings, setIncomings] = useState<Partial<Record<VaultName, Draft>>>(p.incoming ? { [p.vault ?? 'Passwords']: p.incoming } : {});
  const incoming = incomings[vault];
  const setIncoming = (d?: Draft) => setIncomings({ ...incomings, [vault]: d });
  const [gen, setGen] = useState(() => newGen(p.weak ? { ...defaults, words: 4, random: 12 } : defaults));
  const [paste, setPaste] = useState(p.paste ?? false);
  // Answers are remembered per browser.
  const [answers, setAnswers] = useState<Partial<Record<Front, PageAccess>>>({});
  const [dismissals, setDismissals] = useState<Partial<Record<Front, boolean>>>({});
  const access = answers[front] ?? p.access ?? 'allowed';
  const setAccess = (a: PageAccess) => setAnswers({ ...answers, [front]: a });
  const dismissed = dismissals[front] ?? !!p.dismissed;
  const setDismissed = (on: boolean) => setDismissals({ ...dismissals, [front]: on });

  const isOpen = open[vault];
  const browser = scriptable(front) || extensionOnly(front);
  const page = !p.waiting && ((scriptable(front) && access === 'allowed') || (extensionOnly(front) && p.extension && !p.tabsDenied)) ? site : undefined;
  const askAccess = scriptable(front) && access === 'ask';
  // One card at a time: Chrome asks for the page first, then offers the extension.
  const offerExtension = browser && front !== 'Safari' && !p.extension && !dismissed && !askAccess;

  const q = query.trim().toLowerCase();
  const all = vaultItems[vault];
  const forPage = page ? all.filter((i) => i.kind === 'login' && siteOf(i) === page) : [];
  let groups: { head: string; list: Item[] }[];
  if (q) {
    const found = all.filter((i) => `${i.name} ${i.account} ${siteOf(i) ?? ''}`.toLowerCase().includes(q));
    groups = page
      ? [{ head: 'For This Site', list: found.filter((i) => forPage.includes(i)) }, { head: 'Other Matches', list: found.filter((i) => !forPage.includes(i)) }]
      : [{ head: 'Logins', list: found.filter((i) => i.kind === 'login') }, { head: 'Cards', list: found.filter((i) => i.kind === 'card') }, { head: 'Notes and Other', list: found.filter((i) => i.kind !== 'login' && i.kind !== 'card') }];
  } else {
    // Whole words only, and never for a browser: “Zen” must not suggest Zendesk.
    const named = browser ? [] : all.filter((i) => i.name.toLowerCase().split(/[^a-z0-9]+/).includes(front.toLowerCase()));
    groups = [
      page ? { head: `For ${page}`, list: forPage } : { head: `Named like ${front}`, list: named },
      { head: 'Recently used', list: recentOf[vault].filter((i) => !forPage.includes(i) && !named.includes(i)) },
    ];
  }
  const shown = groups.filter((g) => g.list.length);
  const flat = shown.flatMap((g) => g.list);
  // Nothing saved for the page: select nothing, so Return can’t copy another site’s password.
  // A pick is held by item, so a late answer that reorders the list can’t move it to another one.
  const picked = flat.findIndex((i) => i.id === sel);
  const at = picked >= 0 ? picked : Math.min(p.waiting || (!q && page && !forPage.length) ? -1 : 0, flat.length - 1);

  const report = (text: string) => setDone(`${text}. The clipboard clears in 60 seconds.`);
  const copied = (what: string) => report(`${what} copied`);
  const pasted = (what: string) => setDone(`${what} pasted into ${front}. Return was not pressed.`);
  const act = (what: string) => (paste ? pasted(what) : copied(what));
  const forget = () => { setPassword(''); setFailure(undefined); };
  const go = (t: Tab) => { if (t !== tab) forget(); setTab(t); setDone(undefined); setMenu(false); };
  const switchVault = (name: VaultName, search = '') => {
    if (name !== vault) forget();
    setVault(name); setMenu(false); setSel(undefined); setOpened(undefined); setQuery(search); setDone(undefined);
  };
  const show = () => p.onOpen?.('Psss');
  /** Starts a new login, asking first when an unsaved one would be replaced. */
  const start = (d: Draft) => { if (dirty(draft)) setIncoming(d); else { setDraft(d); setIncoming(undefined); } go('new'); };
  const openCount = Object.values(open).filter(Boolean).length;
  const lock = () => {
    setOpen({ Passwords: false, Work: false }); setDrafts({ Passwords: emptyDraft, Work: emptyDraft }); setIncomings({});
    revealed.current.clear();
    setGen(newGen(gen.set)); setQuery(''); setSel(undefined); setOpened(undefined); setDone(undefined); forget();
  };

  const shownItem = tab === 'search' && isOpen ? vaultItems[vault].find((i) => i.id === opened) : undefined;
  const openItem = (id: number) => { setSel(id); setOpened(id); setDone(undefined); };
  const back = () => { setSel(opened); setOpened(undefined); setDone(undefined); };
  const copyMain = (item: Item, e: KeyboardEvent) => {
    const label = e.shiftKey ? 'Username' : e.altKey ? 'Verification code' : mainField(item);
    if (fieldsOf(item).some((f) => f.label === label)) act(label);
  };

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { if (menu) setMenu(false); else if (shownItem) back(); else onClose?.(); return; }
    if (e.metaKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); return; }
    if (tab !== 'search' || !isOpen || menu) return;
    if (shownItem) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); copyMain(shownItem, e); }
      return;
    }
    const field = e.currentTarget.querySelector<HTMLInputElement>('.mbm-search input');
    // → opens the selected item once the cursor is at the end of the search.
    if (e.key === 'ArrowRight' && e.target === field && field?.selectionStart === query.length && flat[at]) {
      e.preventDefault(); openItem(flat[at].id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); field?.focus({ preventScroll: true }); setDone(undefined);
      setSel(flat[Math.max(0, Math.min(flat.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.id);
    } else if (e.key === 'Enter' && e.target === field && flat[at]) {
      e.preventDefault();
      copyMain(flat[at], e);
    }
  };
  const root = useRef<HTMLDivElement>(null);
  /** Set once the person has used the panel: loading the page takes no focus. */
  const used = useRef(false);
  /** Focuses a control when the live panel shows it, without scrolling the page. */
  const take = useCallback((el: HTMLElement | null) => { if (live && used.current) el?.focus({ preventScroll: true }); }, [live]);
  // A control that goes away must not take the keyboard with it.
  useEffect(() => { if (live && used.current && !p.hidden && document.activeElement === document.body) root.current?.focus({ preventScroll: true }); });
  // The selected item stays in view, scrolling only the list.
  useEffect(() => {
    if (!used.current) return;
    const list = root.current?.querySelector<HTMLElement>('.mbm-list');
    const item = list?.querySelector<HTMLElement>('.mrow.sel');
    if (!list || !item) return;
    if (at === 0) { list.scrollTop = 0; return; }
    const box = list.getBoundingClientRect(), r = item.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - 28;
  }, [at, query, tab]);
  // Closing keeps everything: the tab, the search, the open item, shown values, drafts and generated values. Only the vault menu,
  // the status line and a vault password half typed go. A lock or Quit clears it all.
  const wasHidden = useRef(false);
  useEffect(() => {
    if (p.hidden) { wasHidden.current = true; setPassword(''); return; }
    if (!wasHidden.current) return;
    wasHidden.current = false; used.current = true;
    setMenu(false); setDone(undefined);
    requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>('.mbm-search input') ?? root.current)?.focus({ preventScroll: true }));
  }, [p.hidden]);
  // Another app, or another page, starts from its own logins, so Return never lands on a choice made for the last one. A page
  // that answers late keeps what was typed or picked meanwhile.
  const [seen, setSeen] = useState({ front, page });
  if (seen.front !== front || (page && seen.page !== page)) {
    setSeen({ front, page });
    if (seen.front !== front || seen.page) { setQuery(''); setSel(undefined); setOpened(undefined); setDone(undefined); }
  }

  const needsVault = tab === 'search' || tab === 'new';
  const reason = reasons[vault];
  const stateOf = (name: VaultName) => (open[name] ? 'open' : reasons[name] === 'password' ? 'needs-password' : reasons[name] ?? 'locked');
  let body: ReactNode;
  if (noVault) {
    body = <div className="mbm-center"><div className="t">No vault yet</div><div className="s">Create a vault or open a vault file. Then find your logins here.</div><button className="mbtn default">New Vault…</button><button className="mbtn">Open Vault File…</button></div>;
  } else if (needsVault && reason && reason !== 'password') {
    const words = { 'not-downloaded': 'isn’t downloaded yet. Open Psss to download it.', 'not-found': 'can’t be found. Open Psss to locate it.', unreadable: 'can’t be read. Open Psss for details.' }[reason];
    body = <div className="mbm-center"><div className="t">{vault} isn’t available</div><div className="s">{vault} {words}</div><button className="mbtn default" onClick={() => p.onOpen?.('Psss')}>Open Psss</button></div>;
  } else if (needsVault && !isOpen) {
    const unlock = () => { setOpen({ ...open, [vault]: true }); setReasons({ ...reasons, [vault]: undefined }); setAway(false); setSel(undefined); forget(); };
    body = (
      <div className="mbm-center">
        <div className="t">{vault} is locked</div>
        {away && <div className="s">The lock time passed while you were away.</div>}
        {failure === 'cancelled' && <div className="mbm-note" role="status">Touch ID was cancelled.</div>}
        {reason === 'password'
          ? <div className="s">Touch ID is off for {vault}. Unlock with the vault password.</div>
          : <><button ref={take} className="mbtn default" onClick={unlock}>Unlock with Touch ID</button><div className="s">or enter the vault password</div></>}
        {failure === 'wrong' && <div className="mbm-note alert" role="alert">That didn’t open {vault}. Check Caps Lock and your keyboard language. If this vault uses a key file, choose it.</div>}
        <form className="mbm-pw" onSubmit={(e) => { e.preventDefault(); if (password === 'wrong') { setFailure('wrong'); setPassword(''); } else if (password) unlock(); }}><input type="password" aria-label="Vault password" placeholder="Vault password" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="mbtn" disabled={!password}>Unlock</button></form>
        {failure === 'wrong' && <button className="mbtn">Choose Key File…</button>}
      </div>
    );
  } else if (tab === 'generate') {
    body = <Generate gen={gen} onGen={(g) => { setGen(g); setDone(undefined); }} paste={paste} startAt={p.genAt} onPaste={pasted} onCopy={copied} onSave={(v) => start({ web: page ?? '', user: '', password: v })} />;
  } else if (tab === 'new') {
    body = incoming
      ? (
        <div className="mbm-center">
          <div className="t">You have an unsaved login</div>
          <div className="s">For {draft.name || hostOf(draft.web ?? '') || 'no website yet'} in {vault}.</div>
          <button className="mbtn default" onClick={() => setIncoming(undefined)}>Continue It</button>
          <button className="mbtn" onClick={() => { setDraft(incoming); setIncoming(undefined); }}>Replace It</button>
        </div>
      )
      : <NewLogin key={vault} vault={vault} site={page} draft={draft} onDraft={setDraft} onCopy={copied} onShow={show} readOnly={p.readOnly} failed={p.saveFailed} />;
  } else if (shownItem) {
    const other = page && siteOf(shownItem) && siteOf(shownItem) !== page ? siteOf(shownItem) : undefined;
    body = <ItemPage key={shownItem.id} item={shownItem} paste={paste} front={front} otherSite={other} revealed={revealed.current} onBack={back} onPaste={act} onShow={show} />;
  } else {
    let n = -1;
    body = (
      <>
        <label className="mbm-search"><SearchIcon /><input ref={take} value={query} placeholder={`Search ${vault}`} aria-label={`Search ${vault}`} onChange={(e) => { setQuery(e.target.value); setSel(undefined); setDone(undefined); }} /></label>
        <div className="mbm-list">
          {moved && <div className="mbm-note alert" role="alert">{front} is no longer in front. Nothing was pasted.</div>}
          {!q && p.offerPaste && !paste && <div className="mbm-ask"><div>Paste values straight into {front} instead of copying.</div><button className="mbtn" onClick={() => setPaste(true)}>Turn On Paste…</button></div>}
          {p.waiting && <div className="mbm-note s" role="status">Reading the page…</div>}
          {!q && askAccess && <div className="mbm-ask"><div><strong>Show logins for the page in {front}</strong></div><div>macOS will ask to let Psss control {front}, and will say this gives access to its data and actions. Psss reads only the front tab’s address, when this panel opens.</div><div className="mbm-row2"><button className="mbtn" onClick={() => setAccess('off')}>Not Now</button><button className="mbtn default" onClick={() => setAccess('allowed')}>Allow in {front}…</button></div></div>}
          {!q && scriptable(front) && access === 'denied' && <div className="mbm-ask"><div>Psss isn’t allowed to read the page in {front}.</div><button className="mbtn" title="Privacy &amp; Security, Automation">Open System Settings…</button></div>}
          {!q && scriptable(front) && access === 'off' && <div className="mbm-note s">Psss doesn’t read the page in {front}. Turn that on in Settings.</div>}
          {!q && offerExtension && (
            <div className="mbm-ask" role="group" aria-label={`Use Psss with ${front}`}>
              <div><strong>Use Psss with {front}</strong></div>
              <div>{extensionOnly(front) ? `The Psss extension fills sign-ins in ${front} and tells Psss the address of the open page. In the extension, ${front} will ask to allow access to browser tabs. Until then, search by name.` : `The Psss extension fills sign-ins in ${front}.`}</div>
              <div className="mbm-row2"><button className="mbtn" onClick={() => setDismissed(true)}>Not Now</button><button className="mbtn default" title={`Opens ${extensionPage(front)} in ${front}`} onClick={() => p.onSetUp?.(extensionPage(front))}>Set Up…</button></div>
            </div>
          )}
          {!q && extensionOnly(front) && p.extension && p.tabsDenied && <div className="mbm-ask"><div>{front} hasn’t let the Psss extension read tab addresses. For logins for the page, open the extension in {front} and press Allow…. Until then, search by name.</div></div>}
          {!q && extensionOnly(front) && !p.extension && dismissed && <div className="mbm-note s">Psss can’t read the page in {front} without its extension. Search by name, or set it up later in Settings.</div>}
          {!q && page && !forPage.length && <div className="mbm-ask"><div>No login for {page} in {vault}.</div><button className="mbtn" onClick={() => { if (dirty(draft) && covers(hostOf(page), hostOf(draft.web ?? ''))) go('new'); else start({ web: page, user: '', password: '' }); }}>New Login for This Site</button></div>}
          {shown.map((g) => (
            <div key={g.head}>
              <div className="mbm-head">{g.head}</div>
              {g.list.map((item) => {
                n += 1;
                return <ListRow key={item.id} item={item} mac selected={n === at} onClick={() => openItem(item.id)} traits="passkey" trailing={<>
                  {/* The code is its own button; the rest of the row opens the item. */}
                  {item.code && <span onClickCapture={() => copied('Verification code')}><CodePill code={item.code} /></span>}
                  <Chevron />
                </>} />;
              })}
            </div>
          ))}
          {!flat.length && !!q && (
            <div className="mbm-center">
              <span className="mbm-glyph" aria-hidden><SearchIcon /></span>
              <div className="t">No Results</div>
              <div className="s">Nothing in {vault} matches “{query}”.</div>
              {(['Passwords', 'Work'] as VaultName[]).filter((v) => v !== vault && open[v]).map((v) => {
                const n = vaultItems[v].filter((i) => `${i.name} ${i.account} ${siteOf(i) ?? ''}`.toLowerCase().includes(q)).length;
                return n ? <button key={v} className="mbtn default" onClick={() => switchVault(v, query)}>Show {n} in {v}</button> : null;
              })}
              <button className="mbtn" onClick={() => start({ ...emptyDraft, web: page })}>New Login…</button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div ref={root} hidden={p.hidden} className={`mbm-panel${centered ? ' center' : ''}`} role="dialog" aria-label="Psss" tabIndex={-1}
      onKeyDownCapture={() => { used.current = true; }} onPointerDownCapture={() => { used.current = true; }} onKeyDown={keys}
      onClick={(e) => {
        used.current = true;
        const t = e.target as Element;
        if (menu && t.isConnected && !t.closest('.mbm-pop')) setMenu(false);
      }}
      >
      <CopyHost onNotify={report}>
        {!noVault && (
          <div className="mbm-top">
            <div className="mbm-vault">
              <span>Vault</span>
              <span className="mbm-pop">
                <button className="mbtn popup" aria-haspopup="menu" aria-expanded={menu} aria-label={`Vault: ${vault}. Switch vault`} onClick={() => setMenu(!menu)}>{vault}<PopChevrons /></button>
                {menu && <VaultMenu picker current={vault} vaults={[passwordsVault, workVault]} states={{ Passwords: stateOf('Passwords'), Work: stateOf('Work') }} onChoose={(name) => switchVault(name as VaultName)} />}
              </span>
            </div>
            <div className="switch mbm-tabs" role="tablist">{tabs.map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => go(v)}>{l}</button>)}</div>
          </div>
        )}
        <div className="mbm-main">{body}</div>
        {done && <div className="mbm-status s" role="status">{done}</div>}
        <div className="mbm-foot">
          <button className="mbtn" onClick={() => p.onOpen?.('Psss')}>Open Psss</button>
          <button className="mbtn" onClick={() => p.onOpen?.('Psss Settings')}>Settings…</button>
          <span className="grow" />
          {openCount > 0 && !noVault && <button className="mbtn" title="⌘L" onClick={lock}>{openCount > 1 ? 'Lock All' : 'Lock'}</button>}
          <button className="mbtn" onClick={p.onQuit ?? onClose}>Quit</button>
        </div>
      </CopyHost>
    </div>
  );
}

/* ---------- the clickable prototype ---------- */

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mbm-ctl"><span>{label}</span><div className="switch" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div></div>
  );
}

function Prototype() {
  const [front, setFront] = useState<Front>('Safari');
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState(0);
  const [gone, setGone] = useState(false);
  const [url, setUrl] = useState<string>();
  const [win, setWin] = useState<string>();
  return (
    <>
      <div className="mbm-ctls">
        <Pick label="App in front" value={front} onChange={(v) => { setFront(v); setUrl(undefined); setWin(undefined); setOpen(!gone); }} options={[['Safari', 'Safari'], ['Chrome', 'Chrome'], ['Firefox', 'Firefox'], ['Zen', 'Zen'], ['Slack', 'Slack'], ['Terminal', 'Terminal']]} />
        {gone && <button className="mbtn" onClick={() => { setGone(false); setOpen(true); }}>Start Psss again (mock)</button>}
      </div>
      <Desk app={front} open={open} gone={gone} onMark={() => setOpen(!open)} onAway={() => setOpen(false)} front={win ? <div className="mbm-app"><strong>{win}</strong></div> : <FrontApp app={front} site="gitforge.example" url={url} />}>
        <Panel key={run} locked={run > 0} live hidden={!open} front={front} access={front === 'Chrome' ? 'ask' : 'allowed'} site={url ? 'psss.app' : 'gitforge.example'} onSetUp={(u) => { setUrl(u); setWin(undefined); setOpen(false); }} onOpen={(w) => { setWin(w); setOpen(false); }} onClose={() => setOpen(false)} onQuit={() => { setOpen(false); setGone(true); setUrl(undefined); setWin(undefined); setRun(run + 1); }} />
      </Desk>
    </>
  );
}

const Still = (p: PanelProps) => {
  const front = p.front ?? 'Safari';
  return <Desk app={front} open front={<FrontApp app={front} site={p.site ?? 'gitforge.example'} />}><Panel {...p} /></Desk>;
};

export function MacMenuBar() {
  return (
    <Page title="Mac menu bar: quick search" status={<><strong>Approved by the owner, 2026-11-26: phase 1 copies and shows logins for the browser page. Not shipped; a debug prototype exists.</strong> Search as a list and item page was approved the same day. Companion page: <a href="#/mac-background">background running, Dock and login</a>.</>}>
      <Clarity items={[
        ['Which thing?', 'A Psss panel under a menu bar item, also opened from any app with ⌃⌘P. The vault it works in is named at the top and can be changed there.'],
        ['What must they give?', 'Touch ID or the vault password when locked. For the page in Safari or Chrome, one macOS permission per browser. In Firefox and Zen, the Psss extension. Both are optional.'],
        ['What can go wrong?', 'Locked, no vault, nothing found and page access refused: each says so. Without the page, search by name still works.'],
        ['How do they leave?', 'Escape or a click elsewhere closes it and keeps what was on it, shown passwords included. Lock clears it; Quit ends Psss.'],
        ['What happens next?', 'The copy icon puts that value on the clipboard for 60 seconds, and a line says so. The person pastes it where they want it.'],
      ]} />

      <Section title="Try it">
        <p>Switch vaults and tabs, open items, type, use ↑ ↓, Return and Escape. Click the ring in the menu bar to open and close. The switch above the screen is the mock’s, not the app’s.</p>
      </Section>
      <Prototype />

      <Section title="Drawn with the system’s parts">
        <p>The panel is the system’s glass window with no outline of its own. It uses the system search field, the app’s list rows with sections and the system selection, the item page as a grouped form behind a Back button, grouped forms for Generate and New Login, the system empty states, and quiet text buttons at the bottom.</p>
      </Section>

      <Section title="Search (the first tab)">
        <p>The rows are the app’s own list rows. A login with a verification code shows it live in its row, and clicking the code copies it. The first one is selected, so Return copies its password at once. A click, or →, opens that item’s page in the panel, as on iPhone; Back, Esc, ← or a swipe to the right returns. In a browser the logins for the page come first.</p>
      </Section>
      <Frames>
        <Frame label="A browser, page known" caption="Logins for the page come first, the first one selected."><Still /></Frame>
        <Frame label="A login’s page" caption="A row or its copy icon copies the value; the website opens in the browser."><Still detail={201} front="Slack" /></Frame>
        <Frame label="A card’s page" caption="Cards use the same rows."><Still detail={6} front="Slack" /></Frame>
        <Frame label="An app in front" caption="A login with the app’s name as a word comes first, under a heading that says why."><Still front="Slack" /></Frame>
        <Frame label="Searching without a page" caption="Logins first, then cards."><Still front="Slack" query="north" /></Frame>
        <Frame label="A card" caption="Brand under the name, last four digits and expiry at the end, as in the app."><Still front="Slack" query="everyday" /></Frame>
        <Frame label="A note" caption="Every item type is found, with every value of its page."><Still front="Slack" query="wi-fi" /></Frame>
        <Frame label="Nothing found" caption="Offers a new login."><Still query="zzz" /></Frame>
        <Frame label="Found in another open vault" caption="One button shows that vault’s results."><Still front="Slack" bothOpen query="north" vault="Work" /></Frame>
        <Frame label="Reading the page" caption="Until the browser answers, nothing is selected. When the answer comes, a choice already made stays."><Still waiting /></Frame>
      </Frames>

      <Section title="The vault switcher">
        <p>Always at the top, also while locked and with one vault. Choosing a vault locks nothing.</p>
      </Section>
      <Frames>
        <Frame label="Menu open"><Still menu /></Frame>
        <Frame label="Another vault"><Still vault="Work" /></Frame>
        <Frame label="Locked" caption="The switcher and tabs stay. Generate works without unlocking, because it shows nothing from a vault."><Still locked /></Frame>
        <Frame label="No vault yet" caption="There is no vault to switch, so the two ways to get one."><Still noVault /></Frame>
      </Frames>

      <Section title="Locked, and vaults that can’t be used">
        <p>Opening the panel first runs the same away-time check as returning to the app, so a vault whose lock time has passed is locked before anything is drawn. Touch ID is asked only when Unlock is pressed.</p>
      </Section>
      <Frames>
        <Frame label="Away longer than the lock time"><Still away /></Frame>
        <Frame label="Touch ID cancelled"><Still problem="cancelled" /></Frame>
        <Frame label="Wrong password" caption="In the mock, the password “wrong” shows this."><Still problem="wrong" /></Frame>
        <Frame label="Password needed"><Still problem="password" /></Frame>
        <Frame label="Not downloaded"><Still problem="not-downloaded" /></Frame>
        <Frame label="Not found"><Still problem="not-found" /></Frame>
        <Frame label="Can’t be read"><Still problem="unreadable" /></Frame>
      </Frames>

      <Section title="Generate">
        <p>Every kind is on the page with its own value and controls, with no menu to choose a type. The tab scrolls.</p>
      </Section>
      <Frames>
        <Frame label="Top" caption="The three password kinds the app already makes. Counts are sliders with the number beside them."><Still tab="generate" /></Frame>
        <Frame label="Weaker than recommended" caption="The app’s ranges and warning. The time shown is a sample."><Still tab="generate" weak genAt="random" /></Frame>
        <Frame label="Scrolled to the end" caption="New: PIN and Key. A key is random bytes in hexadecimal or Base64."><Still tab="generate" genAt="pin" /></Frame>
      </Frames>

      <Section title="New Login">
        <p>A password and either a name or a website are needed. The website is compared by site, so a typed address with a path finds the login already saved. Each vault keeps its own unsaved login.</p>
      </Section>
      <Frames>
        <Frame label="Empty" caption="The line under the fields says which vault receives it."><Still tab="new" /></Frame>
        <Frame label="Same site and username" caption="Update replaces the password; Save as New keeps both."><Still tab="new" draft={{ web: 'https://gitforge.example/login', user: 'sam.r', password: 'new-orchid-42' }} /></Frame>
        <Frame label="Already saved"><Still tab="new" draft={{ web: 'gitforge.example', user: 'sam.r', password: 'harbor-Il1-lantern-O0-quiet-7' }} /></Frame>
        <Frame label="Read-only vault"><Still tab="new" readOnly draft={{ web: 'harborshop.example', user: 'sam', password: 'new-orchid-42' }} /></Frame>
        <Frame label="Save failed" caption="What was typed stays."><Still tab="new" saveFailed draft={{ web: 'harborshop.example', user: 'sam', password: 'new-orchid-42' }} /></Frame>
        <Frame label="An unsaved login in the way" caption="Save as Login and New Login for This Site ask before replacing it."><Still tab="new" draft={{ web: 'gitforge.example', user: 'sam', password: 'new-orchid-42' }} incoming={{ web: 'harborshop.example', user: '', password: '' }} /></Frame>
        <Frame label="Saved" caption="The new password can be copied at once."><Still tab="new" saved /></Frame>
      </Frames>

      <Section title="Keyboard and VoiceOver" />
      <div className="prose">
        <table className="cmp">
          <thead><tr><th>Keys</th><th>What happens</th></tr></thead>
          <tbody>
            <tr><td>⌃⌘P</td><td>Opens or closes the panel, on the screen that has the keyboard</td></tr>
            <tr><td>↑ ↓</td><td>Select an item; VoiceOver says its name and account</td></tr>
            <tr><td>→ or click</td><td>Open the item’s page</td></tr>
            <tr><td>Return, ⇧Return, ⌥Return</td><td>Copy the password (or card number), the username, the code</td></tr>
            <tr><td>⌘1, ⌘2, ⌘3</td><td>Search, Generate, New Login (not in the mock: the browser takes these keys)</td></tr>
            <tr><td>⌘L</td><td>Lock</td></tr>
            <tr><td>Escape</td><td>Close the vault menu, else leave the item’s page, else close the panel</td></tr>
            <tr><td>←, or swipe right</td><td>Leave the item’s page. The swipe is two fingers on a trackpad, following the Mac’s “Swipe between pages” setting</td></tr>
          </tbody>
        </table>
        <p>Tabs and the vault switcher are the system’s segmented control and pop-up button, with their own keyboard and VoiceOver behaviour. The panel does not rely on Tab reaching every button.</p>
      </div>

      <Section title="The page in the browser">
        <p>Safari and Chrome answer macOS when Psss asks for the front tab’s address. Firefox and Zen have no such question to answer, so only the Psss extension can tell. Psss asks when the panel opens, uses the site name to order the list and stores nothing.</p>
      </Section>
      <Frames>
        <Frame label="Not asked yet" caption="Psss says what macOS will ask before it asks, including that macOS words it more broadly than what Psss does."><Still access="ask" /></Frame>
        <Frame label="Refused"><Still access="denied" /></Frame>
        <Frame label="A login for another site" caption="Its page says so above its values."><Still detail={201} /></Frame>
        <Frame label="Nothing saved for the page" caption="Nothing is selected, so Return copies nothing until an item is chosen."><Still site="harborshop.example" /></Frame>
      </Frames>

      <Section title="Suggesting the extension">
        <p>One card for a browser whose Psss extension has not talked to the app, until it does or Not Now is pressed. It ships for a browser only once psss.app/#browser-name has something to install. Set Up opens psss.app/#browser-name in that browser. Safari has no card: its extension is inside the app.</p>
      </Section>
      <Frames>
        <Frame label="Zen, no extension" caption="Opens psss.app/#zen."><Still front="Zen" /></Frame>
        <Frame label="Chrome, page allowed" caption="Opens psss.app/#chrome. The page is already known; the extension adds filling."><Still front="Chrome" /></Frame>
        <Frame label="After Not Now" caption="A line says why there are no logins for the page."><Still front="Zen" dismissed /></Frame>
        <Frame label="Extension connected" caption="The same list as in Safari."><Still front="Zen" extension /></Frame>
        <Frame label="Connected, tab addresses not allowed" caption="The browser asks only from inside the extension, so the panel says where to press."><Still front="Zen" extension tabsDenied /></Frame>
      </Frames>
      <div className="prose">
        <table className="cmp">
          <thead><tr><th>Browser</th><th>How Psss gets the page</th><th>What it takes</th><th>Not yet proven</th></tr></thead>
          <tbody>
            <tr><td>Safari, Chrome and other Chromium browsers</td><td>Apple Events: the address of the front tab</td><td>macOS asks once per browser; a sandbox exception that names each browser</td><td>On a signed build, and App Review accepting the exception</td></tr>
            <tr><td>Firefox, Zen</td><td>The Psss extension, asked by the app</td><td>The extension installed, a connection it keeps open and the browser’s permission to read tab addresses</td><td>All of it; the extension today sees a page only when you open it</td></tr>
          </tbody>
        </table>
        <p>Apple Passwords uses the same first route with a list of about sixty browsers. Its own signature also skips the macOS question, which no other app can.</p>
      </div>

      <Section title="The shortcut" />
      <Frames>
        <Frame label="Opened with ⌃⌘P" caption="The same panel in the middle of the screen. The app you were in stays in front.">
          <Desk app="Terminal" front={<FrontApp app="Terminal" site="" />}><Panel front="Terminal" centered /></Desk>
        </Frame>
      </Frames>

      <Section title="Later: Paste">
        <p><strong>Not in phase 1 (owner, 2026-11-26).</strong> It needs the Accessibility permission, App Review may refuse it, and it has not been run on a signed build. Drawn here so the later step can be agreed.</p>
      </Section>
      <Frames>
        <Frame label="Paste offered" caption="A line above the list offers to turn Paste on."><Still front="Terminal" offerPaste /></Frame>
        <Frame label="Paste on" caption="Paste sits beside the copy icon on every value that can be entered."><Still paste front="Terminal" detail={202} /></Frame>
        <Frame label="The front app changed" caption="Opened over Terminal; Slack came to the front before the paste. Psss checks again just before pasting.">
          <Desk app="Slack" open front={<FrontApp app="Slack" site="" />}><Panel front="Terminal" paste moved /></Desk>
        </Frame>
      </Frames>
      <div className="prose">
        <p>Paste would type the chosen value into the field that has the cursor: the clipboard untouched, Return never pressed, and no knowledge of which field it is. A developer reports App Review rejecting a clipboard manager that pasted this way.</p>
      </div>

      <Section title="Can it fill any website and any field?" />
      <div className="prose">
        <table className="cmp">
          <thead><tr><th>Where</th><th>Password and code</th><th>Card, address, other fields</th></tr></thead>
          <tbody>
            <tr><td>Safari</td><td>System AutoFill, or copy from the panel</td><td>Psss Safari extension, or copy from the panel</td></tr>
            <tr><td>Mac apps</td><td>System AutoFill where the app marks its fields, or copy from the panel</td><td>Copy from the panel</td></tr>
            <tr><td>Chrome, Firefox and others</td><td>Psss extension (prototype), or copy from the panel</td><td>Copy from the panel</td></tr>
            <tr><td>Terminal and unmarked fields</td><td>Copy from the panel</td><td>Copy from the panel</td></tr>
          </tbody>
        </table>
      </div>

      <Section title="How other apps do it">
        <p>From each vendor’s own pages and search results on 2026-11-26. The apps were not run; only Apple Passwords was seen, in the owner’s screenshots. “Not confirmed” means no page read said so.</p>
      </Section>
      <div className="prose">
        <table className="cmp">
          <thead><tr><th>App</th><th>Menu bar</th><th>Shortcut</th><th>Knows what is in front</th><th>Fills by</th></tr></thead>
          <tbody>
            <tr><td><a href="https://support.apple.com/guide/passwords/menu-bar-mchldd5eb88d/mac">Apple Passwords</a></td><td>Opt-in: search, add, open app</td><td>Not confirmed</td><td>The browser page (inferred)</td><td>Not confirmed</td></tr>
            <tr><td><a href="https://support.1password.com/quick-access/">1Password</a></td><td>Quick Access: search, suggestions, frequent</td><td>⌥⌘\; ⌘\ fills</td><td>Open apps</td><td>Accessibility</td></tr>
            <tr><td><a href="https://bitwarden.com/help/app-settings/">Bitwarden</a></td><td>Icon when the window is closed</td><td>Not confirmed</td><td>Not confirmed</td><td>Not confirmed</td></tr>
            <tr><td>Strongbox</td><td>Quick Search</td><td>Not confirmed</td><td>Not confirmed</td><td>Not confirmed</td></tr>
            <tr><td>KeePassXC</td><td>Tray icon</td><td>Auto-type shortcut</td><td>Window titles</td><td>Typing; Accessibility and Screen Recording</td></tr>
          </tbody>
        </table>
      </div>

      <Against>
        <li>Apple’s menu bar guidance says to show a menu, not a popover, unless the function is too complex for a menu. Tabs, search and item values are, so this is a panel.</li>
        <li>The guidance says people decide whether the item exists and the app must not depend on it. So it is asked for, can be turned off, and everything is also in the main window.</li>
      </Against>

      <Section title="Decisions" />
      <Decisions items={[
        { decision: 'Opening the panel checks the lock time first. With “Immediately”, it asks to unlock after any time in another app.', rejected: 'Opening the panel not counting at all, which would show an unlocked vault past its lock time.' },
        { decision: 'Each vault has its own unsaved login, and replacing one is asked first.', rejected: 'One draft that follows the vault switcher; replacing silently.' },
        { decision: 'Every copy is reported in one line above the footer, with when the clipboard clears.', rejected: 'The floating pill, which covers list rows in a panel this small.' },
        { decision: 'The app must keep that promise: clear on Quit if the clipboard still holds the copy, and keep the copy on this Mac.', why: 'Today’s Mac code does neither.' },
        { decision: 'The panel shows one vault, chosen at the top; the choice is the app’s shown vault too.', rejected: 'Searching every open vault.' },
        { decision: 'Closing the panel keeps the tab, search, open item, shown values, drafts and generated values until a lock or Quit. A different app or page starts its search and selection afresh.', rejected: 'Starting on Search with everything hidden on every opening.' },
        { decision: 'Three tabs: Search, Generate, New Login. Search is first the first time. Settings… is a button at the bottom that opens the Settings window.', rejected: 'A Settings tab repeating some switches; one list with footer buttons for every action.' },
        { decision: 'The vault switcher is always shown.', rejected: 'Only with two or more vaults, as in the AutoFill picker.' },
        { decision: 'Rows are the app’s list rows. A click or → opens the item’s page in the panel, with Back, Esc, ← or a swipe to the right to return; hidden values stay hidden until the eye. Return copies from the list without opening it.', rejected: 'Values opening under the row, which did not look like they belonged to it; a row of action buttons without the values.' },
        { decision: 'Generate shows every kind at once as grouped form sections, with sliders for counts, switches, a pop-up for the separator and a segmented control for the key format.', rejected: 'A Type menu that shows one kind at a time.' },
        { decision: 'Phase 1 copies and shows logins for the page. Paste comes later.' },
        { decision: 'The page comes from Apple Events in Safari and Chromium browsers, and from the Psss extension in Firefox and Zen.', rejected: 'Reading window titles or the screen; an extension for every browser.' },
        { decision: 'A browser without the extension gets one card that opens psss.app/#browser-name. Not Now ends it for that browser.' },
        { decision: 'An app is matched to a login by a whole word of its name, a browser never.', rejected: 'The start of the name, which would offer Zendesk for Zen; a record of which apps each login was copied into.' },
        { decision: 'Later, the word is Paste. On a value’s row the button reads just “Paste”, beside the copy icon.', rejected: 'Type.', why: 'It is the word people know, although no clipboard is used.' },
        { decision: 'Later, Paste enters one value and never presses Return.', rejected: 'Username, Tab, password, Return sequences: the wrong field would receive and submit a password.' },
        { decision: 'A page is named only when the browser reports it.', rejected: 'Guessing from window titles, which any page can set.' },
        { decision: 'Mac only. iPhone and iPad keep AutoFill.' },
      ]} />

      <History entries={[
        { date: '2026-11-26', text: 'Owner: the item page starts with one line holding Back, a small icon and the name (replacing Back on its own line above a large icon and centred name), to save height.' },
        { date: '2026-11-26', text: 'Owner: a login with a verification code shows the code in its list row with a button that copies it (replacing a code glyph, with the code only on the item’s page). Removed “Nothing here is saved until you save it.” from Generate as redundant.' },
        { date: '2026-11-26', text: 'Owner approved the list and item page and asked for swiping back: a two-finger swipe to the right returns to the list. The prototype app now works this way.' },
        { date: '2026-11-26', text: 'Proposed after the owner asked for the iPhone way: the app’s list rows, and a row opens the item’s page with Back (replacing the open card inside the list, and showing the first item’s values on opening).' },
        { date: '2026-11-26', text: 'Owner: the values did not look like they belonged to the row above. The open item is now one card holding its row, values and Show in Psss (replacing a highlighted row with a separate box under it).' },
        { date: '2026-11-26', text: 'Owner: the first native prototype did not look like a Mac app, so the panel is restyled with the system’s parts: glass window without an outline (replacing an outlined panel on a flat fill), system search field, list with sections (replacing hand-built blocks with disclosure chevrons), grouped forms for Generate and New Login, switches (replacing checkboxes), a separator pop-up (replacing four segments), Save as New before the default Update button, system empty states with “No Results”, and borderless footer buttons.' },
        { date: '2026-11-26', text: 'Owner approved the page as drawn, with the choices made while settling the review findings. Paste stays a later step.' },
        { date: '2026-11-26', text: 'Second check: a picked item stays picked when the page answers late; a waiting login stays with its vault; a half-typed vault password is cleared on closing or switching; unavailable and password-only vaults keep that state; a state and frame for an extension without tab access; a lock keeps generator settings (replacing a reset to defaults); Symbol for Words; shown values survive tab changes; a saved site also matches its subdomains; Try Again saves; Quit removes the menu bar item.' },
        { date: '2026-11-26', text: 'Review findings settled: New Login gained Name, an eye, update, already-saved, read-only and failed states and Copy Password after saving (replacing exact-text matching and a password you could not get back); drafts are per vault and replacing one asks; all item values and types; the app’s generator ranges and warning; one copy line instead of the pill; lock on opening; Lock or Lock All (replacing Lock <vault>); locked and unavailable vault states; waiting for the page; keyboard table; Firefox and the two windows in the prototype.' },
        { date: '2026-11-26', text: 'The Firefox and Zen extension card uses the browser’s own words, “access to browser tabs”, and says the question comes from the extension (replacing “will ask you to allow that”), after the prompt was seen on a test add-on in Zen.' },
        { date: '2026-11-26', text: 'The page access card now warns that macOS describes the permission as access to the browser’s data and actions (replacing “will ask to let Psss control” alone), after the real prompt was seen on a test build.' },
        { date: '2026-11-26', text: 'After validation: the page access card has Not Now, with a line saying Settings turns it on later; New Login keeps its website once a username or password is typed.' },
        { date: '2026-11-26', text: 'Owner: shown passwords and the open item persist between openings (replacing a fresh Search tab each time). The whole panel state is kept until a lock or Quit; another app or page resets only the search and selection.' },
        { date: '2026-11-26', text: 'Owner: logins for the page are in phase 1, with a card suggesting the Psss extension that opens psss.app/#browser-name (replacing “Later” frames and a “can’t read the page” note). The Settings tab is gone; Settings… at the bottom opens the Settings window. The mock’s “Used in Terminal before” heading was removed because Psss keeps no such record, and app names now match on whole words.' },
        { date: '2026-11-26', text: 'Owner: phase 1 is copy only. Paste and logins for the page moved to the “Later” section, and the prototype lost its page, page access and Paste switches. Phase 1 search starts from the app in front, and its value rows have the copy icon alone.' },
        { date: '2026-11-26', text: 'Owner: removed the “Return: Paste Password. Esc closes.” line. The keys work as before; a line appears above the footer only to report what was just copied or pasted.' },
        { date: '2026-11-26', text: 'Owner: on each value’s row Paste moved to the trailing end beside the copy icon and lost the field name, which the row already gives (replacing a button under the value, “Paste Username”). With Paste off the row has the copy icon only (replacing a “Copy …” button).' },
        { date: '2026-11-26', text: 'Owner: each generator’s Copy, Paste and New moved onto its heading line, at the trailing end (replacing a row under its controls). Save as Login… stays under the block.' },
        { date: '2026-11-26', text: 'Owner: Generate shows all kinds inline with their controls and sliders for the character and byte counts, replacing the Type menu and the minus and plus buttons.' },
        { date: '2026-11-26', text: 'Owner approved phase 1 and asked for changes: the vault switcher at all times (the locked screen had none); tabs for search, generating, adding a login and settings (replacing one list with footer buttons and a separate new-password view); the selected item opened with every value and its own button (replacing a row of buttons under the item, with passwords never shown); search starting from the page in front; and “Paste” in place of “Type”. The mock’s three phase switches are gone: page matching and Paste are drawn as parts of the panel, each behind its permission.' },
        { date: '2026-11-26', text: 'First proposal: quick search panel in three phases (copy, knowing the page, typing), after the owner asked for a menu bar item and any-field fill.' },
      ]} />
    </Page>
  );
}
