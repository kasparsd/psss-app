import type { ReactNode } from 'react';
import { IPhone } from '../../components/devices';
import { CodeDigits, ItemIcon } from '../../components/Rows';
import { CopyIcon } from '../../icons';
import type { Item } from '../../data';
import { Nav } from '../../screens/PhoneScreens';
import type { Pictures } from '../Gallery';
import { Brand, SafariPage, WidePage, WideStage, accounts } from './fill';
import './signin.css';

/**
 * Pictures `code-setup`: a site shows a setup QR code on the same device. A
 * screenshot, Copy and Delete (iPhone) or the clipboard (Mac), Paste in the
 * login's Add verification code sheet, and a live code appears on that login.
 * The sheet and its words are option H of `pages/CodeSetup.tsx` (approved
 * 2026-11-24): “Screenshot or key” with the system Paste control, Scan with
 * camera, Choose photo (Choose image… on the Mac), and the one help line; the
 * iPad and Mac sheets are the “iPad and Mac” frames of that page.
 * The QR code is a drawn pattern, not a scannable secret.
 * Pure pictures: fixed fictional data, no state, no handlers.
 */

/* ---------- a QR-like picture, from a fixed pattern ---------- */

const N = 25;

/** True for a dark module. A fixed arithmetic pattern with three finder squares: it looks like a QR code and encodes nothing. */
function dark(x: number, y: number): boolean {
  const finder = (ox: number, oy: number) => {
    const dx = x - ox, dy = y - oy;
    if (dx < -1 || dy < -1 || dx > 7 || dy > 7) return null;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  for (const [ox, oy] of [[0, 0], [N - 7, 0], [0, N - 7]] as const) {
    const f = finder(ox, oy);
    if (f !== null) return f;
  }
  const h = Math.imul(x * 31 + 7, 2654435761) ^ Math.imul(y * 17 + 3, 40503);
  return ((h >>> 11) & 3) !== 0 && ((x * y + x + 2 * y) % 5 !== 1 || (h & 4) !== 0);
}

const cells: [number, number][] = [];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (dark(x, y)) cells.push([x, y]);

const Modules = () => <>{cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />)}</>;

const Qr = ({ className }: { className?: string }) => (
  <svg className={className} viewBox={`-1 -1 ${N + 2} ${N + 2}`} shapeRendering="crispEdges" aria-hidden="true"><Modules /></svg>
);

/** What the screenshot holds: the page's lines and the code. Decorative. */
const ShotPicture = () => (
  <div className="lpd-shot" aria-hidden>
    <i className="w" /><i />
    <svg viewBox={`-1 -1 ${N + 2} ${N + 2}`} shapeRendering="crispEdges"><Modules /></svg>
  </div>
);

/* ---------- small pieces copied from pages/CodeSetup.tsx (not exported there) ---------- */

const Clip = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="3.5" width="11" height="14" rx="2" /><path d="M5 7.5v11a2 2 0 0 0 2 2h8" /></svg>
);
const Camera = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></svg>
);
const Photo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 16" /></svg>
);

const HELP = 'Take a screenshot of the QR code, then paste it or pick it from your photos. Or copy the setup key from the site and paste that.';
const HELP_MAC = 'Take a screenshot of the QR code with ⇧⌃⌘4, which copies it, then paste. Or choose an image, drop one here, or copy the setup key and paste that.';
const CONFIRM = 'Type this code into the site to finish turning on two-step verification. It saves to Lumen in your vault, on this device.';

const login: Item = { ...accounts[0], id: 101, name: 'Lumen (Personal)', account: 'sam@personal.example.com' };
const CODE = '348 692';

/** The countdown ring the login's own page draws beside its code, part way round. */
function Ring() {
  const c = 2 * Math.PI * 9;
  return (
    <svg className="lpd-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="bg" cx="12" cy="12" r="9" />
      <circle className="fg" cx="12" cy="12" r="9" strokeDasharray={c} strokeDashoffset={c * (1 - 22 / 30)} />
    </svg>
  );
}

/* ---------- the sheet's bodies ---------- */

const PasteRow = () => (
  <div className="cs-row split" style={{ color: 'var(--lab)' }}>
    <span>Screenshot or key</span>
    <span className="btn cs-go small"><Clip />Paste</span>
  </div>
);

/** Option H, Paste on: something is on the clipboard. */
function PasteBody({ device }: { device: 'iphone' | 'ipad' | 'mac' }) {
  return (
    <>
      <div className="cs-list">
        <PasteRow />
        {device === 'mac'
          ? <div className="cs-row"><Photo />Choose image…</div>
          : <><div className="cs-row"><Camera />Scan with camera</div><div className="cs-row"><Photo />Choose photo</div></>}
      </div>
      <div>{device === 'mac' ? HELP_MAC : HELP}</div>
    </>
  );
}

/** “Found a code for Lumen”: the account, the live code with its ring, one button. */
function FoundBody() {
  return (
    <>
      <div className="t">Found a code for Lumen</div>
      <div className="s" style={{ marginTop: -8 }}>sam@personal.example.com</div>
      <div className="lpd-livecode"><CodeDigits code={CODE} big /><Ring /></div>
      <div>{CONFIRM}</div>
      <div><span className="btn pri cs-go">Save code</span></div>
    </>
  );
}

/* ---------- iPhone ---------- */

/** A bottom sheet over the login's editor, at the medium detent, as `pages/CodeSetup.tsx` draws it. */
function PhoneSheet({ height, children }: { height: number; children: ReactNode }) {
  return (
    <IPhone>
      <div className="lpd-bg">
        <div className="nav"><span className="btn glass">Cancel</span><span /><span className="btn pri main">Save</span></div>
        <div className="ident" style={{ paddingTop: 0 }}>
          <ItemIcon item={login} big />
          <div className="t">{login.name}</div>
        </div>
        <div className="pbody" style={{ overflow: 'hidden' }}>
          <div className="icard">
            <div className="frow"><div className="fbody"><span className="s">Website (optional)</span><span>lumen.example.com</span></div></div>
            <div className="frow"><div className="fbody"><span className="s">Username (optional)</span><span>sam@personal.example.com</span></div></div>
          </div>
        </div>
      </div>
      <div className="cs-dim" />
      <div className="cs-sheet" style={{ height }}>
        <div className="cs-grab" />
        <div className="nav" style={{ padding: '4px 12px 0' }}>
          <span className="btn glass">Cancel</span>
          <span className="mid">Add verification code</span>
          <span />
        </div>
        <div className="cs-body">{children}</div>
      </div>
    </IPhone>
  );
}

/** The site's QR code, with the screenshot's preview waiting in the corner. */
const PhoneQr = () => (
  <IPhone>
    <SafariPage path="/security">
      <Brand />
      <div className="t">Turn on two-step verification</div>
      <div>Scan this QR code with your authenticator app.</div>
      <Qr className="lpd-qr" />
      <div className="s lpd-center">Can’t scan? Show the setup key.</div>
    </SafariPage>
    <div className="lpd-thumb lpd-cue"><ShotPicture /></div>
  </IPhone>
);

/** The screenshot in the editor, with the Done menu open on Copy and Delete. */
const PhoneDone = () => (
  <IPhone>
    <div className="lpd-editor">
      <div className="nav">
        <div className="lpd-donewrap">
          <span className="btn glass">Done</span>
          <div className="lpd-menu">
            <div>Save to Photos</div>
            <div>Save to Files</div>
            <div className="go lpd-cue-in">Copy and Delete</div>
            <div className="del">Delete Screenshot</div>
          </div>
        </div>
        <span />
      </div>
      <div className="lpd-img"><ShotPicture /></div>
    </div>
  </IPhone>
);

/** The login's page after the code is saved: the code card with its live code, ring and copy. */
const PhoneSaved = () => (
  <IPhone>
    <Nav left={<span className="btn glass">Back</span>} right={<span className="btn">Edit</span>} />
    <div className="ident" style={{ paddingTop: 0 }}>
      <ItemIcon item={login} big />
      <div className="t">{login.name}</div>
    </div>
    <div className="pbody">
      <div className="icard">
        <div className="frow"><div className="fbody"><span className="s">Website</span><span>lumen.example.com</span></div></div>
        <div className="frow"><div className="fbody"><span className="s">Username</span><span>sam@personal.example.com</span></div></div>
      </div>
      <div className="sec" style={{ padding: '2px 4px 6px' }}>Verification code</div>
      <div className="icard">
        <div className="frow">
          <div className="lpd-coderow">
            <div className="fbody grow">
              <span className="s">Code</span>
              <CodeDigits code={CODE} big />
            </div>
            <Ring />
            <span className="lpd-copybtn"><CopyIcon /></span>
          </div>
        </div>
      </div>
      <div className="hint">Type this code into the site to finish turning on two-step verification.</div>
    </div>
  </IPhone>
);

/* ---------- iPad and Mac ---------- */

const WideQr = ({ device }: { device: 'ipad' | 'mac' }) => (
  <WideStage device={device}>
    <WidePage device={device} path="/security">
      <Brand />
      <div className="t">Turn on two-step verification</div>
      <div>Scan this QR code with your authenticator app.</div>
      <Qr className="lpd-qr" />
      <div className="s lpd-center">Can’t scan? Show the setup key.</div>
    </WidePage>
  </WideStage>
);

/** A centred sheet over the login, as the “iPad and Mac” frames of `pages/CodeSetup.tsx`: Cancel in the bar on iPad, at the foot on Mac. */
function WideSheetOver({ device, children }: { device: 'ipad' | 'mac'; children: ReactNode }) {
  const sheet = (
    <>
      {device === 'ipad'
        ? <div className="sheetbar"><span className="btn glass">Cancel</span><strong>Add verification code</strong><span /></div>
        : <div className="maphead" style={{ textAlign: 'center' }}><div className="t">Add verification code</div></div>}
      <div className="cs-body" style={{ padding: '4px 4px 6px' }}>{children}</div>
      {device === 'mac' && <div className="sheetfoot" style={{ justifyContent: 'flex-start' }}><span className="btn glass">Cancel</span></div>}
    </>
  );
  return (
    <WideStage device={device} sheet={sheet}>
      <div className="lpd-wbg">
        <div className="ident">
          <ItemIcon item={login} big />
          <div className="t">{login.name}</div>
        </div>
        <div className="pbody" style={{ overflow: 'hidden' }}>
          <div className="icard">
            <div className="frow"><div className="fbody"><span className="s">Website (optional)</span><span>lumen.example.com</span></div></div>
            <div className="frow"><div className="fbody"><span className="s">Username (optional)</span><span>sam@personal.example.com</span></div></div>
          </div>
        </div>
      </div>
    </WideStage>
  );
}

/* ---------- the pictures ---------- */

export function codeSetupPictures(): Pictures {
  return {
    iphone: [
      { caption: 'A QR code on the very phone you would scan it with.', screen: <PhoneQr /> },
      { caption: 'Copy and Delete copies the screenshot and leaves nothing in Photos.', screen: <PhoneDone /> },
      { caption: 'In the login, Paste is on. The clipboard holds the picture.', screen: <PhoneSheet height={400}><PasteBody device="iphone" /></PhoneSheet> },
      { caption: 'Psss found a code for Lumen. Nothing was uploaded.', screen: <PhoneSheet height={430}><FoundBody /></PhoneSheet> },
      { caption: 'The code is saved and ticks live on the login.', screen: <PhoneSaved /> },
    ],
    ipad: [
      { caption: 'A QR code on the iPad you would scan it with.', screen: <WideQr device="ipad" /> },
      { caption: 'In the login, Paste is on. The clipboard holds the picture.', screen: <WideSheetOver device="ipad"><PasteBody device="ipad" /></WideSheetOver> },
      { caption: 'Psss found a code for Lumen. Nothing was uploaded.', screen: <WideSheetOver device="ipad"><FoundBody /></WideSheetOver> },
    ],
    mac: [
      { caption: 'The QR code is on screen, and a screenshot of it is copied.', screen: <WideQr device="mac" /> },
      { caption: 'In the login, Paste is on. ⌘V works anywhere in the sheet.', screen: <WideSheetOver device="mac"><PasteBody device="mac" /></WideSheetOver> },
      { caption: 'Psss found a code for Lumen. Nothing was uploaded.', screen: <WideSheetOver device="mac"><FoundBody /></WideSheetOver> },
    ],
  };
}
