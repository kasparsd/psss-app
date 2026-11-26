import type { ReactNode } from 'react';
import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone } from '../components/devices';
import { ItemIcon, ListRow } from '../components/Rows';
import { Nav } from '../screens/PhoneScreens';
import { FillBtn, InfoBtn } from '../components/loginParts';
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

const Info = ({ it }: { it: Item }) => <InfoBtn name={it.name} />;

function Picker({ proposed }: { proposed?: boolean }) {
  const lines: ReactNode[] = proposed
    ? [<>071114-25629 · <span style={{ whiteSpace: 'nowrap' }}>auth.e-klase.lv</span></>, <>071114-25629 · <span style={{ whiteSpace: 'nowrap' }}>e-klase.lv</span></>, undefined]
    : [undefined, undefined, undefined];
  return (
    <IPhone>
      <Nav left={<button className="btn glass">Cancel</button>} mid={<strong>Choose a Login</strong>} />
      <div className="pbody afl-body">
        <Head>For This Site</Head>
        <div className="grp">
          {[ek1, ek2, ek3].map((it, i) => <ListRow key={it.id} item={it} traits={false} wrap sub={lines[i]} trailing={proposed ? <Info it={it} /> : <FillBtn />} />)}
          {proposed && <div className="afl-new">New Login…</div>}
        </div>
        {proposed && (
          <>
            <Head>Other</Head>
            <div className="grp">
              <ListRow item={ableton} traits={false} wrap sub={<>kaspars@example.com · <span style={{ whiteSpace: 'nowrap' }}>No website</span></>} trailing={<Info it={ableton} />} />
              <ListRow item={airb} traits={false} wrap sub={<>kaspars@example.com · <span style={{ whiteSpace: 'nowrap' }}>Saved for airbaltic.com</span></>} trailing={<Info it={airb} />} />
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
      status={<><strong>Partly approved by the owner, 2026-11-26.</strong> Approved: tapping a row fills it, an (i) at the end opens the details in the sheet, and rows that read the same say what differs (frames B and C); the system’s own list stays as it is. Still open and not to be built: “Other” always listed and “New Login…” (frames B and D). From three screenshots of Apple Passwords’ iOS 26 AutoFill sheet, its detail view and Safari’s system list. Frames A and B put our picker beside the proposed one; C and D are the screens inside the sheet; E to G are the system’s list, where only part of the text is ours. The approved picker is <a href="#/autofill">the AutoFill page</a>.</>}
    >
      <Clarity
        intro={<p>The person is in the middle of signing in. The system opens our sheet, or its own short list, and they want the right login in the field, and to know it is for the right site.</p>}
        items={[
          ['Which thing?', 'The AutoFill sheet (“Choose a Login”) and, before it, the system’s own list in Safari and the keyboard bar. The sheet says which site it is for and which vault it reads.'],
          ['What must they give?', 'One tap on the login. Nothing is typed. Looking at a login’s details or creating a new one is optional and changes nothing until Save and Fill.'],
          ['What can go wrong?', 'Two saved logins read the same, so the wrong one is filled. The sheet fixes that in its own rows; the system’s own list stays as it is (owner, 2026-11-26).'],
          ['How do they leave?', 'Cancel, always labeled. Details and New Login have Back.'],
        ]}
      />

      <Section title="1. What Apple Passwords does, and what we copy">
        <ul>
          <li><strong>Names the site.</strong> A line above the title: “Choose a password to use for “auth.e-klase.lv”.” Not copied (owner, 2026-11-26): our heading stays as it is.</li>
          <li><strong>Suggested, then Other.</strong> Matches first; every other login below in A to Z order; the search field floats at the foot (iOS 26). We already have the two groups and the foot search, but show the second group only after typing.</li>
          <li><strong>The site’s icon</strong> at the start of every row. We have this: the brand icon asset catalog, <code>ItemIcon</code>.</li>
          <li><strong>One row, one meaning.</strong> The bold line is the username, the second line the domain, and the row fills when tapped. A small (i) opens the item in place, read-only. Adopted (owner, 2026-11-26): the labeled Fill button is gone.</li>
          <li><strong>Create New Password…</strong> as the last row of the Suggested group, plus a + in the bar. We would add one labeled row, “New Login…”.</li>
          <li><strong>Apple has the same duplicate problem.</strong> Its own Suggested group shows two identical rows (same icon, username and domain); only the group badge differs. Telling duplicates apart is our chance to do better, not something to copy.</li>
        </ul>
      </Section>

      <Section title="2. The sheet, today and proposed">
        <p>The same three E-Klase logins: two for the same username (one saved for <code>auth.e-klase.lv</code>, one for <code>e-klase.lv</code>), and one for a second child.</p>
      </Section>
      <Frames>
        <Frame label="A · Today" phone caption={<>Heading “For This Site”, rows with a labeled Fill button, search at the foot. The first two rows read exactly the same, so the person cannot choose. Other logins appear only after typing. {built}</>}>
          <Picker />
        </Frame>
        <Frame label="B · Approved: row tap and (i). Open: Other, New Login…" phone caption={<>The heading stays as built. Tapping a row fills; the (i) at the end opens its details (accessibility label “Details for E-Klase”, tooltip “Show Details”). Rows that would read the same get what differs added to the second line: the website, else the vault, else “Changed 14 Dec 2023” (approved). “New Login…” and an always-listed “Other” group are still open: not approved, not built. Search stays at the foot. {newTag}</>}>
          <Picker proposed />
        </Frame>
      </Frames>

      <Section title="3. Inside the sheet: see one login, create one">
        <p>Apple’s (i) opens the whole item without leaving the sheet. Ours is the screen the name used to open (“fill one value”), now opened by the (i); it gains the facts a person uses to tell logins apart. No Edit, no Share, no Notes: the sheet reads, it does not manage.</p>
      </Section>
      <Frames>
        <Frame label="C · The (i): the login" phone caption={<>Icon, name, username, password hidden with the Show eye (the owner-approved exception), website, vault, last changed. Fill Username and Password stays the one prominent button; the per-value Use buttons remain below it. Approved (owner, 2026-11-26): icon, website, vault and changed date are added to the values screen. {newTag}</>}>
          <Details />
        </Frame>
        <Frame label="D · New Login… (open, not approved)" phone caption={<>Open, do not build. Website is filled in from the page and cannot be left empty. The password can be typed or generated (the site’s password rules apply, as in the save sheet). One button names what happens: “Save and Fill”. The line under it says where it goes. Built today as a separate save sheet after sign-up; not reachable from this list. {newTag}</>}>
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
        <Frame label="F · Option 1 (not taken)" phone caption={<>Register <code>user</code> as “username · title” only when two items on one site share a username. The returned credential still carries the real username, so the field gets “071114-25629”. Needs a device test (does the system filter by typed text, merge rows, show the string whole?). {newTag}</>}>
          <Sys rows={[['071114-25629 · E-Klase', 'password for e-klase.lv — Psss'], ['071114-25629 · E-Klase (old)', 'password for e-klase.lv — Psss'], ['160716-25638', 'password for e-klase.lv — Psss']]} />
        </Frame>
        <Frame label="G · Option 2 (not taken)" phone caption={<>Register one identity for each site and username. When two items share them, the tap answers “needs interaction” and opens our sheet (frame B), where the rows can be told apart. One more tap for duplicates, no wrong password, and every string is documented API. {newTag}</>}>
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
          <li><strong>Tell duplicates apart</strong> in our rows (frame B): approved. In the system list (frames F and G): not taken, the registration stays as it is. It is the owner’s complaint, and Apple’s own list has it too. Built in <code>RowLine</code>.</li>
          <li><strong>The login’s details in the sheet</strong> (frame C), opened by the (i): website, vault, changed date, icon. Approved. Reuses the values screen.</li>
          <li><strong>“Other” always listed</strong> (frame B), open. Apple does this; it removes the need to know to type. Cost: every username is on screen after Face ID. Same as the app’s own list.</li>
          <li><strong>New Login…</strong> (frame D), open. Useful when a login does not exist yet; needs the editor, password generator and vault write in the extension, so it is the largest piece. The save sheet already does most of it.</li>
        </ol>
      </Section>

      <Section title="7. Already built">
        <ul className="afl-built">
          <li>Site icon: <code>ItemIcon</code> and the brand-icon catalog, the same in the picker and the app.</li>
          <li>Two groups, “For This Site” and “Other Matches”, with “Saved for …” and “No website”; today “Other Matches” shows only after typing.</li>
          <li>Search field at the foot on iPhone (iOS 26 placement), under the Vault row on iPad and Mac.</li>
          <li>Until 2026-11-26 the name opened the item’s values (username, password, code, card fields) with Fill Username and Password and a Use button per value; the (i) opens them now, and the row fills.</li>
          <li>The record identifier is <code>vault/item</code>; our provider never reads the identity’s <code>user</code>.</li>
          <li>Save and generate sheets (iOS 26.2) with the Vault row, as on <a href="#/autofill">the AutoFill page</a>.</li>
        </ul>
      </Section>

      <Against>
        <li><strong>The + and X buttons.</strong> iOS 26 uses glass icon buttons for dismiss and create. We keep the text “Cancel” and a labeled “New Login…” row.</li>
        <li><strong>The Passwords app footnote.</strong> It links into the app that owns the sheet. An extension cannot open its app, so we do not copy it.</li>
        <li><strong>Group and Contributed By.</strong> Shared groups do not exist in our vaults; the Vault row and the vault line cover where a login lives.</li>
      </Against>

      <Decisions
        items={[
          { decision: <>Add what differs to the second line of a row whose name and username match another row’s: website, else vault, else changed date.</>, why: <>Apple’s list shows two identical rows; two E-Klase logins for one username are normal for families.</> },
          { decision: <>The heading stays as built; no line naming the site.</>, rejected: <>Apple’s “Choose a password to use for “site”” line.</>, why: <>Owner, 2026-11-26: leave it as it is.</> },
          { decision: <>Tapping a row picks it and fills; an (i) at the end of each row (the standard detail button, accent colour) opens the login’s details in the sheet, read-only, with the accessibility label “Details for &lt;name&gt;” and the tooltip “Show Details”. The labeled Fill button goes away. Cancel stays as visible text; no + or X.</>, rejected: <>A labeled Fill button on every row, with the name opening the item.</>, why: <>Owner, 2026-11-26: as in Apple Passwords. The HIG allows the icon-only detail disclosure button, and it carries a label and tooltip. The project rule on visible, labeled actions is met by the row itself being the action.</> },
          { decision: <>Safari’s own system password list stays as it is: no change to what we register.</>, why: <>Owner, 2026-11-26. Frames F and G are not taken.</> },
          { decision: <>Open, not approved, not to be built: an always-listed “Other” group, and “New Login…” in the sheet.</>, why: <>Waiting for the owner.</> },
        ]}
      />

      <Section title="Open questions">
        <ul>
          <li><strong>System list device test.</strong> Not needed: the owner left Safari’s list as it is (2026-11-26).</li>
          <li><strong>“Other” always shown.</strong> Is every username on screen acceptable, or only after a tap on the search? The owner’s call.</li>
          <li><strong>New Login… in the extension.</strong> Memory and time for a vault write from the list; the save sheet already does it after sign-up.</li>
        </ul>
      </Section>

      <History
        proposal
        entries={[
          { date: '2026-11-26', text: <>Owner decisions: tapping a row fills it, with an (i) at the end that opens the details (replaces the labeled Fill button; the “Against” note on the (i) became a decision); rows that read the same say what differs; Safari’s system list stays as it is (frames F and G not taken); “Other” always listed and “New Login…” stay open. Status changed from proposal to partly approved.</> },
          { date: '2026-11-26', text: <>Owner: do not add the site line (“Choose a login for “site””) to the sheet; the heading stays as built. Removed it from frame B and the ranking.</> },
          { date: '2026-11-26', text: <>Page added as a proposal after the owner’s Apple Passwords screenshots: the sheet’s site line, Other group, in-sheet details and New Login…, and the system list’s duplicate username problem with the API facts. Replaces nothing; <a href="#/autofill">the AutoFill page</a> stays the approved picker.</> },
        ]}
      />
    </Page>
  );
}
