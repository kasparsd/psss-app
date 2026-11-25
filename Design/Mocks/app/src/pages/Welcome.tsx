import { useEffect, useState } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { iconU, Mark } from './Logo';
import './Welcome.css';

/**
 * The app icon as the lock screen draws it (`LockAppIcon` in the app): butter in light and dark mode.
 * It appears showing the name, “psss”, and a moment later hides it as a password field would: p and three dots, where it rests.
 * Tapping or clicking it types “psss” again, holds it briefly and hides it again, as a hint that the icon is the field.
 */
function WelcomeIcon({ size }: { size: number }) {
  const [shown, setShown] = useState(true);
  const [run, setRun] = useState(0);
  useEffect(() => {
    // On load: psss, then dots. On each tap: dots → psss → dots.
    const reveal = run === 0 ? undefined : setTimeout(() => setShown(true), 0);
    const hide = setTimeout(() => setShown(false), run === 0 ? 900 : 1300);
    return () => { if (reveal) clearTimeout(reveal); clearTimeout(hide); };
  }, [run]);
  return (
    <button className="wl-icon lg-appicon" style={{ width: size, height: size }} onClick={() => setRun(run + 1)} aria-label="Psss" title="Tap to show the name">
      <Mark u={iconU(size)} mask={!shown} fade icon />
    </button>
  );
}

/** The key symbol the app shows today. */
const KeyGlyph = () => (
  <svg className="wl-key" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="7" r="5" /><circle cx="12" cy="6" r="1.3" fill="var(--bg)" />
    <path d="M10.6 11h2.8v2l1.4 1.2-1.4 1.2 1.4 1.2-2.8 2.8-1.4-1.4z" />
  </svg>
);

const Choices = () => (
  <div className="wl-choices">
    <button className="btn pri wide">+ Create a vault</button>
    <button className="btn wide">Open a vault file</button>
    <button className="btn wide">Import from Apple Passwords</button>
    <button className="btn wide">Import from 1Password</button>
    <button className="btn wide">Try a sample vault</button>
    <div className="wl-foot">Exports from other apps are not encrypted. Delete the file after importing.</div>
  </div>
);

const MacChoices = () => (
  <div className="wl-choices mac">
    <button className="mbtn default">Create a Vault…</button>
    <button className="mbtn">Open a Vault File…</button>
    <button className="mbtn">Import from Apple Passwords…</button>
    <button className="mbtn">Import from 1Password…</button>
    <button className="mbtn">Try a Sample Vault</button>
    <div className="wl-foot">Exports from other apps are not encrypted. Delete the file after importing.</div>
  </div>
);

/** The welcome screen body. `today` draws the key symbol the app has now. */
function Welcome({ today, size = 88, mac }: { today?: boolean; size?: number; mac?: boolean }) {
  return (
    <div className={`wl${mac ? ' mac' : ''}`}>
      {today ? <KeyGlyph /> : <WelcomeIcon size={size} />}
      <div className="wl-title">Welcome to Psss</div>
      <div className="wl-line">Passwords, passkeys and verification codes that stay on your devices.</div>
      {mac ? <MacChoices /> : <Choices />}
    </div>
  );
}

export function WelcomePage() {
  return (
    <Page
      title="Welcome: the first screen"
      status={<><strong>Proposal (2026-11-25), not built.</strong> Starts from the owner’s question how to add Psss branding to the onboarding screen. Only the mark changes; words, buttons and order stay as built today.</>}
    >
      <Clarity
        items={[
          ['What is this?', 'The first screen of a new install: no vault yet. It says what Psss is and offers the ways to start.'],
          ['What changes?', 'The blue key symbol becomes the Psss app icon, the same one the lock screen shows, so the first screen and every unlock look like one app.'],
          ['What happens next?', 'Each button starts its flow (create, open a file, import, sample). Open a vault file picks the file, adds the vault and shows its unlock screen, “Unlock [name]”, with the password field; the password is not asked inside the add flow (frames on Vaults, section 7).'],
        ]}
      />

      <Section title="1. Today and proposed (iPhone)">
        <p>Today the screen shows a generic key symbol in the accent colour; nothing on it is Psss’s own. The proposal puts the app icon there, drawn by the app as on the lock screen: it appears showing the name, “psss”, and a moment later hides it as a password field would, resting on the p and three dots. Tapping it types the name again and hides it, a small hint that the icon is a password field. Click the icons to try it.</p>
      </Section>
      <Frames>
        <Frame phone label="A · Today" caption="The key symbol in the accent colour. Correct, but it could be any password app.">
          <IPhone><Welcome today /></IPhone>
        </Frame>
        <Frame phone label="B · Proposed" caption="The app icon, butter in light and dark mode, 88 pt. It opens on “psss” and hides it to p and three dots; a tap shows the name again. With Reduce Motion the letters change at once.">
          <IPhone><Welcome /></IPhone>
        </Frame>
      </Frames>

      <Section title="2. iPad and Mac">
        <p>The same body, centred. On the Mac the buttons are standard push buttons with the default button first, and the titles use title case as Mac buttons do.</p>
      </Section>
      <Frames>
        <Frame label="D · iPad" caption="Centred column, same icon and words.">
          <IPad><div className="wl-ipad"><Welcome /></div></IPad>
        </Frame>
        <Frame label="E · Mac" caption="The window’s only content until a vault exists. Create a Vault… is the default button (Return).">
          <MacWindow><div className="wl-mac macui"><Welcome mac size={76} /></div></MacWindow>
        </Frame>
      </Frames>

      <Decisions
        items={[
          { decision: 'The app icon replaces the key symbol, drawn by the app (LockAppIcon), at 88 pt on iPhone and iPad and 76 pt on the Mac.', rejected: 'The key symbol.', why: 'The mark is the brand; the lock screen already shows it, so the first screen matches every unlock.' },
          { decision: 'It opens on “psss” and hides it to p and three dots, where it rests; a tap types the name again, holds it about a second and hides it.', rejected: 'Resting on the name; a still icon; a loop.', why: 'Hiding the name is what a password field does, so the first thing Psss shows is its idea; ending on the dots invites a tap. The tap does nothing else, so nothing is lost if no one finds it. VoiceOver reads it as an image named Psss, with no button. Reduce Motion changes the letters at once.' },
          { decision: 'The icon is butter in light and dark mode.', rejected: 'Charcoal in dark mode, as the lock screen draws it today.', why: 'Owner: the bright yellow is the brand; one colour in every look.' },
          { decision: 'Title stays “Welcome to Psss” in the system font; buttons stay system blue.', rejected: 'The wordmark as the title; butter-coloured buttons.', why: 'Product rules: the brand lives in the mark, not in a custom tint or font. A system-font title reads well with VoiceOver and at large text sizes.' },
        ]}
      />
      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>Open a vault file no longer asks for the file’s password in the add flow: file picker, then the vault is added and its unlock screen is shown (drawn on <a href="#/vault-switcher">Vaults</a>, section 7). No frame here changes; New Vault still sets a password and Import is unchanged.</> },
          { date: '2026-11-25', text: <>Owner: the icon is butter in every colour scheme. Replaces charcoal in dark mode; the dark frame (C) is removed, since the icon no longer changes. The lock screen still draws charcoal in dark mode.</> },
          { date: '2026-11-25', text: <>Owner: rest on the dots, not the name. The icon opens on “psss”, hides it to p and three dots, and a tap shows the name again, as a hint to play with it. Replaces typing “psss” once and resting on the name.</> },
          { date: '2026-11-25', text: <>New page. Proposal: the welcome screen’s key symbol is replaced by the Psss app icon (as on the lock screen), which types “psss” once. Words and buttons unchanged. The Mac frame uses Mac push buttons.</> },
        ]}
      />
    </Page>
  );
}
