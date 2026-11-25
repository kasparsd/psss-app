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
import { SmallMarkPage } from './pages/SmallMark';
import { FieldMapping } from './pages/FieldMapping';
import { CreateVault } from './pages/CreateVault';
import { WelcomePage } from './pages/Welcome';
import { WifiPlace } from './pages/WifiPlace';
import { SearchFields } from './pages/SearchFields';
import { CodeSetup } from './pages/CodeSetup';
import { Settings } from './pages/Settings';
import { VaultSwitcher } from './pages/VaultSwitcher';
import { VaultStates } from './pages/VaultStates';
import { Autofill } from './pages/Autofill';
import { BrowserExtension } from './pages/BrowserExtension';
import { AppSwitcher } from './pages/AppSwitcher';

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
  { slug: 'unlock-screen', short: 'Unlock', title: 'Unlock screen', oldFile: '', status: 'Approved by the owner, 2026-11-23', summary: 'One unlock form on every device, as built: the app icon, “Unlock [name]”, the password field, Unlock then Use Touch ID or Use Face ID; beside the sidebar on Mac and regular iPad, full screen on iPhone; the system prompt appears by itself.', component: UnlockScreen },
  { slug: 'logo', short: 'Logo', title: 'Logo: one field, shown and hidden', oldFile: '', status: 'Approved by the owner, 2026-11-24; app icon and lock screen not built', summary: 'The logo as one password field in two states: hidden it is a p and three dots, shown it reads psss. It rests hidden and shows the name on hover; the reverse is kept. Varela Round letters a little heavier than the outline, sizes from page to icon, and the decisions.', component: Logo },
  { slug: 'small-mark', short: 'Small mark', title: 'Small mark: toolbar button and favicon', oldFile: '', status: 'Option A chosen by the owner, 2026-11-25', summary: 'The field closed into a ring with one dot, outline or with the butter inside, for the browser toolbar button and the favicon.', component: SmallMarkPage },
  { slug: 'field-mapping', short: 'Field mapping', title: 'KeePass field mapping', oldFile: 'keepass-field-mapping.html', status: 'Approved by the owner, 2026-11-24; native sheet not rebuilt yet', summary: 'A custom item\'s page and its one button, Edit, and the Show as sheet: stored fields on the left, what each is used as on the right, a missing card number, and Custom item.', component: FieldMapping },
  { slug: 'welcome', short: 'Welcome', title: 'Welcome: the first screen', oldFile: '', status: 'Proposal (2026-11-25)', summary: 'The first screen of a new install with the Psss app icon in place of the key symbol, typing “psss” once.', component: WelcomePage },
  { slug: 'create-vault', short: 'Create a vault', title: 'Create a vault: where it is kept', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'The create sheet with a Keep in choice: iCloud Drive by default, so the vault survives deleting the app, or This device only; and the sheet when iCloud Drive is off.', component: CreateVault },
  { slug: 'wifi-place', short: 'More and Wi-Fi', title: 'More tab, Wi-Fi and Recently Deleted', oldFile: '', status: 'Direction chosen by the owner, 2026-11-24; redraw awaiting a look', summary: 'A More tab that lists the places not in the bar: Wi-Fi networks (with Join and a QR code to share) and Recently Deleted, and room for more.', component: WifiPlace },
  { slug: 'search-fields', short: 'Search fields', title: 'Search: find in a field', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'Pills under the search field for Name, Website and Username, each with its count and dimmed when nothing matches, so a domain that is also a username can be found as a website.', component: SearchFields },
  { slug: 'code-setup', short: 'Code setup', title: 'Verification code setup', oldFile: '', status: 'Option H approved by the owner, 2026-11-24; built, device check open', summary: 'Every way a verification code gets into a login, five options for the Add verification code sheet scored against each other, and the recommended sheet in each state on iPhone, iPad and Mac.', component: CodeSetup },
  { slug: 'settings', short: 'Settings', title: 'Settings: this vault and this app', oldFile: '', status: 'Chosen by the owner 2026-11-24, confirmed 2026-11-25: each vault has its own page; built, Mac device check open', summary: 'Settings lists the vaults and the app rows and each vault has its own page (iPhone and iPad push it; the Mac Settings window has General and Vaults panes), with the Remove Vault alerts.', component: Settings },
  { slug: 'vault-switcher', short: 'Add and switch vaults', title: 'Vaults: add one, switch between them', oldFile: '', status: 'Built, 2026-11-25', summary: 'Each vault is a section of the sidebar on Mac and iPad (Mail-style, with a right-click menu and Add Vault at the foot); iPhone and the iPad with a hidden sidebar have a labeled vault capsule whose menu follows Safari\u2019s profile menu. Several vaults can be open at once; auto-lock locks them all. New Vault, Open Vault File and Import are choices in that menu, the File menu and Settings \u203a Vaults; Open Vault File adds the file and shows its unlock screen.', component: VaultSwitcher },
  { slug: 'vault-states', short: 'Vault states', title: 'Vault states: one picture everywhere', oldFile: '', status: 'Proposal, 2026-11-24, not built', summary: 'The five states a person sees, one vault menu and one Vault row (with Unlock beside it) drawn once, every surface against every state, locking and unlocking, and several vaults open at once.', component: VaultStates },
  { slug: 'autofill', short: 'AutoFill', title: 'AutoFill: choosing a login', oldFile: '', status: 'Redrawn 2026-11-24 from the vault-states model; lead-approved, being built', summary: 'The system picker on iPhone, iPad and Mac: the app\u2019s row and search, the Vault row with Unlock beside it, and the notices when the chosen vault is locked or not available.', component: Autofill },
  { slug: 'browser-extension', short: 'Browser extension', title: 'Browser extension: the popup', oldFile: '', status: 'Redrawn 2026-11-24 from the vault-states model; lead-approved, being built', summary: 'The toolbar popup: filling and searching, the compact Vault row with Unlock, and the notices when the chosen vault is locked or not available.', component: BrowserExtension },
  { slug: 'app-switcher', short: 'Leaving and coming back', title: 'Leaving and coming back', oldFile: '', status: 'Proposal (2026-11-25), not built', summary: 'A plain butter cover while Psss is not the app in front (so the app switcher shows no items), the lock decided before the first frame on return, and the place and item reopened after unlocking; the Control Center cover is an open choice.', component: AppSwitcher },
];
