import { IPhone } from '../../components/devices';
import { CodeRow } from '../../components/Rows';
import type { Item } from '../../data';
import type { Pictures } from '../Gallery';
import { Brand, FieldBox, Keyboard, SafariPage, cue } from './fill';
import './signin.css';

/**
 * Pictures `code-fill`: the site now asks for a six-digit code. One way is the
 * suggestion above the keyboard; the other is the Codes tab, where the digits
 * are the button that copies. Drawn from `pages/Places.tsx` (frames B and C,
 * Codes) and `components/Rows.tsx` (`CodeRow`). iPhone only: the suggestion
 * above the keyboard is the system's, and no approved mock draws the codes
 * sheet or the Codes list for Lumen on iPad or Mac.
 * Pure pictures: the codes are fixed fictional ones, as the Codes mock has them.
 */

const CODE = '348 692';

const login = (id: number, name: string, account: string, color: Item['color'], code: string): Item =>
  ({ id, name, account, kind: 'login', color, uses: 0, fields: [], code });

/** Five codes or fewer: one list A to Z with no group headings, as the app draws it. */
const list: Item[] = [
  login(4, 'Cloudnest', 'sam.r', 3, '913 640'),
  login(1, 'Gitforge', 'sam.r', 1, '482 913'),
  login(101, 'Lumen', 'sam@personal.example.com', 4, CODE),
  login(5, 'Mailbox', 'sam.rivera', 5, '305 118'),
  login(18, 'Taxdesk', 'sam.r', 2, '627 305'),
];

/** Lumen's page asking for the code: the field has the focus with the suggestion above the keyboard, or the code is already in. */
function AskForCode({ filled }: { filled?: boolean }) {
  return (
    <IPhone>
      <SafariPage path="/verify">
        <Brand />
        <div className="t">Two-step verification</div>
        <div>Enter the six-digit code for your Lumen account.</div>
        <div className="lpd-lab">Verification code<FieldBox value={filled ? CODE : undefined} placeholder="000 000" className={filled ? '' : 'on'} /></div>
        <button type="button" className="btn pri wide" disabled={!filled}>Verify</button>
      </SafariPage>
      {!filled && (
        <Keyboard bar={
          <div className={cue(true, 'lpd-sugg')}>
            <span>Lumen (Personal)</span>
            <span className="s">Code from Psss</span>
          </div>
        } />
      )}
    </IPhone>
  );
}

/** The Codes tab. The ring is on the Lumen code; `copied` is the app's pill and the row's own “Copied”. */
function Codes({ copied }: { copied?: boolean }) {
  return (
    <IPhone tab="codes" pill={copied ? 'Verification code copied' : undefined}>
      <div className="lt"><div className="t">Codes</div></div>
      <div className="pbody tabpad">
        <div className="grp">
          {list.map((it) => {
            const row = <CodeRow key={it.id} item={it} copied={copied && it.id === 101} />;
            return it.id === 101 && !copied ? <div key={it.id} className="lpd-cue-in">{row}</div> : row;
          })}
        </div>
      </div>
    </IPhone>
  );
}

export function codeFillPictures(): Pictures {
  return {
    iphone: [
      { caption: 'Lumen asks for a six-digit code. Safari offers it above the keyboard.', screen: <AskForCode /> },
      { caption: 'The code is in the field. Nothing was typed.', screen: <AskForCode filled /> },
      { caption: 'Or open Codes: every code is there, live.', screen: <Codes /> },
      { caption: 'The code is copied, one tap from the list.', screen: <Codes copied /> },
    ],
  };
}
