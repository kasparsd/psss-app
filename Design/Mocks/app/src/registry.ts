import type { ComponentType } from 'react';
import { TabsOnMacAndIpad } from './pages/TabsOnMacAndIpad';
import { ToolbarAndEdit } from './pages/ToolbarAndEdit';
import { CopyIcons } from './pages/CopyIcons';
import { CardsTab } from './pages/CardsTab';
import { TabBarAndCodes } from './pages/TabBarAndCodes';
import { InlineHelp } from './pages/InlineHelp';
import { UnlockScreen } from './pages/UnlockScreen';

export interface PageEntry {
  slug: string;
  title: string;
  /** Label in the page menu at the top of every page. */
  short: string;
  /** The static file this page replaces (kept so old links work). */
  oldFile: string;
  status: string;
  summary: string;
  component: ComponentType;
}

// Add a page here, then it is routed and listed on the home page.
export const pages: PageEntry[] = [
  { slug: 'toolbar-and-edit', short: 'Toolbar and Edit', title: 'Toolbar and Edit', oldFile: 'toolbar-and-edit.html', status: 'Approved 2026-11-23, being built (clickable prototype)', summary: 'Mac and iPad: a toolbar per column, All / Codes / Cards and + Add over the list, a labelled Edit over the item, Cancel and Save, Delete Item at the bottom of the editor, Set Up Code…, copy icons, search, an empty-list toggle.', component: ToolbarAndEdit },
  { slug: 'tabs-on-mac-and-ipad', short: 'Places', title: 'Tabs on Mac and iPad (places All, Codes, Cards)', oldFile: 'tabs-on-mac-and-ipad.html', status: 'Approved 2026-11-23, being built', summary: 'The three places on iPhone, iPad and Mac, each view with its own device switch and one switch for the whole page.', component: TabsOnMacAndIpad },
  { slug: 'copy-icons', short: 'Copy icons', title: 'Copy icons and the Copied pill', oldFile: 'copy-icons.html', status: 'Approved 2026-11-23, being built', summary: 'The copy icon on each field, the checkmark and the pill, the eye beside eight dots, Add code beside its field, and the field row convention.', component: CopyIcons },
  { slug: 'cards-tab', short: 'Cards', title: 'Cards tab', oldFile: 'cards-tab.html', status: 'Revised version approved 2026-11-23, not built yet', summary: 'A third iPhone tab: one row per card (brand, last four, expiry) that opens the card\'s page; expired and empty states; Mac and iPad.', component: CardsTab },
  { slug: 'tab-bar-and-codes', short: 'Tab bar and Codes', title: 'Tab bar and Codes', oldFile: 'tab-bar-and-codes.html', status: 'Approved 2026-11-23, being built', summary: 'The iPhone tab bar with the search tab, the Codes list and its states, search on the All screen, Codes on Mac and iPad, and which other tabs were considered.', component: TabBarAndCodes },
  { slug: 'inline-help', short: 'Inline help', title: 'Inline help', oldFile: 'inline-help.html', status: 'Approved 2026-11-23, being built', summary: 'An info button that opens a short bubble: the Codes countdown, the setup key in the editor, Mac and iPad popovers, and the rules for what a bubble may hold.', component: InlineHelp },
  { slug: 'unlock-screen', short: 'Unlock', title: 'Unlock screen', oldFile: '', status: 'Approved 2026-11-23, not built yet', summary: 'Passwords-style lock screen on every device: icon with the live Touch ID or Face ID glyph, one line, Use Password…; Touch ID listens while the Mac window is in front.', component: UnlockScreen },
];
