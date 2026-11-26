import { Against, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { IPhone, type TabSpec } from '../components/devices';
import { AllGlyph, CardsGlyph, CodesGlyph, MoreGlyph } from '../icons';
import { FieldRow } from '../components/FieldRow';
import { Chevron, ItemIcon } from '../components/Rows';
import { Nav, PhoneAll } from '../screens/PhoneScreens';
import { BackIcon } from '../icons';

const all: TabSpec = ['all', 'All', <AllGlyph key="a" />];
const codes: TabSpec = ['codes', 'Codes', <CodesGlyph key="c" />];
const cards: TabSpec = ['cards', 'Cards', <CardsGlyph key="d" />];
const more: TabSpec = ['more', 'More', <MoreGlyph key="m" />];

const networks = [
  { name: 'Home', sub: 'Harbor-5G · WPA3', color: 5 as const },
  { name: 'Studio', sub: 'studio-guest · WPA2', color: 3 as const },
  { name: 'Parents', sub: 'Karlsson-WiFi · WPA2', color: 2 as const },
  { name: 'Cabin', sub: 'Cabin Net · WPA2', color: 4 as const },
];

const fourAndSearch = [all, codes, cards, more];

function WifiList() {
  return (
    <IPhone tab="more" tabs={fourAndSearch}>
      <Nav left={<button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>More</button>} right={<button className="btn">+ Add network</button>} />
      <div className="lt"><div className="t">Wi-Fi</div><div className="s">4 networks</div></div>
      <div className="pbody tabpad">
        <div className="grp">
          {networks.map((n) => (
            <div key={n.name} className="prow link">
              <ItemIcon item={{ name: n.name, color: n.color }} />
              <div className="grow">
                <div className="trunc">{n.name}</div>
                <div className="s trunc">{n.sub}</div>
              </div>
              <Chevron />
            </div>
          ))}
        </div>
        <div className="hint">Open a network to copy its password or show a QR code a guest can scan.</div>
      </div>
    </IPhone>
  );
}

function WifiEmpty() {
  return (
    <IPhone tab="more" tabs={fourAndSearch}>
      <Nav left={<button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>More</button>} right={<button className="btn">+ Add network</button>} />
      <div className="lt"><div className="t">Wi-Fi</div></div>
      <div className="pbody tabpad" style={{ textAlign: 'center', paddingTop: 40 }}>
        <div className="t" style={{ fontSize: 'var(--b)', fontWeight: 600 }}>No Wi-Fi networks yet</div>
        <div className="s" style={{ margin: '8px 20px 16px' }}>Save the password of a network you share often. Psss keeps it with your other passwords and can show a QR code for a guest to join.</div>
        <button className="btn pri">+ Add network</button>
      </div>
    </IPhone>
  );
}

const Mark = ({ n }: { n: number }) => (
  <svg viewBox="0 0 29 29" width="100%" height="100%" shapeRendering="crispEdges" aria-label="QR code (drawn, not real)">
    <rect width="29" height="29" fill="#fff" />
    {Array.from({ length: 29 * 29 }, (_, i) => {
      const x = i % 29, y = Math.floor(i / 29);
      const finder = (x < 8 && y < 8) || (x > 20 && y < 8) || (x < 8 && y > 20);
      if (finder) return null;
      return ((x * 7 + y * 13 + x * y + n) % 5 < 2) ? <rect key={i} x={x} y={y} width="1" height="1" fill="#000" /> : null;
    })}
    {[[0, 0], [22, 0], [0, 22]].map(([x, y]) => (
      <g key={`${x}${y}`}><rect x={x} y={y} width="7" height="7" fill="#000" /><rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" /><rect x={x + 2} y={y + 2} width="3" height="3" fill="#000" /></g>
    ))}
  </svg>
);

function WifiItem({ qr }: { qr?: boolean }) {
  const back = <button className="btn plain" style={{ paddingLeft: 0 }}><span style={{ display: 'inline-flex', width: 14, height: 14 }}><BackIcon /></span>Wi-Fi</button>;
  return (
    <IPhone tab="more" tabs={fourAndSearch}>
      <Nav left={back} right={<button className="btn main">Edit</button>} />
      <div className="pbody tabpad" style={{ overflow: 'auto' }}>
        <div className="ident"><ItemIcon item={{ name: 'Home', color: 5 }} big /><div className="t">Home</div></div>
        <div className="icard">
          <FieldRow label="Network name" value="Harbor-5G" />
          <FieldRow label="Password" value="harbor-light-4821-maple" secret />
          <FieldRow label="Security" value="WPA3 Personal" />
          <div className="frow"><button className="btn sq acc">Join This Network</button><button className="btn sq">Show QR Code</button></div>
        </div>
        <div className="gh">Notes</div>
        <div className="icard"><FieldRow label="Notes" value="Router is in the hall cupboard." /></div>
        {qr && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', alignItems: 'end', zIndex: 5 }}>
            <div style={{ background: 'var(--card)', borderRadius: '24px 24px 0 0', padding: '20px 20px 28px', textAlign: 'center' }}>
              <div style={{ fontWeight: 600 }}>Join Harbor-5G</div>
              <div style={{ width: 190, height: 190, margin: '14px auto', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--sep)' }}><Mark n={3} /></div>
              <div className="s" style={{ marginBottom: 14 }}>Point a phone’s Camera at this. It joins without typing the password. The code contains the password, so show it only to people you trust.</div>
              <button className="btn wide">Done</button>
            </div>
          </div>
        )}
      </div>
    </IPhone>
  );
}

export function WifiPlace() {
  return (
    <Page
      title="Wi-Fi and Recently Deleted"
      status={<><strong>Wi-Fi: built. Direction chosen by the owner, 2026-11-24.</strong> The bottom bar and the More page (one tab called More that holds Wi-Fi, Recently Deleted and the places to come) moved to <a href="#/places">Places</a> on 2026-11-26; this page keeps the Wi-Fi pages and where Recently Deleted lives.</>}
    >
      <Clarity
        intro={<p>What a person must know here, before any layout:</p>}
        items={[
          ['Which thing?', 'A Wi-Fi network they join often: its name, password and security type. Kept in the vault like a password, so it is encrypted, backed up and on every device with the vault. Nothing is uploaded to a network.'],
          ['What must they give?', 'A network name and a password. Security type defaults to WPA2/WPA3 and is rarely changed. Hidden network is a switch in Edit.'],
          ['What can go wrong?', 'A guest cannot read the password (the QR code solves it); the password changed on the router (Edit); there are no networks yet (the empty state says what the tab is for).'],
          ['How do they leave?', 'Choose another tab or go back. Showing a QR code changes nothing; Done closes it. The password is shown only after a deliberate tap, as everywhere else.'],
        ]}
      />

      <p className="prose muted">The bottom bar (always All, Codes, Cards, More) and the More page itself are on <a href="#/places">Places</a>; this page is about what is behind the Wi-Fi and Recently Deleted rows.</p>

      <Section title="1. iPhone" />
      <Frames>
        <Frame phone label="A. Wi-Fi" caption="Each row shows the network’s name as you call it (Home) and, in the grey line, the name the router shows and its security. The back button says More. + Add network is labelled, as + Add is on the other tabs.">
          <WifiList />
        </Frame>
        <Frame phone label="B. A network" caption="Network name, Password (hidden until the eye is pressed, copied with the copy icon) and Security. Two labelled buttons: Join This Network (iPhone and iPad only; the system asks before it joins) and Show QR Code for a guest.">
          <WifiItem />
        </Frame>
        <Frame phone label="C. Show QR Code" caption="A sheet from the bottom with the code to scan and one sentence about who should see it. Standard Wi-Fi QR format, so any phone’s Camera can join. The code here is drawn, not real.">
          <WifiItem qr />
        </Frame>
        <Frame phone label="D. No networks yet" caption="The row in More (see Places) is there from the start, so the place can be found before it is used.">
          <WifiEmpty />
        </Frame>
        <Frame phone label="E. Recently Deleted is in More" caption="With the count beside its row in More (see Places). It was the last entry of the Filter menu on the All tab; that entry goes, since a place should have one home. The count is plain text, not a red badge: Apple keeps badges for critical information.">
          <PhoneAll menuOpen />
        </Frame>
      </Frames>
      <p className="prose muted">iPad at regular width and Mac use the sidebar: Wi-Fi is a row under Codes and Cards and Recently Deleted stays the last row, each with its count; there is no More there because the sidebar has room. iPad at compact width uses the iPhone tab bar. Frame E still shows the Filter menu as it is today, with Recently Deleted in it; it moves to More once this is approved and built. Nothing here is built yet.</p>

      <Section title="2. Decisions" />
      <Decisions
        items={[
          {
            decision: <><strong>1. Recently Deleted lives in More only, with its count.</strong> It leaves the Filter menu on iPhone. On iPad and Mac it stays the last sidebar row.</>,
            rejected: <>keeping it in two places (a place should have one home); a badge on the tab (Apple reserves badges for critical information).</>,
            why: <>It is a recovery place, not a daily one, and More is where such places go.</>,
          },
          {
            decision: <><strong>2. A Wi-Fi network is a custom item with a type marker, so it stays an ordinary KeePass entry.</strong> The network name is the username, the password is the password, and Security and Hidden are custom strings.</>,
            rejected: <>a separate file or store; an entry type other apps cannot read.</>,
            why: <>The vault keeps working in KeePassXC and Strongbox.</>,
          },
          {
            decision: <><strong>3. Join This Network is offered on iPhone and iPad (owner, 2026-11-24).</strong> It uses the system’s Hotspot Configuration, which asks the person before joining; the entitlement is added to the iOS app. The Mac shows the QR code only.</>,
            why: <>It saves typing a long password on the device the person is holding. Nothing is joined without the system’s own prompt.</>,
          },
        ]}
      />
      <Against>
        <li>Wi-Fi sits one tap deeper than a tab would put it; the owner chose that for room to grow (the More tab and Apple’s guidance on it are on <a href="#/places">Places</a>).</li>
        <li>Nothing here is stored or sent until a network is added. The QR code is made on the device. Join asks the system’s permission each time.</li>
      </Against>
      <History
        entries={[
          { date: '2026-11-26', text: <>Retitled from “More tab, Wi-Fi and Recently Deleted”. The bottom-bar strips, the More tab decision (one More tab for places not in the bar) and the More list frame (grey tiles, subtitles) moved to <a href="#/places">Places</a>, where the owner chose a plain list of places (inset grouped, no tiles or subtitles) for the iPhone More tab. The Wi-Fi frames were lettered A to D and the Recently Deleted frame E; decisions 2 to 4 became 1 to 3.</> },
          { date: '2026-11-24', text: <>Redrawn after the owner chose a More tab over Wi-Fi as a fourth tab and over a Recently Deleted tab: the bar is always All, Codes, Cards, More; More lists Wi-Fi and Recently Deleted with counts; Recently Deleted leaves the Filter menu; Join This Network was added. Earlier the page recommended Wi-Fi as a tab and Recently Deleted staying in Filter; the owner chose differently.</> },
        ]}
      />
    </Page>
  );
}
