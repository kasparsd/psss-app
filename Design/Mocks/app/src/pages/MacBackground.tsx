import { useState, type ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { Desk, Panel } from './MacMenuBar';
import { PopChevrons } from '../components/PopUpRow';
import './mbm.css';

const Switch = ({ on, label, onClick, off }: { on: boolean; label: string; onClick?: () => void; off?: boolean }) => (
  <button className={`mbm-sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={off} onClick={onClick}><i /></button>
);
const Row = ({ l, sub, children }: { l: string; sub?: ReactNode; children?: ReactNode }) => (
  <div className="mapfield"><div className="l">{l}{sub && <div className="s">{sub}</div>}</div>{children}</div>
);

type Login = 'on' | 'off' | 'approval';

/** The section added to Settings, General. The switches work, so the dependency between them can be tried. */
type Access = 'Allowed.' | 'Not asked yet.' | 'Not allowed in macOS.';
function SettingsPane({ bar: bar0 = true, dock: dock0 = true, login: login0 = 'on', chrome = 'Not asked yet.', zen = false, taken }: { bar?: boolean; dock?: boolean; login?: Login; chrome?: Access; zen?: boolean; taken?: boolean }) {
  const [bar, setBar] = useState(bar0);
  const [dock, setDock] = useState(dock0);
  const [login, setLogin] = useState<Login>(login0);
  const [page, setPage] = useState(true);
  return (
    <div className="mbm-win dt macui">
      <div className="mbm-wtitle"><span className="lights"><i /><i /><i /></span><strong>General</strong></div>
      <div className="mbm-wbody">
        <div className="maphelp">Menu bar and startup</div>
        <div className="icard">
          <Row l="Show Psss in the menu bar" sub={bar ? 'Search and copy from any app. Closing the window leaves Psss running there.' : 'Adds search and copy to the menu bar, reachable from any app.'}>
            <Switch on={bar} label="Show Psss in the menu bar" onClick={() => { if (bar) setDock(true); setBar(!bar); }} />
          </Row>
          <Row l="Keyboard shortcut" sub={taken && bar ? '⌃⌘P is used by another app. Choose another shortcut.' : 'Opens quick search from any app.'}><button className="mbtn popup" disabled={!bar}>{bar && !taken ? '⌃⌘P' : 'None'} <PopChevrons /></button></Row>
          <Row l="Open Psss at login" sub={login === 'approval' ? 'macOS is waiting for your approval in Login Items.' : 'Starts locked, with no window.'}>
            {login === 'approval' && <button className="mbtn">Open Login Items…</button>}
            <Switch on={login !== 'off'} label="Open Psss at login" onClick={() => setLogin(login === 'off' ? 'on' : 'off')} />
          </Row>
          <Row l="Keep Psss in the Dock" sub={bar ? 'When off, Psss is in the Dock and in ⌘Tab only while a window is open.' : 'Turn on the menu bar item first, so you can still reach Psss.'}>
            <Switch on={dock} off={!bar} label="Keep Psss in the Dock" onClick={() => setDock(!dock)} />
          </Row>
        </div>
        <div className="maphelp">Browsers</div>
        <div className="icard">
          <Row l="Show logins for the page" sub={!bar ? 'Turn on the menu bar item first.' : page ? 'Reads the front tab’s address when the menu bar panel opens. Nothing is stored.' : 'No browser’s page is read.'}>
            <Switch on={bar && page} off={!bar} label="Show logins for the page" onClick={() => setPage(!page)} />
          </Row>
          {[['Safari', 'Allowed.' as Access], ['Chrome', chrome]].map(([name, access]) => (
            <Row key={name} l={name} sub={bar && page ? access : 'Not read.'}>
              {bar && page && (access === 'Not asked yet.'
                ? <button className="mbtn">Allow in {name}…</button>
                : <button className="mbtn" title="Privacy &amp; Security, Automation">Open System Settings…</button>)}
            </Row>
          ))}
        </div>
        <div className="maphelp">Psss browser extension</div>
        <div className="icard">
          {['Chrome', 'Firefox', 'Zen'].map((name) => {
            const connected = name === 'Zen' && zen;
            return (
              <Row key={name} l={name} sub={connected ? 'Connected.' : 'Not set up.'}>
                {!connected && <button className="mbtn" aria-label={`Set up the extension in ${name}`} title={`Opens psss.app/#${name.toLowerCase()} in ${name}`}>Set Up…</button>}
              </Row>
            );
          })}
        </div>
        <div className="maphelp">The extension fills sign-ins. In Firefox and Zen it is also how logins for the page are found. Set it up here at any time.</div>
        <div className="maphelp">Quit Psss (⌘Q) stops it completely until you open it again{login === 'off' ? '' : ' or log in'}.</div>
      </div>
    </div>
  );
}

/** Shown once, over the main window, after the first vault is open. Nothing changes before a button is pressed. */
function SetupSheet({ bar: bar0 = true }: { bar?: boolean }) {
  const [bar, setBar] = useState(bar0);
  const [login, setLogin] = useState(true);
  const [dock, setDock] = useState(true);
  return (
    <div className="mbm-win dt macui">
      <div className="mbm-wtitle"><span className="lights"><i /><i /><i /></span><strong>Passwords</strong></div>
      <div className="mbm-sheetbg">
        <div className="mbm-sheet" role="dialog" aria-label="Keep Psss close">
          <div className="t">Keep Psss close</div>
          <div className="s">{bar ? 'Find and copy a login from any app with ⌃⌘P. Closing the window leaves Psss running in the menu bar.' : 'Without the menu bar item, closing the window leaves Psss in the Dock.'} You can change this in Settings › General.</div>
          <div className="icard">
            <Row l="Show in the menu bar"><Switch on={bar} label="Show in the menu bar" onClick={() => { if (bar) setDock(true); setBar(!bar); }} /></Row>
            <Row l="Open at login" sub="Starts locked, with no window."><Switch on={login} label="Open at login" onClick={() => setLogin(!login)} /></Row>
            <Row l="Keep in the Dock"><Switch on={dock} off={!bar} label="Keep in the Dock" onClick={() => setDock(!dock)} /></Row>
          </div>
          <div className="mbm-sheetfoot"><button className="mbtn">Not Now</button><button className="mbtn default">Use These Settings</button></div>
        </div>
      </div>
    </div>
  );
}

function LoginCard({ bar = true }: { bar?: boolean }) {
  return (
    <div className="mbm-win dt macui">
      <div className="mbm-wtitle"><span className="lights"><i /><i /><i /></span><strong>Passwords</strong></div>
      <div className="mbm-wbody">
        <div className="ser-card mbm-card" role="group" aria-label="Open Psss at login">
          <div><strong>Open Psss at login</strong><div>{bar ? 'Then ⌃⌘P and the menu bar work as soon as your Mac starts.' : 'Then Psss is ready as soon as your Mac starts.'} Psss starts locked.</div></div>
          <div className="mbm-row2"><button className="mbtn default">Open at Login</button><button className="mbtn">Don’t Ask Again</button></div>
        </div>
        <div className="mbm-head">All · 214 items</div>
      </div>
    </div>
  );
}

export function MacBackground() {
  return (
    <Page title="Mac: running in the background, Dock and login" status={<><strong>Approved by the owner, 2026-11-26, the Browsers and extension sections included. Not built.</strong> Companion page: <a href="#/menu-bar">menu bar quick search</a>.</>}>
      <Clarity items={[
        ['Which thing?', 'Mac settings for the menu bar item and its shortcut, opening at login, the Dock icon, and showing logins for the page in browsers.'],
        ['What must they give?', 'A yes. All three are optional. Psss changes nothing before a button or switch is pressed.'],
        ['What can go wrong?', 'macOS may hold the login item for approval, or the person removes it in System Settings. The switch shows what macOS reports, and Psss does not add it again.'],
        ['How do they leave?', 'Turn the switches off, or Quit. Nothing in the vault changes.'],
        ['What happens next?', 'Closing the window keeps Psss in the menu bar, locked on the same rules as today.'],
      ]} />

      <Section title="Asking" />
      <Frames>
        <Frame label="1. The sheet, once, after the first vault opens" caption="All three switches start on (Dock is how Mac apps behave already), and apply only with “Use These Settings”. Apple requires consent for opening at login. “Not Now” changes nothing.">
          <SetupSheet />
        </Frame>
        <Frame label="The sheet with the menu bar item off" caption="The words no longer promise the shortcut.">
          <SetupSheet bar={false} />
        </Frame>
        <Frame label="2. One later reminder" caption="Only if opening at login is still off, 7 days later, and never beside the AutoFill card. Either button ends it for good.">
          <LoginCard />
        </Frame>
      </Frames>

      <Section title="Settings › General" />
      <Frames>
        <Frame label="Everything on">
          <SettingsPane />
        </Frame>
        <Frame label="No Dock icon" caption="The “runs in the background” setup: menu bar only, until a window is opened.">
          <SettingsPane dock={false} />
        </Frame>
        <Frame label="Shortcut taken, Chrome refused, Zen connected">
          <SettingsPane taken chrome="Not allowed in macOS." zen />
        </Frame>
        <Frame label="Waiting for approval">
          <SettingsPane login="approval" />
        </Frame>
        <Frame label="Menu bar item off" caption="The Dock switch locks on, so Psss can never run with no visible way in.">
          <SettingsPane bar={false} login="off" />
        </Frame>
      </Frames>

      <Section title="After login" />
      <Frames>
        <Frame label="No window, no Touch ID prompt" caption="Only the menu bar item appears. The first time it is opened, it asks to unlock.">
          <Desk app="Finder" short />
        </Frame>
        <Frame label="First open">
          <Desk app="Finder" open><Panel front="Slack" locked /></Desk>
        </Frame>
      </Frames>

      <Section title="Rules" />
      <div className="prose">
        <table className="cmp">
          <thead><tr><th>Event</th><th>What happens</th></tr></thead>
          <tbody>
            <tr><td>Close the last window (menu bar on)</td><td>Psss keeps running. With the Dock switch off, the Dock icon goes.</td></tr>
            <tr><td>Close the last window (menu bar off)</td><td>As today: Psss stays in the Dock.</td></tr>
            <tr><td>Open Psss again from Spotlight, Finder or the Dock</td><td>The window opens. This is the way in if macOS hides the menu bar item (a full menu bar, or System Settings › Menu Bar).</td></tr>
            <tr><td>Sleep, display sleep, screen lock, or idle for the lock time</td><td>Every vault locks, with or without a window. The panel closes.</td></tr>
            <tr><td>Another app comes to the front, while only the panel was used</td><td>The lock time keeps counting from the last key or click in Psss.</td></tr>
            <tr><td>Open the panel after the lock time passed away from Psss</td><td>The vault locks before the panel draws. With “Immediately”, any time in another app counts.</td></tr>
            <tr><td>Quit (⌘Q, or Quit in the panel)</td><td>Psss ends. No helper keeps running.</td></tr>
          </tbody>
        </table>
      </div>

      <Against>
        <li>Apple suggests offering the menu bar item during setup and leaving the choice to the person; the sheet does that. Switches that start on are a recommendation to weigh: the stricter choice is all off.</li>
        <li>An app with no Dock icon has no app menu while no window is open. That is why the Dock icon returns with a window, so ⌘L, Settings and Edit commands keep working.</li>
      </Against>

      <Section title="Decisions" />
      <Decisions items={[
        { decision: 'The Dock choice is “keep it in the Dock” or “only while a window is open”.', rejected: 'Never in the Dock.', why: 'A window without menus loses standard shortcuts.' },
        { decision: 'Quit really quits.', rejected: '⌘Q hides to the menu bar.', why: 'It would not do what it says, and App Review forbids processes that outlive Quit without consent.' },
        { decision: 'The login item is the app itself, registered only on a click.', rejected: 'A separate helper app; registering on first launch.' },
        { decision: 'Lock timing is unchanged; opening the panel counts as coming back, so the same check runs.' },
      ]} />

      <History entries={[{ date: '2026-11-26', text: 'Owner approved the Browsers section, the extension rows and Open Psss at login starting on in the sheet.' }, { date: '2026-11-26', text: 'The extension has its own rows for Chrome, Firefox and Zen, there also when page reading is off (replacing a Zen row that disappeared with it, so Not Now on the panel’s card had no way back).' }, { date: '2026-11-26', text: 'Review findings: the sheet says Psss keeps running and stops promising the shortcut when the menu bar item is off; Browsers gained Chrome, its states and the menu bar off case; a taken shortcut is shown; opening the panel runs the lock check (replacing “locking rules do not change”).' }, { date: '2026-11-26', text: 'Owner: Settings › General gained a Browsers section (page logins and extension setup, also the way back after Not Now), and the menu bar panel lost its Settings tab. These two changes are not approved yet.' }, { date: '2026-11-26', text: 'Approved with phase 1. The menu bar panel it opens gained a vault switcher and tabs, one of which repeats the switches used most; see the menu bar page.' }, { date: '2026-11-26', text: 'First proposal, after the owner asked for background running without a Dock icon and a prompt to open at login.' }]} />
    </Page>
  );
}
