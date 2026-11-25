import type { ReactNode } from 'react';
import { Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPad, IPhone } from '../components/devices';
import { ListRow } from '../components/Rows';
import { Notice } from '../components/Notice';
import { VaultRow } from '../components/VaultRow';
import { Mark } from './Logo';
import { FillBtn, gitforge, harbor } from '../components/loginParts';
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

/** A checkout page. `filled` shows what Fill wrote; `cvv` marks the security code field focused or filled. */
function Checkout({ form, filled, cvv }: { form: Form; filled?: boolean; cvv?: 'focus' | 'filled' }) {
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
        <div className="isf-row2"><In label="Postal code" value={filled ? 'LV-1010' : undefined} /><In label="City" value={filled ? 'Riga' : undefined} /></div>
        <In label="Email" value={filled ? 'sam@harbor.example' : undefined} />
        <In label="Phone" value={filled ? '+371 2000 0000' : undefined} />
      </div>
    );
  }
  return (
    <div className="isf-page"><div className="t">Pay · Harbor Shop</div>
      <In label="Name on card" value={filled ? 'Sam Rivers' : undefined} />
      <In label="Card number" value={filled ? '4929 3741 0268 4417' : undefined} />
      <div className="isf-row2"><In label="Expiry" value={filled ? '08/28' : undefined} /><In label="Security code" on={cvv === 'focus'} value={cvv === 'filled' ? '•••' : undefined} /></div>
    </div>
  );
}

const Back = () => <div className="isf-lbl" style={{ padding: '0 16px 4px', color: 'var(--accent)' }}>◀ Safari</div>;

/** Safari on iPhone: the page, the address bar capsule with ᴀA, and (when asked) the page menu or Psss's popup sheet. */
function SafariPhone({ form = 'card', filled, cvv, menu, sheet, url = 'harborshop.example' }: { form?: Form; filled?: boolean; cvv?: 'focus' | 'filled'; menu?: boolean; sheet?: ReactNode; url?: string }) {
  return (
    <IPhone>
      <Checkout form={form} filled={filled} cvv={cvv} />
      <div className="isf-safari">
        <div className="isf-cap"><span className={`isf-aa${menu ? ' on' : ''}`}>ᴀA</span><span>🔒 {url}</span><span aria-hidden>↻</span></div>
        <div className="isf-tools" aria-hidden><span>‹</span><span>›</span><span>⇪</span><span>▯</span><span>⧉</span></div>
      </div>
      {menu && (
        <div className="isf-menu" role="menu">
          <div className="isf-mi"><span>ᴀ  100%  A</span></div>
          <div className="isf-mi">Show Reader</div>
          <div className="isf-mi">Website Settings</div>
          <div className="isf-mi">Request Desktop Website</div>
          <div className="isf-msep" />
          <div className="isf-mi hl"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="isf-mark"><Mark u={0.22} mask /></span>Psss</span></div>
          <div className="isf-mi">Manage Extensions</div>
        </div>
      )}
      {sheet && <><div className="isf-dim" /><div className="isf-sheet" role="dialog" aria-label="Psss"><div className="isf-grab" />{sheet}</div></>}
    </IPhone>
  );
}

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

const Gh = ({ children }: { children: ReactNode }) => <div className="isf-grp-h">{children}</div>;

const cards = cardItems.filter((c) => !c.expired).slice(0, 2);
const cardSub = (c: Item) => `${c.brand === 'American Express' ? 'Amex' : c.brand} •• ${c.last4} · ${c.account.split('· ')[1]}`;
const identities: [Item, string][] = [
  [{ id: 31, name: 'Home', account: '', kind: 'custom', color: 5, uses: 0, fields: [] } as Item, '12 Harbour Road, Riga'],
  [{ id: 32, name: 'Work', account: '', kind: 'custom', color: 4, uses: 0, fields: [] } as Item, '4 Quay Street, Riga'],
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
    <Notice kind="info" title="Filled Everyday Visa">Name on card, card number and expiry are in the form.</Notice>
    {code === 'none'
      ? <div>Enter the security code from your card.</div>
      : <><div className="s">Everyday Visa has a security code saved. It is filled only when you ask.</div><button className="btn pri wide">Fill Security Code</button></>}
  </div>
);

const Dep = ({ children }: { children: ReactNode }) => <li>{children}</li>;

export function IosSafariFill() {
  return (
    <Page
      title="Cards and addresses in Safari (iPhone and iPad)"
      status={<><strong>Proposal (2026-11-25), not built.</strong> The owner’s top priority: iOS has no third-party AutoFill for cards or addresses, so Psss adds a Safari extension whose popup fills a card or an address into the checkout form. Drawn from what Safari on iOS allows as best known; each frame marked “verify” needs a device check.</>}
    >
      <Clarity
        intro={<p>On a checkout page the person opens Psss from Safari’s page menu, picks a card or an address and taps Fill. The popup is a small web page in a sheet that Safari draws; the card data comes from the vault, is shown only as network, last four digits and expiry, and goes into the page only on that tap.</p>}
        items={[
          ['Which thing?', 'The Psss extension in Safari on iPhone and iPad. It fills one saved card, or one saved address (name, street, city, postal code, email, phone), into the page in front of the person. It does not save, generate or fill logins here: system AutoFill does that.'],
          ['What must they give?', 'One tap to turn the extension on in Settings (once), one tap on Psss in Safari’s menu, one tap on Fill. A locked vault needs Face ID in Psss first.'],
          ['What can go wrong?', 'The vault is locked, there are no cards, the page has no card or address fields Psss recognizes, or its card fields sit inside the payment provider’s own frame. Each notice says what to do.'],
          ['Where does it live?', 'Cards and addresses stay in the vault, in iCloud Drive or where the person put it. Nothing is uploaded. The page receives only the values of the fields that are filled, on the tap.'],
          ['Who holds the key?', 'Face ID opens the vault in Psss, as everywhere. If the unlock is left for Safari for a few minutes (open decision, see Depends on), the extension can read the vault without asking again until that ends or the vault locks.'],
          ['How do they leave?', 'Done, or swipe the sheet down. Looking and filling change nothing in the vault. Turning it off: Settings › Apps › Safari › Extensions › Psss.'],
        ]}
      />

      <Section title="1. Opening it">
        <p>Safari on iPhone and iPad gives an extension no button of its own on the keyboard bar and no way to open by itself when a card field is tapped. The person opens it from Safari’s page menu (ᴀA in the address bar; the puzzle button in the toolbar on iPad). Safari’s own saved cards keep their keyboard-bar suggestion; Psss cannot add to it.</p>
      </Section>
      <Frames>
        <Frame phone label="1 · The page menu" caption="On the checkout page: ᴀA in the address bar, then Psss in the list of extensions. Safari draws the menu and its rows differ by iOS version (verify on a device). There is no shortcut on the keyboard bar, and the popup does not open when a field is tapped; the first-run card (frame 8) and Help say so.">
          <SafariPhone menu />
        </Frame>
      </Frames>

      <Section title="2. Choosing and filling a card">
        <p>The popup uses the Mac popup’s rows: letter tile, name over a second line (network, last four digits and expiry for a card; street and city for an address; never cut short), one labeled Fill button on every row. Safari draws the sheet and its Done button; Psss draws what is inside. The header is the Psss mark and, with two or more vaults, the vault select. The card number never appears in full here.</p>
      </Section>
      <Frames>
        <Frame phone label="2 · A card form, with an address too" caption="The page has card and address fields, so there are two groups, cards first. Each heading says the kind, because “For This Page” alone would not. An expired card is left out of the list (it stays in the app).">
          <SafariPhone sheet={<><PHead /><CardList /><AddressList /></>} />
        </Frame>
        <Frame phone label="3a · After Fill, no security code saved" caption="The form is filled with name, number and expiry. The security code field is focused and the popup says “Enter the security code from your card.” Done closes the sheet. Safari may not raise the keyboard from a script until the field is tapped (verify).">
          <SafariPhone filled cvv="focus" sheet={<><PHead /><Result code="none" /><button className="btn wide">Done</button></>} />
        </Frame>
        <Frame phone label="3b · After Fill, security code saved" caption="Decision: the first Fill never writes a saved security code. It adds one labeled step, Fill Security Code, because the project rule is that the code needs its own deliberate action (docs/items.md). The owner’s alternative is to fill it with the rest; that is one tap fewer and puts all three numbers in the page on one tap.">
          <SafariPhone filled cvv="focus" sheet={<><PHead /><Result code="stored" /><button className="btn wide">Done</button></>} />
        </Frame>
      </Frames>

      <Section title="3. A locked vault">
        <p>An extension on iOS most likely cannot show Face ID: its handler has no screen, and a Keychain read that asks for Face ID needs an app in front. So the main path sends the person to Psss. The notice says why, the button opens Psss (a link, from the person’s tap), Psss unlocks with Face ID and tells the person to go back. Safari’s own “◀ Safari” link in the status bar takes them back.</p>
        <p><strong>If a device test shows Face ID works from the extension</strong>, the notice carries <em>Unlock with Face ID</em> beside the vault select, as on the Mac, and frames 4b and 4c are not needed. Not drawn: it is a possibility, not the plan.</p>
      </Section>
      <Frames>
        <Frame phone label="4a · Passwords is locked" caption="A notice in the vault-notice style with one labeled button. The cards stay hidden. Open Psss only opens the app; nothing is unlocked by it.">
          <SafariPhone sheet={<><PHeadLocked /><Notice kind="info" action={OpenPsss}>Passwords is locked. Open Psss to unlock it with Face ID.</Notice></>} />
        </Frame>
        <Frame phone label="4b · In Psss, after Face ID" caption="Psss shows one line and nothing else new: unlocked, and the way back. The status bar’s ◀ Safari link is the system’s. The vault stays open for Safari for a short time only (open decision).">
          <IPhone>
            <Back />
            <div className="isf-pad" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 24 }}>
              <div className="t">Passwords is unlocked</div>
              <div>Go back to Safari and tap Psss again.</div>
              <div className="s">Passwords stays open for Safari for a few minutes, then locks.</div>
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
        <Frame phone label="6 · A delivery form" caption="Only address fields on the page, so only the Addresses group. Fill writes name, street, city, postal code, email and phone into the fields that exist and leaves the rest alone. An address is an item that does not exist yet in the vault (see Depends on).">
          <SafariPhone form="address" sheet={<><PHead /><AddressList title="Addresses for This Page" /></>} />
        </Frame>
        <Frame phone label="7a · No card or address fields" caption="The words say what was looked for. There is no search field and no “fill anyway”, see Decisions.">
          <SafariPhone form="none" url="harborshop.example/news" sheet={<><PHead /><Notice kind="info">Psss found no card or address fields on this page.</Notice></>} />
        </Frame>
        <Frame phone label="7b · Card fields inside a payment frame" caption="Many shops show the card form from their payment provider inside a frame of its own. Psss fills the page itself, not other sites’ frames, so it says so. What to do instead: the card’s page in Psss (Copy). Whether fields in frames can be filled safely is a separate decision (docs/autofill.md).">
          <SafariPhone form="frame" sheet={<><PHead /><Notice kind="info" title="Card fields are in a payment frame">This page’s card form belongs to its payment provider, so Psss can’t fill it. Open Psss to copy the number.</Notice><button className="btn wide">Open Psss</button></>} />
        </Frame>
      </Frames>

      <Section title="5. Turning it on, and the iPad">
        <p>The extension is off until the person allows it in Settings. The first-run card sits at the top of the Psss list, as the AutoFill card does, and goes away once Psss can see it is on (or Later, for a week).</p>
      </Section>
      <Frames>
        <Frame phone label="8 · The first-run card in Psss" caption="Plain steps, one labeled button. Open Settings opens Safari’s Extensions page at Psss if iOS offers that (SFSafariSettings, to verify), otherwise Psss’s own page in Settings, and the steps still name the way. The steps keep Safari’s permission at Ask, see Decisions.">
          <IPhone tab="all">
            <div style={{ padding: '4px 14px', overflow: 'hidden' }}>
              <div className="isf-card">
                <div className="t">Fill cards and addresses in Safari</div>
                <div>iPhone has no AutoFill for cards or addresses. Turn on Psss in Safari and it fills them for you.</div>
                <ol className="isf-steps">
                  <li>Open Settings › Apps › Safari › Extensions.</li>
                  <li>Tap Psss and turn on Allow Extension.</li>
                  <li>In Safari, tap ᴀA, then Psss, on a checkout page.</li>
                </ol>
                <div style={{ display: 'flex', gap: 8 }}><button className="btn pri">Open Settings</button><button className="btn plain">Later</button></div>
              </div>
              <div className="grp" style={{ margin: '0 -14px' }}>
                <ListRow item={gitforge} traits="passkey" />
                <ListRow item={harbor} traits={false} sub="gitforge.example" />
              </div>
            </div>
          </IPhone>
        </Frame>
      </Frames>
      <Frames>
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

      <Section title="Depends on">
        <div className="isf-note">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <Dep><strong>Face ID in the extension (spike).</strong> Most likely not possible (no foreground UI for the handler). If it is, frame 4 gets “Unlock with Face ID” and 4b and 4c go.</Dep>
            <Dep><strong>A way to read the vault after Psss unlocked it.</strong> The extension runs in its own process. After Face ID in Psss it needs a short-lived grant the app leaves for it (for example a few minutes, cleared when the vault locks). Open owner decision, below.</Dep>
            <Dep><strong>Memory budget.</strong> The extension opens the vault in its own process; iOS limits an extension’s memory (spike S7, <code>ExtensionUnlockBudget</code>), so a large vault may not open.</Dep>
            <Dep><strong>Signing.</strong> Needs the paid team (3549F795T2) for the extension target and its shared Keychain and App Group.</Dep>
            <Dep><strong>An address item.</strong> The vault has cards but no address type yet (docs/items.md: identity records are custom items). Frames 2 and 6 assume one with name, street, city, postal code, country, email and phone. Proposed on <a href="#/address-item">Addresses: a new item kind</a>.</Dep>
          </ul>
        </div>
      </Section>

      <Decisions
        items={[
          {
            decision: <>Cards are filled with Fill on the row; the first Fill writes cardholder, number and expiry. A saved security code is a second, labeled step (<strong>Fill Security Code</strong>). With no code saved, the field is focused and the popup says “Enter the security code from your card.” <strong>Open for the owner:</strong> filling it with the rest.</>,
            rejected: <>filling the code with everything on the first tap; a separate Fill on each field.</>,
            why: <>docs/items.md and docs/browser-extension.md keep the code behind its own deliberate action. One more tap is the price.</>,
          },
          {
            decision: <>No search field and no “fill a card anyway into fields Psss did not recognize” (frame 7a). When nothing is recognized the popup says so and stops.</>,
            rejected: <>a search to pick a card for any page; a pick-a-field mode.</>,
            why: <>A card number written into a field Psss did not identify can land in a hidden input, a lookalike form or a script’s field, and a fake checkout could ask for it. Recognized fields on the page itself are the safety rule. The single-field route in the iOS text-insertion sheet (docs/autofill.md) covers a mislabeled form, where the person aims the value.</>,
          },
          {
            decision: <>A locked vault sends the person to Psss: notice with a labeled Open Psss button, Face ID in the app, a line saying to go back to Safari and tap Psss again. Face ID inside the popup is only a possibility if a device test shows it works.</>,
            rejected: <>a Face ID button as the main path (an extension handler most likely cannot raise it); a button that says Unlock but opens an app.</>,
            why: <>The button says what it does. It has to be a tap in the popup, because iOS allows opening the app only from one.</>,
          },
          {
            decision: <><strong>Open decision: a short-lived grant after unlocking in Psss.</strong> Option A: the app leaves the extension a grant that opens the vault for a few minutes, cleared on lock; frame 4c then works at once. Option B: no grant, so the extension would need Face ID itself, which it most likely cannot do, and the feature could not work.</>,
            why: <>The tradeoff is convenience against a key the extension can read without Face ID for a few minutes. Recommend A with the shortest time that lets a checkout finish (about two minutes), cleared when the app locks.</>,
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
            decision: <>Honest about Safari: no keyboard-bar button and no automatic popup. The first-run card and Help say to open it from ᴀA.</>,
          },
          {
            decision: <>Sheet on iPhone, popover on iPad, same content. Safari draws the frame and Done; the extension draws only inside.</>,
          },
        ]}
      />

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>New page, at the owner’s request (very critical): iOS has no third-party AutoFill for payment cards or addresses. Frame 4 follows the coordinator’s research: the main unlock path is Open Psss and back, because an iOS extension handler most likely cannot show Face ID; the grant after unlocking is an open decision.</> },
        ]}
      />
    </Page>
  );
}
