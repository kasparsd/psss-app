import { useEffect, useState, type ReactNode } from 'react';
import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { iconU, Mark } from './Logo';
import { CheckIcon } from '../icons';

type Bio = 'touch' | 'face' | 'none';
type State = 'ready' | 'password' | 'inactive' | 'failed' | 'working' | 'missing' | 'checking';

/**
 * The app icon with the live biometric glyph on its corner, as Apple Passwords
 * draws it. The icon is the logo's field: hidden (p and three dots) while
 * locked, shown (psss) while the vault opens. In the mock, clicking the glyph
 * stands in for a recognised finger or face.
 */
function LockIcon({ bio, dim, open, onRecognised }: { bio: Bio; dim?: boolean; open?: boolean; onRecognised?: () => void }) {
  return (
    <div className="lk-icon">
      <div className="lg-appicon" style={{ width: 76, height: 76 }}>
        <Mark u={iconU(76)} mask={!open} fade icon />
      </div>
      {bio !== 'none' && (
        <button className={`lk-badge${dim ? ' dim' : ''}`} style={{ border: 0, padding: 0, cursor: 'pointer' }} aria-label={bio === 'touch' ? 'Touch ID' : 'Face ID'} onClick={onRecognised}>
          {bio === 'touch' ? <Fingerprint /> : <FaceGlyph />}
        </button>
      )}
    </div>
  );
}

const Fingerprint = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M6.5 8.5a6.5 6.5 0 0 1 11 0" /><path d="M5 12a7 7 0 0 1 .6-2.8" /><path d="M18.4 9.2A7 7 0 0 1 19 12v1" />
    <path d="M8 12a4 4 0 0 1 8 0v2.5" /><path d="M8 12v1.5a8 8 0 0 0 1.4 4.5" /><path d="M12 12v3a6 6 0 0 0 2 4.5" />
    <path d="M16 17a9 9 0 0 1-.6 2.5" /><path d="M10.5 9.2" />
  </svg>
);
const FaceGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a3.5 3.5 0 0 0 5 0" />
  </svg>
);


type VaultRow = { name: string; where: string; problem?: string };
const vaults: VaultRow[] = [
  { name: 'Personal', where: 'iCloud Drive' },
  { name: 'Family', where: 'iCloud Drive' },
  { name: 'Work', where: 'On this Mac' },
  { name: 'Archive', where: 'Documents', problem: 'Not found' },
];

/**
 * The vault selector: a standard pop-up button naming the vault that is about to open. Its menu lists every
 * available or remembered vault (a checkmark on the current one, where it lives in secondary text, a problem
 * in place of the location) and ends, after a separator, with "Open Another Vault…".
 */
function VaultPicker({ current, open: open0, onPick }: { current: string; open?: boolean; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(open0 ?? false);
  return (
    <span className="sortwrap lk-pick">
      <span className="lk-line" style={{ marginRight: 8 }}>Unlock Vault:</span>
      <button className="btn sq" aria-haspopup="menu" aria-expanded={open} aria-label={`Vault: ${current}`} data-tip={open ? undefined : 'Choose a vault'} onClick={() => setOpen(!open)}>
        {current} <span style={{ opacity: 0.6 }}>⌃⌄</span>
      </button>
      {open && (
        <div className="pop lk-menu" role="menu">
          <div className="ph">Vault</div>
          {vaults.map((v) => (
            <button key={v.name} role="menuitemradio" aria-checked={v.name === current} onClick={() => { onPick(v.name); setOpen(false); }}>
              <span className="chk">{v.name === current && <CheckIcon />}</span>
              <span>{v.name}</span>
              <span style={{ marginLeft: 'auto', paddingLeft: 18, color: v.problem ? 'var(--accent)' : 'var(--lab2)' }}>{v.problem ?? v.where}</span>
            </button>
          ))}
          <div className="ph sepd" style={{ padding: 0 }} />
          <button role="menuitem"><span className="chk" />Open Another Vault…</button>
        </div>
      )}
    </span>
  );
}

/** The lock screen body, shared by every device. Click "Use Password…" to see the password state. */
function Lock({ bio, state: s0, vault: vault0 = 'Personal', phone, menu }: { bio: Bio; state: State; vault?: string; phone?: boolean; menu?: boolean }) {
  const [vault, setVault] = useState(vault0);
  const missing = vaults.find((v) => v.name === vault)?.problem !== undefined;
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
  const showPassword = state === 'password' || state === 'failed' || state === 'checking' || bio === 'none' || isMissing;
  let line: ReactNode;
  if (state === 'working') line = 'Opening your vault…';
  else if (isMissing) line = <>“{vault}” can’t be found. Its file has moved or been deleted. Choose another vault above, locate the file, or forget this vault under Forgot Password.</>;
  else if (bio === 'none') line = <>Enter the vault password to open “{vault}”.</>;
  else if (state === 'inactive') line = <>Click this window, then use {name} or enter the vault password.</>;
  else line = <>{bio === 'touch' ? 'Touch ID' : 'Use Face ID'} or enter the vault password to open “{vault}”.</>;
  return (
    <div className={`lk${phone ? " onphone" : ""}`}>
      <LockIcon bio={bio} dim={state === 'inactive' || state === 'working'} open={state === 'working'} onRecognised={() => setState('working')} />
      <div className="lk-title">Psss Is Locked</div>
      <div className="lk-line">{line}</div>
      {state === 'failed' && (
        <div className="lk-line">{name} didn't recognise you. Try again, or enter the vault password.</div>
      )}
      {state !== 'working' && <VaultPicker current={vault} open={menu} onPick={setVault} />}
      {!showPassword && state !== 'working' && (
        <button className="btn sq lk-use" onClick={() => setState('password')}>Use Password…</button>
      )}
      {showPassword && (
        <div className="lk-form">
          <div className="lk-field" style={state === 'checking' ? { opacity: 0.5, borderColor: 'var(--sep)' } : undefined} aria-disabled={state === 'checking'}>{state === 'checking' ? '••••••••••••' : 'Vault Password'}</div>
          {state === 'checking' && (
            <div className="lk-progress">
              <>
                <div style={{ fontWeight: 600 }}>◌ Checking your vault password…</div>
                <div className="lk-line">This takes a moment on purpose: it makes guessing your vault password very slow. Keep this window open.</div>
              </>
            </div>
          )}
          {isMissing ? <button className="btn pri wide">Locate Vault File…</button> : <button className="btn pri wide" disabled={state === 'checking'} onClick={() => setState('checking')}>Unlock</button>}
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
      status={<><Approved on="2026-11-23" /> One lock screen on every device, as in Apple Passwords. The icon showing the name while the vault opens was approved on 2026-11-24 and is built.</>}
    >
      <Clarity
        intro={<p>One calm screen, as Apple Passwords shows it: the app icon with a Touch ID or Face ID glyph, one line, and “Use Password…”. On Mac, touching the sensor while the window is in front unlocks it, with no dialog.</p>}
        items={[
          ['Which thing?', 'The vault named in the line (“Personal”). Psss stays locked until it is opened.'],
          ['What must they give?', 'A finger on Touch ID or a glance for Face ID. The vault password works at any time through “Use Password…”.'],
          ['What can go wrong?', 'Touch ID or Face ID does not recognise them; it is turned off or no longer matches the vault (changed elsewhere); the vault file is missing; they forgot the password.'],
          ['How do they leave?', 'Quit, or choose or open another vault from the selector under the line. Nothing changes until the vault opens.'],
        ]}
      />

      <Section title="1. Mac" />
      <Frames>
        <Frame label="A. Locked, window in front" caption="The glyph on the icon is the live Touch ID control (Apple's embedded authentication view). While this window is in front, touching the sensor opens the vault: no dialog, no click. “Use Password…” shows the password form in place (click it).">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="ready" /></div></MacWindow>
        </Frame>
        <Frame label="B. Use Password…" caption="The password form appears under the line; the icon and title stay put. Touch ID keeps listening, so a finger still works. A key file row appears only for a vault that uses one. Help moves behind its two buttons; the paragraph is gone.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="password" /></div></MacWindow>
        </Frame>
        <Frame label="C. Window not in front" caption="macOS only lets the sensor answer the app in front. When the window loses focus, Psss stops listening and dims the glyph; when it comes back, listening starts again by itself.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="inactive" /></div></MacWindow>
        </Frame>
        <Frame label="D. Not recognised" caption="After the system's failed attempts the password form opens with a plain line. Touch ID listens again when the window is next brought forward. Other problems (turned off, changed elsewhere, vault file missing) have their own messages, shown in this same spot.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="failed" /></div></MacWindow>
        </Frame>
        <Frame label="E. Touch ID not turned on" caption="No glyph. The password form shows straight away with the field focused.">
          <MacWindow><div className="lk-win"><Lock bio="none" state="ready" /></div></MacWindow>
        </Frame>
      </Frames>

      <Section title="2. iPhone and iPad" />
      <Frames>
        <Frame phone label="F. iPhone, Face ID" caption="Face ID starts by itself when the screen appears and each time the app returns to the front. “Use Password…” shows the form (click it).">
          <IPhone><Lock bio="face" state="ready" phone /></IPhone>
        </Frame>
        <Frame phone label="G. iPhone, password" caption="The keyboard comes up with the field focused. Face ID's glyph stays; tapping it tries again.">
          <IPhone><Lock bio="face" state="password" phone /></IPhone>
        </Frame>
        <Frame label="H. iPad" caption="The same screen, centred in the window. On an iPad with Touch ID in the top button, the glyph is Touch ID and it listens while Psss is in front, as on Mac.">
          <IPad><div className="lk-win ipad"><Lock bio="face" state="ready" /></div></IPad>
        </Frame>
      </Frames>

      <Section title="3. Choosing another vault">
        <p>The vault selector sits under the line that names the vault, on every lock screen and every device, even with one vault (its menu is where “Open Another Vault…” lives). It is a standard pop-up button: it shows the vault that will open, and its menu lists every available or remembered vault with a checkmark on the current one and where it lives in secondary text. After a separator, “Open Another Vault…” is the last item. Choosing a vault switches this screen to it at once; nothing is forgotten or opened until its own Touch ID, Face ID or password. Click the selector in any frame to try it.</p>
      </Section>
      <Frames>
        <Frame label="K. Mac, menu open" caption="Items say the vault name and, in secondary text, where it lives (iCloud Drive, On this Mac, or a folder). A vault that cannot be reached says why in the same place, in the accent colour (here “Not found”). It stays in the list so it can still be chosen, read about and forgotten.">
          <MacWindow><div className="lk-win" style={{ alignItems: 'start', paddingTop: 20, height: 560 }}><Lock bio="touch" state="ready" menu /></div></MacWindow>
        </Frame>
        <Frame phone label="L. iPhone, menu open" caption="The same menu, as a pull-down under the button.">
          <IPhone><Lock bio="face" state="ready" phone menu /></IPhone>
        </Frame>
        <Frame label="M. iPad, menu open" caption="The same on iPad.">
          <IPad><div className="lk-win ipad" style={{ alignItems: 'start', paddingTop: 30, height: 600 }}><Lock bio="face" state="ready" menu /></div></IPad>
        </Frame>
        <Frame label="N. Mac, vault not found" caption="Choosing “Archive” (or opening with it remembered) shows the password form and a line naming the vault, where its file was, and the two ways out: choose another vault here, or forget it under Forgot Password. Nothing is deleted by choosing it.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="ready" vault="Archive" /></div></MacWindow>
        </Frame>
        <Frame phone label="O. iPhone, vault not found" caption="The same on iPhone. The selector stays, so the way out is always one tap away.">
          <IPhone><Lock bio="face" state="ready" vault="Archive" phone /></IPhone>
        </Frame>
        <Frame label="P. iPad, vault not found" caption="The same on iPad.">
          <IPad><div className="lk-win ipad"><Lock bio="face" state="ready" vault="Archive" /></div></IPad>
        </Frame>

        <Frame label="Q. Mac, checking the password" caption="Progress sits under the field with no space held for it beforehand, so the form is not pushed down when idle: the field stays where it was, locked and dimmed, the notice appears under it, and Unlock, which dims, moves down by the notice's height; and the selector and help buttons stay. The same slot is used on iPhone and iPad.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="checking" /></div></MacWindow>
        </Frame>
        <Frame phone label="R. iPhone, checking the password" caption="Same place, under the field; the keyboard stays up.">
          <IPhone><Lock bio="face" state="checking" phone /></IPhone>
        </Frame>
        <Frame label="S. iPad, checking the password" caption="Same place.">
          <IPad><div className="lk-win ipad"><Lock bio="face" state="checking" /></div></IPad>
        </Frame>
      </Frames>

      <Section title="4. While the vault opens">
        <p>The icon is the logo's field. Locked, it is hidden: a p and three dots. Once the finger or the face is accepted, or the vault password has been entered, the dots become “sss” one after another while the vault is opened, and then the vault's list replaces the screen. The icon here is drawn by the app, flat, so that it can change; it is not the glass icon from the Home Screen or the Dock. In any frame above, click the glyph on the icon, or Unlock in the password form, to play it; the mock then returns to where it started.</p>
      </Section>
      <Frames>
        <Frame phone label="I. iPhone, opening" caption="The moment Face ID is asked or the password is entered. The line changes to “Opening your vault…” and the icon reads “psss”. It lasts only as long as opening the vault takes and adds no waiting of its own. With the password that is the second or so the password check needs. With Face ID or Touch ID the vault opens almost at once, so the switch may be cut short or not seen at all.">
          <IPhone><Lock bio="face" state="working" phone /></IPhone>
        </Frame>
        <Frame label="J. Mac, opening" caption="The same on Mac, and on iPad. A finger or face that is not recognised leaves the dots as they are. A wrong password is only known once it has been checked, so the name shows while it is checked and the dots come back together with the message. The sample vault's lock screen keeps the dots: its only wait is the system's prompt. When the app locks again the icon is back to the dots. With Reduce Motion the three letters change at once, with no stagger.">
          <MacWindow><div className="lk-win"><Lock bio="touch" state="working" /></div></MacWindow>
        </Frame>
      </Frames>

      <Section title="5. Decisions to approve" />
      <Decisions
        items={[
          {
            decision: <>While the vault password is checked, the progress (spinner, “Checking your vault password…”, the line that it takes a moment on purpose) shows under the password field, with no space held in advance, on every device: only Unlock and the help buttons move down while it shows.</>,
            rejected: <>progress above the field (the field jumped down on Mac and iPad) and progress elsewhere on iPhone.</>,
            why: <>The field the person just used must not move when Unlock is pressed. Space is not reserved for the notice (owner, 2026-11-24): holding it pushed Unlock too far down the idle screen. Face ID and Touch ID still use the “Opening your vault…” line, since there is no field then.</>,
          },
          {
            decision: <>A vault selector on every lock screen: a standard pop-up button under the line naming the vault, listing every available or remembered vault, ending with “Open Another Vault…”.</>,
            rejected: <>the selector above the title (it would sit before the thing it changes, and push the icon down); a segmented control or sidebar (does not scale past two or three vaults); keeping “Open Another Vault…” only inside “Forgot Password”, which hid the only way to switch vaults.</>,
            why: <>A person who is locked out of, or simply opened, the wrong vault needs the way out on the screen, not behind a help button for forgotten passwords. Below the line it reads as “this one will open — or change it”. It is shown even with one vault so “Open Another Vault…” is always findable. Apple's guidelines use a pop-up button for choosing one of several options and allow an action after a separator (as font and location pickers do); Passwords itself has no selector because it has one library, so this is a Psss addition, not a conflict.</>,
          },
          {
            decision: <>Menu items read “Name” plus where it lives in secondary text (iCloud Drive, On this Mac, or the folder). A missing or unreachable vault stays in the list with its problem (“Not found”, “Can't reach”) in that place.</>,
            why: <>Two vaults can share a name; the location tells them apart and answers “where does it live?”. Keeping a missing vault listed lets the person see it, read the message and forget it, instead of it vanishing.</>,
          },
          {
            decision: <>“Forgot Password” no longer has “Open Another Vault…”. It keeps the three things to try and “Forget This Vault…”.</>,
            why: <>One place for one action. Two entries for the same action would make the help page look like the place to switch vaults, which is what hid it.</>,
          },
          {
            decision: <>One calm lock screen on every device: icon with the biometric glyph, “Psss Is Locked”, one line naming the vault, and “Use Password…”.</>,
            rejected: <>a password-first screen with the help paragraph always shown; the system Touch ID dialog on Mac.</>,
            why: <>Most unlocks are a finger or a face. The password form is one click away and still always works, and help is behind labelled buttons, not hidden.</>,
          },
          {
            decision: <>Mac: Touch ID listens whenever the lock window is in front, using Apple's embedded authentication view (the glyph on the icon is that control). It stops when the window loses focus and starts again when it returns.</>,
            why: <>That is how Passwords behaves: touch the sensor and it opens. macOS only gives the sensor to an app that is asking, so Psss asks for as long as it is in front.</>,
          },
          {
            decision: <>iPhone and iPad: Face ID starts when the lock screen appears and each time the app comes to the front; the glyph retries.</>,
          },
          {
            decision: <>The line names the vault and says “vault password”, not “your password”.</>,
            why: <>“Your password” reads as the Mac login or Apple Account password. The vault password is a different thing, and “Help” explains it.</>,
          },
          {
            decision: <>The icon on the lock screen is the logo's field. It is hidden (p and three dots) while locked and shows the name (psss) while the vault opens, on every device.</>,
            rejected: <>an animated logo at the top left of the main screen on launch.</>,
            why: <>Hidden while locked and shown when opened is what the logo already means. It starts as soon as an attempt starts (password submitted, Face ID or Touch ID asked), not when the vault has opened, and nothing is ever held for it (owner, 2026-11-24): if the vault is open first, the list simply replaces the screen. Apple's guidance is to launch instantly and not to brand the launch, and the top left of the main screen is taken by the back button, the sidebar and the window controls.</>,
          },
          {
            decision: <>The key file row only appears for a vault that uses one, and moves under “Use Password…”.</>,
          },
        ]}
      />
      <Against>
        <li>None for the layout: it follows Passwords and standard controls. The Mac decision rests on two conditions: that the embedded Touch ID view answers without a dialog while the window is in front, and that the same unlock can read the saved key from the Keychain without a second prompt. If either fails, the fallback is the system Touch ID dialog, shown automatically when the window comes to the front.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-24', text: <>The selector is built. The vault-not-found line now reads as the app words it and the button there is “Locate Vault File…”; the progress notice uses the app's existing wording. Opening another vault keeps the one before it, so the old warning about Psss-created vaults is gone.</> },
          { date: '2026-11-24', text: <>“What Is This?” is now “Help” and comes after “Forgot Password”; neither label has a question mark (owner request). Replaces “What Is This?” before “Forgot Password?”.</> },
          { date: '2026-11-24', text: <>Password progress moved under the password field on every device, with no reserved space (frames Q to S); the field is shown locked and dimmed while it is checked. The selector gained the label “Unlock Vault:” before it on the same row. Replaces progress shown above the field on Mac and iPad and elsewhere on iPhone, which made the field jump.</> },
          { date: '2026-11-24', text: <>Added the vault selector under the line naming the vault, on every lock screen (frames K to P, section 3). “Open Another Vault…” moved out of “Forgot Password” into the selector's menu, because hiding it there left no visible way to switch vaults once one was set up. Replaces: a lock screen with no selector (dropped 2026-11-23 along with the always-visible help paragraph).</> },
          { date: '2026-11-24', text: <>The icon also plays the switch once by itself, right after the lock screen shows and each time the app returns to the front, then rests on “psss”. Nothing waits for it. Added because with no Face ID on the device nothing else started it when the app was reopened.</> },
          { date: '2026-11-24', text: <>The switch now starts when an attempt starts, including while Face ID or Touch ID is asked, so it has more time to play. A hold until 0.75 s was tried and taken out the same day: the owner never wants the screen held, so a fast unlock may still cut it short. It replaces “the icon changes only once the person is accepted”.</> },
          { date: '2026-11-24', text: <>The switch is built. Two captions were corrected to what the app does: a wrong password shows the name while it is checked and then the dots return (before, the page said the dots stay), and with Face ID or Touch ID the vault opens so fast that the switch could not be seen (changed the same day, see the first entry). The lock screen icon is now drawn by the app, flat, on every device; before, it was a picture of the icon.</> },
          { date: '2026-11-24', text: <>The icon is now drawn as the logo's field (see the Logo page) and shows the name while the vault opens; frames I and J and one decision were added. The owner approved the lock screen as the place for this. Before, the icon was a placeholder square with a P and did not change.</> },
          { date: '2026-11-23', text: <>Approved as drawn. It replaced a password-first lock screen that opened with a password field, an Unlock button, a key file row, a paragraph of help and two buttons, and that asked for Touch ID in a system dialog on Mac. The password form is now one click away and still always works, and help sits behind two labelled buttons. The line says “vault password” and names the vault, because “your password” reads as the Mac login or Apple Account password.</> },
        ]}
      />
    </Page>
  );
}
