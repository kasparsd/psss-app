import { useState } from 'react';
import { Against, Approved, ChangeNote, Clarity, Page, Section } from '../components/page';
import { DeviceSwitcher } from '../components/DeviceSwitcher';
import type { Device } from '../components/devices';
import { renderDevice } from '../screens/render';

export function ToolbarAndEdit() {
  const [device, setDevice] = useState<Device>('mac');
  const [empty, setEmpty] = useState(false);
  return (
    <Page
      title="Toolbar and Edit (prototype)"
      status={
        <>
          <Approved />, with all updates (owner); being built. Mac and iPad, modelled on Apple's Passwords app. Replaces the floating Edit and the single window-wide toolbar tried earlier the same day. The prototype works: click All / Codes / Cards, the sidebar rows, items, Edit (and Delete Item inside it), Set Up Code…, the sidebar button, search, the copy icons and the eye.
        </>
      }
    >
      <Clarity
        items={[
          ['Which thing?', 'The places stay as approved: All / Codes / Cards as a segmented control at the top, and the sidebar list beside it, both showing one selection. iPhone keeps its tab bar.'],
          ['The toolbar', 'follows the columns, as in Passwords: the sidebar button over the sidebar; All / Codes / Cards and + Add over the list, with the list\'s title and count as its first line; Edit and search over the item. Each part holds very little.'],
          ['Edit', 'is a labelled button above the open item. While editing, Cancel and Save take its place, and a red Delete Item sits at the bottom of the form, saying where the item goes.'],
          ['The item', 'opens with its icon centred above its name, at the top of its card: which item this is, nothing else.'],
        ]}
      />
      <ChangeNote>
        Rebuilt from the shared components. Field rows now match the copy-icon decision: eight dots and an eye on hidden values (the card number keeps “•••• 4417”), and a row with nothing to copy has no copy icon. The sidebar follows the plan: Recent, Most used, All, Codes, Cards, Logins, Secure notes, Custom items, Recently Deleted, then Filters (Passkeys, With notes). Editing a login shows “Add code” / “Replace code” beside the setup key field and “Remove code” alone below. In Recently Deleted the toolbar offers a labelled Restore. Delete Item shows Undo for 10 seconds.
      </ChangeNote>

      <div className="ctl">
        <span>Device <DeviceSwitcher label="Device" value={device} options={['mac', 'ipad']} onChange={setDevice} /></span>
        <label><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> Empty list</label>
      </div>

      <div className="stagebox" style={{ maxWidth: 1000 }}>
        {renderDevice(device, null, { side: 'recent' }, { menuBar: true, empty })}
      </div>

      <p className="prose muted">Mac: click “Psss” in the menu bar to see Settings. iPad: the Setup gear sits beside the sidebar button. Northbank has no code, so its card shows “Set Up Code…”. Switching device restarts the prototype.</p>

      <Section title="Decisions to approve" />
      <table className="cmp">
        <thead><tr><th>Where</th><th>What</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>Sidebar</td><td>The approved list: Recent, Most used, All, Codes, Cards, Logins, Secure notes, Custom items, Recently Deleted, then Filters (Passkeys, With notes), with counts. It and the All / Codes / Cards control show one selection.</td><td>Unchanged (owner, 2026-11-23: keep our tabs at the top, no Passwords-style tiles).</td></tr>
          <tr><td>Toolbar over the sidebar</td><td>Sidebar button. iPad also the Setup gear.</td><td>Setup is about the whole app. Mac: Psss › Settings… (⌘,).</td></tr>
          <tr><td>Toolbar over the list</td><td><strong>All / Codes / Cards</strong>, then <strong>+ Add</strong> with its label. The list's title and count (“All · 9 items”) are the first line of the list. Mac keeps ⌘1 to ⌘3.</td><td>Both change or add to the list below. Add asks for the item type after the click, as today.</td></tr>
          <tr><td>Toolbar over the item</td><td><strong>Edit</strong> (labelled), then search, which says “Search all items”.</td><td>Where Passwords puts Edit, so people know where to look. Search covers the whole vault from any place, and the field says so.</td></tr>
          <tr><td>Editing</td><td><strong>Cancel</strong> and <strong>Save</strong> in Edit's place; the sidebar, list and search dim. A red <strong>Delete Item</strong> at the bottom of the form, with “Moves this item to Recently Deleted. You can bring it back for 30 days.”</td><td>As in Passwords. Delete is one deliberate step away and never beside Edit. Undo follows, so it asks nothing more.</td></tr>
          <tr><td>Item card</td><td>Icon centred above the name at the top of the card, then the fields. Every field row, on logins, cards and notes alike, ends with a copy icon; hidden values show eight dots and an eye. Labelled buttons under the field they act on, starting with <strong>Set Up Code…</strong> on a login without a code.</td><td>The identity of the item, then its contents. Actions are words next to what they change; no “⋯” menus.</td></tr>
          <tr><td>Nothing open</td><td>Edit disappears; the pane says “No item open”.</td><td>Only when the list is empty, since the first item opens by itself. Nothing to edit, as in Passwords.</td></tr>
        </tbody>
      </table>

      <h3>Where Psss differs from Passwords, on purpose</h3>
      <div className="prose">
        <ul>
          <li><strong>Copy icons are visible</strong> on every field. Passwords hides copying behind a click on the value.</li>
          <li><strong>The first item opens by itself.</strong> Passwords shows “No Item Selected”.</li>
          <li><strong>Search covers the whole vault.</strong> Passwords searches the selected place and names it in the field.</li>
          <li><strong>+ Add has a label.</strong> Passwords uses a bare +.</li>
        </ul>
      </div>

      <Against>
        <li>None in the structure: per-column toolbars and a labelled Edit are what Passwords does. The labelled + Add departs from the compact toolbar convention, by the app's rule that important actions carry words.</li>
      </Against>
    </Page>
  );
}
