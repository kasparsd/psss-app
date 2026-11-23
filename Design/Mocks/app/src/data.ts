// Shared sample data for every mock page. Fictional. Change an item here
// and every page that draws it changes with it.

export type Kind = 'login' | 'note' | 'card' | 'custom';

export interface Field {
  label: string;
  value: string;
  /** Hidden until the eye is pressed. */
  secret?: boolean;
  /** What a hidden value shows. Default: the fixed eight dots. */
  mask?: string;
}

export interface Item {
  id: number;
  name: string;
  /** The second line of a list row. */
  account: string;
  kind: Kind;
  color: 1 | 2 | 3 | 4 | 5 | 6;
  /** Live six-digit code as it reads right now. */
  code?: string;
  /** Seconds. Missing means 30. */
  period?: number;
  /** A code setting Psss cannot make a code from. */
  brokenCode?: boolean;
  passkey?: boolean;
  recent?: boolean;
  uses: number;
  fields: Field[];
  /** Cards only. */
  expired?: boolean;
  last4?: string;
  brand?: string;
}

/** What every hidden value shows, whatever its real length. */
export const DOTS = '••••••••';

export const items: Item[] = [
  {
    id: 1, name: 'Gitforge', account: 'sam.r', kind: 'login', color: 1, code: '482 913', passkey: true, recent: true, uses: 42,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'harbor-lantern-quiet-orbit-7', secret: true },
      { label: 'Website', value: 'gitforge.example' },
      { label: 'Notes', value: 'Team account. Billing contact is the finance mailbox.' },
    ],
  },
  {
    id: 2, name: 'Northbank', account: 'sam.r', kind: 'login', color: 2, recent: true, uses: 31,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'velvet-anchor-tide-92', secret: true },
      { label: 'Website', value: 'northbank.example' },
    ],
  },
  {
    id: 3, name: 'Home Wi-Fi', account: 'Secure note', kind: 'note', color: 5, recent: true, uses: 12,
    fields: [{ label: 'Note', value: 'Network: Harbor-5G. Password on the router label.' }],
  },
  {
    id: 4, name: 'Cloudnest', account: 'sam.r', kind: 'login', color: 3, code: '913 640', recent: true, uses: 20,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'maple-dune-orbit-58', secret: true },
      { label: 'Website', value: 'cloudnest.example' },
    ],
  },
  {
    id: 5, name: 'Mailbox', account: 'sam.rivera', kind: 'login', color: 5, code: '305 118', passkey: true, recent: true, uses: 55,
    fields: [
      { label: 'Username', value: 'sam.rivera' },
      { label: 'Password', value: 'granite-lark-wave-310', secret: true },
      { label: 'Website', value: 'mailbox.example' },
    ],
  },
  {
    id: 6, name: 'Everyday Visa', account: 'Visa •• 4417 · 08/28', kind: 'card', color: 2, recent: true, uses: 18, last4: '4417', brand: 'Visa',
    fields: [
      { label: 'Number', value: '4929 1102 7731 4417', secret: true, mask: '•••• 4417' },
      { label: 'Expiry', value: '08/28' },
      { label: 'Security code', value: '731', secret: true },
      { label: 'Name on card', value: 'Sam Rivera' },
    ],
  },
  {
    id: 7, name: 'Travel Mastercard', account: 'Mastercard •• 9052 · 11/27', kind: 'card', color: 3, uses: 9, last4: '9052', brand: 'Mastercard',
    // No security code saved: the row does not exist.
    fields: [
      { label: 'Number', value: '5412 7500 3318 9052', secret: true, mask: '•••• 9052' },
      { label: 'Expiry', value: '11/27' },
      { label: 'Name on card', value: 'Sam Rivera' },
    ],
  },
  {
    id: 8, name: 'Business Amex', account: 'Amex •• 3006 · 05/29', kind: 'card', color: 5, uses: 6, last4: '3006', brand: 'American Express',
    fields: [
      { label: 'Number', value: '3782 822463 13006', secret: true, mask: '•••• 3006' },
      { label: 'Expiry', value: '05/29' },
      { label: 'Security code', value: '4421', secret: true },
      { label: 'Name on card', value: 'Sam Rivera' },
    ],
  },
  {
    id: 9, name: 'Old Visa', account: 'Expired 03/25', kind: 'card', color: 4, uses: 2, last4: '1180', brand: 'Visa', expired: true,
    fields: [
      { label: 'Number', value: '4716 2209 4410 1180', secret: true, mask: '•••• 1180' },
      { label: 'Expiry', value: '03/25' },
      { label: 'Security code', value: '208', secret: true },
      { label: 'Name on card', value: 'Sam Rivera' },
    ],
  },
  {
    id: 10, name: 'Parcelpost', account: 'sam.r', kind: 'login', color: 1, recent: false, uses: 8,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'copper-finch-lane-44', secret: true },
      { label: 'Website', value: 'parcelpost.example' },
    ],
  },
  {
    id: 11, name: 'Streamly', account: 'sam.r', kind: 'login', color: 6, uses: 5,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'pepper-owl-stone-8', secret: true },
      { label: 'Website', value: 'streamly.example' },
    ],
  },
  {
    id: 12, name: 'Gym locker', account: 'Custom item', kind: 'custom', color: 4, uses: 3,
    fields: [{ label: 'Combination', value: '18-04-27', secret: true }],
  },
  // Codes the list has to handle.
  {
    id: 13, name: 'Harbor Vault', account: 'sam.r', kind: 'login', color: 4, code: '8142 0973', period: 60, uses: 4,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'basalt-reed-moon-61', secret: true },
    ],
  },
  {
    id: 14, name: 'Old forum', account: 'sam.r', kind: 'login', color: 6, brokenCode: true, uses: 1,
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'quartz-moss-pine-17', secret: true },
    ],
  },
];

/** Items in Recently Deleted, with their age. */
export const deletedItems: (Item & { deletedAgo: string })[] = [
  {
    id: 101, name: 'Retired router', account: 'Secure note', kind: 'note', color: 4, uses: 1, deletedAgo: 'Deleted 3 days ago',
    fields: [{ label: 'Note', value: 'Admin login for the old router. Replaced in March.' }],
  },
  {
    id: 102, name: 'Quiz night', account: 'sam.r', kind: 'login', color: 3, uses: 1, deletedAgo: 'Deleted 12 days ago',
    fields: [
      { label: 'Username', value: 'sam.r' },
      { label: 'Password', value: 'otter-plum-sky-33', secret: true },
    ],
  },
];

export const byId = (id: number): Item => {
  const it = items.find((i) => i.id === id);
  if (!it) throw new Error(`No sample item ${id}`);
  return it;
};

export const hasCode = (i: Item) => !!i.code || !!i.brokenCode;
export const isLogin = (i: Item) => i.kind === 'login';

export const logins = items.filter((i) => i.kind === 'login');
export const codeItems = items.filter((i) => !!i.code || i.brokenCode);
export const cardItems = items.filter((i) => i.kind === 'card');
