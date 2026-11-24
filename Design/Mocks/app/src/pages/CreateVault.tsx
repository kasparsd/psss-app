import { useState } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone, MacWindow } from '../components/devices';
import { Nav } from '../screens/PhoneScreens';

type Where = 'icloud' | 'device';

const DOTS = '••••••••••';

/** What the footer under "Keep in" says. It names the file, the folder and what happens when the app is deleted. */
function whereNote(where: Where, unavailable: boolean) {
  if (unavailable) {
    return 'iCloud Drive is off for Psss, so this vault stays on this device and is deleted with Psss. Turn on iCloud Drive for Psss in Settings to keep it there instead.';
  }
  if (where === 'icloud') {
    return 'Saved as Passwords.kdbx in the Psss folder in iCloud Drive. It is still there if you delete Psss or get a new device. Only the encrypted file is stored.';
  }
  return 'The file stays on this device and is deleted if you delete Psss. Save a copy somewhere safe.';
}

/** The create sheet body: name, where it is kept, the vault password. Same on every device. */
function Body({ where: where0, unavailable = false }: { where: Where; unavailable?: boolean }) {
  const [where, setWhere] = useState<Where>(unavailable ? 'device' : where0);
  const id = `keep-${where0}-${unavailable}`;
  return (
    <>
      <div className="maphelp" style={{ paddingTop: 4 }}>
        Your logins, passkeys, codes, cards and notes are kept in one encrypted file. Psss cannot read it without the vault password.
      </div>
      <div className="icard">
        <div className="mapfield">
          <label className="l" htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="mapsel" style={{ textAlign: 'right' }} defaultValue="Passwords" />
        </div>
        <div className="mapfield">
          <label className="l" htmlFor={id}>Keep in</label>
          <select id={id} className="mapsel" value={where} disabled={unavailable} onChange={(e) => setWhere(e.target.value as Where)}>
            <option value="icloud">iCloud Drive</option>
            <option value="device">This device only</option>
          </select>
        </div>
      </div>
      <div className="maphelp" role="status">{whereNote(where, unavailable)}</div>
      <div className="icard">
        <div className="mapfield">
          <div className="l">Vault password</div>
          <span className="mono" style={{ color: 'var(--lab2)' }}>{DOTS}</span>
        </div>
        <div className="mapfield">
          <div className="l">Repeat password</div>
          <span className="mono" style={{ color: 'var(--lab2)' }}>{DOTS}</span>
        </div>
      </div>
      <div className="maphelp">
        You enter it each time the vault unlocks. Psss cannot reset it, so keep a copy somewhere safe. You also need it if you reinstall Psss: Face ID and Touch ID are set up again afterwards.
      </div>
    </>
  );
}

function Sheet({ device, where, unavailable }: { device: 'iphone' | 'ipad' | 'mac'; where: Where; unavailable?: boolean }) {
  const body = <Body where={where} unavailable={unavailable} />;
  if (device === 'iphone') {
    return (
      <IPhone tall>
        <Nav left={<button className="btn plain">Cancel</button>} mid={<strong>Create a vault</strong>} right={<button className="btn pri main">Create</button>} />
        <div className="pbody" style={{ overflow: 'visible' }}>{body}</div>
      </IPhone>
    );
  }
  const sheet = device === 'ipad' ? (
    <div className="sheetwrap">
      <div className="sheet">
        <div className="sheetbar">
          <button className="btn plain">Cancel</button>
          <strong>Create a vault</strong>
          <button className="btn pri main">Create</button>
        </div>
        <div className="sheetscroll">{body}</div>
      </div>
    </div>
  ) : (
    <div className="sheetwrap">
      <div className="sheet">
        <div className="maphead"><div className="t">Create a vault</div></div>
        <div className="sheetscroll">{body}</div>
        <div className="sheetfoot">
          <button className="btn glass">Cancel</button>
          <button className="btn pri main">Create</button>
        </div>
      </div>
    </div>
  );
  if (device === 'ipad') return <IPad>{sheet}</IPad>;
  return <MacWindow>{sheet}</MacWindow>;
}

export function CreateVault() {
  return (
    <Page
      title="Create a vault: where it is kept"
      status={<><strong>Approved by the owner, 2026-11-24.</strong> Built in the create sheet; device check open. Answers the owner's question of 2026-11-24: can a person delete the app and keep the vault?</>}
    >
      <Clarity
        intro={<p>What is being made, where it is kept, who holds the key, how to leave and what happens next, in plain words.</p>}
        items={[
          ['What is created?', 'One encrypted vault file, Passwords.kdbx (the name is the vault name), that other KeePass apps can open.'],
          ['Where is it kept?', 'In the Psss folder in iCloud Drive. The folder shows in Files and in Finder, so the person can see it and copy it. “This device only” keeps it in the app and is the one place deleted with the app.'],
          ['Who holds the key?', 'The person. The vault password is the only way in, and the same password opens it after a reinstall. Face ID and Touch ID are a shortcut kept on this device and are set up again after a reinstall.'],
          ['How do they leave?', 'Cancel. Nothing is written until Create. The vault can be moved or copied from iCloud Drive at any time.'],
          ['What happens next?', 'The vault opens empty with the AutoFill card at the top, as before.'],
        ]}
      />

      <Section title="1. The sheet on iPhone, iPad and Mac, signed in to iCloud" />
      <Frames>
        <Frame label="A · iPhone" phone caption="iCloud Drive is the default and the first choice. The footer names the file and the folder, and says the vault survives deleting Psss."><Sheet device="iphone" where="icloud" /></Frame>
        <Frame label="B · iPad" caption="A sheet over the window, Cancel and Create in its bar."><Sheet device="ipad" where="icloud" /></Frame>
        <Frame label="C · Mac" caption="A sheet with Cancel and Create at the foot."><Sheet device="mac" where="icloud" /></Frame>
      </Frames>

      <Section title="2. This device only, and iCloud Drive off" />
      <Frames>
        <Frame label="D · This device only (iPhone)" phone caption="Chosen on purpose. The footer says the file is deleted with Psss and asks for a copy somewhere safe."><Sheet device="iphone" where="device" /></Frame>
        <Frame label="E · iCloud Drive is off (iPhone)" phone caption="The choice is dimmed and says why. Create still works and keeps the vault on the device. No error, no blocked button."><Sheet device="iphone" where="device" unavailable /></Frame>
        <Frame label="F · iCloud Drive is off (Mac)" caption="Same words on the Mac. The pop-up button is dimmed."><Sheet device="mac" where="device" unavailable /></Frame>
      </Frames>

      <Section title="3. Not drawn, and what it needs">
        <ul>
          <li><strong>A folder picker is not in the sheet.</strong> “Open Another Vault…” on the lock screen and in Setup already opens a KeePass file wherever it is. A person who wants their vault in a folder of their own creates it here and moves it in Files or Finder, or opens the file from the folder.</li>
          <li><strong>AutoFill.</strong> The extension must be able to read the vault in the Psss folder. That needs the iCloud Documents entitlement on the extension, and an unverified check on a device: that a vault that is not yet downloaded gives the “not ready” screen, not a wrong answer.</li>
          <li><strong>A vault found on a new device.</strong> After a reinstall, the lock screen's selector lists the vaults in the Psss folder, so nothing needs to be located by hand.</li>
        </ul>
      </Section>

      <Decisions
        items={[
          {
            decision: <>New vaults are kept in the app's own folder in iCloud Drive by default, with “This device only” as the other choice. There is no folder picker.</>,
            rejected: <>a folder picker in the sheet; keeping the vault in the app's private storage and offering iCloud as an extra.</>,
            why: <>The vault then survives deleting the app, which the app's private storage does not. A picker adds a decision about files to the first screen, against the one-vault-created-without-asking rule. A person who wants a folder of their own can move the file.</>,
          },
          {
            decision: <>The footer under “Keep in” always says where the file is, whether it survives deleting Psss, and what the person needs afterwards.</>,
          },
          {
            decision: <>With iCloud Drive off, Create still works and keeps the vault on the device. The sheet says so in place.</>,
            rejected: <>blocking Create until iCloud is on.</>,
            why: <>A person must always be able to start. The footer states the risk and the fix.</>,
          },
        ]}
      />
      <Against>
        <li>None. A pop-up button in a grouped form is the standard control, and the sheet follows the rest of the app's sheets.</li>
      </Against>

      <History
        entries={[
          { date: '2026-11-24', text: <>Page added, approved and built. Replaces the first-run sheet that had a name and a vault password and said “kept in one encrypted file on this device. Nothing is uploaded”, which put every new vault in storage that goes with the app. The owner asked whether a person should choose the iCloud location so the vault survives deleting the app.</> },
        ]}
      />
    </Page>
  );
}
