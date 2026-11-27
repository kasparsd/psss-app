import type { ReactNode } from 'react';
import type { Pictures } from '../Gallery';
import { byId, type Item } from '../../data';
import { IPhone } from '../../components/devices';
import { ItemCard } from '../../components/ItemCard';
import { Chevron, ListHead, ListRow } from '../../components/Rows';
import { Nav } from '../../screens/PhoneScreens';
import { renderDevice } from '../../screens/render';
import type { WorkspaceInit } from '../../components/Workspace';
import { BackButton, Row, ScreenTitle, VaultDevice, vaultTabs } from './vaultParts';

/* Cards, as pages/CardsTab.tsx draws them. On iPhone two cards are given the same name to show the problem; fictional. The old one has expired. */
const current: Item = { ...byId(6), name: 'Everyday Visa' };
const old: Item = { ...byId(9), name: 'Everyday Visa' };
const live: Item[] = [byId(8), current, byId(7)];

function List() {
  return (
    <VaultDevice>
      <IPhone tab="cards" tabs={vaultTabs}>
        <Nav right={<button type="button" className="btn">+ Add</button>} />
        <ScreenTitle>Cards</ScreenTitle>
        <div className="pbody tabpad">
          <div className="grp">
            {live.map((c) => (
              <Row key={c.id} cue={c.id === current.id}><ListRow item={c} trailing={<Chevron />} /></Row>
            ))}
          </div>
          <ListHead>Expired</ListHead>
          <div className="grp">
            <Row><ListRow item={old} trailing={<Chevron />} /></Row>
          </div>
        </div>
      </IPhone>
    </VaultDevice>
  );
}

function CardPage({ copied }: { copied?: boolean }) {
  return (
    <VaultDevice cue={copied ? undefined : 'expiry'}>
      <IPhone tab="cards" tabs={vaultTabs} pill={copied ? 'Expiry copied' : undefined}>
        <Nav left={<BackButton label="Cards" />} right={<button type="button" className="btn main">Edit</button>} />
        <div className="pbody tabpad" style={{ overflow: 'auto' }}>
          <ItemCard item={current} copied={copied ? 'Expiry' : undefined} />
        </div>
      </IPhone>
    </VaultDevice>
  );
}

/** The Mac and iPad window with Cards chosen. The sample vault has "Everyday Visa" and "Old Visa" (expired), so the wide pictures use those. */
const wide = (init: WorkspaceInit): { ipad: ReactNode; mac: ReactNode } => ({
  ipad: renderDevice('ipad', null, { side: 'cards', ...init }),
  mac: renderDevice('mac', null, { side: 'cards', ...init }),
});

export function cardsPictures(): Pictures {
  const open = wide({ sel: 6 });
  const copied = wide({ sel: 6, copied: 'Expiry' });
  const expired = wide({ sel: 9 });
  return {
    iphone: [
      { caption: 'Two Visas, one name. Last four digits and expiry tell them apart.', screen: <List /> },
      { caption: 'Each field on the card has its own copy icon.', screen: <CardPage /> },
      { caption: 'The expiry is copied, ready to paste into the checkout.', screen: <CardPage copied /> },
    ],
    ipad: [
      { caption: 'Cards in the sidebar, the chosen card’s page beside the list.', screen: open.ipad },
      { caption: 'The expiry is copied, ready to paste into the checkout.', screen: copied.ipad },
      { caption: 'An expired card goes last, under Expired.', screen: expired.ipad },
    ],
    mac: [
      { caption: 'Cards in the sidebar, the chosen card’s page beside the list.', screen: open.mac },
      { caption: 'The expiry is copied, ready to paste into the checkout.', screen: copied.mac },
      { caption: 'An expired card goes last, under Expired.', screen: expired.mac },
    ],
  };
}
