import { useEffect, useState, type ReactNode } from 'react';
import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone } from '../components/devices';
import { Workspace } from '../components/Workspace';
import { iconU, Mark } from './Logo';
import { PopUpRow } from '../components/PopUpRow';
import { Notice } from '../components/Notice';
import { VaultNotice } from '../components/VaultRow';
import { PasswordField, UnlockRow } from '../components/UnlockRow';
import { VaultMenu, archiveVault, isUnavailable, passwordsVault, sampleVaults } from '../components/VaultMenu';

type Bio = 'touch' | 'face' | 'none';
type State = 'ready' | 'password' | 'failed' | 'working' | 'missing' | 'checking' | 'wrong' | 'changed' | 'reason';

/**
 * The app icon alone (no biometric glyph on it; Use Touch ID or Use Face ID under the field asks again). The icon is the logo's field:
 * it appears hidden (p and three dots), shows the name (psss) a moment later and rests there; the name also shows while the vault opens.
 * A pointer over it (Mac, iPad) switches to the other state until it leaves; a tap switches it for about a second. `touch` is a device without a pointer.
 */
export function LockIcon({ open, touch }: { open?: boolean; touch?: boolean }) {
  const [introduced, setIntroduced] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIntroduced(true), 80);
    return () => clearTimeout(t);
  }, []);
  const [taps, setTaps] = useState(0);
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (taps === 0) return;
    setTapped(true);
    const t = setTimeout(() => setTapped(false), 1300);
    return () => clearTimeout(t);
  }, [taps]);
  const shown = Boolean(open || introduced) !== (over || tapped);
  return (
    <div className={tapped ? 'lk-icon now' : 'lk-icon'} onPointerEnter={(e) => { if (!touch && e.pointerType === 'mouse') setOver(true); }} onPointerLeave={() => setOver(false)} onClick={() => setTaps(taps + 1)}>
      <div className="lg-appicon" style={{ width: 76, height: 76 }}>
        <Mark u={iconU(76)} mask={!shown} fade icon />
      </div>
    </div>
  );
}

export const Fingerprint = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M6.5 8.5a6.5 6.5 0 0 1 11 0" /><path d="M5 12a7 7 0 0 1 .6-2.8" /><path d="M18.4 9.2A7 7 0 0 1 19 12v1" />
    <path d="M8 12a4 4 0 0 1 8 0v2.5" /><path d="M8 12v1.5a8 8 0 0 0 1.4 4.5" /><path d="M12 12v3a6 6 0 0 0 2 4.5" />
    <path d="M16 17a9 9 0 0 1-.6 2.5" /><path d="M10.5 9.2" />
  </svg>
);
export const FaceGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a3.5 3.5 0 0 0 5 0" />
  </svg>
);


/** The vaults this screen knows: the shared sample rows (Passwords, Work) and Archive, drawn only to show Not found. */
const vaults = [...sampleVaults, archiveVault];

/**
 * The vault selector: a standard pop-up button naming the vault that is about to open. Its menu is the shared `VaultMenu` in its
 * `locked` variant (header “Vault”, each name over where it lives or the state's words, a closed padlock or warning glyph, a checkmark on the current one) with “Archive”
 * (Not found) as a third row, and ends, after a separator, with New Vault…, Open Vault File… and Import from Apple Passwords….
 */
function VaultPicker({ current, open: open0, onPick, mac }: { current: string; open?: boolean; onPick: (v: string) => void; mac?: boolean }) {
  const [open, setOpen] = useState(open0 ?? false);
  return (
    <span className="sortwrap lk-pickrow" onClick={(e) => { if ((e.target as HTMLElement).closest('.pur button') && !(e.target as HTMLElement).closest('.lk-menu')) setOpen(!open); }}>
      <PopUpRow label="Vault" value={current} chevrons mac={mac} ariaLabel={`Vault: ${current}. Switch Vault`} tip="Switch vault" menu={open && <VaultMenu locked align="right" shift={mac ? 0 : 24} current={current} extra={[archiveVault]} onChoose={(n) => { onPick(n); setOpen(false); }} onPick={() => setOpen(false)} />} />
    </span>
  );
}

/** The full-screen lock screen of iPhone and compact iPad, as built: the password field and the Unlock row are always there; there is no "Use Password…" step. Mac and regular-width iPad show the same form in the main window (Workspace). */
export function Lock({ bio, state: s0, vault: vault0 = passwordsVault.name, phone, menu, keyfile, title }: { bio: Bio; state: State; vault?: string; phone?: boolean; menu?: boolean; keyfile?: 'uses' | 'chosen'; title?: string }) {
  // The key file row shows only when it is needed: the vault is known to use one, or one was chosen from the warning.
  const [keyState, setKeyState] = useState<'uses' | 'chosen' | undefined>(keyfile);
  const [vault, setVault] = useState(vault0);
  const [pw, setPw] = useState(s0 === 'checking' ? '••••••••••••' : s0 === 'wrong' ? 'hunter2hunter2' : '');
    const missing = isUnavailable(vaults.find((v) => v.name === vault)?.state ?? 'locked');
  const initial: State = bio === 'none' && s0 === 'ready' ? 'password' : s0;
  void missing;
  const [state, setState] = useState<State>(initial);
  // In the app the vault's list replaces this screen. The mock goes back to where it started, so it can be played again.
  useEffect(() => {
    if ((state !== 'working' && state !== 'checking') || initial === state) return;
    const t = setTimeout(() => setState(initial), 2200);
    return () => clearTimeout(t);
  }, [state, initial]);
  const name = bio === 'touch' ? 'Touch ID' : 'Face ID';
  const isMissing = state === 'missing' || missing;
  let line: ReactNode;
  if (state === 'working') line = 'Opening your vault…';
  else if (bio === 'none' || state === 'changed' || state === 'reason') line = <>Enter the vault password.</>;
  else line = <>Use {name} or enter the vault password.</>;
  return (
    <div className={`lk${phone ? " onphone" : ""}`}>
      <LockIcon open={state === 'working'} touch={phone} />
      <div className="lk-title">{title ?? `Unlock ${vault}`}</div>
      <div className="lk-line">{line}</div>
      {state !== 'working' && <VaultPicker current={vault} open={menu} onPick={setVault} mac={!phone && bio === 'touch'} />}
      {state !== 'working' && (
        <div className="lk-form">
          <PasswordField value={pw} onChange={setPw} dim={state === 'checking'} />
          {keyState && (
            <PopUpRow label="Key file" value={keyState === 'chosen' ? 'Work.keyx' : 'Choose…'} mac={!phone} trailing={keyState === 'chosen' ? <button className="lk-x" aria-label="Remove key file" onClick={() => setKeyState(undefined)}>×</button> : undefined} />
          )}
          {isMissing ? <button className="btn pri wide">Locate Vault File…</button> : <UnlockRow bio={bio === 'none' ? undefined : name} typed={pw.length > 0} busy={state === 'checking'} onUnlock={() => setState('checking')} onBio={() => setState(initial)} />}
          {state === 'checking' && (
            <Notice kind="progress" title="Checking your vault password…">This takes a moment on purpose: it makes guessing your vault password very slow. Keep this window open.</Notice>
          )}
          {state === 'wrong' && (
            <Notice kind="warning" action={keyState ? undefined : <button className="btn sq" onClick={() => setKeyState('chosen')}>Choose Key File…</button>}>That didn’t open {vault}. Check Caps Lock and your keyboard language. If this vault uses a key file, choose it.</Notice>
          )}
          {state === 'changed' && (
            <Notice kind="info">The vault was changed by another app or device and needs your vault password again.</Notice>
          )}
          {state === 'reason' && <VaultNotice kind="needs-password" name={vault} bio={name as 'Face ID' | 'Touch ID'} why="changed" />}
          {state === 'failed' && (
            <Notice kind="info">{name} didn’t recognise you. Try again, or enter the vault password.</Notice>
          )}
          {isMissing && (
            <Notice kind="warning">“{vault}” can’t be found. Its file has moved or been deleted. Choose another vault above, locate the file, or remove this vault under Forgot Password.</Notice>
          )}
          <div className="lk-help">
            <button className="btn sq">Forgot Password</button>
            <button className="btn sq">Help</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnlockScreen() {
  return (
    <Page
      title="Unlock screen"
      status={<><Approved on="2026-11-23" /> As built (2026-11-25): the unlock form is one form on every device. On the Mac and on iPad at regular width it is the content area of the main window beside the sidebar; on iPhone and compact iPad it is a full-screen lock screen with the app icon and a Vault pop-up row. The icon showing the name while the vault opens is built.</>}
    >
      <Clarity
        intro={<p>One calm form: a title (“Unlock Passwords”), one line, the vault password field, then one row, Unlock and Use Touch ID (Use Face ID on iPhone and iPad), Unlock first. The form is always there; there is no “Use Password…” step and no biometric glyph on the icon. On iPhone and iPad Face ID starts by itself and Use Face ID asks again. On the Mac, when the form becomes active and Touch ID is on, Psss shows the system’s Touch ID prompt by itself, without a click, and the form is already under it.</p>}
        items={[
          ['Which thing?', 'The vault named in the title (“Unlock Passwords”). Other open vaults stay open; this one stays locked until it is opened.'],
          ['What must they give?', 'A finger on Touch ID or a glance for Face ID, or the vault password, which is always typed straight into the field.'],
          ['What can go wrong?', 'Touch ID or Face ID does not recognise them; it is turned off or no longer matches the vault (changed elsewhere); the vault file is missing; they forgot the password.'],
          ['How do they leave?', 'Quit, or choose or add another vault from the selector under the line. Other open vaults stay open; nothing changes until this vault opens. A vault just added with Open Vault File… shows this screen too, and cancelling leaves it in the list, locked.'],
        ]}
      />

      <Section title="1. Mac">
        <p>On the Mac there is no full-window lock screen (as built, 2026-11-25). The window is always the main window: the sidebar with every locked vault collapsed (or the open vaults expanded), and the unlock form in the content area, spanning the list and the detail, in place of them. Choosing a locked vault while another is open swaps the window to these two columns, the sidebar and the form; the vault’s places reappear in the sidebar once it unlocks. After the auto-lock every vault is locked and the form is for the vault last on screen.</p>
      </Section>
      <Frames>
        <Frame label="A. Locked, Touch ID prompt" caption="When the form becomes active and Touch ID is on, Psss shows the system’s prompt (“Psss wants to unlock Passwords”) by itself, without a click; the finger answers it. The form is already under it. The prompt belongs to the window in front: while the window is behind another none is shown, and it appears by itself once more when the window comes forward. Right after the person locks, no prompt is shown (frame B). Honest limit: macOS shows Touch ID only through this system prompt; Psss cannot listen for a finger silently.">
          <Workspace device="mac" init={{ locked: true, bioPrompt: true }} />
        </Frame>
        <Frame label="B. Prompt cancelled, or locked by you" caption="After Cancel, and right after the person locks (Lock, Lock All Vaults, Lock Now), the window shows what was under the prompt: the title, the password field, then one row, Unlock and Use Touch ID. Unlock is the default button (Return) and is dimmed until a password is typed (click the field and type to see it); the password is the main way in, and Touch ID the alternative people reach for second, so it comes second (in macOS alerts the default button sits on the trailing side, but this is an in-window form, not an alert). Use Touch ID brings the prompt back. Forgot Password and Help are under the row.">
          <Workspace device="mac" init={{ locked: true }} />
        </Frame>
        <Frame label="D. Not recognised" caption="After the system’s failed attempts the prompt closes and a notice under the buttons says so in plain words; Use Touch ID tries again. The prompt comes back by itself when the window is next brought forward. Other problems (turned off, changed elsewhere, vault file missing) have their own messages, shown in this same spot.">
          <Workspace device="mac" init={{ locked: true, unlockState: 'failed' }} />
        </Frame>
        <Frame label="E. Touch ID not turned on" caption="No prompt and no Use Touch ID button: the field is focused and Unlock is the only button on the row.">
          <Workspace device="mac" init={{ locked: true, noBio: true }} />
        </Frame>
      </Frames>

<Section title="2. iPhone and iPad" />
      <Frames>
        <Frame phone label="F. iPhone, Face ID" caption="The full-screen lock screen: the app icon, the title “Unlock Passwords” (the vault’s name, not “Psss Is Locked”), one line, the Vault row, then the field with Unlock and, stacked under it, Use Face ID. Face ID starts by itself when the screen appears and each time the app returns to the front, but not right after the person locks, until they leave the app and come back or choose the vault; the keyboard is not forced up over it. Use Face ID asks again.">
          <IPhone><Lock bio="face" state="ready" phone /></IPhone>
        </Frame>
        <Frame phone label="G. iPhone, password" caption="The field focused with the keyboard up. Unlock, the filled button, is dimmed until a password is typed, and Use Face ID is below it.">
          <IPhone><Lock bio="face" state="password" phone /></IPhone>
        </Frame>
        <Frame label="H. iPad" caption="At regular width iPad is the Mac’s layout: the sidebar and the form in the content area, with Unlock and Use Face ID (Use Touch ID on an iPad with the Touch ID button) on one row. The full-screen screen above is for iPhone and iPad at compact width (Slide Over, narrow Split View), which have no sidebar.">
          <Workspace device="ipad" init={{ locked: true }} />
        </Frame>
      </Frames>

<Section title="3. Choosing another vault">
        <p>On the Mac and on iPad at regular width the sidebar is the vault selector: each vault is a section, and choosing a locked one shows this form (see <a href="#/vault-switcher">Vaults</a>). The full-screen lock screen of iPhone and compact iPad has no sidebar, so a <strong>Vault</strong> pop-up row sits under the line that names the vault, even with one vault (its menu is where New Vault…, Open Vault File… and Import from Apple Passwords… live). It is a standard pop-up button: it shows the vault that will open, and its menu lists every known vault in the fixed order of Settings › Vaults, with a checkmark on the current one and where it lives in secondary text; a locked vault has the closed padlock and an unavailable one the warning glyph. After a separator come the three add items. The title follows the choice (“Unlock Work”). Choosing a vault switches this screen to it at once; nothing is opened until its own Face ID or password, and the vaults that are already open stay open (several vaults can be open at once; the auto-lock locks all of them). A vault added with Open Vault File… is shown here at once, with the password field only (frames AD and AE). Click the selector to try it.</p>
      </Section>
      <Frames>
        <Frame phone label="J. iPhone, menu open" caption="Items say the vault name with, under it in secondary text, where it lives (iCloud Drive, or the file’s name). A vault that cannot be reached says why in the same place, with the orange warning glyph at the row’s end (here “Not found”). It stays in the list so it can still be chosen, read about and removed.">
          <IPhone><Lock bio="face" state="ready" phone menu /></IPhone>
        </Frame>
        <Frame phone label="M. iPhone, vault not found" caption="Choosing “Archive” (or opening with it remembered) shows the title “Unlock Archive”, the password form and a line naming the vault, where its file was, and the two ways out: choose another vault here, or remove it under Forgot Password. The selector stays, so the way out is always one tap away. Nothing is deleted by choosing it.">
          <IPhone><Lock bio="face" state="ready" vault="Archive" phone /></IPhone>
        </Frame>
        <Frame label="AD. Mac, a vault file was just opened" caption="After Open Vault File… the vault is added and its form is shown in the content area, “Unlock Family”, with the password field only: Touch ID is offered after the first unlock. Cancelling leaves Family in the list, locked.">
          <Workspace device="mac" init={{ vaults: 'two', added: 'Family', unlock: 'Family' }} />
        </Frame>
        <Frame phone label="AE. iPhone, a vault file was just opened" caption="The same on iPhone: no Use Face ID button until the vault has been unlocked once.">
          <IPhone><Lock bio="none" state="ready" vault="Family" phone title="Unlock Family" /></IPhone>
        </Frame>
        <Frame label="O. Mac, checking the password" caption="Progress sits under Unlock with no space held for it beforehand. The field and Unlock dim and stay exactly where they were; the notice appears under them and only Forgot Password and Help move down. The same slot is used on iPhone and iPad.">
          <Workspace device="mac" init={{ locked: true, unlockState: 'checking' }} />
        </Frame>
        <Frame phone label="P. iPhone, checking the password" caption="Same place, under the buttons; the keyboard stays up.">
          <IPhone><Lock bio="face" state="checking" phone /></IPhone>
        </Frame>
      </Frames>

<Section title="4. While the vault opens">
        <p>The icon is the logo's field. Locked, it is hidden: a p and three dots. Once the finger or the face is accepted, or the vault password has been entered, the dots become “sss” one after another while the vault is opened, and then the vault's list replaces the screen. The icon here is drawn by the app, flat, so that it can change; it is not the glass icon from the Home Screen or the Dock. In any frame above, click the glyph on the icon, or Unlock in the password form, to play it; the mock then returns to where it started.</p>
      </Section>
      <Frames>
        <Frame phone label="R. iPhone, opening" caption="The moment Face ID is asked or the password is entered. The form beside the sidebar on Mac and iPad draws the same icon and changes it the same way. The line changes to “Opening your vault…” and the icon reads “psss”. It lasts only as long as opening the vault takes and adds no waiting of its own. With the password that is the second or so the password check needs. With Face ID or Touch ID the vault opens almost at once, so the switch may be cut short or not seen at all.">
          <IPhone><Lock bio="face" state="working" phone /></IPhone>
        </Frame>
</Frames>

      <Section title="5. Notices under the buttons">
        <p>Progress, a wrong password and every other message share one place: a notice directly under the Unlock buttons, above the help buttons. It is a small card with a filled symbol, so it reads as a notice and not as stray text: an orange warning triangle for something that went wrong, a blue “i” for information, a spinner for progress. Red is kept for deletion. Nothing is held in advance, so the idle screen stays compact.</p>
      </Section>
      <Frames>
        <Frame phone label="T. iPhone, wrong password" caption="The field keeps its text and focus; the notice appears under the buttons and is spoken at once (“Warning: …”). Unlock does not move."><IPhone><Lock bio="face" state="wrong" phone /></IPhone></Frame>
        <Frame phone label="U. iPhone, checking" caption="The same card and place, with a spinner. The field is dimmed and locked."><IPhone><Lock bio="face" state="checking" phone /></IPhone></Frame>
        <Frame phone label="V. iPhone, not recognised" caption="Information, not a mistake in what was typed: a blue “i”, same place."><IPhone><Lock bio="face" state="failed" phone /></IPhone></Frame>
        <Frame label="W. Mac, wrong password" caption="The same on Mac and iPad, in the form beside the sidebar."><Workspace device="mac" init={{ locked: true, unlockState: 'wrong' }} /></Frame>
        <Frame phone label="X. iPhone, changed elsewhere" caption="The app locks itself when another app or device changed the vault file, and says so in the info notice it shows: “The vault was changed by another app or device and needs your vault password again.” The password form is open; the new file is read when it unlocks."><IPhone><Lock bio="face" state="changed" phone /></IPhone></Frame>
        <Frame phone label="Y. iPhone, why the password is needed" caption="Quick unlock was lost: the same “why” sentence the AutoFill sheet and the popup show (“Face ID changed since Passwords was set up.”), then the way forward. The other two reasons, “Face ID is off for …” and “Face ID is locked out right now.”, read the same way and are drawn on Vault states."><IPhone><Lock bio="face" state="reason" phone /></IPhone></Frame>
        <Frame label="Z. Mac, changed elsewhere" caption="The same on Mac and iPad, in the form beside the sidebar."><Workspace device="mac" init={{ locked: true, unlockState: 'changed' }} /></Frame>
      </Frames>

      <Section title="6. Key file: only when it is needed, and the Mac layout">
        <p>A key file is rare, so the lock screen shows nothing for it by default: no row, link, pill or disclosure. It appears in two cases. When the vault is known to use one (Psss records that after the first unlock), the Key file row is on the screen from the start (frames AA and AB). When a vault made elsewhere turns out to need one, the wrong-password notice carries a <strong>Choose Key File…</strong> button (frames T and W), which adds the row with the file’s name and a remove button. The Open a Vault File sheet always has its key file field. A hardware key would follow the same rule. On the Mac the label sits right next to its control, right-aligned with a colon, the pair meeting on the window’s centre line.</p>
      </Section>
      <Frames>
        <Frame phone label="AA. iPhone, vault uses a key file" caption="The Key file row is under the field from the start, in the same grey row as Vault. Nothing else changes."><IPhone><Lock bio="face" state="password" phone keyfile="uses" /></IPhone></Frame>
        <Frame phone label="AB. iPhone, file chosen" caption="After Choose Key File… (from the warning) or Choose…: the file’s name and a remove button replace “Choose…”."><IPhone><Lock bio="face" state="password" phone keyfile="chosen" /></IPhone></Frame>
</Frames>

      <Section title="7. Decisions to approve" />
      <Decisions
        items={[
          {
            decision: <>Progress, a wrong password, “not recognised”, a lock notice and “vault not found” all appear as one notice card directly under the Unlock buttons (frames T to W), replacing the plain line above the vault row and the plain icon-and-text line.</>,
            rejected: <>messages under the title, away from the field the person is looking at, and a bare triangle glyph beside body text.</>,
            why: <>The owner (2026-11-24): the error did not look like a notice, its icon was plain, and the help buttons are below the field, so progress and the error belong there too. A tinted card with a filled symbol is how iOS shows an inline notice. Orange for a problem, not red, which is for deletion.</>,
          },
          {
            decision: <>While the vault password is checked, the progress (spinner, “Checking your vault password…”, the line that it takes a moment on purpose) shows under the Unlock buttons, with no space held in advance, on every device: only the help buttons move down while it shows.</>,
            rejected: <>progress above the field (the field jumped down on Mac and iPad) and progress elsewhere on iPhone.</>,
            why: <>The field the person just used must not move when Unlock is pressed. Space is not reserved for the notice (owner, 2026-11-24): holding it pushed Unlock too far down the idle screen. Face ID and Touch ID still use the “Opening your vault…” line, since there is no field then.</>,
          },
          {
            decision: <>A vault selector on every lock screen: a standard pop-up button under the line naming the vault, listing every available or remembered vault in the fixed order of Settings › Vaults, ending with the three add items: New Vault…, Open Vault File… and Import from Apple Passwords….</>,
            rejected: <>the selector above the title (it would sit before the thing it changes, and push the icon down); a segmented control or sidebar (does not scale past two or three vaults); keeping the add items only inside “Forgot Password”, which hid the only way to switch vaults.</>,
            why: <>A person who is locked out of, or simply opened, the wrong vault needs the way out on the screen, not behind a help button for forgotten passwords. Below the line it reads as “this one will open — or change it”. It is shown even with one vault so the add items are always findable. Apple's guidelines use a pop-up button for choosing one of several options and allow an action after a separator (as font and location pickers do); Passwords itself has no selector because it has one library, so this is a Psss addition, not a conflict.</>,
          },
          {
            decision: <>Menu items read “Name” plus where it lives in secondary text (iCloud Drive, or the file’s name). A vault that is not available stays in the list with a warning glyph and its reason (“Not downloaded yet”, “Not found”, “Can’t be read”) in that place; one that needs its vault password says “Needs vault password”. The words and glyphs are the ones on the Vault states page.</>,
            why: <>Two vaults can share a name; the location tells them apart and answers “where does it live?”. Keeping a missing vault listed lets the person see it, read the message and remove it, instead of it vanishing.</>,
          },
          {
            decision: <>“Forgot Password” has no way to add or open a vault. It keeps the three things to try and “Remove Vault…”.</>,
            why: <>One place for one action. Two entries for the same action would make the help page look like the place to switch vaults, which is what hid it.</>,
          },
          {
            decision: <>One calm unlock form on every device: the app icon, a title naming the vault (“Unlock Passwords”), the password field, and Unlock and Use Touch ID (Face ID), Unlock first (one row on Mac and iPad, stacked on iPhone), Unlock the default button and dimmed until a password is typed; the password is the main way in and Touch ID the alternative people reach for second (in macOS alerts the default button is on the trailing side, but this is an in-window form, not an alert). The form is always shown: there is no “Use Password…” step and no Face ID glyph on the icon. On the Mac and iPad at regular width it is the content area beside the sidebar; iPhone and compact iPad draw it full screen with one line and the Vault row.</>,
            rejected: <>a password-first screen with the help paragraph always shown; Use Touch ID before Unlock; Unlock full width above Use Touch ID on the Mac.</>,
            why: <>Most unlocks are a finger or a face. The password form is one click away and still always works, and help is behind labelled buttons, not hidden.</>,
          },
          {
            decision: <>Mac: when the lock window (or the unlock form in the main window) becomes active and Touch ID is on, Psss shows the system’s Touch ID prompt by itself, without a click. Use Touch ID brings it back after Cancel. The password form is always under it.</>,
            rejected: <>a Touch ID glyph on the icon that listens silently while the window is in front (the earlier drawing).</>,
            why: <>The owner’s direction, and the honest one: macOS shows Touch ID only through the system prompt, so an app cannot listen for a finger without a prompt on screen. The row’s Use Touch ID is the way back when the prompt was cancelled.</>,
          },
          {
            decision: <>iPhone and iPad: Face ID starts when the lock screen appears and each time the app comes to the front; Use Face ID asks again.</>,
          },
          {
            decision: <>After a lock the person chose, the lock screen does not ask for Face ID or Touch ID by itself. It asks again once they leave the app and come back, or choose the vault. A lock Psss makes by itself asks as before.</>,
            rejected: <>asking at once after every lock.</>,
            why: <>Someone who just locked wants it locked; a prompt that opens it again in the same second undoes that.</>,
          },
          {
            decision: <>The line names the vault and says “vault password”, not “your password”.</>,
            why: <>“Your password” reads as the Mac login or Apple Account password. The vault password is a different thing, and “Help” explains it.</>,
          },
          {
            decision: <>The icon on the lock screen is the logo's field. It appears hidden (p and three dots), then shows the name (psss) and rests there, also while the vault opens, on every device. With a pointer (Mac, iPad) hovering over it switches to the other state; a tap (iPhone, iPad) switches it for about a second.</>,
            rejected: <>an animated logo at the top left of the main screen on launch.</>,
            why: <>Hidden while locked and shown when opened is what the logo already means. It starts as soon as an attempt starts (password submitted, Face ID or Touch ID asked), not when the vault has opened, and nothing is ever held for it (owner, 2026-11-24): if the vault is open first, the list simply replaces the screen. Apple's guidance is to launch instantly and not to brand the launch, and the top left of the main screen is taken by the back button, the sidebar and the window controls.</>,
          },
          {
            decision: <>The key file row only appears for a vault that uses one, between the password field and the Unlock row.</>,
          },
        ]}
      />
      <Against>
        <li><strong>Apple Passwords on the Mac</strong> lets a finger on the sensor open it with no dialog (an embedded authentication view). This design uses the system prompt, shown by itself, because it is the documented way for an app to ask for Touch ID. If the embedded view proves usable for Psss, the prompt can be dropped with no change to the row.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-26', text: <>Owner, built: right after the person locks (Lock, Lock All Vaults, Lock Now) the lock screen waits; Face ID or Touch ID asks by itself again once they leave the app and come back, or choose the vault. Replaces the prompt appearing as soon as the lock screen showed, whatever caused the lock.</> },
          { date: '2026-11-26', text: <>Owner, built: notices sit under Unlock and Use Touch ID (Face ID), above Forgot Password and Help, and the form is centred as if there were none, so no button moves when one appears. Hovering the icon (Mac, iPad) switches it to its other state until the pointer leaves, and a tap (iPhone, iPad) switches it for about a second, all three places at once with no delay. The icon is now drawn resting on the name, as the app does. Replaces notices between the password field and the buttons, which pushed Unlock down. Also removed from the Mac and iPad form: the line “Psss is locked. All your vaults are locked.”, which added nothing to the sidebar’s padlocks.</> },
          { date: '2026-11-25', text: <>Built that way, mock follows. The unlock form is always shown: “Use Password…” and the biometric glyph on the icon are gone (Use Touch ID or Use Face ID under the field asks again; the system prompt appears by itself). The full-screen lock screen of iPhone and compact iPad is titled “Unlock [name]”, not “Psss Is Locked”. On the Mac and regular-width iPad the form is drawn in the main window beside the sidebar, spanning the list and detail (the icon, “Unlock [name]”, the field, the row, Forgot Password and Help), and choosing a locked vault while another is open swaps the window to those two columns; frames A, B, D, E, H, AD, O, W and Z use it. Replaces the Mac and iPad full-window frames, the Mac’s “window not in front” frame (now said in frame A), the Mac and iPad vault pop-up, vault-not-found, opening and key-file frames (the Mac window has no Vault pop-up; iPhone frames J, M, R, AA and AB stay), and the Face ID glyph and “Use Password…” wording.</> },
          { date: '2026-11-25', text: <>Open Vault File… no longer asks for the password in the add flow: the vault is added and this screen is shown for it, “Unlock [name]”, with the password field and no Touch ID (Face ID) button until the first unlock (new frames AD and AE). Several vaults can be open at once, so choosing a vault here never locks another one. Replaces a password step inside the add flow (none was drawn) and the one-vault-at-a-time wording.</> },
          { date: '2026-11-25', text: <>Unlock form: Unlock first, then Use Touch ID (Face ID), one row on Mac and iPad and stacked on iPhone, Unlock the default button and dimmed until a password is typed; on the Mac the form is shown at once and the system Touch ID prompt appears by itself when the window becomes active, with Use Touch ID, after Unlock, to bring it back (frames A to E). The iPhone and iPad captions follow. Vault menus list every vault in the fixed Settings › Vaults order, current one checked. Replaces a first draft with Use Touch ID before Unlock, the Mac’s silently listening Touch ID glyph (Apple’s embedded view), “Use Password…” on the Mac, Unlock full width above the help buttons, and the “Switch to …” rows on iOS.</> },
          { date: '2026-11-25', text: <>Review fixes. The three add items replace the old “Add Vault…” wording in the section text and the decision, and a vault that is no longer wanted is “removed” (Remove Vault…), not “forgotten”; “dropdown” is gone from the status line. On iPhone and iPad the Vault pop-up’s menu has the structure of Safari’s profile menu (“Switch to …” rows for the other vaults, a divider, the three add items; no section for the locked vault); the Mac keeps its list with a check (frames J and M redrawn). The iPhone menus no longer run past the bottom of the screen. Frame letters now read in page order (A to H, I to Q, R and S, T to W, X to Z, then AA to AC); the Unlock buttons of the Mac window are macOS push buttons. Replaces the out-of-order letters and the old wording.</> },
          { date: '2026-11-25', text: <>Added a pointer, nothing replaced: a proposal on <a href="#/vault-switcher">Vaults</a> (frame I) would replace the Mac’s full-window lock screen and its Vault pop-up with the normal window, its sidebar showing every vault collapsed and locked and the unlock form for the last used vault in the content area. The owner confirms it; the frames on this page stay until then.</> },
          { date: '2026-11-25', text: <>The vault menu ends in New Vault…, Open Vault File… and Import from Apple Passwords… instead of one “Add Vault…” item that opened a chooser sheet; see <a href="#/vault-switcher">Vaults</a>. On Mac frames the Unlock, Use Password…, Forgot Password and Help buttons are macOS push buttons (grey rounded rectangle; Unlock is the default button, accent fill) instead of the iOS capsule, and the Vault pop-up has up/down chevrons. Replaces the iOS capsule look on the Mac.</> },
          { date: '2026-11-25', text: <>Mac frames: the Vault row (and the Key file row) is one unit, “Vault:” and the pop-up button side by side, centred under the title. Replaces the layout that pinned the colon to the window’s centre line, which made a short label and a long vault name look shifted to the right (owner, from the built lock screen). The AutoFill sheet on the Mac uses the same row.</> },
          { date: '2026-11-24', text: <>Lead decisions applied: frame I’s caption now says the unavailable vault shows the orange warning glyph (it said the accent colour); added a changed-elsewhere lock screen (X, Z) with the info notice the app shows, and a needs-password “why” frame (Y). The AutoFill sheet’s in-sheet unlock is this screen, with no More Options and no Forgot Password.</> },
          { date: '2026-11-24', text: <>The menu rows come from the shared row data in <code>VaultMenu.tsx</code> (name, location, state), the same words and glyphs as on <a href="#/vault-states">Vault states</a>: Passwords and Work are Locked (closed padlock, where the file is kept), Archive is Not available (warning glyph, “Not found”, shown only here). Before, Archive’s reason was an accent-coloured line with no glyph. The Vault row is the same pop-up row the AutoFill picker and the browser popup use; there the current vault’s Unlock button sits beside it, here the lock screen is the unlock.</> },
          { date: '2026-11-24', text: <>The vault menu on this page is now the shared <code>VaultMenu</code> (its <code>locked</code> variant, the same rows as the main window’s dropdown: name over where it is kept, closed padlock), not its own copy; “Archive” (Not found) stays as a third row. Before, this page drew a name and location side by side.</> },
          { date: '2026-11-24', text: <>Sample vaults are now “Passwords” (iCloud Drive) and “Work” (Work.kdbx), with “Archive” (Not found) as a third row to show the not-found state. Replaces Personal, Family and Work (On this Mac), which disagreed with the other pages. The Vault pop-up row, its name with ⌃⌄, stays; its menu is the same list as the main window’s vault dropdown, with the header “Vault” in place of the open vault’s name and without the Lock item (<a href="#/vault-switcher">Vaults</a>). An earlier entry here that drew a database icon with “Choose Vault” was never kept.</> },
          { date: '2026-11-24', text: <>The “More Options” disclosure is gone. The Key file row shows only when the vault is known to use a key file, or after Choose Key File… in the wrong-password notice (frames T, W, AA to AC); the Mac pop-up row puts the label beside the control on the centre line. Replaces the always-visible Key file row, the link and the disclosure drawn earlier the same day (an extra control on every lock screen for something most vaults never use).</> },
          { date: '2026-11-24', text: <>The vault selector became a Vault pop-up row (“Vault” on the left, the name with ⌃⌄ on the right; the system’s Form pop-up idiom) and the “Use a Key File…” link became a Key file row with “Choose…” (after a choice: the file name and a remove button). Same row in the AutoFill picker. Replaces the grey “Passwords ⌃⌄” pill and the blue link. Built for the Vault row (owner saw it in the simulator); the key file row is built too.</> },
          { date: '2026-11-24', text: <>Notices moved under the password field and became a card with a filled symbol (frames T to W, section 5): progress, wrong password, not recognised and vault not found. Replaces the plain lines above the vault row and the outline triangle. Built 2026-11-24.</> },
          { date: '2026-11-24', text: <>The selector button shows the selected vault’s name again (“Passwords ⌃⌄”) instead of “Choose Vault”, and the line above no longer repeats the name (“Use Face ID or enter the vault password.”). A button that only says “Choose Vault” hid which vault a password would open; with the name on the button the line needs no name. Replaces the fixed “Choose Vault” label and the “to open “Name”” wording in every frame.</> },
          { date: '2026-11-24', text: <>The selector is now the same control as the vault switcher in the main window (<a href="#/vault-switcher">Vaults: add one, switch between them</a>): a button with the database icon and “Choose Vault”, no “Unlock Vault:” line before it, and a menu whose rows end in a padlock (every vault is locked on this screen). “Open Another Vault…” became “Add Vault…”, the same sheet as in Settings. The current vault’s name is no longer on the button: the line above it names the vault being opened, and the menu’s checkmark shows it. Proposed at the owner’s request; not built. Replaces the “Unlock Vault: [name] ⌃⌄” pop-up in every frame on this page.</> },
          { date: '2026-11-24', text: <>The selector is built. The vault-not-found line now reads as the app words it and the button there is “Locate Vault File…”; the progress notice uses the app's existing wording. Opening another vault keeps the one before it, so the old warning about Psss-created vaults is gone.</> },
          { date: '2026-11-24', text: <>“What Is This?” is now “Help” and comes after “Forgot Password”; neither label has a question mark (owner request). Replaces “What Is This?” before “Forgot Password?”.</> },
          { date: '2026-11-24', text: <>Password progress moved under the password field on every device, with no reserved space (frames O to Q); the field is shown locked and dimmed while it is checked. The selector gained the label “Unlock Vault:” before it on the same row. Replaces progress shown above the field on Mac and iPad and elsewhere on iPhone, which made the field jump.</> },
          { date: '2026-11-24', text: <>Added the vault selector under the line naming the vault, on every lock screen (frames I to N, section 3). “Open Another Vault…” moved out of “Forgot Password” into the selector's menu, because hiding it there left no visible way to switch vaults once one was set up. Replaces: a lock screen with no selector (dropped 2026-11-23 along with the always-visible help paragraph).</> },
          { date: '2026-11-24', text: <>The icon also plays the switch once by itself, right after the lock screen shows and each time the app returns to the front, then rests on “psss”. Nothing waits for it. Added because with no Face ID on the device nothing else started it when the app was reopened.</> },
          { date: '2026-11-24', text: <>The switch now starts when an attempt starts, including while Face ID or Touch ID is asked, so it has more time to play. A hold until 0.75 s was tried and taken out the same day: the owner never wants the screen held, so a fast unlock may still cut it short. It replaces “the icon changes only once the person is accepted”.</> },
          { date: '2026-11-24', text: <>The switch is built. Two captions were corrected to what the app does: a wrong password shows the name while it is checked and then the dots return (before, the page said the dots stay), and with Face ID or Touch ID the vault opens so fast that the switch could not be seen (changed the same day, see the first entry). The lock screen icon is now drawn by the app, flat, on every device; before, it was a picture of the icon.</> },
          { date: '2026-11-24', text: <>The icon is now drawn as the logo's field (see the Logo page) and shows the name while the vault opens; frames R and S and one decision were added. The owner approved the lock screen as the place for this. Before, the icon was a placeholder square with a P and did not change.</> },
          { date: '2026-11-23', text: <>Approved as drawn. It replaced a password-first lock screen that opened with a password field, an Unlock button, a key file row, a paragraph of help and two buttons, and that asked for Touch ID in a system dialog on Mac. The password form is now one click away and still always works, and help sits behind two labelled buttons. The line says “vault password” and names the vault, because “your password” reads as the Mac login or Apple Account password.</> },
        ]}
      />
    </Page>
  );
}
