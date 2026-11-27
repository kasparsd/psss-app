import type { Pictures } from '../Gallery';
import type { Topic, TopicGroup } from '../Topics';
import { Desk, Panel as LibraryPanel, type Front, type PanelProps } from '../../pages/MacMenuBar';
import './menuBar.css';

/**
 * Pictures for the group "From the Mac menu bar": the panel under the Psss
 * item, drawn on the right end of a Mac screen with the app in front behind it.
 *
 * Drawn from `pages/MacMenuBar.tsx`. The screen (`Desk`) and the panel
 * (`Panel`, with the props the mock page's own frames pass) are imported. Only
 * `FrontApp`, the app window behind the panel, is copied (the page does not
 * export it), without its props for a browser address. `Panel` keeps its own
 * state in the library, but every picture here only gives it starting props and
 * is rendered once, so no picture holds state or a handler of its own.
 * The values the generator shows are fixed (`Panel` below), so every build of the
 * page is identical.
 */

/**
 * The library's generator draws its sample values with `crypto.getRandomValues`
 * when the panel first renders. The panel is called here, not rendered as a
 * child, so that draw happens inside this call: for its length a fixed
 * pseudo-random sequence stands in for `getRandomValues`, then the real one is
 * put back. Nothing is kept between renders, so every render gives the same
 * values (mulberry32, restarted at the same seed each time).
 */
function Panel(p: PanelProps) {
  const c = globalThis.crypto;
  const real = c.getRandomValues;
  let a = 0x5eed1234;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
  Object.defineProperty(c, 'getRandomValues', {
    configurable: true, writable: true,
    value: (arr: ArrayBufferView) => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i += 4) { const v = next(); for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] = (v >>> (8 * j)) & 255; }
      return arr;
    },
  });
  try { return LibraryPanel(p); } finally {
    Object.defineProperty(c, 'getRandomValues', { configurable: true, writable: true, value: real });
  }
}

/** The app in front, behind the panel: a browser page for a sign-in or a terminal asking for a password. */
function FrontApp({ app, site }: { app: Front; site: string }) {
  if (app === 'Terminal') {
    return <div className="mbm-app term" aria-hidden><div>sam@mac ~ % ssh deploy@build.example</div><div>deploy@build.example’s password: ▌</div></div>;
  }
  return (
    <div className="mbm-app" aria-hidden>
      <div className="mbm-url">{app === 'Slack' ? 'Slack · Sign in to your workspace' : `${site}/sign-in`}</div>
      <div className="mbm-form"><div>Email or username</div><i /><div>Password</div><i /></div>
    </div>
  );
}

/** A Mac screen cropped to the right end of the menu bar with the panel open under it. `mod` names a small change of the crop, see menuBar.css. */
function Still({ mod, ...p }: PanelProps & { mod?: 'scrolled' | 'top' }) {
  const front = p.front ?? 'Safari';
  return (
    <div className={`lpm-crop${mod ? ` lpm-${mod}` : ''}`}>
      <Desk app={front} open front={<FrontApp app={front} site={p.site ?? 'gitforge.example'} />}><Panel {...p} /></Desk>
    </div>
  );
}

/** The same screen with the panel closed: just the Psss item in the menu bar, ringed. */
function Closed() {
  return (
    <div className="lpm-crop lpm-closed">
      <Desk app="Safari" front={<FrontApp app="Safari" site="gitforge.example" />} />
    </div>
  );
}

const findPictures: Pictures = {
  mac: [
    { caption: 'Psss sits in the menu bar, over whatever you are doing.', screen: <Closed /> },
    { caption: 'The panel opens on the logins for the page in front, the first one chosen.', screen: <Still /> },
    { caption: 'A login’s page lists its values, each with a copy icon.', screen: <Still detail={201} front="Slack" /> },
    { caption: 'The password is copied, and the panel says when the clipboard clears.', screen: <Still detail={201} front="Slack" copiedNow="Password copied. Clears in 60 s." /> },
  ],
};

const generatePictures: Pictures = {
  mac: [
    { caption: 'The generator is a tab: a strong password, random characters or words.', screen: <Still tab="generate" /> },
    { caption: 'With the vault locked, the generator still works and shows nothing from it.', screen: <Still tab="generate" locked /> },
    { caption: 'Further down, a PIN, or a key in hexadecimal or Base64.', screen: <Still tab="generate" mod="scrolled" /> },
  ],
};

const savePictures: Pictures = {
  mac: [
    { caption: 'A new login, with the vault it goes into named under the fields.', screen: <Still tab="new" addKind="login" /> },
    { caption: 'The same site and username already exist: replace the password, or keep both.', screen: <Still tab="new" draft={{ web: 'https://gitforge.example/login', user: 'sam.r', password: 'new-orchid-42' }} /> },
    { caption: 'Saved, and the new password can be copied at once.', screen: <Still tab="new" saved /> },
  ],
};

const keepOnTopPictures: Pictures = {
  mac: [
    { caption: 'On a login’s page, one button keeps the panel in front.', screen: <Still detail={201} front="Slack" mod="top" /> },
    { caption: 'With it on, the panel stays over another app while you work there.', screen: <Still detail={202} front="Terminal" top mod="top" /> },
    { caption: 'A value is copied, and the panel is still there for the next one.', screen: <Still detail={202} front="Terminal" top copiedNow="Password copied. Clears in 60 s." mod="top" /> },
    { caption: 'If the vault locks, nothing from it stays on screen.', screen: <Still locked front="Terminal" top mod="top" /> },
  ],
};

const note = 'Approved 2026-11-26, not built. Only a debug prototype exists.';

export function menuBarTopics(): Topic[] {
  return [
    {
      id: 'menu-bar-find',
      quote: 'I need one password. Not the whole app.',
      elsewhere: 'Looking up one value means switching to the app, finding its window and searching.',
      saves: 'Search from the menu bar over whatever you are doing, with the logins for the page in front first.',
      title: 'Finding a login from the menu bar',
      status: 'coming',
      statusNote: note,
      pictures: findPictures,
    },
    {
      id: 'menu-bar-generate',
      quote: 'I need a new password right now.',
      elsewhere: 'A generator inside the app means switching to it, making a password, copying it and switching back.',
      saves: 'Generate from the menu bar, even while the vault is locked.',
      title: 'Generating a password from the menu bar',
      status: 'coming',
      statusNote: note,
      pictures: generatePictures,
    },
    {
      id: 'menu-bar-save',
      quote: 'I signed up and never saved the login.',
      elsewhere: 'A login made in a hurry is easy to lose when saving it means going to another window first.',
      saves: 'Save a login from the menu bar. It says which vault gets it, and asks before replacing one.',
      title: 'Saving a login from the menu bar',
      status: 'coming',
      statusNote: note,
      pictures: savePictures,
    },
    {
      id: 'menu-bar-keep-on-top',
      quote: 'I have to copy several things, one after another.',
      elsewhere: 'A pop-up that closes whenever you click elsewhere has to be reopened for every value you copy.',
      saves: 'Keep on Top holds the panel above other windows while you copy and paste in turn.',
      title: 'Keeping the menu bar panel on top',
      status: 'coming',
      statusNote: note,
      pictures: keepOnTopPictures,
    },
  ];
}

export function menuBarGroup(): TopicGroup {
  return {
    id: 'from-the-menu-bar',
    heading: 'From the Mac menu bar',
    lead: 'A Psss item in the menu bar, or ⌃⌘P from any app.',
    topics: menuBarTopics(),
  };
}
