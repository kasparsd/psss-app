import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import type { Item } from '../data';
import { Notice } from '../components/Notice';
import { BioPrompt } from '../components/BioPrompt';
import { VaultRow, VaultNotice } from '../components/VaultRow';
import { VaultMenu, type VaultState } from '../components/VaultMenu';
import { Caret, FillBtn, Hit, Pills, gitforge, gitforge2, harbor, hosting } from '../components/loginParts';

/* ---------- the browser extension popup ---------- */

/** The popup in a browser window: a toolbar with the Psss button, the popup hanging from it. */
function Browser({ children, title = 'Sign in · Gitforge', url = 'gitforge.example/login', badge, closed, prompt }: { children: ReactNode; title?: string; url?: string; badge?: boolean; closed?: boolean; prompt?: ReactNode }) {
  return (
    <div className="xb macui">
      <div className="xb-bar">
        <span className="lights"><i /><i /><i /></span>
        <div className="xb-url"><span aria-hidden>🔒</span> {url}</div>
        <span className="xb-btn" aria-label={badge ? 'Psss, unlocked' : 'Psss'} style={{ position: 'relative' }}>p{badge && <i className="xb-badge" aria-hidden="true">✓</i>}</span>
      </div>
      <div className="xb-page"><div className="t">{title}</div><div className="s">Email</div><div className="xb-in" /><div className="s">Password</div><div className="xb-in" /></div>
      {!closed && <div className="xp" role="dialog" aria-label="Psss">{children}</div>}
      {prompt}
    </div>
  );
}

/** The header: the title, then (with two or more vaults) the vault glyph and the compact vault picker, with Unlock beside it when the current vault is locked. No site: the address bar shows it. */
const XHead = ({ vaults, menu, vault = 'Passwords', unlock, gone, states }: { vaults?: boolean; menu?: boolean; vault?: string; unlock?: boolean; gone?: boolean; states?: Record<string, VaultState> }) => (
  <div className="xp-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <div style={{ flex: 1, minWidth: 0 }}><div className="t">Psss</div></div>
    {vaults && <VaultRow name={vault} state={gone ? 'unavailable' : unlock ? 'locked' : 'unlocked'} variant="compact" menu={menu && <VaultMenu picker align="right" current={vault} states={states} />} />}
  </div>
);

function XRow({ item, sub, button, last, wrap }: { item: Item; sub?: ReactNode; button: ReactNode; last?: boolean; wrap?: boolean }) {
  return (
    <div className={`xp-row${last ? ' last' : ''}`}>
      <div className={`ic c${item.color}`} aria-hidden>{item.name[0]}</div>
      <div className="grow"><div className="trunc">{item.name}</div>{sub && <div className={wrap ? 's' : 's trunc'}>{sub}</div>}</div>
      {button}
    </div>
  );
}

/** The footer every open popup ends with (owner, 2026-11-25): one labeled Settings button at the trailing end. It opens the extension's own settings page in the browser; Safari's popup has none. */
const XFoot = () => <div className="xp-foot"><button className="btn" data-tip="Opens the extension’s settings page in the browser">Settings</button></div>;

/** The popup's search, focused the moment the popup opens: the accent ring and a caret. */
const XSearch = ({ q, off }: { q?: string; off?: boolean }) => (
  <div className="xp-search" style={off ? { opacity: 0.5 } : { boxShadow: '0 0 0 2px var(--accent)' }} aria-disabled={off}><span className="s" aria-hidden>⌕</span>{q}{!off && <Caret />}{!q && <span className="s">Search all logins</span>}</div>
);

export function BrowserExtension() {
  const counts: [string, number][] = [['Name', 2], ['Website', 3], ['Username', 0]];
  const Head = ({ children }: { children: ReactNode }) => <div className="s" style={{ padding: '0 2px' }}>{children}</div>;
  return (
    <Page
      title="Browser extension: the popup"
      status={<><strong>Redrawn 2026-11-24 from the vault-states model; lead-approved, being built.</strong> The popup, its search and the compact vault picker are built; Unlock beside it, the list heading, the empty-in-this-vault line and the save wording are being built from this page. The system picker has <a href="#/autofill">its own page</a>.</>}
    >
      <Clarity
        intro={<p>The person clicks the Psss button in the toolbar while a page waits. The popup is a small web page that depends on the Mac app’s helper, and the browser closes it the moment it loses focus.</p>}
        items={[
          ['Which thing?', 'The popup of the Psss extension in Chrome, Edge, Firefox and Safari. It fills one login into the page in front of the person, or creates one on a sign-up page. With two vaults the header names the current vault.'],
          ['What must they give?', 'Nothing for the usual fill: one Fill button. The search field has the focus when the popup opens. A locked vault gets an Unlock button in the header: Touch ID when it is ready, otherwise Psss comes forward on its lock screen.'],
          ['What can go wrong?', 'The vault is locked or needs its password, Touch ID is cancelled, the vault is not available (not downloaded, not found, can’t be read), or Psss is not running. Each notice names the vault and the way out..'],
          ['How do they leave?', 'Fill, or click anywhere else. Looking, searching and unlocking change nothing in the vault. Creating a login writes into the current vault, which the header’s vault button names.'],
        ]}
      />

      <Section title="1. Filling a login">
        <p>The rows, pills and words are the <a href="#/autofill">AutoFill sheet’s</a>, except that the popup never repeats the page’s own site (the address bar shows it; owner, 2026-11-25): letter tile, name over account (no second line when the name is the account), the matched part in bold, and one Fill button on every row. The search field is at the top, the pills directly under it, then the heading and the card. Every open popup ends with one footer, a labeled Settings button (not in Safari’s popup, see Decisions).</p>
      </Section>
      <Frames>
        <Frame label="A · Logins for this site" caption="The header is just “Psss” and, with two vaults, the vault glyph and a plain pick list beside it: the address bar already shows the site, so the popup does not repeat it. The heading is “For This Site”. Each row shows the login’s account; the second row’s name is its account, so it has no second line. Fill is bordered, filled for a single match. Every open popup ends with the same footer: a labeled Settings button, which opens the extension’s own settings page in the browser (not the app’s Settings window).">
          <Browser>
            <XHead vaults />
            <XSearch />
            <Head>For This Site</Head>
            <div className="xp-card">
              <XRow item={gitforge} sub="sam.r" button={<FillBtn />} />
              <XRow item={harbor} button={<FillBtn />} last />
            </div>
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="B · Searching “git”" caption="The pills touch the search field. Results are in two groups, as the app’s list groups its rows: “For This Site” (logins whose website matches the page) and “Other Matches” (matched by name or search, but saved for another site or with no website). Fill is the same button on every row. Each Other Matches row keeps a second line saying why it is there, “Saved for githosting.example” (the matched part bold) or “No website”: that line, with the group heading, is the check against a lookalike site. A group with no rows is left out. Return with exactly one matching login presses Fill.">
          <Browser>
            <XHead vaults />
            <XSearch q="git" />
            <Pills counts={counts} />
            <Head>For This Site</Head>
            <div className="xp-card">
              <XRow item={gitforge} sub="sam.r" button={<FillBtn />} />
              <XRow item={gitforge2} sub="sam@work.example" button={<FillBtn />} last />
            </div>
            <Head>Other Matches</Head>
            <div className="xp-card">
              <XRow item={hosting} sub={<>Saved for <Hit hit="git" after="hosting.example" /></>} button={<FillBtn />} last wrap />
            </div>
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="C · Nothing for this site in this vault" caption="A notice, the same card as the vault notices: “No logins for this site”, then what to do: search all logins in the field above, or choose another vault in the header. The notice names the vault; the site is the page’s own, so it is not named. Psss does not search the other vault for the person. It has no button, because each way out is a control already in the popup. With one vault the notice leaves out the vault clause.">
          <Browser title="Sign in · Cloudnest" url="cloudnest.example/login">
            <XHead vaults />
            <XSearch />
            <Head>For This Site</Head>
            <Notice kind="info" title="No logins for this site">Passwords has none for this site. Search all logins above, or choose another vault.</Notice>
            <XFoot />
          </Browser>
        </Frame>
      </Frames>

      <Section title="2. Creating a login">
        <p>On a sign-up page the popup saves into the current vault. The header’s vault picker names it; the button does not repeat the name. When the same website and username already exist there, the button says Update with the login’s name and account. The search field is at the top in every frame.</p>
      </Section>
      <Frames>
        <Frame label="D · A sign-up page" caption="The glyph and pick list in the header say where it goes (Passwords). The button reads “Generate, Fill and Save”. The username is a labeled field, not a placeholder.">
          <Browser title="Create your account · Gitforge" url="gitforge.example/signup">
            <XHead vaults />
            <XSearch />
            <div className="xp-card" style={{ padding: 12 }}>
              <div className="b">Create a login</div>
              <div className="s" style={{ margin: '4px 0 6px' }}>Username or email</div>
              <div className="xp-field">sam@harbor.example</div>
              <button className="btn pri wide" style={{ marginTop: 10 }}>Generate, Fill and Save</button>
            </div>
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="E · The login already exists" caption="Same website and username in Passwords: the line says Passwords already has the account for this site, and the button names what it changes, as Update Name (account). Update changes the password only; the username and website stay. With one vault there is no vault picker and the create button reads the same.">
          <Browser title="Reset your password · Gitforge" url="gitforge.example/reset">
            <XHead vaults />
            <XSearch />
            <div className="xp-card" style={{ padding: 12 }}>
              <div className="b">Update a login</div>
              <div className="s" style={{ margin: '4px 0 6px' }}>Passwords already has sam.r for this site.</div>
              <div className="xp-field">sam.r</div>
              <button className="btn pri wide" style={{ marginTop: 10 }}>Update Gitforge (sam.r)</button>
            </div>
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="F · Saving into a locked vault" caption="Work is the current vault and is locked: Unlock sits beside the pick list, the notice says why, and the save button is dimmed until the vault is open. The sign-up details stay in the form.">
          <Browser title="Create your account · Gitforge" url="gitforge.example/signup">
            <XHead vaults vault="Work" unlock />
            <XSearch off />
            <VaultNotice kind="locked" name="Work" bio="Touch ID" />
            <div className="xp-card" style={{ padding: 12 }}>
              <div className="b">Create a login</div>
              <div className="s" style={{ margin: '4px 0 6px' }}>Username or email</div>
              <div className="xp-field">sam@harbor.example</div>
              <button className="btn pri wide" style={{ marginTop: 10 }} disabled>Generate, Fill and Save</button>
            </div>
            <XFoot />
          </Browser>
        </Frame>
      </Frames>

      <Section title="3. Vaults, locking and unlocking">
        <p>One current vault per device: choosing another here makes it the app’s vault too, and the open one locks. When the current vault is locked an Unlock button sits beside the vault pick list and one notice says why. Touch ID takes focus, so the browser closes the popup: the design carries the result to the next click with a check on the toolbar button.</p>
        <p>The main story, with Touch ID ready: choose Work (G), Unlock (H), the prompt (I), the check on the toolbar (J), the next click lists Work (K).</p>
      </Section>
      <Frames>
        <Frame label="G · Choosing Work" caption="Same rows as the app’s menu: name, location, a check on the current vault, a padlock or warning at the end. Passwords, the current vault, shows the open padlock (spoken “Unlocked”); Work shows the closed one (“Locked”). No Lock item and no add items here.">
          <Browser>
            <XHead vaults menu />
            <XSearch off />
            <div style={{ height: 120 }} />
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="H · Work, locked, Touch ID ready" caption="Work is now current. Unlock asks Psss for Touch ID. The system prompt takes focus, which closes the popup (frame I): expected, not an error.">
          <Browser>
            <XHead vaults vault="Work" unlock />
            <XSearch off />
            <VaultNotice kind="locked" name="Work" bio="Touch ID" />
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="I · The Touch ID prompt" caption="The system’s dialog over the page; the popup has closed. Nothing is wrong. Frame J is what the person sees after the finger is accepted.">
          <Browser closed prompt={<BioPrompt bio="Touch ID" reason="Unlock Work" mac />}><div /></Browser>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="J · Unlocked, popup closed" caption="The app keeps the unlocked vault. The toolbar button shows a small check, and the next click lists that vault’s logins with no second prompt. Where the browser allows it, the extension reopens the popup itself (open question).">
          <Browser closed badge><div /></Browser>
        </Frame>
        <Frame label="K · The next click: Work’s logins" caption="Work is open here (open padlock in its menu), so the header has no Unlock. The login is Gitforge (work), whose account is sam@work.example.">
          <Browser>
            <XHead vaults vault="Work" />
            <XSearch />
            <Head>For This Site</Head>
            <div className="xp-card"><XRow item={gitforge2} sub="sam@work.example" button={<FillBtn main />} last /></div>
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="L · Needs password" caption="Quick unlock is off for Work. The notice says why, then Unlock brings Psss forward on that vault’s lock screen (the popup closes). If the host cannot launch the app, the notice says “Open Psss to unlock Work.”">
          <Browser>
            <XHead vaults vault="Work" unlock />
            <XSearch off />
            <VaultNotice kind="needs-password" name="Work" bio="Touch ID" />
            <XFoot />
          </Browser>
        </Frame>
      </Frames>
      <Frames>
        <Frame label="M · Touch ID cancelled" caption="The next open says so. Unlock asks again; the picker stays for another vault.">
          <Browser>
            <XHead vaults unlock />
            <XSearch off />
            <VaultNotice kind="cancelled" bio="Touch ID" />
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="N · One vault, locked" caption="With one vault there is no vault picker, so the notice carries Unlock.">
          <Browser>
            <XHead />
            <XSearch off />
            <VaultNotice kind="locked" bio="Touch ID" unlock />
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="O · Not available" caption="No Unlock: nothing here can fix it. The pick list sits beside the vault glyph and carries the orange warning glyph at its end; the notice says what Psss will do, and the pick list stays so Passwords is one click away.">
          <Browser>
            <XHead vaults vault="Archive" gone />
            <XSearch off />
            <VaultNotice kind="not-found" name="Archive" />
            <XFoot />
          </Browser>
        </Frame>
        <Frame label="P · Psss not running" caption="Not a vault state: the helper has no app to ask. A visible Open Psss button when the host can launch the app (not checked; without it the card has the words only).">
          <Browser>
            <XHead />
            <XSearch off />
            <Notice kind="info" action={<button className="btn sq">Open Psss</button>}>Psss is not running. Open it, then try again.</Notice>
          </Browser>
        </Frame>
      </Frames>

      <Section title="4. How it is built">
        <ul>
          <li>Plain HTML and CSS following the system’s look (system font, accent colour, light and dark). The icon tile is a coloured initial.</li>
          <li>The host returns which field matched, the counts per field, the list of vaults with their states and the app’s search rule. Unlock sends <code>unlock-vault</code> to the app; the save request names the vault.</li>
        </ul>
      </Section>

      <Decisions
        items={[
          {
            decision: <>Keep the compact vault picker in the header with two or more vaults, drawn as a plain web select (the name and a chevron) with the app’s vault glyph outside it, to its left, as a label, and add a labeled Unlock button beside it when the current vault is locked. One current vault per device.</>,
            why: <>The owner’s review of the earlier drawing (“all over the place”): keep the vault picker, Unlock beside it, one current vault. The browser relay lives in the app, so a separate choice here could not hold anyway.</>,
          },
          {
            decision: <>The popup does not repeat the page’s site. No host in the header, the heading is “For This Site”, rows show the account, and the empty and update lines say “this site”. A host is shown only when a login’s saved site differs from the page’s (“Saved for githosting.example”).</>,
            rejected: <>the host in the header, in the heading and as every row’s second line; “Suggested” as the heading.</>,
            why: <>The owner: the address bar already shows it, so it is redundant. A differing host is the one place it carries information: it warns about a lookalike domain.</>,
          },
          {
            decision: <>Rows, headings, pills and the empty line are the AutoFill sheet’s (apart from the site, see above), and the search field is at the top with the pills directly under it.</>,
            why: <>One consistent look on both surfaces, not a second variant.</>,
          },
          {
            decision: <>The create button reads “Generate, Fill and Save” and the header’s vault picker names the vault it saves into; for a login that exists the button reads “Update Name (account)”. Saving into a locked vault shows Unlock beside the vault button and the button dimmed.</>,
            why: <>The person sees where the new password goes without the button repeating it, and cannot save into a vault that is closed.</>,
          },
          {
            decision: <>The search field is at the top of the popup in every frame (dimmed while the vault is locked or not available), and the pills sit directly under it.</>,
            why: <>The lead’s decision, matching the AutoFill sheet on Mac and iPad; one place for the search on every state.</>,
          },
          {
            decision: <>Every open popup ends with the same footer: one labeled <strong>Settings</strong> button at the trailing end. The one exception is Psss not running (frame P), where the only action is Open Psss. Settings opens the extension’s own settings page in the browser (one labeled switch, “Turn off browser password prompts”), not the app’s Settings window. Safari’s popup has no Settings button, because Safari has no API for that switch.</>,
            rejected: <>a Settings button in only some states (before, only frame A had one).</>,
            why: <>The owner: one footer, the same place in every state, so it is never a hunt. The words follow docs/browser-extension.md (the popup’s Settings button opens the extension’s own page); if the owner meant the app’s Settings at its browser section, that is a change to that doc as well.</>,
          },
          {
            decision: <><strong>Fill is the same on every result</strong>; there is no Fill… and no confirmation. Results are grouped: “For This Site” (website matches the page) first, then “Other Matches” (matched by name or search, but saved for another site or with no website); an empty group is left out. Each Other Matches row keeps a second line, “Saved for githosting.example” or “No website”. Fill is the same everywhere; the group heading and the row’s “Saved for …” line say it’s another site.</>,
            rejected: <>“Fill…” with an ask-first card naming both sites (and its Fill Anyway button); one flat list with the host only on some rows.</>,
            why: <>The owner: one button, one behaviour, no extra step. With no confirmation the second line is the safety signal against a lookalike domain, so it is kept on every Other Matches row and is never shortened away.</>,
          },
          {
            decision: <>Nothing for this site is a notice (<code>Notice</code>, the card the vault notices use) titled “No logins for this site”, with one sentence naming the vault and the ways on: search all logins above, or choose another vault. No button: each way is a control already on screen.</>,
            rejected: <>one line of plain secondary text under the heading.</>,
            why: <>The owner: plain text did not read as a message. The same card as the other notices is how the popup says something is not as expected.</>,
          },
          {
            decision: <>The popup says Touch ID, never Face ID, and a vault chosen with Touch ID ready goes Unlock, prompt, toolbar check, list (frames G to K).</>,
            why: <>The popup is Mac only, and the system’s prompt closes it, so the story is drawn end to end.</>,
          },
          {
            decision: <>The vault menu (picker variant) shows the open padlock on the current vault when it is unlocked, and a not-available vault shows the orange warning glyph on the vault button too. Spoken labels are “Unlocked” and “Locked”.</>,
          },
          {
            decision: <>Losing the popup to the Touch ID prompt is expected: no error, a check on the toolbar button after success, a notice with Unlock after a cancel.</>,
          },
          {
            decision: <>A vault that needs its password is unlocked in Psss, not in the popup.</>,
            why: <>A web popup should not hold a vault password or key file, and the popup closes when Psss comes forward.</>,
          },
          {
            decision: <>Not-available vaults get no Unlock; the notice says what Psss will do.</>,
          },
          {
            decision: <>Return in the search field with exactly one matching login presses Fill.</>,
            why: <>The usual sign-in is open, Return, done.</>,
          },
          {
            decision: <>Update changes the password (and adds a passkey) of the existing login; it never changes the username, website or title.</>,
            why: <>Website and username are how the login was matched, so they are its identity.</>,
          },
          {
            decision: <>The needs-password notice says why in a few words, then “Unlock with the vault password.” Choosing another vault mid-flow keeps a save form and changes only where it goes.</>,
          },
        ]}
      />
      <Against>
        <li><strong>A web popup is not a native control.</strong> The extension cannot use the system’s toggle buttons, so the pills are styled to match them (capsule, accent colour when on, dimmed when empty). Safari’s popup follows the same sheet.</li>
      </Against>

      <Section title="Open questions">
        <ul>
          <li><strong>Reopening after Touch ID.</strong> Whether the extension can reopen the popup when the unlock finishes (Chrome’s <code>action.openPopup</code> can; Firefox only from a user action) and how Safari’s extension behaves. The fallback is the toolbar check and one more click.</li>
          <li><strong>An Open Psss button.</strong> Whether the host can launch the app from the card (frame P). If not, the card has the words only.</li>
          <li><strong>Bringing Psss forward.</strong> Whether the host can bring Psss to the front on its lock screen when the vault needs its password (frame L).</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-25', text: <>Fill… and its ask-first confirmation (frame B2) are replaced by grouped results with a uniform Fill, at the owner’s request. Frame B now shows “For This Site” and “Other Matches”; the second line “Saved for githosting.example” (or “No website”) stays on every Other Matches row as the lookalike-site signal. Replaces the “Fill…” button on logins saved for another site, frame B2 and its Fill Anyway card, and the one flat list.</> },
          { date: '2026-11-25', text: <>Footer, Fill… and the empty state. (1) Every open popup ends with the same Settings button; before, only frame A had one. Only Psss not running (P) has none. Settings is said to open the extension’s own settings page in the browser (as docs/browser-extension.md has it); Safari’s popup has none. (2) Fill… was kept and explained, then replaced the same day (see the next entry). (3) “Nothing for this site” (frame C) is a notice titled “No logins for this site” with a sentence naming the vault and the ways on. Replaces the single line of plain text, “No logins for this site in Passwords. Choose another vault above.”</> },
          { date: '2026-11-25', text: <>Review fixes and owner changes. (1) The page’s own site is gone from the popup: not in the header, not in the heading, not in the rows (the address bar shows it). The heading “For gitforge.example” is “For This Site”, which says what the list is without a name that could be misread as a vault or a search; “Suggested” would not say why these logins are shown. Rows show the account; a login whose name is its account has no second line. A host stays only when it differs from the page’s site, as in “Saved for githosting.example”: a lookalike-domain check. The empty and update lines say “this site”. (2) The vault picker has the same vault glyph as the app’s vault button, outside the pick list at its left, in secondary colour, as a label; the pick list itself is a plain web select (name and a chevron, accessible label “Vault”) with no glyph inside. Also drawn with Mac controls: the Safari popover’s buttons are macOS push buttons, the default one with the accent fill. Replaces the header’s site line, the host in rows and heading, the ⌃⌄ pick list with no glyph, and the iOS capsules in the popover. The AutoFill sheet’s own rows are not changed by this.</> },
          { date: '2026-11-24', text: <>Lead decisions applied: the create button is “Generate, Fill and Save” (the vault button names the vault) and “Update Name (account)” for an existing login; search at the top in every frame; Touch ID, never Face ID; saving into a locked vault (F); the Touch ID story drawn as frames G to K with the system prompt and Work’s list; the not-available example is Archive with the warning glyph on the vault button; the locked and one-vault notices use the shared <code>VaultNotice</code>; “Saved for githosting.example” wraps instead of truncating. Replaces the “Generate, fill and save in Passwords” button and the search field under the list. Frames were re-lettered A to P.</> },
          { date: '2026-11-24', text: <>Shared Vault row and menu; lead decisions applied. The page’s own vault button and menu are gone: the header uses the compact <code>VaultRow</code>, the notices are <code>VaultNotice</code> and the menu is <code>VaultMenu</code> (picker variant). Needs-password says why; Return fills with one match; Update changes the password only.</> },
          { date: '2026-11-24', text: <>Redrawn from the vault-states model (<code>docs/plans/vault-switcher-and-extension-style.md</code>, sections 2 to 6) after the owner’s review: compact vault button without the icon, Unlock beside it, needs-password and not-available notices, one-vault notice with Unlock, the list heading above the card, name-equals-account rows, the empty-in-this-vault line, the save card naming the vault and the Update wording. Replaces the “locked or not connected” card with an Open Psss button for a locked vault (that stays only for Psss not running, frame N), the “Vault with no saved key” card that sent the person to the app, and the search field under the list. Frames were re-lettered A to N. Sample vaults are Passwords and Work. Not built.</> },
          { date: '2026-11-24', text: <>Split from “AutoFill and the browser extension: one style” into its own page (owner: they overlap but the journey is different).</> },
          { date: '2026-11-24', text: <>Popup unlocking redrawn around the system prompt taking focus and closing the popup (owner: another password manager does Touch ID from its Firefox extension but loses the popup): an “Unlocking…” card, the closed popup with an unlocked check on the toolbar button, a cancelled card.</> },
          { date: '2026-11-24', text: <>Built the browser extension popup with the protocol’s field-aware search and vault list.</> },
          { date: '2026-11-24', text: <>The switcher button shows the open vault’s name instead of the icon alone, at the owner’s request; later the icon was dropped (compact name with arrows).</> },
          { date: '2026-11-24', text: <>Page added as a proposal at the owner’s request: the extension takes the app’s row, search and pills.</> },
        ]}
      />
    </Page>
  );
}
