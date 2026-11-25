import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone } from '../components/devices';
import { ListRow } from '../components/Rows';
import { items } from '../data';
import { PhoneItem } from '../screens/PhoneScreens';
import { Lock } from './UnlockScreen';
import { iconU, Mark } from './Logo';
import './AppSwitcher.css';

/**
 * The cover: charcoal filling the window with the logo mark alone in butter (the field outline with p and three dots, resting state),
 * no tile behind it. Nothing from the vault shows through, and it is the same in light and dark mode.
 */
function Cover({ size = 120, flat }: { size?: number; flat?: boolean }) {
  return (
    <div className={`as-cover${flat ? ' flat' : ''}`} role="img" aria-label="Psss cover">
      <Mark u={iconU(size)} mask icon />
    </div>
  );
}

/** The All list as the person left it. */
function ListPhone({ cover, over }: { cover?: boolean; over?: ReactNode }) {
  return (
    <IPhone tab="all">
      <div className="nav"><div /><div className="mid" /><span className="btn glass">+ Add</span></div>
      <div className="lt"><div className="t">All <span className="s" style={{ fontWeight: 400 }}>· 214 items</span></div></div>
      <div className="pbody tabpad">
        <div className="grp">{items.slice(0, 6).map((it) => <ListRow key={it.id} item={it} />)}</div>
      </div>
      {cover && <Cover />}
      {over}
    </IPhone>
  );
}

/** The app switcher: a wallpaper and Psss's card, which shows whatever was on screen when the app left. */
function Switcher({ cover }: { cover?: boolean }) {
  return (
    <div className="as-wall dt">
      <div className="as-label"><span className="lg-appicon" style={{ width: 24, height: 24 }}><Mark u={iconU(24)} mask icon /></span>Psss</div>
      <div className="as-card">
        {cover ? <Cover size={80} flat /> : <div className="as-scale"><ListPhone cover={cover} /></div>}
      </div>
      <div className="as-hint"><i /></div>
    </div>
  );
}

const ControlCenter = () => (
  <div className="as-cc" aria-label="Control Center">
    <div className="row"><div className="tile" /><div className="tile" /></div>
    <div className="row"><div className="tile sm" /><div className="tile sm" /></div>
    <div className="row"><div className="tile" /><div className="tile" /></div>
  </div>
);

export function AppSwitcher() {
  return (
    <Page
      title="Leaving and coming back"
      status={<><strong>Proposal (2026-11-25), not built.</strong> The cover is the butter mark alone on charcoal, no tile (owner’s choice). Found on a real iPhone 17: coming back to Psss briefly shows the list, then the unlock screen, and after unlocking the place and item are lost. The app switcher also shows item names to anyone looking. The proposal covers the window the moment Psss stops being the active app, decides the lock before the first frame on return, and reopens the place and item you had. The owner chooses between E1 and E2 (section 5); the page recommends E1.</>}
    >
      <Clarity
        intro={<p>This is what a person sees when they leave Psss and come back: a plain charcoal cover with the Psss mark instead of their items, then either the list where they were or the unlock screen.</p>}
        items={[
          ['What is this?', 'A cover over the window while Psss is not the app in front, and a faster, safer return. No new screen to learn.'],
          ['What is shown?', 'When Psss is not in front (app switcher, Home, another app), its card shows no item names, no field values and no readable text. The cover is charcoal with the Psss mark in butter, the same in light and dark mode. Nothing of the vault shows through.'],
          ['Where is the “where you were” note kept?', 'In memory only: the vault, the place and the item you had open. It never holds a field value or the search text, it is never written to disk, and it is gone when the app quits or the vault is removed. Locking forgets nothing else: the note is all that survives.'],
          ['Who holds the key?', 'The vault password, or Face ID or Touch ID if turned on, exactly as today. The cover and the note give no one a way in; the note only says where to go after you unlock.'],
          ['How do they leave?', 'Nothing to dismiss: the cover lifts by itself when Psss is in front again. A person who does not want to be taken back to the item opens another place.'],
          ['What happens next?', 'Back within the lock time (default 1 minute): the list or item as you left it. After it: the unlock screen first, then, once unlocked, the same item.'],
        ]}
      />

      <Section title="A. The cover: what the app switcher shows">
        <p>iOS takes a picture of the window when the app leaves, to show in the app switcher. Today Psss puts nothing over its content first, so the picture is the item list. The proposal covers the window the moment Psss stops being the active app, and the system then takes its picture of the cover: charcoal filling the window, with the logo mark alone in butter at the centre (the field with the p and three dots). There is no app-icon tile behind it, because the app switcher already shows the app icon above each card. It is the same in light and dark mode.</p>
      </Section>
      <Frames>
        <Frame label="A1 · Today: the app switcher" phone caption="Psss’s card shows the list with item names to anyone who looks over a shoulder. This is the problem."><Switcher /></Frame>
        <Frame label="A2 · The cover: the app switcher" phone caption="Charcoal and the butter mark, no text, no items, nothing of the layout. The app icon above the card already says whose card it is."><Switcher cover /></Frame>
        <Frame label="A3 · The cover at full size" phone caption="The cover fills the window edge to edge, in light and dark mode alike. It has no controls and says nothing."><ListPhone cover /></Frame>
      </Frames>

      <Section title="B. Coming back within the lock time">
        <p>Back within the lock time (default 1 minute), the cover lifts and the list is exactly where you left it, with the same place, scroll position and open item. Nothing was locked, so nothing is asked.</p>
      </Section>
      <Frames>
        <Frame label="B1 · Returning: the cover" phone caption="Psss is in front again, and the cover is still there for this one moment."><ListPhone cover /></Frame>
        <Frame label="B2 · The cover has lifted" phone caption="The Gitforge page you had open, as you left it. No unlock screen."><PhoneItem id={1} /></Frame>
      </Frames>

      <Section title="C. Coming back after the lock time">
        <p>After the lock time the first thing shown is the unlock screen, never the list first. The lock is decided before the first frame is drawn, so the list is never seen, not even for an instant. The system’s Face ID prompt appears by itself, as on a normal unlock.</p>
      </Section>
      <Frames>
        <Frame label="C1 · Returning: the cover" phone caption="The same cover as B1. It stays until Psss knows whether the vault is locked; the list behind it is never uncovered in this case."><ListPhone cover /></Frame>
        <Frame label="C2 · The unlock screen" phone caption="The screen as built: the vault’s name in the title (“Unlock Passwords”), a line, the Vault row, the password field, Unlock, then Use Face ID, with Forgot Password and Help under it. Face ID starts by itself. The list was never drawn."><IPhone><Lock bio="face" state="ready" vault="Passwords" phone title="Unlock Passwords" /></IPhone></Frame>
      </Frames>

      <Section title="D. After unlocking: back to the place and item">
        <p>Unlocking drops you where you were, not at the top of the list. Psss keeps a note in memory only: the vault, the place and the item that were open. It never holds a field value or the search text, and it is never saved to disk.</p>
      </Section>
      <Frames>
        <Frame label="D1 · After unlocking" phone caption="The Gitforge page reopens, with the fields hidden as usual. The search you had typed is not restored."><PhoneItem id={1} /></Frame>
        <Frame label="D2 · If the item was deleted meanwhile" phone caption="You land on its place, here All, with no message. Nothing is shown that is no longer there."><ListPhone /></Frame>
      </Frames>

      <Section title="E. Control Center, notifications and calls: the owner chooses">
        <p>iOS takes the app switcher’s picture when the app becomes inactive, which is slightly before it is in the background: when you swipe up to the switcher, and also when you pull down Control Center or the notifications, or a call banner appears. Two ways to handle those pull-downs:</p>
        <div className="as-vs">
          <div><strong>E1 · Cover on every pull-down (recommended).</strong> The cover appears whenever Psss stops being the active app, including Control Center, the notification pull-down and a call banner. The picture the system takes is always the cover. The cost: a brief charcoal flash each time, and no seeing the list behind a pull-down.</div>
          <div><strong>E2 · Cover only on leaving.</strong> The cover appears only when you really leave: app switcher, Home, another app. Pull-downs show the list behind them. The cost: if the system takes its picture at the start of a swipe up, one frame of the list can slip into it, which is exactly the leak this page is closing.</div>
        </div>
        <p>For a password app, E1 is safer, and a charcoal flash is a small price. E2 looks calmer but cannot promise that the picture never shows items.</p>
      </Section>
      <Frames>
        <Frame label="E1 · Control Center, with the cover" phone caption="The cover is behind Control Center. Nothing from the vault shows through."><ListPhone cover over={<ControlCenter />} /></Frame>
        <Frame label="E2 · Control Center, without the cover" phone caption="The list shows behind Control Center: calmer, but this is also what a picture taken at that moment would hold."><ListPhone over={<ControlCenter />} /></Frame>
      </Frames>

      <Section title="F. iPad: each window covers itself">
        <p>With Split View or Stage Manager, each Psss window covers itself when its scene stops being active. Two windows, two covers, each at its own size.</p>
      </Section>
      <Frames>
        <Frame label="F · iPad, two windows" caption="A Psss window beside another app (here two Psss windows): each one is covered while it is not the active one."><IPad><div className="as-pad"><div className="pane"><Cover size={140} flat /></div><div className="pane"><Cover size={140} flat /></div></div></IPad></Frame>
      </Frames>

      <Section title="G. Mac">
        <p>The Mac has no app-switcher pictures, so no cover is drawn there; it already locks on sleep and when the screen locks.</p>
      </Section>

      <Section title="How it’s built">
        <p>The cover is an ordinary SwiftUI view (the charcoal colour with the mark drawn as a shape, the same drawing as the app’s <code>LockAppIcon</code> mark), laid over the window when the scene stops being active. It is drawn live at whatever size the window is, so there are no images per device or aspect ratio, and iPad windows of any size work. The system takes its picture of whatever is on screen at that moment, which is now the cover. On return, Psss decides whether the lock time has passed before it draws anything, and shows either the list or the unlock screen. The place and item note is a small value kept in memory while the app runs; locking drops the decrypted vault but not the note, and unlocking reads it to reopen the item.</p>
      </Section>

      <Decisions
        items={[
          { decision: <><strong>Cover on leaving.</strong> A solid cover over the window the moment Psss stops being the active app; no word readable at any size. It is a live view and needs no images per device.</>, rejected: <>an unblurred or lightly blurred copy of the list; a cover with the vault name or the word “Locked”.</>, why: <>The app switcher’s picture can be seen by anyone looking, so it must hold no readable item or name.</> },
          { decision: <><strong>The cover: the butter mark on charcoal, no tile.</strong> Charcoal (#1F1F23) fills the window and the logo mark alone, in butter (#FFD84D), sits at the centre; the same in light and dark mode.</>, rejected: <>a butter tile (the app icon) on butter; a blurred passthrough cover.</>, why: <>Owner: the switcher already shows the app icon above the card; charcoal with the butter mark reads as Psss without repeating it, and nothing of the vault shows through.</> },
          { decision: <><strong>The lock is decided before the first frame.</strong> On return Psss checks the lock time before drawing the list; after the lock time the first thing shown is the unlock screen.</>, rejected: <>checking once the app is fully active, which shows the list for a moment first.</>, why: <>Found on a real iPhone 17: the list flashed, then the unlock screen. A flash of the list is a leak.</> },
          { decision: <><strong>Restore the place and item, not the search.</strong> A memory-only note holds the vault, the place and the item; never field values or the search text; gone at quit. If the item was deleted, you land on its place.</>, rejected: <>restoring the search text; saving the note to disk.</>, why: <>Where you were is useful; what you typed or saw is not worth keeping anywhere that outlives the app.</> },
          { decision: <><strong>Open, owner to choose: E1 or E2.</strong> The page recommends E1 (cover also during Control Center, notifications and calls).</>, why: <>The system’s picture is taken when the app becomes inactive, before it is in the background. E1 never lets the list into it; the cost is a brief charcoal flash.</> },
          { decision: <>iPad covers each window; the Mac has no cover.</>, why: <>The Mac has no app-switcher pictures and already locks on sleep and screen lock.</> },
        ]}
      />

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>Owner chose the solid cover, as the butter mark on charcoal with no tile; the blurred cover and the butter tile are removed. Unlock frame matched to the built screen.</> },
          { date: '2026-11-25', text: <>New page, with two covers drawn (solid butter, and a blurred one). Proposal after the owner found, on a real iPhone 17, that returning to Psss shows the list and then the unlock screen, and that the place and item are lost after unlocking.</> },
        ]}
      />
    </Page>
  );
}
