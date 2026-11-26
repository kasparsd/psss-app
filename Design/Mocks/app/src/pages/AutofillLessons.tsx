import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone } from '../components/devices';
import { ItemIcon, ListRow } from '../components/Rows';
import { Nav } from '../screens/PhoneScreens';
import { FillBtn } from '../components/loginParts';
import { EyeIcon, SearchIcon } from '../icons';
import type { Item } from '../data';
import './autofill.css';
import './afl.css';

/* ---------- sample items: one school login saved twice, one other, two unrelated ---------- */

const mk = (id: number, name: string, account: string, color: Item['color']): Item => ({ id, name, account, kind: 'login', color, uses: 0, fields: [] });
const ek1 = mk(1, 'E-Klase', '071114-25629', 5);
const ek2 = mk(2, 'E-Klase', '071114-25629', 5);
const ek3 = mk(3, 'E-Klase', '160716-25638', 5);
const airb = mk(4, 'airBaltic', 'kaspars@example.com', 3);
const ableton = mk(5, 'Ableton', 'kaspars@example.com', 4);

const site = 'auth.e-klase.lv';

/* ---------- the picker, today and proposed ---------- */

const Head = ({ children }: { children: ReactNode }) => <div className="afl-h">{children}</div>;
const SearchPill = () => <div className="afl-pin"><div className="sfield"><SearchIcon />Search</div></div>;

function Picker({ proposed }: { proposed?: boolean }) {
  const lines: ReactNode[] = proposed
    ? [<>071114-25629 · <span style={{ whiteSpace: 'nowrap' }}>auth.e-klase.lv</span></>, <>071114-25629 · <span style={{ whiteSpace: 'nowrap' }}>e-klase.lv</span></>, undefined]
    : [undefined, undefined, undefined];
  return (
    <IPhone>
      <Nav left={<button className="btn glass">Cancel</button>} mid={<strong>Choose a Login</strong>} />
      {proposed && <div className="afl-ask">Choose a login for “{site}”.</div>}
      <div className="pbody afl-body">
        <Head>For This Site</Head>
        <div className="grp">
          {[ek1, ek2, ek3].map((it, i) => <ListRow key={it.id} item={it} traits={false} wrap sub={lines[i]} trailing={<FillBtn />} />)}
          {proposed && <div className="afl-new">New Login…</div>}
        </div>
        {proposed && (
          <>
            <Head>Other</Head>
            <div className="grp">
              <ListRow item={ableton} traits={false} wrap sub={<>kaspars@example.com · <span style={{ whiteSpace: 'nowrap' }}>No website</span></>} trailing={<FillBtn />} />
              <ListRow item={airb} traits={false} wrap sub={<>kaspars@example.com · <span style={{ whiteSpace: 'nowrap' }}>Saved for airbaltic.com</span></>} trailing={<FillBtn />} />
            </div>
          </>
        )}
      </div>
      <SearchPill />
    </IPhone>
  );
}

/* ---------- inside the sheet ---------- */

function Details() {
  return (
    <IPhone>
      <Nav left={<button className="btn glass">Back</button>} mid={<strong>E-Klase</strong>} />
      <div className="pbody">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 0 12px' }}>
          <ItemIcon item={ek2} big />
        </div>
        <div className="ac-card" style={{ margin: 0 }}>
          <div className="afl-kv"><span>Username</span><span className="s">071114-25629</span></div>
          <div className="afl-kv"><span>Password</span><span className="s" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>••••••••<span className="ibtn flat" style={{ width: 26, height: 26 }} aria-label="Show"><EyeIcon /></span></span></div>
          <div className="afl-kv"><span>Website</span><span className="s">e-klase.lv</span></div>
          <div className="afl-kv"><span>Vault</span><span className="s">Passwords</span></div>
          <div className="afl-kv"><span>Changed</span><span className="s">14 Dec 2023</span></div>
        </div>
        <div style={{ paddingTop: 14 }}><button className="btn pri wide">Fill Username and Password</button></div>
        <Head>Or use one value</Head>
        <div className="ac-card" style={{ margin: 0 }}>
          <div className="afl-kv"><span>Username</span><button className="btn">Use</button></div>
          <div className="afl-kv"><span>Password</span><button className="btn">Use</button></div>
        </div>
      </div>
    </IPhone>
  );
}

function NewLogin() {
  return (
    <IPhone>
      <Nav left={<button className="btn glass">Back</button>} mid={<strong>New Login</strong>} />
      <div className="pbody">
        <Head>To save in Passwords</Head>
        <div className="ac-card" style={{ margin: 0 }}>
          <div className="afl-kv"><span>Website</span><span className="s">e-klase.lv</span></div>
          <div className="afl-kv"><span>Username</span><span className="s">Required</span></div>
          <div className="afl-kv"><span>Password</span><span className="s">Strong password</span></div>
          <div className="afl-kv"><span>Name</span><span className="s">Optional</span></div>
        </div>
        <div style={{ paddingTop: 16 }}><button className="btn pri wide">Save and Fill</button></div>
        <div className="afl-note" style={{ textAlign: 'center' }}>Saves a new login in the vault Passwords, then fills it into this page. Nothing else is uploaded.</div>
      </div>
    </IPhone>
  );
}

/* ---------- the system's own list ---------- */

function Sys({ rows, note }: { rows: [ReactNode, string, boolean?][]; note?: ReactNode }) {
  return (
    <IPhone>
      <div className="afl-page">
        <div style={{ textAlign: 'center' }}><strong style={{ color: 'var(--lab)' }}>{site}</strong></div>
        <div className="afl-dim" />
        <div className="afl-sys">
          <div className="ttl">Choose a saved password to use</div>
          {rows.map(([user, line, same], i) => (
            <div key={i} className={`opt${same ? ' same' : ''}`}><div>{user}</div><div className="s">{line}</div></div>
          ))}
          <div className="opt plainb">Psss</div>
          <div className="opt plainb">Passwords</div>
          <div className="opt plainb">Cancel</div>
        </div>
      </div>
      {note}
    </IPhone>
  );
}

const built = <span className="afl-tag">Built</span>;
const newTag = <span className="afl-tag new">Proposed</span>;

export function AutofillLessons() {
  return (
    <Page
      title="AutoFill picker: lessons from Apple Passwords"
      status={<><strong>Proposal (2026-11-26), not built.</strong> From three screenshots of Apple Passwords’ iOS 26 AutoFill sheet, its detail view and Safari’s system list. Frames A and B put our picker beside the proposed one; C and D are the screens inside the sheet; E to G are the system’s list, where only part of the text is ours. Nothing here changes the approved picker until the owner picks.</>}
    >
      <Clarity
        intro={<p>The person is in the middle of signing in. The system opens our sheet, or its own short list, and they want the right login in the field, and to know it is for the right site.</p>}
        items={[
          ['Which thing?', 'The AutoFill sheet (“Choose a Login”) and, before it, the system’s own list in Safari and the keyboard bar. The sheet says which site it is for and which vault it reads.'],
          ['What must they give?', 'One tap: Fill. Nothing is typed. Looking at a login’s details or creating a new one is optional and changes nothing until Save and Fill.'],
          ['What can go wrong?', 'Two saved logins read the same, so the wrong one is filled. The sheet fixes that in its own rows; in the system’s list we can only fix it by changing what we register (frames F and G, to be tested on a device).'],
          ['How do they leave?', 'Cancel, always labeled. Details and New Login have Back.'],
        ]}
      />

      <Section title="1. What Apple Passwords does, and what we copy">
        <ul>
          <li><strong>Names the site.</strong> A line above the title: “Choose a password to use for “auth.e-klase.lv”.” Our sheet only says “For This Site”, so the person cannot check a lookalike address.</li>
          <li><strong>Suggested, then Other.</strong> Matches first; every other login below in A to Z order; the search field floats at the foot (iOS 26). We already have the two groups and the foot search, but show the second group only after typing.</li>
          <li><strong>The site’s icon</strong> at the start of every row. We have this: the brand icon asset catalog, <code>ItemIcon</code>.</li>
          <li><strong>One row, one meaning.</strong> The bold line is the username, the second line the domain, and the row fills when tapped. A small (i) opens the item in place, read-only. We keep a labeled Fill button and let the name open the item (see “Against Apple’s guidance”).</li>
          <li><strong>Create New Password…</strong> as the last row of the Suggested group, plus a + in the bar. We would add one labeled row, “New Login…”.</li>
          <li><strong>Apple has the same duplicate problem.</strong> Its own Suggested group shows two identical rows (same icon, username and domain); only the group badge differs. Telling duplicates apart is our chance to do better, not something to copy.</li>
        </ul>
      </Section>

      <Section title="2. The sheet, today and proposed">
        <p>The same three E-Klase logins: two for the same username (one saved for <code>auth.e-klase.lv</code>, one for <code>e-klase.lv</code>), and one for a second child.</p>
      </Section>
      <Frames>
        <Frame label="A · Today" phone caption={<>Heading “For This Site”, rows with Fill, search at the foot. The first two rows read exactly the same, so the person cannot choose. Other logins appear only after typing. {built}</>}>
          <Picker />
        </Frame>
        <Frame label="B · Proposed" phone caption={<>A line under the title names the site (body size, secondary colour). Rows that would read the same get what differs added to the second line: the website, else the vault, else “Changed 14 Dec 2023”. “New Login…” closes the group. “Other” lists every other login always, each with “Saved for …” or “No website”, as built for search results. Search stays at the foot. {newTag}</>}>
          <Picker proposed />
        </Frame>
      </Frames>

      <Section title="3. Inside the sheet: see one login, create one">
        <p>Apple’s (i) opens the whole item without leaving the sheet. Ours is the screen the name already opens (“fill one value”); it gains the facts a person uses to tell logins apart. No Edit, no Share, no Notes: the sheet reads, it does not manage.</p>
      </Section>
      <Frames>
        <Frame label="C · Tap a name: the login" phone caption={<>Icon, name, username, password hidden with the Show eye (the owner-approved exception), website, vault, last changed. Fill Username and Password stays the one prominent button; the per-value Use buttons remain below it. Built today: the name and the Use rows. Proposed: icon, website, vault, changed. {newTag}</>}>
          <Details />
        </Frame>
        <Frame label="D · New Login…" phone caption={<>Website is filled in from the page and cannot be left empty. The password can be typed or generated (the site’s password rules apply, as in the save sheet). One button names what happens: “Save and Fill”. The line under it says where it goes. Built today as a separate save sheet after sign-up; not reachable from this list. {newTag}</>}>
          <NewLogin />
        </Frame>
      </Frames>

      <Section title="4. The system’s list: Safari and the keyboard bar">
        <p>Before our sheet, Safari (and the keyboard bar) show the system’s own list, built from the identities we register. We control three things: the <code>user</code> string (first line), the <code>rank</code> (order within one site) and how many identities we register. The second line, “password for e-klase.lv — Psss”, is written by the system from the service identifier and the extension’s name; it has no title, no icon and no field for either.</p>
      </Section>
      <Frames>
        <Frame label="E · Today" phone caption={<>Two items, same username, same site: two rows that read the same. The system does not show the title, and the tap fills whichever item the row’s record identifier names. {built}</>}>
          <Sys rows={[['071114-25629', 'password for e-klase.lv — Psss', true], ['071114-25629', 'password for e-klase.lv — Psss', true], ['160716-25638', 'password for e-klase.lv — Psss']]} />
        </Frame>
        <Frame label="F · Option 1: add the title, only for duplicates" phone caption={<>Register <code>user</code> as “username · title” only when two items on one site share a username. The returned credential still carries the real username, so the field gets “071114-25629”. Needs a device test (does the system filter by typed text, merge rows, show the string whole?). {newTag}</>}>
          <Sys rows={[['071114-25629 · E-Klase', 'password for e-klase.lv — Psss'], ['071114-25629 · E-Klase (old)', 'password for e-klase.lv — Psss'], ['160716-25638', 'password for e-klase.lv — Psss']]} />
        </Frame>
        <Frame label="G · Option 2: one row, our list decides" phone caption={<>Register one identity for each site and username. When two items share them, the tap answers “needs interaction” and opens our sheet (frame B), where the rows can be told apart. One more tap for duplicates, no wrong password, and every string is documented API. {newTag}</>}>
          <Sys rows={[['071114-25629', 'password for e-klase.lv — Psss'], ['160716-25638', 'password for e-klase.lv — Psss']]} />
        </Frame>
      </Frames>

      <Section title="5. What the API allows (checked 2026-11-26)">
        <table className="afl-table">
          <thead><tr><th>Question</th><th>Answer</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>Can the system list’s second line carry a title?</td><td>No field for it. <code>ASPasswordCredentialIdentity</code> has <code>serviceIdentifier</code>, <code>user</code>, <code>recordIdentifier</code> and <code>rank</code>. Only <code>ASOneTimeCodeCredentialIdentity</code> has a <code>label</code>, documented as shown in the suggestion.</td><td>iOS 27.2 SDK headers: <code>ASPasswordCredentialIdentity.h</code>, <code>ASOneTimeCodeCredentialIdentity.h</code></td></tr>
            <tr><td>Does iOS 26 add a display name?</td><td><code>ASCredentialServiceIdentifier(identifier:type:displayName:)</code> exists from iOS and macOS 26.2, and a new type <code>.app</code>. The header documents <code>displayName</code> only for an incoming App identifier on a save request. Whether the system shows it for a stored identity is undocumented. A developer report says it is not used for suggestions. Cheap to test.</td><td><code>ASCredentialServiceIdentifier.h</code>; <a href="https://github.com/KeeForge/KeeForge/issues/137">KeeForge issue 137</a></td></tr>
            <tr><td>Does the system fill <code>user</code> from the identity or the credential we return?</td><td>The credential we return: a returned <code>ASPasswordCredential(user:password:)</code> decides what lands in the fields (an empty user leaves a filled username alone in Safari and clears it in an app). Our provider already finds the item by <code>recordIdentifier</code> and never reads the identity’s <code>user</code>, so a longer display string cannot change what is filled. Inference, not a documented guarantee.</td><td><a href="https://developer.apple.com/forums/thread/127931">Apple forums 127931</a>; <code>CredentialProviderViewController.swift</code></td></tr>
            <tr><td>Is <code>user</code> matched against the typed text?</td><td>Not documented anywhere we found. Keyboard suggestions are chosen by service identifier; matching on the user string is unconfirmed. A string that begins with the username keeps any prefix match.</td><td><a href="https://github.com/bitwarden/ios/pull/3227">Bitwarden iOS PR 3227</a> (service identifier drives suggestions)</td></tr>
            <tr><td>Does the system merge identities with the same site and user?</td><td>Unknown. Passwords’ own list shows two identical rows, so merging is at least not universal; Passwords’ merged rows read “and N more” on the owner’s device.</td><td>Owner’s device screenshots</td></tr>
            <tr><td>What can we not control?</td><td>The second line (“password for … — Psss”), the icon, the order of the Psss, Passwords and other providers’ rows, and the system’s own dialog title.</td><td>Same headers; Safari list screenshot</td></tr>
          </tbody>
        </table>
        <p>Documented: <a href="https://developer.apple.com/documentation/authenticationservices/ascredentialidentitystore">ASCredentialIdentityStore</a> and <a href="https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller">ASCredentialProviderViewController</a> describe what a provider registers and answers; neither describes how the list is drawn.</p>
      </Section>

      <Section title="6. Ranked by value">
        <ol>
          <li><strong>Tell duplicates apart</strong> in our rows (frame B) and in the system list (frame G first, F if G’s extra tap is too much). It is the owner’s complaint, and Apple’s own list has it too. Small change: <code>RowLine</code> and <code>SharedVault.identities</code>.</li>
          <li><strong>Name the site in the sheet</strong> (frame B, the line under the title). The lookalike check without reading the heading. One <code>Text</code> line.</li>
          <li><strong>The login’s details in the sheet</strong> (frame C): website, vault, changed date, icon. Reuses the values screen.</li>
          <li><strong>“Other” always listed</strong> (frame B). Apple does this; it removes the need to know to type. Cost: every username is on screen after Face ID. Same as the app’s own list.</li>
          <li><strong>New Login…</strong> (frame D). Useful when a login does not exist yet; needs the editor, password generator and vault write in the extension, so it is the largest piece. The save sheet already does most of it.</li>
        </ol>
      </Section>

      <Section title="7. Already built">
        <ul className="afl-built">
          <li>Site icon: <code>ItemIcon</code> and the brand-icon catalog, the same in the picker and the app.</li>
          <li>Two groups, “For This Site” and “Other Matches”, with “Saved for …” and “No website”; today “Other Matches” shows only after typing.</li>
          <li>Search field at the foot on iPhone (iOS 26 placement), under the Vault row on iPad and Mac.</li>
          <li>The name opens the item’s values (username, password, code, card fields) with Fill Username and Password and a Use button per value.</li>
          <li>The record identifier is <code>vault/item</code>; our provider never reads the identity’s <code>user</code>.</li>
          <li>Save and generate sheets (iOS 26.2) with the Vault row, as on <a href="#/autofill">the AutoFill page</a>.</li>
        </ul>
      </Section>

      <Against>
        <li><strong>The (i) button.</strong> Apple’s row fills when tapped and the (i) shows the item. We keep a labeled Fill button at the end of the row and let the name open the item, so one extra icon-only control would crowd it and the project rule is visible, labeled actions. Recommendation, not a requirement: if the owner wants Apple’s exact pattern, the row would fill on tap and the (i) would carry an accessibility label and tooltip, which the HIG permits for a detail disclosure.</li>
        <li><strong>The + and X buttons.</strong> iOS 26 uses glass icon buttons for dismiss and create. We keep the text “Cancel” and a labeled “New Login…” row.</li>
        <li><strong>The Passwords app footnote.</strong> It links into the app that owns the sheet. An extension cannot open its app, so we do not copy it.</li>
        <li><strong>Group and Contributed By.</strong> Shared groups do not exist in our vaults; the Vault row and the vault line cover where a login lives.</li>
      </Against>

      <Decisions
        items={[
          { decision: <>Add what differs to the second line of a row whose name and username match another row’s: website, else vault, else changed date.</>, why: <>Apple’s list shows two identical rows; two E-Klase logins for one username are normal for families.</> },
          { decision: <>Name the site in a line under the title.</>, why: <>It is the person’s check that the sheet is for the page they are on.</> },
          { decision: <>Keep Fill, Cancel and a labeled New Login… as visible text; add no (i), + or X.</>, why: <>Project rule: important actions visible and labeled; recommendation to the owner, see above.</> },
          { decision: <>In the system list, try frame G first (one identity per site and username, duplicates open our sheet), and test frame F and the service identifier’s <code>displayName</code> on a device before building either.</>, why: <>G uses only documented behaviour; F and <code>displayName</code> depend on how the system draws the list, which no document describes.</> },
        ]}
      />

      <Section title="Open questions">
        <ul>
          <li><strong>Device test, one build.</strong> Register for one site: (a) <code>user</code> “name · title”, (b) <code>displayName</code> “Title”, (c) two identical identities. Look at Safari’s list and the keyboard bar, tap each, type into the field first, and see what lands in the field. Not possible in the simulator’s Passwords-free list.</li>
          <li><strong>“Other” always shown.</strong> Is every username on screen acceptable, or only after a tap on the search? The owner’s call.</li>
          <li><strong>New Login… in the extension.</strong> Memory and time for a vault write from the list; the save sheet already does it after sign-up.</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-26', text: <>Page added as a proposal after the owner’s Apple Passwords screenshots: the sheet’s site line, Other group, in-sheet details and New Login…, and the system list’s duplicate username problem with the API facts. Replaces nothing; <a href="#/autofill">the AutoFill page</a> stays the approved picker.</> },
        ]}
      />
    </Page>
  );
}
