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

function Choices({ mac }: { mac?: boolean }) {
  // [iPhone and iPad label, Mac label]
  const list: [string, string][] = [
    ['Create a vault', 'Create a Vault…'],
    ['Open a vault file', 'Open a Vault File…'],
    ['Import from Apple Passwords', 'Import from Apple Passwords…'],
    ['Import from 1Password', 'Import from 1Password…'],
    ['Try a sample vault', 'Try a Sample Vault'],
  ];
  return (
    <div className={`wl-choices${mac ? ' mac' : ''}`}>
      {list.map(([touch, desk], i) => mac
        ? <button key={touch} className={`mbtn${i === 0 ? ' default' : ''}`}>{desk}</button>
        : <button key={touch} className={`btn wide${i === 0 ? ' pri' : ''}`}>{touch}</button>)}
    </div>
  );
}

function Welcome({ size = 88, mac }: { size?: number; mac?: boolean }) {
  return (
    <div className={`wl${mac ? ' mac' : ''}`}>
      <WelcomeIcon size={size} />
      <div className="wl-title">Psss for your secrets</div>
      <div className="wl-line">The quickest storage and autofill for your logins and passwords.</div>
      <Choices mac={mac} />
    </div>
  );
}

export function WelcomePage() {
  return (
    <Page
      title="Onboarding: the first screen"
      status={<><strong>Approved by the owner, 2026-11-26; built.</strong> New heading and line under it, and no note under the buttons.</>}
    >
      <Clarity
        items={[
          ['What is this?', 'The first screen of a new install: no vault yet. It says what Psss is for and offers the ways to start.'],
          ['Where are things kept, and who holds the key?', 'Not said here. Create a vault says what is made, where it is kept and that Psss cannot recover the password, before anything is committed.'],
          ['What happens next?', 'Each button starts its flow (create, open a file, import, sample). Importing from 1Password is not built yet and says so.'],
        ]}
      />

      <Section title="The screen">
        <p>The app icon, the heading, one line and five buttons, centred in the window both ways. Tap the icon to see it type the name. On the Mac the body is the window’s only content until a vault exists.</p>
      </Section>
      <Frames>
        <Frame phone label="A · iPhone" caption="Create a vault is the one filled button.">
          <IPhone><Welcome /></IPhone>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="B · iPad" caption="The column is centred across and down, same icon and words.">
          <IPad><div className="wl-ipad"><Welcome /></div></IPad>
        </Frame>
        <Frame label="C · Mac" caption="Create a Vault… is the default button (Return).">
          <MacWindow><div className="wl-mac macui"><Welcome mac size={76} /></div></MacWindow>
        </Frame>
      </Frames>

      <Decisions
        items={[
          { decision: 'Heading “Psss for your secrets”; under it “The quickest storage and autofill for your logins and passwords.”', rejected: '“Welcome to Psss” with “Passwords, passkeys and verification codes that stay on your devices.”; a whisper line, a question the buttons answer, the landing page’s slogan and a signed note.', why: 'Owner: “Welcome” sounds impersonal. The old line was also not the whole truth, since a new vault is kept in iCloud Drive by default. “Quickest” is a claim nothing has measured yet; check it before release.' },
          { decision: 'No note under the buttons about exports from other apps.', rejected: '“Exports from other apps are not encrypted. Delete the file after importing.”', why: 'Owner: not needed on the first screen.' },
          { decision: 'The app icon at 88 pt (76 pt on the Mac) opens on “psss” and hides it to p and three dots; a tap shows the name again. Butter in light and dark.', rejected: 'The key symbol; resting on the name; a loop.', why: 'Reduce Motion changes the letters at once.' },
          { decision: 'System font, system blue buttons, a plain background.', rejected: 'The wordmark as the title; butter-coloured buttons; the cover’s dots behind the screen.', why: 'The brand lives in the mark and the words. Five buttons need a plain ground.' },
        ]}
      />
      <History
        entries={[
          { date: '2026-11-26', text: <>Owner: “is” dropped, so the heading is “Psss for your secrets”. The screen is centred up and down as well as across, after the owner saw it sitting at the top on iPad.</> },
          { date: '2026-11-26', text: <>Owner: “Welcome” sounds very impersonal. Chosen and built: the heading “Psss for your secrets” with a new line under it, and the note about unencrypted exports is removed. Replaces “Welcome to Psss”. Weighed and not taken: “Psss, keep this between us.”, “Where are your passwords now?” with buttons as answers (recommended at the time), “Secure passwords for the rest of us.” and a signed note from the maker. The key-symbol comparison frame is removed, since the icon is built.</> },
          { date: '2026-11-25', text: <>Open a vault file no longer asks for the file’s password in the add flow: file picker, then the vault is added and its unlock screen is shown (drawn on <a href="#/vault-switcher">Vaults</a>, section 7). No frame here changes; New Vault still sets a password and Import is unchanged.</> },
          { date: '2026-11-25', text: <>Owner: the icon is butter in every colour scheme. Replaces charcoal in dark mode; the dark frame (C) is removed, since the icon no longer changes. The lock screen still draws charcoal in dark mode.</> },
          { date: '2026-11-25', text: <>Owner: rest on the dots, not the name. The icon opens on “psss”, hides it to p and three dots, and a tap shows the name again, as a hint to play with it. Replaces typing “psss” once and resting on the name.</> },
          { date: '2026-11-25', text: <>New page. Proposal: the welcome screen’s key symbol is replaced by the Psss app icon (as on the lock screen), which types “psss” once. Words and buttons unchanged. The Mac frame uses Mac push buttons.</> },
        ]}
      />
    </Page>
  );
}
