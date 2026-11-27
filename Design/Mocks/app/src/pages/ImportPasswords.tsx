import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, MacWindow } from '../components/devices';
import { PopChevrons } from '../components/PopUpRow';
import { Problem } from '../components/Problem';
import './imp.css';

type Dev = { mac?: boolean };

const Btn = ({ mac, pri, children }: Dev & { pri?: boolean; children: ReactNode }) =>
  <button className={mac ? `mbtn${pri ? ' default' : ''}` : `btn wide${pri ? ' pri' : ''}`}>{children}</button>;

/** One sheet, the same words on every device: a full-height sheet on iPhone, a window sheet on the Mac. */
function Sheet({ mac, title, cancel = 'Cancel', done, children, foot }: Dev & { title: string; cancel?: string | null; done?: boolean; children: ReactNode; foot: ReactNode }) {
  const body = (
    <div className={`imp${mac ? ' mac macui' : ''}`} role="dialog" aria-label={title}>
      {!mac && <div className="imp-bar">{cancel && <button className="btn plain">{cancel}</button>}{done && <button className="btn plain imp-done">Done</button>}</div>}
      <div className="imp-title">{title}</div>
      <div className="imp-body">{children}</div>
      <div className="imp-foot">{foot}{mac && cancel && <button className="mbtn">{cancel}</button>}{mac && done && <button className="mbtn default">Done</button>}</div>
    </div>
  );
  return mac ? <MacWindow><div className="imp-dim">{body}</div></MacWindow> : <IPhone>{body}</IPhone>;
}

const Box = ({ head, children }: { head?: string; children: ReactNode }) => (
  <div className="imp-group">{head && <strong>{head}</strong>}<div className="icard imp-card">{children}</div></div>
);

const Start = ({ mac }: Dev) => (
  <Sheet mac={mac} title="Import from Apple Passwords" foot={null}>
    <Box head="Move directly">
      <ol>
        {mac ? <>
          <li>In Passwords, choose File › Export All Items to App…</li>
          <li>Choose Psss and confirm.</li>
          <li>Psss opens and shows what will be added.</li>
        </> : <>
          <li>In Passwords, choose Export Data to Another App.</li>
          <li>Choose Psss and confirm.</li>
          <li>Psss opens and shows what will be added.</li>
        </>}
      </ol>
      <p>Passwords, passkeys and verification codes move. No file is made.</p>
      {mac && <Btn mac pri>Open Passwords</Btn>}
    </Box>
    <Box head="Or use a file">
      <p>{mac ? 'In Passwords, choose File › Export All Passwords to File…, then choose that file here.' : 'Choose a passwords file (CSV) that you exported.'} A file is not encrypted and has no passkeys.</p>
      <Btn mac={mac}>Choose File…</Btn>
    </Box>
  </Sheet>
);

const Into = ({ mac, value }: Dev & { value: string }) => (
  <div className="icard imp-row"><span>Import into</span><button className={mac ? 'mbtn popup' : 'btn plain'}>{value} {mac ? <PopChevrons /> : '⌃⌄'}</button></div>
);

const Review = ({ mac, file, newVault }: Dev & { file?: boolean; newVault?: boolean }) => (
  <Sheet mac={mac} title="Review the import" foot={<><p>{newVault ? 'Nothing is added until you create the vault.' : 'Nothing is added until you choose Import.'}</p><Btn mac={mac} pri>{newVault ? 'Create Vault…' : 'Import 398 Items'}</Btn></>}>
    <p>{file ? 'The file holds 412 logins, 21 with a verification code.' : 'Apple Passwords sent 412 logins: 38 with a passkey, 21 with a verification code.'}</p>
    <Into mac={mac} value={newVault ? 'New vault' : 'Passwords'} />
    {!newVault && <p>14 are already in Passwords and will not be added again.<br />3 logins in Passwords get what they are missing, such as a passkey or verification code. Nothing saved there is replaced.</p>}
    <Box head="Check these">
      <p><strong>example.com</strong><br />The verification code could not be read. It is kept as text; set it up again on the site.</p>
      <p><strong>bank.example</strong><br />A login for this site and username is already here with a different password. Both are kept.</p>
      <p><strong>shop.example</strong><br />You deleted it in Psss earlier, so it is not imported again.</p>
    </Box>
  </Sheet>
);

const Done = ({ mac, file }: Dev & { file?: boolean }) => (
  <Sheet mac={mac} title="398 items imported" cancel={null} done foot={null}>
    <p>They are in the vault Passwords. Nothing was sent anywhere.</p>
    {file
      ? <p>The file you chose still lists every password without encryption.</p>
      : <p>They are also still in Apple Passwords. Delete them there only after you have signed in with Psss.</p>}
    <p>Psss fills them once AutoFill is on for Psss in {mac ? 'System Settings' : 'Settings'}.</p>
    {file && <Btn mac={mac}>{mac ? 'Move File to Trash…' : 'Delete File…'}</Btn>}
  </Sheet>
);

const Failed = ({ mac, title, text, action }: Dev & { title: string; text: string; action?: string }) => (
  <Sheet mac={mac} title={title} cancel={action ? 'Cancel' : null} done={!action} foot={action ? <Btn mac={mac} pri>{action}</Btn> : null}>
    <Problem>{text}</Problem>
  </Sheet>
);

export function ImportPasswords() {
  return (
    <Page title="Import from Apple Passwords" status={<><strong>Approved and built (2026-11-26).</strong> Replaces the file-only import with its “Ready to import” alert. The direct move is not yet tried with Apple Passwords on a real device.</>}>
      <Clarity items={[
        ['What is this?', 'Bringing logins, passkeys and verification codes from Apple Passwords into a Psss vault.'],
        ['Where is it stored?', 'In the vault chosen on the review screen, in its encrypted KeePass file. A direct move makes no file.'],
        ['Who holds the key?', 'The person: the vault password. Importing into a new vault asks for one first.'],
        ['How to get out?', 'Cancel before Import adds nothing. Apple Passwords is not changed.'],
        ['What happens next?', 'The finished screen says where the items are and what is left to do.'],
      ]} />

      <Section title="1. Start"><p>Opened by “Import from Apple Passwords” on Welcome, in Add Vault, in the File menu and in an empty vault. Only Apple Passwords can start a direct move, so this screen tells the person how.</p></Section>
      <Frames>
        <Frame phone label="A · iPhone" caption="No button opens Passwords: iOS has no supported way to do it."><Start /></Frame>
        <Frame label="B · Mac" caption="Open Passwords is the default button."><Start mac /></Frame>
      </Frames>

      <Section title="2. Review"><p>Shown when Apple Passwords hands over the items, or after a file is chosen. A locked vault shows its usual unlock form first. Import into lists the open vaults and “New vault”.</p></Section>
      <Frames>
        <Frame phone label="C · Direct move" caption="“Check these” is left out when there is nothing to check."><Review /></Frame>
        <Frame phone label="D · New vault" caption="With no vault yet this is the only choice. The next step is the existing Create a vault sheet."><Review newVault /></Frame>
        <Frame label="E · Mac, from a file" caption="A file has no passkeys."><Review mac file /></Frame>
      </Frames>

      <Section title="3. Finished" />
      <Frames>
        <Frame phone label="F · After a direct move" caption="No offer to delete anything in Apple Passwords: Psss cannot."><Done /></Frame>
        <Frame label="G · After a file" caption="The delete button is bordered, asks to confirm, and never runs by itself."><Done mac file /></Frame>
      </Frames>

      <Section title="4. Problems" />
      <Frames>
        <Frame phone label="H · The handover failed" caption="The system’s hand-over can be used once and expires."><Failed title="Nothing was imported" text="Psss did not receive the items. Start the export again in Passwords." /></Frame>
        <Frame phone label="I · Wrong file" caption=""><Failed title="Nothing was imported" text="This file is not a passwords export. It needs columns such as Title, URL, Username and Password." action="Choose File…" /></Frame>
        <Frame phone label="J · Nothing new" caption="A second import."><Failed title="Nothing new to import" text="412 items are already in Passwords." /></Frame>
        <Frame label="K · The write failed" caption="The review stays; the vault is unchanged."><Failed mac title="Nothing was imported" text="The vault file was changed by another app or device." action="Try Again" /></Frame>
      </Frames>

      <Decisions items={[
        { decision: 'Two ways on one screen, the direct move first.', rejected: 'File only; hiding the file way.', why: 'The direct move carries passkeys and leaves no unencrypted file. The file way works when the hand-over does not.' },
        { decision: 'One review screen with the destination, counts and only the exceptions.', rejected: 'The alert “Ready to import”; a list of all items; choosing items.', why: 'Apple Passwords already lets the person choose what to export.' },
        { decision: 'Exact duplicates are skipped; a different password for the same site and username is added beside the old one and listed.', rejected: 'Overwriting.', why: 'No password is lost.' },
        { decision: 'Cards and Wi-Fi networks are not promised.', why: 'Apple’s export names passwords, passkeys and verification codes. Anything else that arrives is added or listed.' },
      ]} />
      <History entries={[
        { date: '2026-11-27', text: <>With a new vault the line above the button says “Nothing is added until you create the vault”, since the button is Create Vault…. Replaces “until you choose Import” there. After the iPhone check, the delete button is bordered as decided.</> },
        { date: '2026-11-27', text: <>“Check these” also names items the person deleted for good in Psss. “All 412 logins are already in Passwords” became “412 items are already in Passwords”, which also holds when the export has other kinds of items.</> },
        { date: '2026-11-26', text: <>Built. Added the line for logins that gain a passkey or verification code, which replaces a review that only counted what was skipped. Done moved to the sheet’s toolbar and the delete button into the sheet’s body, where standard forms put them.</> },
        { date: '2026-11-26', text: <>New page.</> },
      ]} />
    </Page>
  );
}
