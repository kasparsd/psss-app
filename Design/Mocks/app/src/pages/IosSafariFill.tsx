import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone } from '../components/devices';
import { Notice } from '../components/Notice';
import { VaultRow } from '../components/VaultRow';
import { BioPrompt } from '../components/BioPrompt';
import { CheckIcon } from '../icons';
import { Mark } from './Logo';
import { FillBtn } from '../components/loginParts';
import { cardItems, type Item } from '../data';
import './isf.css';

/* ---------- Safari's chrome and the page ---------- */

type Form = 'card' | 'address' | 'none' | 'frame';

const In = ({ label, value, on, half }: { label: string; value?: string; on?: boolean; half?: boolean }) => (
  <div style={half ? undefined : undefined}>
    <div className="isf-lbl">{label}</div>
    <div className={`isf-in${on ? ' on' : ''}`}>{value}</div>
  </div>
);

/** A checkout page. `filled` shows what Fill wrote; `cvv` marks the security code field focused or filled; `missed` names a field Fill left empty. */
function Checkout({ form, filled, cvv, missed }: { form: Form; filled?: boolean; cvv?: 'focus' | 'filled'; missed?: 'expiry' | 'phone' | 'street2' }) {
  if (form === 'none') {
    return <div className="isf-page"><div className="t">Newsletter</div><In label="Your email" /><div className="isf-lbl">Sign up for our weekly offers.</div></div>;
  }
  if (form === 'frame') {
    return <div className="isf-page"><div className="t">Payment</div><div className="isf-lbl">Card details</div><div className="isf-in" style={{ height: 76, borderStyle: 'dashed', color: 'var(--lab2)' }}>Secure card form from the payment provider</div></div>;
  }
  if (form === 'address') {
    return (
      <div className="isf-page"><div className="t">Delivery</div>
        <In label="Full name" value={filled ? 'Sam Rivers' : undefined} />
        <In label="Street address" value={filled ? '12 Harbour Road' : undefined} />
        {missed === 'street2' && <In label="Apartment or suite" />}
        <div className="isf-row2"><In label="Postal code" value={filled ? 'LV-1010' : undefined} /><In label="City" value={filled ? 'Riga' : undefined} /></div>
        <In label="Email" value={filled ? 'sam@harbor.example' : undefined} />
        <In label="Phone" value={filled && missed !== 'phone' ? '+371 2000 0000' : undefined} />
      </div>
    );
  }
  return (
    <div className="isf-page"><div className="t">Pay · Harbor Shop</div>
      <In label="Name on card" value={filled ? 'Sam Rivers' : undefined} />
      <In label="Card number" value={filled ? '4929 3741 0268 4417' : undefined} />
      <div className="isf-row2"><In label="Expiry" value={filled && missed !== 'expiry' ? '08/28' : undefined} /><In label="Security code" on={cvv === 'focus'} value={cvv === 'filled' ? '•••' : undefined} /></div>
    </div>
  );
}

const Back = () => <div className="isf-lbl" style={{ padding: '0 16px 4px', color: 'var(--accent)' }}>◀ Safari</div>;

/** Safari on iPhone (iOS 27.2): the page, the compact address bar with the page menu button at its left, and (when asked) the page menu, Psss's popup sheet or Safari's own question. */
function SafariPhone({ form = 'card', filled, cvv, missed, menu, sheet, ask, url = 'harborshop.example' }: { form?: Form; filled?: boolean; cvv?: 'focus' | 'filled'; missed?: 'expiry' | 'phone' | 'street2'; menu?: boolean; sheet?: ReactNode; ask?: boolean; url?: string }) {
  return (
    <IPhone>
      <Checkout form={form} filled={filled} cvv={cvv} missed={missed} />
      <div className="isf-safari">
        <span className="isf-circ" aria-hidden>‹</span>
        <div className="isf-cap"><span className={`isf-pm${menu ? ' on' : ''}`} role="img" aria-label="Page menu"><b /><i /></span><span className="isf-url">{url}</span><span aria-hidden>↻</span></div>
        <span className="isf-circ" aria-hidden>⧉</span>
      </div>
      {menu && (
        <div className="isf-menu" role="menu">
          {['Share', 'Add to Bookmarks', 'Add Bookmark to…'].map((r) => <div key={r} className="isf-mi">{r}</div>)}
          <div className="isf-msep" />
          {['Find on Page', 'Page Zoom', 'Notify Me', 'Hide Distracting Items'].map((r) => <div key={r} className="isf-mi">{r}</div>)}
          <div className="isf-msep" />
          <div className="isf-mi hl"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="isf-mark"><Mark u={0.22} mask /></span>Psss</span></div>
          <div className="isf-mi">Describe Extension</div>
          <div className="isf-mi">Manage Extensions</div>
        </div>
      )}
      {ask && (
        <>
          <div className="isf-dim" />
          <div className="isf-ask" role="alertdialog" aria-label="Open this page in “Psss”?">
            <div>Open this page in “Psss”?</div>
            <div className="btns"><span>Cancel</span><strong>Open</strong></div>
          </div>
        </>
      )}
      {sheet && <><div className="isf-dim" /><div className="isf-sheet" role="dialog" aria-label="Psss"><div className="isf-grab" />{sheet}</div></>}
    </IPhone>
  );
}

/** Safari's page for the extension in Settings (iOS 27.2). iOS draws all of it; the description is the extension's own text. */
function ExtensionSettings() {
  return (
    <IPhone>
      <div className="isf-set">
        <div className="isf-stitle"><span className="isf-circ" aria-hidden>‹</span><span className="t">Psss</span></div>
        <div className="isf-group">
          <div className="isf-srow"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><span className="isf-mark"><Mark u={0.3} mask /></span>Psss</span></div>
          <div className="isf-srow"><span>App</span><span className="isf-lbl">Psss</span></div>
          <div className="isf-srow col"><span>Description</span><span className="isf-lbl">{description}</span></div>
        </div>
        <div className="isf-group">
          <div className="isf-srow"><span>Allow Extension</span><span className="isf-sw on" role="img" aria-label="On" /></div>
          <div className="isf-srow"><span>Allow in Private Browsing</span><span className="isf-sw" role="img" aria-label="Off" /></div>
        </div>
        <div className="isf-lbl">Permissions</div>
        <div className="isf-group">
          <div className="isf-srow col"><span>Webpage Contents and Browsing History</span><span className="isf-lbl">Can read and alter sensitive information on webpages, including passwords, phone numbers, and credit cards, and see your browsing history on the current tab’s webpage when you use the extension.</span></div>
        </div>
      </div>
    </IPhone>
  );
}

/** The extension's description, the owner's words (2026-11-26). */
const description = 'Fills out credit cards and addresses in forms, which system AutoFill does not do for Psss. Uses the website URL to check the page, and the form fields to match the values.';

/* ---------- the popup ---------- */

const PHead = () => (
  <div className="isf-h">
    <span className="isf-mark" aria-label="Psss"><Mark u={0.3} mask /></span>
    <span className="sp" />
    <VaultRow name="Passwords" state="unlocked" variant="compact" />
    <span className="isf-done" data-tip="Safari draws this button">Done</span>
  </div>
);
/** The same header while the vault is locked: no Unlock button, because an Open Psss notice below is the way on. */
const PHeadLocked = () => (
  <div className="isf-h">
    <span className="isf-mark" aria-label="Psss"><Mark u={0.3} mask /></span>
    <span className="sp" />
    <VaultRow name="Passwords" state="unlocked" variant="compact" />
    <span className="isf-done">Done</span>
  </div>
);

/** The header when the popup has no vault list to show: the page may not be filled, or Psss could not answer. */
const PHeadBare = () => (
  <div className="isf-h">
    <span className="isf-mark" aria-label="Psss"><Mark u={0.3} mask /></span>
    <span className="sp" />
    <span className="isf-done">Done</span>
  </div>
);
/** The header with another vault chosen; `menu` draws the web select open (names only, as on the Mac popup). */
const PHeadVault = ({ name, menu }: { name: string; menu?: boolean }) => (
  <div className="isf-h">
    <span className="isf-mark" aria-label="Psss"><Mark u={0.3} mask /></span>
    <span className="sp" />
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <VaultRow name={name} state="unlocked" variant="compact" />
      {menu && (
        <div className="isf-sel" role="menu">
          {['Passwords', 'Work'].map((v) => <div key={v} className="isf-opt" role="menuitemradio" aria-checked={v === name}><span className="chk">{v === name && <CheckIcon />}</span>{v}</div>)}
        </div>
      )}
    </span>
    <span className="isf-done">Done</span>
  </div>
);

/** A Psss screen reached from Safari: centred words, with the system's way back above. */
const AppScreen = ({ title, text, children, overlay }: { title: string; text: string; children?: ReactNode; overlay?: ReactNode }) => (
  <IPhone>
    <Back />
    <div className="isf-pad" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 24 }}>
      <div className="t">{title}</div>
      <div>{text}</div>
      {children}
    </div>
    {overlay}
  </IPhone>
);

const Gh = ({ children }: { children: ReactNode }) => <div className="isf-grp-h">{children}</div>;

const cards = cardItems.filter((c) => !c.expired).slice(0, 2);
const cardSub = (c: Item) => `${c.brand === 'American Express' ? 'Amex' : c.brand} •• ${c.last4} · ${c.account.split('· ')[1]}`;
const identities: [Item, string][] = [
  [{ id: 31, name: 'Home', account: '', kind: 'custom', color: 5, uses: 0, fields: [] } as Item, 'Sam Rivers · Riga'],
  [{ id: 32, name: 'Work', account: '', kind: 'custom', color: 4, uses: 0, fields: [] } as Item, 'Sam Rivers · Riga'],
];

const XR = ({ item, sub, button, last }: { item: Item; sub: ReactNode; button: ReactNode; last?: boolean }) => (
  <div className={`xp-row${last ? ' last' : ''}`}>
    <div className={`ic c${item.color}`} aria-hidden>{item.name[0]}</div>
    <div className="grow"><div className="trunc">{item.name}</div><div className="s">{sub}</div></div>
    {button}
  </div>
);

const CardList = () => (
  <>
    <Gh>Cards for This Page</Gh>
    <div className="xp-card">{cards.map((c, i) => <XR key={c.id} item={c} sub={cardSub(c)} button={<FillBtn />} last={i === cards.length - 1} />)}</div>
  </>
);
const AddressList = ({ title = 'Addresses for This Page' }: { title?: string }) => (
  <>
    <Gh>{title}</Gh>
    <div className="xp-card">{identities.map(([it, sub], i) => <XR key={it.id} item={it} sub={sub} button={<FillBtn />} last={i === identities.length - 1} />)}</div>
  </>
);

const OpenPsss = <button className="btn pri">Open Psss</button>;

const Result = ({ code }: { code: 'none' | 'stored' }) => (
  <div className="isf-pad">
    {code === 'none'
      ? <><Notice kind="info" title="Filled Everyday Visa">Name on card, card number and expiry are in the form.</Notice><div>Tap the security code field and enter the code from your card.</div></>
      : <Notice kind="info" title="Filled Everyday Visa">Name on card, card number, expiry and security code are in the form.</Notice>}
  </div>
);

const Dep = ({ children }: { children: ReactNode }) => <li>{children}</li>;

export function IosSafariFill() {
  return (
    <Page
      title="Cards and addresses in Safari (iPhone and iPad)"
      status={<><strong>Approved by the owner, 2026-11-26: frames 0 to 7b and 9, and the popup states 5b and 10 to 21 (14b and 15c included).</strong> The extension target, its handler, the popup and the app side (4b, 16a, 17a, 17b) are built and left out of Release builds. The owner’s top priority: iOS has no third-party AutoFill for cards or addresses, so Psss adds a Safari extension whose popup fills a card or an address into the checkout form. Safari’s words and behaviour were checked in the iOS 27.2 simulator; a real iPhone and the iPad still need a check. Two owner decisions shape it: after unlocking in Psss, Safari receives only a copy of one vault’s cards and addresses, never the vault’s key; and the security code fills with the card’s other fields in one tap.</>}
    >
      <Clarity
        intro={<p>On a checkout page the person opens Psss from Safari’s page menu, picks a card or an address and taps Fill. The popup is a small web page in a sheet that Safari draws; the card data comes from the vault, is shown only as network, last four digits and expiry, and goes into the page only on that tap.</p>}
        items={[
          ['Which thing?', 'The Psss extension in Safari on iPhone and iPad. It fills one saved card, or one saved address (name, street, city, postal code, email, phone), into the page in front of the person. It does not save, generate or fill logins here: system AutoFill does that.'],
          ['What must they give?', 'The extension turned on in Settings (once), one tap on Psss in Safari’s page menu, one tap on Fill. A locked vault first needs Open Psss, Open on Safari’s question, Face ID or the vault password in Psss, and the way back.'],
          ['What can go wrong?', 'The vault is locked, there are no cards, the page has no card or address fields Psss recognizes, or its card fields sit inside the payment provider’s own frame. Or Safari has not allowed the page, the page is not HTTPS or changed, the list was out of date, only part or nothing was filled, or Psss could not share with Safari (frames 10 to 18b), Psss may be unable to confirm what was filled (14b), and there may be no addresses (5b) or no vault yet (20). Each notice says what happened and what to do.'],
          ['Where does it live?', 'Cards and addresses stay in the vault, in iCloud Drive or where the person put it. Nothing is uploaded. The page receives only the values of the fields that are filled, on the tap.'],
          ['Who holds the key?', 'Psss. Face ID opens the vault in Psss, as everywhere. Safari then receives only a copy of that one vault’s cards (with saved security codes) and addresses, kept in the Keychain on this device. It gets no vault key and cannot open the vault or read passwords, passkeys, verification codes or notes (owner, 2026-11-26).'],
          ['How do they leave?', 'Done, or swipe the sheet down. Looking and filling change nothing in the vault. Turning it off: Settings › Apps › Safari › Extensions › Psss.'],
        ]}
      />

      <Section title="1. Opening it">
        <p>Safari on iPhone and iPad gives an extension no button of its own on the keyboard bar and no way to open by itself when a card field is tapped. The person turns it on once at Settings › Apps › Safari › Extensions › Psss › Allow Extension, then opens it from Safari’s page menu (the button at the left of the address bar, with a puzzle badge; on iPad the puzzle button in the toolbar, not yet checked). Safari’s own saved cards keep their keyboard-bar suggestion; Psss cannot add to it.</p>
      </Section>
      <Frames>
        <Frame phone label="0 · The extension in Settings" caption="Settings › Apps › Safari › Extensions › Psss. iOS draws the page; the description is Psss’s own text, approved by the owner.">
          <ExtensionSettings />
        </Frame>
        <Frame phone label="1 · The page menu" caption="On the checkout page: the page menu button at the left of the address bar, then Psss, above Describe Extension and Manage Extensions. Safari draws the menu; these are the iOS 27.2 words, and other versions differ. There is no shortcut on the keyboard bar, and the popup does not open when a field is tapped; Help says so, and turning the extension on is on the Safari extension reminder page.">
          <SafariPhone menu />
        </Frame>
      </Frames>

      <Section title="2. Choosing and filling a card">
        <p>The popup uses the Mac popup’s rows: letter tile, name over a second line (network, last four digits and expiry for a card; full name and city for an address, as the address list draws it; never cut short), one labeled Fill button on every row. Safari draws the sheet and its Done button; Psss draws what is inside. The header is the Psss mark and, with two or more vaults, the vault select. The card number never appears in full here.</p>
      </Section>
      <Frames>
        <Frame phone label="2 · A card form, with an address too" caption="The page has card and address fields, so there are two groups, cards first. Each heading says the kind, because “For This Page” alone would not. An expired card is left out of the list (it stays in the app).">
          <SafariPhone sheet={<><PHead /><CardList /><AddressList /></>} />
        </Frame>
        <Frame phone label="3a · After Fill, no security code saved" caption="The form is filled with name, number and expiry; the sentence names only what was written (part filled: frame 15a). The security code field is focused and the popup says to tap it and enter the code. Done at the top closes the sheet. Safari raises the number keyboard while the popup is open, but drops it when the popup closes.">
          <SafariPhone filled cvv="focus" sheet={<><PHead /><Result code="none" /></>} />
        </Frame>
        <Frame phone label="3a, after Done · Keyboard down" caption="The sheet is closed. The focus ring stays on the security code field, but the keyboard has gone down: the person taps the field to bring it back.">
          <SafariPhone filled cvv="focus" />
        </Frame>
        <Frame phone label="3b · After Fill, security code saved" caption="Owner decision, 2026-11-26: one Fill writes the card’s name, number, expiry and saved security code together. There is no separate Fill Security Code tap. The code is never shown in the popup, and the tap on Fill is the deliberate action.">
          <SafariPhone filled cvv="filled" sheet={<><PHead /><Result code="stored" /></>} />
        </Frame>
      </Frames>

      <Section title="3. A locked vault">
        <p>An extension on iOS most likely cannot show Face ID: its handler has no screen, and a Keychain read that asks for Face ID needs an app in front. So the main path sends the person to Psss. The notice says why, the button asks Safari to open Psss (from the person’s tap), the popup closes so Safari’s question can be seen, and after Open Psss unlocks with Face ID and tells the person to go back. The system’s “◀ Safari” link in the status bar takes them back to the same page, with what they typed kept.</p>
        <p><strong>If a device test shows Face ID works from the extension</strong>, the notice carries <em>Unlock with Face ID</em> beside the vault select, as on the Mac, and the trip to Psss (4a·2 to 4c) is not needed. Not drawn: it is a possibility, not the plan.</p>
      </Section>
      <Frames>
        <Frame phone label="4a · Passwords is locked" caption="A notice in the vault-notice style with one labeled button. The cards stay hidden. Open Psss only opens the app; nothing is unlocked by it. The same words for every locked vault, whether it opens with Face ID, Touch ID or its password.">
          <SafariPhone sheet={<><PHeadLocked /><Notice kind="info" action={OpenPsss}>Passwords is locked. Open Psss to unlock it.</Notice></>} />
        </Frame>
        <Frame phone label="4a·2 · Safari asks" caption="After Open Psss the popup closes and Safari asks over the checkout page. Open goes to Psss. Cancel leaves the page as it was. Safari draws the question and its words.">
          <SafariPhone ask />
        </Frame>
        <Frame phone label="4b · In Psss, after unlocking" caption="Psss says that the vault is unlocked and what to do next. Done goes to the vault; leaving Psss closes the screen too. The status bar’s ◀ Safari link is the system’s.">
          <IPhone>
            <Back />
            <div className="isf-pad" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 24 }}>
              <div className="t">Passwords is unlocked</div>
              <div>Go back to Safari and tap Psss again.</div>
              <button className="btn plain">Done</button>
            </div>
          </IPhone>
        </Frame>
        <Frame phone label="4c · Back in Safari" caption="The person opens Psss from the menu again and sees frame 2. The tap on Fill is still needed: unlocking never fills by itself.">
          <SafariPhone sheet={<><PHead /><CardList /></>} />
        </Frame>
      </Frames>

      <Section title="4. No cards, only an address form, nothing recognized">
        <p>Each message names what Psss found and what to do. “Recognized” means the field is labelled for card or address by its HTML (autocomplete tokens, names, labels), as the Mac popup decides.</p>
      </Section>
      <Frames>
        <Frame phone label="5 · No cards in Passwords" caption="Shown on a card form when the current vault has none. One way on: the labeled button. With two vaults the line also says to choose another vault.">
          <SafariPhone sheet={<><PHead /><Notice kind="info" title="No cards in Passwords" action={OpenPsss}>Add a card in Psss. Or choose another vault above.</Notice></>} />
        </Frame>
        <Frame phone label="5b · No addresses in Passwords" caption="Shown on an address form when the chosen vault is ready and holds no address. Laid out like frame 5, and Open Psss uses the same link as there. If the page also has card fields, the cards are listed with this notice.">
          <SafariPhone form="address" sheet={<><PHead /><Notice kind="info" title="No addresses in Passwords" action={OpenPsss}>Open Psss to add one.</Notice></>} />
        </Frame>
        <Frame phone label="6 · A delivery form" caption="Only address fields on the page, so only the Addresses group. Fill writes every field Psss recognizes: name, company, street, city, region, postal code, country, email and phone. Separate first and last name fields are filled only from a two-word name (owner, 2026-11-26). Other fields are left alone. The address item is described under Depends on.">
          <SafariPhone form="address" sheet={<><PHead /><AddressList title="Addresses for This Page" /></>} />
        </Frame>
        <Frame phone label="7a · No card or address fields" caption="The words say what was looked for. There is no search field and no “fill anyway”, see Decisions.">
          <SafariPhone form="none" sheet={<><PHead /><Notice kind="info">Psss found no card or address fields on this page.</Notice></>} />
        </Frame>
        <Frame phone label="7b · Card fields inside a payment frame" caption="Many shops show the card form from their payment provider inside a frame of its own. Psss fills the page itself, not other sites’ frames, so it says so. What to do instead: the card’s page in Psss (Copy). This is a guess made from outside the frame; when Psss is unsure it shows the words of 7a. Whether fields in frames can be filled safely is a separate decision (docs/autofill.md). Open Psss only opens the app, for copying; it does not ask to share with Safari.">
          <SafariPhone form="frame" sheet={<><PHead /><Notice kind="info" title="Card fields are in a payment frame">This page’s card form belongs to its payment provider, so Psss can’t fill it. Open Psss to copy the number.</Notice><button className="btn wide">Open Psss</button></>} />
        </Frame>
      </Frames>

      <Section title="5. Turning it on, and the iPad">
        <p>The extension is off until the person allows it. The card that says so, its steps sheet and the Settings row are on <a href="#/safari-extension-reminder">Safari extension reminder</a>; they replace frame 8, the first-run card, which is no longer drawn here.</p>
      </Section>
      <Frames>
        <Frame phone label="8 · First-run card: replaced" caption="Nothing to build from this number.">
          <div className="dt isf-note">Replaced by <a href="#/safari-extension-reminder">Safari extension reminder</a> (2026-11-26).</div>
        </Frame>
        <Frame label="9 · iPad: a popover from the toolbar" caption="On iPad Safari shows an extension button (puzzle piece) in the toolbar and the popup opens as a popover under it, with the same content as the iPhone sheet. Same rows, same notices, same Done.">
          <IPad>
            <div className="isf-ipad">
              <div className="isf-itool"><span aria-hidden>‹ ›</span><span className="url">🔒 harborshop.example</span><span className="pz on" aria-label="Extensions">⧉</span><span aria-hidden>⇪</span></div>
              <div className="isf-ibody">
                <div><div className="t">Delivery</div><In label="Full name" value="Sam Rivers" /><In label="Street address" value="12 Harbour Road" /><In label="City" value="Riga" /></div>
                <div><div className="t">Pay</div><In label="Name on card" /><In label="Card number" /><div className="isf-row2"><In label="Expiry" /><In label="Security code" /></div></div>
              </div>
              <div className="isf-pop" role="dialog" aria-label="Psss"><PHeadLocked /><CardList /></div>
            </div>
          </IPad>
        </Frame>
      </Frames>

      <Section title="6. The page cannot be filled">
        <p>No message shows how long Safari may fill, and Safari gets cards and addresses only. On iPad the same words and buttons show in the popover of frame 9, so there are no separate iPad frames.</p>
      </Section>
      <Frames>
        <Frame phone label="10 · Safari has not allowed the page" caption="Safari refuses to let Psss read the page in front. The popup has no list, so no vault select. It does not send the person to a Settings path that has not been checked, and never asks to allow all websites. Not seen in the simulator, which asked nothing; the wording needs a real iPhone.">
          <SafariPhone sheet={<><PHeadBare /><Notice kind="warning" title="Safari hasn’t allowed Psss on this page">Nothing was filled. Close this, open Psss again, and allow it if Safari asks.</Notice></>} />
        </Frame>
        <Frame phone label="11 · The page is not HTTPS" caption="The popup checks the address before asking Psss for anything, and the handler refuses it too. No Open Psss button: the message should not lead to typing a card into this page.">
          <SafariPhone url="Not Secure" sheet={<><PHeadBare /><Notice kind="warning" title="This page isn’t secure">Psss fills only pages that use HTTPS. Nothing was filled.</Notice></>} />
        </Frame>
        <Frame phone label="12 · The page changed before Fill" caption="Between the list and the tap on Fill, the tab went to another site, or another tab came to the front. The popup checks before asking for the values and again before writing.">
          <SafariPhone url="pay.harbor.example" sheet={<><PHead /><Notice kind="warning" title="The page changed">Nothing was filled. Close this and open Psss again.</Notice></>} />
        </Frame>
        <Frame phone label="13 · Fill is no longer allowed (frame 4a again)" caption="The list was showing, but by the tap on Fill Psss no longer lets Safari fill: the vault was locked, or the permission ran out. The popup replaces the list with frame 4a’s notice, starting with “Nothing was filled.”">
          <SafariPhone sheet={<><PHeadLocked /><Notice kind="info" action={OpenPsss}>Nothing was filled. Passwords is locked. Open Psss to unlock it.</Notice></>} />
        </Frame>
        <Frame phone label="13b · The list was out of date at Fill" caption="The card or address tapped is no longer in what Safari was given (for example Psss was unlocked again since the list was drawn). The popup asks for the list again, shows it and says to tap again. If the chosen vault is no longer ready, it shows its locked notice instead.">
          <SafariPhone sheet={<><PHead /><Notice kind="warning">Nothing was filled. Tap Fill again.</Notice><CardList /></>} />
        </Frame>
      </Frames>

      <Section title="7. Nothing or only part was filled">
        <p>The popup learns which fields were written, never their values, and builds the sentence from that: the fields in the form in the page’s order, then the fields that have a saved value and a place on the page but were not written. A field the page does not have is not mentioned. A card whose number the page does not keep gets nothing else, so it shows frame 14.</p>
      </Section>
      <Frames>
        <Frame phone label="14 · Nothing was filled" caption="The fields were hidden, read-only, too short, gone, or did not keep the value. The same words for an address, with its name. Open Psss here only opens the app, to copy from the item; it does not ask to share with Safari.">
          <SafariPhone sheet={<><PHead /><Notice kind="warning" title="Nothing was filled" action={OpenPsss}>This page’s fields didn’t take Everyday Visa. Open Psss to copy the details.</Notice></>} />
        </Frame>
        <Frame phone label="14b · The result is unknown" caption="The values went to the page, but it gave no clear answer back, or may still hold some of what it did not keep. The popup claims neither success nor failure. Open Psss only opens the app, for copying.">
          <SafariPhone sheet={<><PHead /><Notice kind="warning" title="Check the form" action={OpenPsss}>Psss couldn’t confirm what was filled. Check the fields on this page, or open Psss to copy the details.</Notice></>} />
        </Frame>
        <Frame phone label="15a · Part of a card" caption="Here the expiry list on the page had no matching choice. One missed field says “it”, several say “them”. Done at the top closes the sheet.">
          <SafariPhone filled cvv="filled" missed="expiry" sheet={<><PHead /><Notice kind="warning" title="Partly filled Everyday Visa">Name on card, card number and security code are in the form. Expiry was not filled. Type it on the page.</Notice></>} />
        </Frame>
        <Frame phone label="15b · Part of an address" caption="Here the phone field was too short for the saved number, so it was left empty rather than cut.">
          <SafariPhone form="address" filled missed="phone" sheet={<><PHead /><Notice kind="warning" title="Partly filled Home">Name, street address, postal code, city and email are in the form. Phone was not filled. Type it on the page.</Notice></>} />
        </Frame>
        <Frame phone label="15c · Part of one field" caption="The street has two lines and only the first box was written. The street address is then named neither as in the form nor as not filled, because both would be false. The same sentence says “name” (one of first and last name written) or “expiry” (a month without its year).">
          <SafariPhone form="address" filled missed="street2" sheet={<><PHead /><Notice kind="warning" title="Partly filled Home">Name, postal code, city, email and phone are in the form. Part of the street address was not filled. Check it on the page.</Notice></>} />
        </Frame>
      </Frames>

      <Section title="8. Psss could not share, or was already open" />
      <Frames>
        <Frame phone label="16a · In Psss: could not share" caption="Shown instead of frame 4b when Psss could not save the copy for Safari. The vault stays unlocked in Psss. Try Again saves the copy once more; Done goes to the vault.">
          <AppScreen title="Couldn’t share with Safari" text="Passwords is unlocked, but Safari can’t fill from it.">
            <button className="btn pri wide">Try Again</button>
            <button className="btn plain">Done</button>
          </AppScreen>
        </Frame>
        <Frame phone label="16b · In Safari: Psss can’t answer" caption="Psss in Safari cannot read what the app saved or the vault list, or gets a reply it does not understand. No vault name or select, because there is no list. No error codes.">
          <SafariPhone sheet={<><PHeadBare /><Notice kind="warning" title="Psss can’t fill right now" action={OpenPsss}>Nothing was filled. Open Psss, then try again in Safari.</Notice></>} />
        </Frame>
        <Frame phone label="17a · Psss was already open" caption="After Open Psss, an unlocked Psss asks for Face ID again before Safari gets anything. Face ID starts by itself; the system draws it. A device with Touch ID says Touch ID; one without either says “Use your passcode to let Safari fill its cards and addresses.” The passcode is also the fallback when Face ID fails. Success shows frame 4b.">
          <AppScreen title="Fill from Passwords in Safari" text="Use Face ID to let Safari fill its cards and addresses." overlay={<BioPrompt bio="Face ID" reason="" />} />
        </Frame>
        <Frame phone label="17b · Face ID cancelled or failed" caption="Nothing was given to Safari. One button asks again (“Use Passcode” without Face ID or Touch ID); Cancel goes to the vault. When the check cannot run or fails for another reason than Cancel, the reason shows in grey above the button. The ◀ Safari link still works.">
          <AppScreen title="Fill from Passwords in Safari" text="Use Face ID to let Safari fill its cards and addresses.">
            <button className="btn pri wide">Use Face ID</button>
            <button className="btn plain">Cancel</button>
          </AppScreen>
        </Frame>
      </Frames>

      <Section title="9. Another vault">
        <p>Safari has the cards and addresses of one vault at a time. Choosing another vault shows that it is locked; nothing from the first vault is shown under its name. Unlocking the second one replaces what Safari had, so the first then shows as locked.</p>
      </Section>
      <Frames>
        <Frame phone label="18a · Choosing another vault" caption="Passwords is ready. The vault select is a plain web list with names only, as in the Mac popup.">
          <SafariPhone sheet={<><PHeadVault name="Passwords" menu /><CardList /></>} />
        </Frame>
        <Frame phone label="18b · Work is locked" caption="Open Psss goes to Work’s unlock, with Face ID, Touch ID or its password; the words are the same for each. Choosing Passwords again shows its cards at once, as long as Safari may still fill from it.">
          <SafariPhone sheet={<><PHeadVault name="Work" /><Notice kind="info" action={OpenPsss}>Work is locked. Open Psss to unlock it.</Notice></>} />
        </Frame>
      </Frames>

      <Section title="10. No vault yet, and the first load">
        <p>On iPad the same content shows in the popover.</p>
      </Section>
      <Frames>
        <Frame phone label="20 · No vault set up yet" caption="Psss answers with an empty vault list: no vault has been created or opened, or every one was removed. No vault select. Open Psss only opens the app, which offers to create or open a vault; there is nothing to share yet.">
          <SafariPhone sheet={<><PHeadBare /><Notice kind="info" title="No vault yet" action={OpenPsss}>Open Psss to create or open a vault. Then come back to Safari and try again.</Notice></>} />
        </Frame>
        <Frame phone label="21 · Waiting for the first answer" caption="Shown from the moment the popup asks until Psss answers. The first answer took about 8 seconds in the simulator, later ones were immediate. The answer replaces this with the list, a locked notice or frame 20. If the request fails, or nothing comes back and the popup stops waiting, it shows frame 16b; an answer that arrives after that is ignored. Done leaves at any time.">
          <SafariPhone sheet={<><PHeadBare /><Notice kind="progress">Loading cards and addresses…</Notice></>} />
        </Frame>
      </Frames>

      <Section title="Depends on">
        <div className="isf-note">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <Dep><strong>Face ID in the extension (not proven).</strong> The simulator allowed it, which proves nothing about a device. If a real iPhone allows it, bring that to the owner.</Dep>
            <Dep><strong>The copy Psss makes.</strong> The extension runs in its own process. After Face ID in Psss the app leaves it a copy of that vault’s cards and addresses in one Keychain item, so the extension never opens the vault file (owner, 2026-11-26, decision below).</Dep>
            <Dep><strong>Signing.</strong> Needs the paid team (3549F795T2) for the extension target, its own shared Keychain group and the App Group.</Dep>
            <Dep><strong>An address item.</strong> Frames 2 and 6 use it, with name, street, city, postal code, country, email and phone. Approved and built as <a href="#/address-item">Addresses: a new item kind</a>; its row is the full name and the city.</Dep>
          </ul>
        </div>
      </Section>

      <Section title="Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>Owner, 2026-11-26:</strong> every locked vault says “&lt;Vault&gt; is locked. Open Psss to unlock it.” (4a, 13, 18b).</>,
            rejected: <>“with Face ID” in the popup; telling Safari how each vault unlocks.</>,
            why: <>The popup is not told whether a vault uses Face ID, Touch ID or only its password, and these words are true for all three.</>,
          },
          {
            decision: <>A failed Fill says “Nothing was filled” or names what was and was not filled. A lock noticed on the tap starts with the same words (13). A list that is out of date is loaded again with “Nothing was filled. Tap Fill again.” (13b).</>,
            rejected: <>closing the popup silently; a raw error word; reloading the list without saying why.</>,
            why: <>The person has to know whether to check the form before paying.</>,
          },
          {
            decision: <>Open Psss after nothing was filled or on a payment frame (14, 7b) only opens the app, for copying. It does not start sharing with Safari.</>,
          },
          {
            decision: <>“Safari hasn’t allowed Psss” and “This page isn’t secure” have no button of their own: Safari’s Done is the way out. Release builds fill HTTPS pages only.</>,
            rejected: <>Open Psss on an insecure page; a Settings path that has not been checked on a device.</>,
          },
          {
            decision: <>An already open Psss asks for Face ID again before Safari gets the copy (17a, 17b). When sharing fails, Psss offers Try Again and Done (16a).</>,
            rejected: <>giving Safari the copy at once.</>,
            why: <>Any web page can ask Psss to open; the check makes sure the person means it.</>,
          },
          {
            decision: <>With no vault, the popup says “No vault yet” and offers Open Psss, which only opens the app (20).</>,
            rejected: <>an empty list; “Passwords is locked” for a vault that does not exist.</>,
          },
          {
            decision: <>While waiting for the first answer, a spinner and “Loading cards and addresses…” (21). After 20 seconds, a number never shown to the person, the popup stops waiting and shows 16b; a later answer is ignored.</>,
            rejected: <>a blank sheet; waiting with no end.</>,
            why: <>Nothing else ends the wait if no answer comes back. 20 seconds is about twice the slowest first answer seen (9.5 s in the simulator on a busy Mac).</>,
          },
          {
            decision: <>No result in the popup has a large Done button (3a, 3b, 15a, 15b): Safari’s Done at the top is the one way to close.</>,
            rejected: <>a second, large Done under the result.</>,
          },
          {
            decision: <>When Psss cannot confirm what was filled, the popup says “Check the form” and offers Open Psss, which only opens the app (14b).</>,
            rejected: <>claiming the form was filled, or that nothing was.</>,
            why: <>Either claim could be false, and the person may be about to pay.</>,
          },
          {
            decision: <>A field written only in part gets its own sentence in the partly filled notice: “Part of the street address was not filled. Check it on the page.”, also for “name” and “expiry” (15c).</>,
            rejected: <>listing that field as in the form or as not filled.</>,
          },
          {
            decision: <>An address form with a ready vault holding no addresses says “No addresses in &lt;Vault&gt;. Open Psss to add one.”, laid out like the no-cards notice and with the same link (5b).</>,
          },
          {
            decision: <>Cards are filled with one tap on Fill: cardholder, number, expiry and a saved security code go in together (owner, 2026-11-26). With no code saved, the field is focused and the popup says “Tap the security code field and enter the code from your card.”</>,
            rejected: <>a separate <strong>Fill Security Code</strong> tap after the first Fill (the earlier draft: it kept the code behind its own deliberate action, docs/items.md); a separate Fill on each field.</>,
            why: <>The owner wants one tap. The tap on Fill on a recognized card form is the deliberate action, and the popup never shows or copies the code. The cost is that the code is in the page on the same tap as the number, so the rule that only recognized fields on the page itself are filled matters more (next decision).</>,
          },
          {
            decision: <>No search field and no “fill a card anyway into fields Psss did not recognize” (frame 7a). When nothing is recognized the popup says so and stops.</>,
            rejected: <>a search to pick a card for any page; a pick-a-field mode.</>,
            why: <>A card number written into a field Psss did not identify can land in a hidden input, a lookalike form or a script’s field, and a fake checkout could ask for it. Recognized fields on the page itself are the safety rule. The single-field route in the iOS text-insertion sheet (docs/autofill.md) covers a mislabeled form, where the person aims the value.</>,
          },
          {
            decision: <>A locked vault sends the person to Psss: notice with a labeled Open Psss button, unlocking in the app, a line saying to go back to Safari and tap Psss again. Face ID inside the popup is only a possibility if a device test shows it works.</>,
            rejected: <>a Face ID button as the main path (an extension handler most likely cannot raise it); a button that says Unlock but opens an app.</>,
            why: <>The button says what it does. It has to be a tap in the popup, because iOS allows opening the app only from one.</>,
          },
          {
            decision: <><strong>Owner, 2026-11-26: after unlocking in Psss, Safari receives only a copy of one vault’s cards and addresses.</strong> Security codes that are saved go with the cards; nothing else of the vault does. Frame 4c then needs no second Face ID. The copy sits in a Keychain item on this device only, readable by Psss and the extension. A time limit of about two minutes exists: after it, and when the vault is locked, the copy is refused and deleted. No screen or message shows the limit.</>,
            rejected: <>the extension holding the <strong>vault’s key</strong>, which opens the whole vault (passwords, passkeys, verification codes and notes too); no access at all, so the extension would need Face ID itself, which it most likely cannot do.</>,
            why: <>The owner chose the key first and switched after the device spike: reading the vault in the extension runs into its memory limit (about 9,000 entries or 14 MiB of attachments, estimated in the simulator), and reaching a vault in iCloud Drive or one picked in Files was not proven. A leaked copy is worth only those cards and addresses.</>,
          },
          {
            decision: <>The extension’s description, shown by iOS (frame 0), is, as approved by the owner: “Fills out credit cards and addresses in forms, which system AutoFill does not do for Psss. Uses the website URL to check the page, and the form fields to match the values.”</>,
            why: <>The website address checks the page; it does not choose values, since cards are not tied to sites. The owner’s first draft said it matched values and that forms were not supported by system AutoFill; both were corrected.</>,
          },
          {
            decision: <>The popup lists cards and addresses for the page: cards first when the page has card fields, addresses when it has address fields. Headings say “Cards for This Page” and “Addresses for This Page”. Rows and Fill are the Mac popup’s.</>,
            rejected: <>one heading “For This Page” over both kinds.</>,
            why: <>A heading that does not say the kind would not tell a card from an address.</>,
          },
          {
            decision: <>The card number is never shown in full in the popup: network, last four digits and expiry only. The popup has no copy or reveal control.</>,
          },
          {
            decision: <>Safari’s website permission stays at <strong>Ask</strong>, not “Allow on all websites”. The popup only needs the page in front of it when tapped.</>,
            rejected: <>telling the person to allow all websites.</>,
            why: <>Least privilege, as on the Mac (docs/browser-extension.md). Whether Safari still asks on first use per site with only the active-tab permission is to verify.</>,
          },
          {
            decision: <>Honest about Safari: no keyboard-bar button and no automatic popup. Help says to open it from the page menu.</>,
          },
          {
            decision: <>Sheet on iPhone, popover on iPad, same content. Safari draws the frame and Done; the extension draws only inside.</>,
          },
        ]}
      />

      <History
        entries={[
          { date: '2026-11-27', text: <>Built, the app side. Frame 4b gained a Done button, as on 16a: it covers the whole window, and a screen must have a visible way out (Apple’s guidance for modal screens; “◀ Safari” is not always there, for example beside Safari on iPad). 17a and 17b gained their wording for a device without Face ID or Touch ID, and the grey line for a check that cannot run. Not yet approved by the owner.</> },
          { date: '2026-11-26', text: <>Owner, built: notices have no coloured background. The icon says the kind (grey circled i, orange triangle, spinner) beside the words; grey replaces the accent-blue information icon, which looked tappable. Replaces the tinted card.</> },
          { date: '2026-11-26', text: <>The owner approved three states that had no agreed words: no addresses in the vault (5b, where the popup would otherwise show nothing), an unknown result (14b) and part of one field filled (15c, where that field was named in neither sentence).</> },
          { date: '2026-11-26', text: <>The owner approved frames 20 (no vault yet) and 21 (first load) as drawn, with a 20 second wait before 16b that is never shown, and removed the large Done button from 3a and 3b, as already on 15a and 15b, because it doubled Safari’s Done.</> },
          { date: '2026-11-26', text: <>The owner approved frames 10 to 19 with changes. Every locked vault now says “Open Psss to unlock it.” (replacing “with Face ID” in 4a, 13 and 18b), so frame 19, the vault that needs its password, no longer differed and was merged into 18b. Frame 13 now starts with “Nothing was filled.”; 13b was added for a list that is out of date at Fill; the large Done button left 15a and 15b. Open Psss on 7b and 14 only opens the app; names are split only for two-word names; release builds fill HTTPS only. Frames 20 (no vault yet) and 21 (first load) were drawn as new proposals.</> },
          { date: '2026-11-26', text: <>Added proposals awaiting approval, frames 10 to 19, because the build plan listed states the approved page did not draw: Safari not allowing the page, not HTTPS, page changed, permission gone before Fill (frame 4a again), nothing or part filled, Psss could not share (app and popup), Face ID when Psss was already open, a second locked vault, and a vault that needs its password. Captions of 3a, 4a, 6 and 7b now follow what the code can do (sentence built from what was written; every recognized address field, replacing the shorter list; payment frame is a guess that falls back to 7a). Frame 8 is shown as replaced. No frame or message shows a time limit, so the plan’s suggested “for two minutes” line was not used (owner’s decision).</> },
          { date: '2026-11-26', text: <>After the device spike the owner replaced the vault key in Safari with a copy of one vault’s cards and addresses (memory limit; iCloud Drive and picked files not proven); added the Settings page with the owner’s description (0), Safari’s “Open this page in “Psss”?” (4a·2) and the keyboard going down after the popup closes; frame 3a now says to tap the code field (was “Enter the security code from your card.”), and the ᴀA menu and old toolbar became the iOS 27.2 page menu and address bar.</> },
          { date: '2026-11-26', text: <>Owner approved frame 4b without a line saying Safari now has access.</> },
          { date: '2026-11-26', text: <>Owner decisions. (1) No screen, button or message shows a time limit: frame 4b lost its line saying how long the vault stays open for Safari, because the limit stays but is not something the person has to manage. (2) “A short read permission” became what it is: the extension holds the vault’s key and can open the whole vault, while filling only cards and addresses; a cards-and-addresses-only copy was rejected and the risk of a leaked key accepted. (3) Frame 8, the first-run card, was removed; <a href="#/safari-extension-reminder">Safari extension reminder</a> replaces it.</> },
          { date: '2026-11-26', text: <>Approved by the owner with two changes. (1) The short read permission after unlocking in Psss, about two minutes and cleared on lock, is approved (was an open decision). (2) The security code fills with the card’s other fields in one tap: frame 3b no longer shows a Fill Security Code button, and the separate-tap option moved to rejected. Address rows read full name · city, to match <a href="#/address-item">Addresses</a> (were street and city).</> },
          { date: '2026-11-25', text: <>New page, at the owner’s request (very critical): iOS has no third-party AutoFill for payment cards or addresses. Frame 4 follows the coordinator’s research: the main unlock path is Open Psss and back, because an iOS extension handler most likely cannot show Face ID; the grant after unlocking is an open decision.</> },
        ]}
      />
    </Page>
  );
}
