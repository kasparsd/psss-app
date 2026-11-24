import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { VaultMenu, VaultStateMark, everyState, type VaultState } from '../components/VaultMenu';
import { VaultNotice, VaultRow } from '../components/VaultRow';

/* ---------- pieces ---------- */

const R = ({ cells }: { cells: ReactNode[] }) => <tr>{cells.map((c, i) => <td key={i}>{c}</td>)}</tr>;
const Glyph = ({ s, children }: { s: VaultState; children: ReactNode }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><VaultStateMark state={s} inline />{children}</span>;

/** A slice of a screen: the Vault row and what sits under it, on the surface's own background. No device frame: only the row matters. */
const Slice = ({ bg = 'var(--screen)', width, children }: { bg?: string; width?: number; children: ReactNode }) => (
  <div style={{ background: bg, maxWidth: width, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
);

/** The browser popup's header in compact form: Psss and the site on the left, name ⌃⌄ and Unlock on the right. */
function PopupHeader({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 12, boxShadow: 'var(--shadow)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ flex: '1 1 auto' }}><div className="t">Psss</div><div className="s">gitforge.example</div></div>
        {children}
      </div>
      {below}
    </div>
  );
}

const Logins = () => (
  <div className="xp-card">
    <div className="xp-row"><div className="grow"><div className="trunc">Gitforge</div><div className="s trunc">sam.r</div></div></div>
    <div className="xp-row last"><div className="grow"><div className="trunc">Gitforge (work)</div><div className="s trunc">sam@work.example</div></div></div>
  </div>
);

/* ---------- the page ---------- */

export function VaultStates() {
  return (
    <Page
      title="Vault states: one picture everywhere"
      status={<><strong>Proposal, 2026-11-24: not built; the lead decided the open questions.</strong> Redrawn from the plan after the owner’s review (“all over the place”). One list of states, one vault menu, one Vault row, one table of every surface against every state.</>}
    >
      <Clarity
        intro={<p>A vault is the same thing wherever it is shown: the app, the lock screen, AutoFill and the browser. The words and the glyph for each state are drawn once and every page uses them.</p>}
        items={[
          ['Which thing?', 'One vault: its name (“Passwords”), where its file is kept (iCloud Drive, Work.kdbx) and whether it can be used right now.'],
          ['What must they give?', 'Nothing to look at the state. To open a locked vault: Face ID or Touch ID when it is ready, otherwise the vault password (and a key file if the vault uses one).'],
          ['What can go wrong?', 'The file is not downloaded yet, was moved or deleted, or is damaged. The row says which in two or three words (“Not downloaded yet”, “Not found”, “Can’t be read”) and a notice says what Psss will do.'],
          ['How do they leave?', 'Choose another vault from the same menu. A vault that is no longer wanted is forgotten on its page in Settings; the file stays.'],
          ['Where does it live, who holds the key?', 'The vault file stays where the person put it. The vault password is held by the person only; a saved key behind Face ID or Touch ID is optional and lives on this device. Nothing is uploaded by this screen.'],
          ['What happens next?', 'Unlock opens the vault. In AutoFill and the browser it opens it in place where it can, and otherwise says to open Psss. Not available vaults are solved in Psss only.'],
        ]}
      />

      <Section title="1. The facts, and the five states a person sees">
        <p>What the code already knows about one vault, from <code>VaultReference</code>, <code>UnlockGate</code>, <code>BiometricKey</code> and <code>NotReadyReason</code>.</p>
      </Section>
      <table className="cmp">
        <thead><tr><th>Fact</th><th>Values</th></tr></thead>
        <tbody>
          <R cells={['File', 'available · not downloaded yet (iCloud) · not found (moved, deleted, bookmark stale) · can’t be read (damaged, not a vault) · changed elsewhere while open']} />
          <R cells={['Lock', 'locked · unlocked (only the current vault, only in the process that opened it)']} />
          <R cells={['Quick unlock (saved key)', 'ready (Face ID, Touch ID, passcode) · off (setting) · lost (biometry changed, reinstall) · unavailable now (lockout, no passcode)']} />
          <R cells={['Needs', 'vault password · vault password and key file']} />
          <R cells={['Role', 'current vault (one per device) · other known vault · sample vault (app only, never AutoFill)']} />
        </tbody>
      </table>
      <table className="cmp">
        <thead><tr><th>State</th><th>Glyph</th><th>Subtitle</th><th>It means</th><th>The way forward</th></tr></thead>
        <tbody>
          <R cells={[<strong key="s">Unlocked</strong>, <Glyph s="open">open padlock</Glyph>, 'Where it is kept (iCloud Drive)', 'Unlocked.', 'Lock it: Lock Passwords, Lock Now, ⌘L.']} />
          <R cells={[<strong key="s">Locked</strong>, <Glyph s="locked">closed padlock</Glyph>, 'Where it is kept (Work.kdbx)', 'Locked, and quick unlock is ready.', 'Face ID or Touch ID opens it; the vault password always works.']} />
          <R cells={[<strong key="s">Needs password</strong>, <Glyph s="needs-password">closed padlock</Glyph>, '“Needs vault password”', 'Locked, and quick unlock is off, lost or unavailable now.', 'The vault password. In the app that is the lock screen’s field; in AutoFill and the browser, the Unlock button.']} />
          <R cells={[<strong key="s">Not available</strong>, <Glyph s="not-found">warning</Glyph>, '“Not downloaded yet”, “Not found” or “Can’t be read”', 'The file cannot be opened at all.', 'Download, Locate… or details, all in Psss. Never solved in AutoFill or the popup.']} />
          <R cells={[<strong key="s">Changed elsewhere</strong>, 'none', 'none', 'The file changed on another device while open.', 'The app locks with a notice and reads the new file on unlock (built). In AutoFill it is read fresh anyway: no separate state.']} />
        </tbody>
      </table>
      <div className="prose"><p>Besides these, the app has two states of its own: no vault (the welcome screen) and the sample vault, which is never offered in AutoFill (“The sample vault is not available for AutoFill”).</p></div>

      <Section title="2. One vault menu, every state">
        <p>Every menu has the same rows: a check on the current vault, its name, under it where it is kept (or the state’s words), the glyph at the trailing end. Add Vault… is last, in the app and on the lock screen only. One menu is drawn here with a vault in every state; the real menu shows only the vaults a person has. Every page draws its menu from the same row data in <code>VaultMenu.tsx</code>.</p>
      </Section>
      <Frames>
        <Frame phone label="A · The app’s dropdown" caption="Header naming the open vault, Lock Passwords, then one row per vault: Passwords open, Work locked, Family locked and needs its vault password, Travel, Archive and Taxes with the warning glyph and the reason."><VaultMenu inline vaults={everyState} /></Frame>
        <Frame phone label="B · The lock screen’s menu" caption="Same rows behind the Vault row. Header says “Vault”, no Lock item (nothing is open), so every working vault is locked. Passwords is the one that will open."><VaultMenu inline locked vaults={everyState.map((v) => (v.state === 'open' ? { ...v, state: 'locked' as const } : v))} /></Frame>
        <Frame phone label="C · AutoFill and the browser" caption="The real picker variant: header “Vault”, no Lock, no Add Vault… (adding a vault is done in the app). Passwords, the current vault, is unlocked here, so it shows the open padlock; the others are closed or warning. Choosing a vault makes it current on this device."><VaultMenu inline picker vaults={everyState} /></Frame>
      </Frames>

      <Section title="3. The Vault row, in each state">
        <p>The Vault row (<strong>Vault</strong> and the name with ⌃⌄) is the picker on the lock screen, on every AutoFill screen and, compact, in the browser popup. It is shown with two or more vaults. When the current vault is locked in AutoFill or the browser, a labeled <strong>Unlock</strong> button sits at the trailing end of the row and one notice below says why. When the vault is not available there is no Unlock: the notice says what Psss will do and the row stays, so another vault is one tap away. The lock screen itself is the unlock, so there the row is the picker alone.</p>
      </Section>
      <Frames>
        <Frame phone label="D · iPhone, unlocked" caption="The row alone. The list below it is the logins for the page."><Slice><VaultRow state="unlocked" variant="phone" /></Slice></Frame>
        <Frame phone label="E · iPhone, locked (Face ID cancelled)" caption="Unlock at the row’s end, one notice below. Unlock asks Face ID again."><Slice><VaultRow state="locked" variant="phone" /><VaultNotice kind="cancelled" /></Slice></Frame>
        <Frame phone label="F · iPhone, needs vault password" caption="The same row. Unlock shows the app’s lock screen inside the sheet, for that vault: the vault password, a key file only when the vault uses one."><Slice><VaultRow name="Work" state="locked" variant="phone" /><VaultNotice kind="needs-password" name="Work" /></Slice></Frame>
        <Frame phone label="G · iPhone, not available" caption="No Unlock. The notice names the state and the way out, which is in Psss. The row stays."><Slice><VaultRow name="Archive" state="unavailable" variant="phone" /><VaultNotice kind="not-found" name="Archive" /></Slice></Frame>
        <Frame phone label="H · iPhone, one vault, locked" caption="With one vault there is no Vault row, so the notice carries Unlock."><Slice><VaultNotice kind="needs-password" unlock /></Slice></Frame>
      </Frames>
      <Frames>
        <Frame label="I · iPad sheet, unlocked" caption="The grey iOS pop-up row, as on iPhone: “Vault” on the left, the name with ⌃⌄ in the accent colour. Only the Mac uses the bordered button."><Slice bg="var(--win)" width={380}><VaultRow state="unlocked" variant="phone" /></Slice></Frame>
        <Frame label="J · Mac sheet, locked" caption="The Mac’s own form: “Vault:” with a bordered pop-up button, and Unlock right beside it. The iPad keeps the grey row of frame I, with Unlock at its end. Touch ID, not Face ID."><Slice bg="var(--win)" width={380}><VaultRow name="Work" state="locked" variant="mac" /><VaultNotice kind="needs-password" name="Work" bio="Touch ID" /></Slice></Frame>
        <Frame label="K · Mac sheet, not available" caption="No Unlock; the orange warning glyph sits in the row too. “Travel” is in iCloud but not on this device yet."><Slice bg="var(--win)" width={380}><VaultRow name="Travel" state="unavailable" variant="mac" /><VaultNotice kind="not-downloaded" name="Travel" /></Slice></Frame>
      </Frames>
      <Frames>
        <Frame phone label="L · Popup header, unlocked" caption="Compact: no label, the name with ⌃⌄ as a bordered button, beside Psss and the site."><PopupHeader below={<Logins />}><VaultRow state="unlocked" variant="compact" /></PopupHeader></Frame>
        <Frame phone label="M · Popup header, locked" caption="Unlock beside the name. One notice, no list."><PopupHeader below={<VaultNotice kind="needs-password" bio="Touch ID" />}><VaultRow state="locked" variant="compact" /></PopupHeader></Frame>
        <Frame phone label="N · Popup header, not available" caption="No Unlock; the name ⌃⌄ stays, with the orange warning glyph beside it."><PopupHeader below={<VaultNotice kind="unreadable" name="Taxes" />}><VaultRow name="Taxes" state="unavailable" variant="compact" /></PopupHeader></Frame>
      </Frames>

      <Frames>
        <Frame phone label="O · iPhone, Face ID changed" caption="Quick unlock was lost (the face data changed), so the notice says so before “Unlock with the vault password.” Unlock then shows the lock screen in the sheet."><Slice><VaultRow name="Work" state="locked" variant="phone" /><VaultNotice kind="needs-password" name="Work" why="changed" /></Slice></Frame>
        <Frame phone label="P · iPhone, Face ID locked out" caption="Too many failed attempts: Face ID is unavailable for now. The same notice and the same way forward."><Slice><VaultRow name="Work" state="locked" variant="phone" /><VaultNotice kind="needs-password" name="Work" why="locked-out" /></Slice></Frame>
        <Frame label="Q · Mac sheet, Touch ID changed" caption="The same on the Mac, with Touch ID."><Slice bg="var(--win)" width={380}><VaultRow name="Work" state="locked" variant="mac" /><VaultNotice kind="needs-password" name="Work" bio="Touch ID" why="changed" /></Slice></Frame>
      </Frames>

      <Section title="4. Every surface against every state">
        <p>One short cell each: what the person sees and the one way forward. The words are the ones in the frames above.</p>
      </Section>
      <table className="cmp">
        <thead><tr><th /><th>Unlocked</th><th>Locked</th><th>Needs password</th><th>Not available</th><th>Changed elsewhere</th></tr></thead>
        <tbody>
          <R cells={[<strong key="s">App window</strong>,
            'The items. With 2+ vaults the vault icon’s menu shows the open padlock; Lock Passwords is in it.',
            'The lock screen.',
            'The lock screen.',
            'The lock screen.',
            'The app locks with a notice; the new file is read on unlock.']} />
          <R cells={[<strong key="s">Lock screen</strong>,
            'Not shown: nothing to unlock.',
            'Face ID or Touch ID starts by itself. Way forward: Use Password….',
            'Password field. Way forward: type the vault password (a Key file row only when the vault uses one).',
            'Vault row names it; notice and Locate Vault File… or Download. Another vault is one tap away in the menu.',
            'Same screen with the notice; unlocking reads the new file.']} />
          <R cells={[<strong key="s">AutoFill</strong>,
            'Logins for this site. The sheet closes and nothing stays open.',
            'Face ID automatically. Cancelled: notice and Unlock, which asks again.',
            'Notice says why (“Face ID is off for Work.”), then “Unlock with the vault password.” Way forward: Unlock shows the app’s lock screen in the sheet.',
            'Notice says what Psss will do (open Psss to locate or download). No Unlock. Pick another vault in the row.',
            'Read fresh every time: no separate state.']} />
          <R cells={[<strong key="s">Browser popup</strong>,
            'Lists the current vault while Psss has it open.',
            'Notice and Unlock beside the name. Unlock asks Psss: Touch ID when ready.',
            'Same, and Unlock brings Psss forward on its lock screen.',
            'Notice says what Psss will do. No Unlock. Name ⌃⌄ stays for another vault.',
            'The popup follows the app, which locked: it shows Locked.']} />
        </tbody>
      </table>

      <Section title="5. Locking and unlocking">
        <p>Where each surface opens a vault, what its Unlock button does, and when it locks again.</p>
      </Section>
      <table className="cmp">
        <thead><tr><th>Surface</th><th>Opens how</th><th>Unlock button does</th><th>Locks when</th></tr></thead>
        <tbody>
          <R cells={[<strong key="s">App</strong>, 'Lock screen of the current vault: Face ID automatically when ready, else password (a Key file row only when the vault uses one)', '(the lock screen is the unlock)', 'Auto-lock, ⌘L / Lock in the dropdown / Lock Now, switching vault, changed elsewhere']} />
          <R cells={[<strong key="s">AutoFill (iPhone, iPad, Mac)</strong>, 'Face ID automatically for the current vault when ready', 'Ready: asks Face ID again. Needs password: shows the app’s lock screen inside the sheet (vault password; a Key file row only when the vault uses one or after Choose Key File… in the wrong-password notice; no More Options, no Forgot Password) for that vault. AutoFill cannot open the app, so this is the app’s flow, in place.', 'The sheet closes (nothing stays open)']} />
          <R cells={[<strong key="s">Browser popup (Mac)</strong>, 'Through the app: lists the current vault when the app has it open', 'Asks Psss to unlock: Touch ID when ready (the prompt closes the popup; toolbar check, next click lists), otherwise Psss comes forward on its lock screen', 'With the app']} />
        </tbody>
      </table>
      <div className="prose">
        <p><strong>One current vault per device.</strong> The app window, the AutoFill picker and the browser popup all show the current vault. Choosing another vault in any of them makes it current everywhere, and the open one locks (as built: <code>VaultSession.switchTo</code> works only while locked). It is simple to say, already built, and the browser relay lives in the app, so a separate choice per surface could not hold.</p>
        <ul>
          <li>Every vault menu has the same rows (section 2).</li>
          <li>The Vault row is the picker on the lock screen, every AutoFill screen and, compact, the popup header; with 2+ vaults, and always on the lock screen (Add Vault… lives there).</li>
          <li>Unlock sits beside the picker when the current vault is locked in AutoFill or the browser; with one vault the notice carries it.</li>
          <li>The app window keeps the compact vault icon with its dropdown, only with 2+ vaults: header naming the current vault, Lock Passwords first, the rows, Add Vault…. With one vault, Lock stays in Settings (Lock Now) and ⌘L on Mac.</li>
        </ul>
      </div>

      <Decisions
        items={[
          {
            decision: <>Five states, the same words and glyphs on every surface: Unlocked (open padlock, spoken “Unlocked”), Locked (closed padlock, spoken “Locked”), Needs password (closed padlock, “Needs vault password”), Not available (warning, “Not downloaded yet”, “Not found” or “Can’t be read”), and Changed elsewhere (no glyph, a notice).</>,
            why: <>The facts are many (file, lock, quick unlock, needs, role); a person needs the few that change what they do next.</>,
          },
          {
            decision: <>One current vault per device. The app, AutoFill and the browser popup show it, and choosing another vault anywhere makes it current everywhere.</>,
            rejected: <>a vault choice per surface. The browser relay lives in the app, so a separate choice could not hold; and three different pickers (a filter, a switcher, a lock screen row) was exactly what the owner found confusing.</>,
            why: <>It is already built (<code>VaultSession.switchTo</code>) and easy to say.</>,
          },
          {
            decision: <>One vault menu, one row, drawn from one set of row data: check on the current vault, name, location or state words, glyph at the trailing end. Add Vault… only in the app and on the lock screen.</>,
            why: <>The same rows everywhere is what makes the picture consistent.</>,
          },
          {
            decision: <>A labeled <strong>Unlock</strong> button at the trailing end of the Vault row when the current vault is locked in AutoFill or the browser, with one notice that says why. With one vault the notice carries the button.</>,
            why: <>The owner’s decision: unlocking sits beside the thing being unlocked, and the button is visible and labeled, not an icon or a gesture.</>,
          },
          {
            decision: <>Not available is never solved in AutoFill or the popup. The notice says what Psss will do; there is no Unlock; the Vault row stays.</>,
            why: <>Download, Locate and details need the app, and AutoFill cannot open it. Another vault is still one tap away.</>,
          },
        ]}
      />

      <Section title="Open question">
        <ul>
          <li><strong>Key derivation memory in the extension.</strong> Does the vault password’s key derivation (an Argon2 vault using 64 MiB) fit inside the AutoFill extension’s memory limit? To measure. If it cannot fit, Unlock for that vault says “Open Psss to unlock Work” instead of showing the lock screen in the sheet, and the cell in section 4 changes.</li>
        </ul>
        <p>Decided 2026-11-24 (lead): the needs-password notice says why in a few words, then “Unlock with the vault password.” (frames F, O, P); the popup’s Unlock for a vault that needs its password brings Psss forward on its lock screen, and says “Open Psss to unlock Work.” when the host cannot launch the app; outside the app the not-found way forward reads “Open Psss to locate it.”</p>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-24', text: <>Lead decisions applied: the state is called Unlocked (spoken “Unlocked” and “Locked” everywhere); frame C is the real picker variant (no Lock, header “Vault”); the sheet frames use the iPad’s grey row and, for the Mac only, the bordered “Vault:” button (I to K); the warning glyph is in the row as well as the menu; the in-sheet unlock follows the approved lock screen (no More Options); the popup uses Touch ID; frames O to Q draw the Face ID changed and locked-out notices; the popup header wraps so Unlock is no longer clipped; the open questions the plan decided are now a decided line. Replaces the state name “Open”.</> },
          { date: '2026-11-24', text: <>Shared Vault row and menu; lead decisions applied. The needs-password notice now says why (“Face ID is off for Work.”) before “Unlock with the vault password.”; the AutoFill and browser pages use these components directly, and the Settings list is names only.</> },
          { date: '2026-11-24', text: <>Page added after the owner’s review of the earlier vault screens (“all over the place”). It replaces three different representations: a Show filter in AutoFill and the popup, a switcher in the app, and a pop-up row on the lock screen. Now there are five states, one vault menu, one Vault row with Unlock beside it, and one current vault per device.</> },
        ]}
      />
    </Page>
  );
}
