import type { Pictures } from '../Gallery';
import { byId, deletedItems, type Item } from '../../data';
import { GearIcon } from '../../icons';
import { IPhone } from '../../components/devices';
import { ItemCard } from '../../components/ItemCard';
import { Chevron, ListRow } from '../../components/Rows';
import { UndoBanner } from '../../components/UndoBanner';
import { Nav } from '../../screens/PhoneScreens';
import { renderDevice } from '../../screens/render';
import { BackButton, Row, VaultDevice, unused, vaultTabs } from './vaultParts';

/** The logins of this small vault, A to Z. Streamly is the one that moves. */
const logins: Item[] = [1, 2, 4, 5, 10, 11].map(byId).sort((a, b) => a.name.localeCompare(b.name));
const streamly = byId(11);

/** The All list. `moved` hides Streamly and shows the banner the app draws right after the move. */
function AllList({ moved }: { moved?: boolean }) {
  const rows = logins.filter((l) => !moved || l.id !== streamly.id);
  return (
    <VaultDevice cue={moved ? 'undo' : undefined}>
      <IPhone tab="all" tabs={vaultTabs}>
        <Nav
          left={<button type="button" className="ibtn flat" aria-label="Settings" data-tip="Settings"><GearIcon /></button>}
          right={<button type="button" className="btn">+ Add</button>}
        />
        <div className="lt">
          <div className="t">All <span className="s" style={{ fontWeight: 400 }}>· {rows.length} items</span></div>
        </div>
        <div className="pbody tabpad">
          <div className="grp">
            {rows.map((l) => (
              <Row key={l.id} cue={!moved && l.id === streamly.id}><ListRow item={l} trailing={<Chevron />} /></Row>
            ))}
          </div>
        </div>
        {moved && <UndoBanner text={`“${streamly.name}” moved to Recently Deleted`} above="tabbar" />}
      </IPhone>
    </VaultDevice>
  );
}

const Page = () => (
  <VaultDevice cue="edit">
    <IPhone tab="all" tabs={vaultTabs}>
      <Nav left={<BackButton label="All" />} right={<button type="button" className="btn main">Edit</button>} />
      <div className="pbody tabpad" style={{ overflow: 'auto' }}><ItemCard item={streamly} /></div>
    </IPhone>
  </VaultDevice>
);

const Editing = () => (
  <VaultDevice cue="delete">
    <IPhone tall>
      <Nav left={<button type="button" className="btn plain">Cancel</button>} right={<button type="button" className="btn pri main">Save</button>} />
      <div className="pbody" style={{ overflow: 'visible' }}>
        <ItemCard item={streamly} mode="edit" onDelete={unused} />
      </div>
    </IPhone>
  </VaultDevice>
);

/** Recently Deleted, with the login that was just moved at the top. */
function RecentlyDeleted() {
  const rows: (Item & { when: string })[] = [{ ...streamly, when: 'Deleted just now' }, ...deletedItems.map((d) => ({ ...d, when: d.deletedAgo }))];
  return (
    <VaultDevice>
      <IPhone tab="more" tabs={vaultTabs}>
        <Nav left={<BackButton label="More" />} />
        <div className="lt">
          <div className="t">Recently Deleted <span className="s" style={{ fontWeight: 400 }}>· {rows.length} items</span></div>
        </div>
        <div className="pbody tabpad">
          <div className="grp">
            {rows.map((r) => <ListRow key={r.id} item={r} sub={r.when} traits={false} trailing={<Chevron />} />)}
          </div>
          <div className="hint">Items you delete stay here for 30 days.</div>
        </div>
      </IPhone>
    </VaultDevice>
  );
}

/*
 * The Mac and iPad window draws its Undo banner only after a real delete, and a static picture of it would still list the login
 * it says has moved, so the wide pictures show the page, the editor and Recently Deleted. The banner is on iPhone only.
 */
export function undoPictures(): Pictures {
  const wide = (init: Parameters<typeof renderDevice>[2]) => ({ ipad: renderDevice('ipad', null, init), mac: renderDevice('mac', null, init) });
  const page = wide({ side: 'logins', sel: streamly.id });
  const editing = wide({ side: 'logins', sel: streamly.id, editing: true });
  const deleted = wide({ side: 'deleted', sel: 101 });
  return {
    iphone: [
      { caption: 'You are tidying up your logins. Streamly looks old.', screen: <AllList /> },
      { caption: 'Moving a login away starts in Edit.', screen: <Page /> },
      { caption: 'Move to Recently Deleted says where it goes. Nothing asks you to confirm.', screen: <Editing /> },
      { caption: 'Wrong login? One tap on Undo puts it straight back.', screen: <AllList moved /> },
      { caption: 'Otherwise it waits in Recently Deleted for 30 days.', screen: <RecentlyDeleted /> },
    ],
    ipad: [
      { caption: 'Streamly looks old. Its page is open beside the list.', screen: page.ipad },
      { caption: 'Move to Recently Deleted says where it goes. Nothing asks you to confirm.', screen: editing.ipad },
      { caption: 'Deleted logins wait in Recently Deleted for 30 days.', screen: deleted.ipad },
    ],
    mac: [
      { caption: 'Streamly looks old. Its page is open beside the list.', screen: page.mac },
      { caption: 'Move to Recently Deleted says where it goes. Nothing asks you to confirm.', screen: editing.mac },
      { caption: 'Deleted logins wait in Recently Deleted for 30 days.', screen: deleted.mac },
    ],
  };
}
