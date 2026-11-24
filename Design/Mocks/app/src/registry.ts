import type { ComponentType } from 'react';
import { Places } from './pages/Places';
import { CardsTab } from './pages/CardsTab';
import { ListRows } from './pages/ListRows';
import { FilterAndSort } from './pages/FilterAndSort';
import { ItemPage } from './pages/ItemPage';
import { CopyIcons } from './pages/CopyIcons';
import { InlineHelp } from './pages/InlineHelp';
import { UnlockScreen } from './pages/UnlockScreen';
import { Logo } from './pages/Logo';
import { FieldMapping } from './pages/FieldMapping';

export interface PageEntry {
  slug: string;
  title: string;
  /** Label in the page menu at the top of every page. */
  short: string;
  /** The static file this page replaces (kept so old links work). */
  oldFile: string;
  /** Who approved the current decisions, and when. Build status lives in docs, not here. */
  status: string;
  summary: string;
  component: ComponentType;
}

// Add a page here, then it is routed and listed on the home page.
export const pages: PageEntry[] = [
  { slug: 'places', short: 'Places', title: 'Places: All, Codes, Cards', oldFile: 'tab-bar-and-codes.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24', summary: 'The tab bar on iPhone, the sidebar on Mac and iPad, search, and the Codes list with its Recently used group.', component: Places },
  { slug: 'cards-tab', short: 'Cards', title: 'Cards tab', oldFile: 'cards-tab.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24', summary: 'One row per card, last four digits and expiry on the right, a Recently used group, expired cards last, and the card\'s own page.', component: CardsTab },
  { slug: 'list-rows', short: 'List rows', title: 'List rows', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'The one row of every list: lines between rows, what a login has at the trailing end, and one way to write a code.', component: ListRows },
  { slug: 'filter-and-sort', short: 'Filter and sort', title: 'Filter and sort', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'Sort and Filter before + Add: Show a kind, With what an item has, Sort by, the Recently used group, and the guards for an empty or forgotten filter.', component: FilterAndSort },
  { slug: 'item-page', short: 'Item page', title: 'Item page, Edit and toolbar', oldFile: 'toolbar-and-edit.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24', summary: 'The icon and name above one card per group, one field order in view, edit and new, optional names with the heading as the name field, Edit in place, Move to Recently Deleted, the toolbar per column on Mac and iPad, and a clickable prototype.', component: ItemPage },
  { slug: 'copy-icons', short: 'Copying', title: 'Copying a field', oldFile: 'copy-icons.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24', summary: 'A tap anywhere on a field copies it, the copy icon as its sign, the Copied pill, the eye beside eight dots, and where a field\'s action sits.', component: CopyIcons },
  { slug: 'inline-help', short: 'Inline help', title: 'Inline help', oldFile: 'inline-help.html', status: 'Approved by the owner, 2026-11-23', summary: 'An info button that opens a short bubble: the clipboard line, the setup key in the editor, Mac and iPad popovers, and the rules for what a bubble may hold.', component: InlineHelp },
  { slug: 'unlock-screen', short: 'Unlock', title: 'Unlock screen', oldFile: '', status: 'Approved by the owner, 2026-11-23', summary: 'Passwords-style lock screen on every device: icon with the live Touch ID or Face ID glyph, one line, Use Password…; Touch ID listens while the Mac window is in front.', component: UnlockScreen },
  { slug: 'logo', short: 'Logo', title: 'Logo: one field, shown and hidden', oldFile: '', status: 'Approved by the owner, 2026-11-24; app icon and lock screen not built', summary: 'The logo as one password field in two states: hidden it is a p and three dots, shown it reads psss. It rests hidden and shows the name on hover; the reverse is kept. Varela Round letters a little heavier than the outline, sizes from page to icon, and the decisions.', component: Logo },
  { slug: 'field-mapping', short: 'Field mapping', title: 'KeePass field mapping', oldFile: 'keepass-field-mapping.html', status: 'Approved by the owner, 2026-11-24; native sheet not rebuilt yet', summary: 'A custom item\'s page and its one button, Edit, and the Show as sheet: stored fields on the left, what each is used as on the right, a missing card number, and Custom item.', component: FieldMapping },
];
