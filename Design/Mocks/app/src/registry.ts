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
import { IosSafariFill } from './pages/IosSafariFill';
import { AddressItem } from './pages/AddressItem';
import { SafariExtensionReminder } from './pages/SafariExtensionReminder';
import { AutofillLessons } from './pages/AutofillLessons';
import { MacMenuBar } from './pages/MacMenuBar';
import { MacBackground } from './pages/MacBackground';
import { ImportPasswords } from './pages/ImportPasswords';

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
  { slug: 'places', short: 'Places', title: 'Places: All, Codes, Cards, More', oldFile: 'tab-bar-and-codes.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24; More tab option A chosen 2026-11-26', summary: 'The tab bar on iPhone, the More tab as a plain list of places (option A chosen 2026-11-26), the sidebar on Mac and iPad, search, and the Codes list with its Recently used group.', component: Places },
  { slug: 'cards-tab', short: 'Cards', title: 'Cards tab', oldFile: 'cards-tab.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24; More tab option A chosen 2026-11-26', summary: 'One row per card, last four digits and expiry on the right, a Recently used group, expired cards last, and the card\'s own page.', component: CardsTab },
  { slug: 'list-rows', short: 'List rows', title: 'List rows', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'The one row of every list: lines between rows, what a login has at the trailing end, and one way to write a code.', component: ListRows },
  { slug: 'filter-and-sort', short: 'Filter and sort', title: 'Filter and sort', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'Sort and Filter before + Add: Show a kind, With what an item has, Sort by, the Recently used group, and the guards for an empty or forgotten filter.', component: FilterAndSort },
  { slug: 'item-page', short: 'Item page', title: 'Item page, Edit and toolbar', oldFile: 'toolbar-and-edit.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24; More tab option A chosen 2026-11-26', summary: 'The icon and name above one card per group, one field order in view, edit and new, optional names with the heading as the name field, Edit in place, Move to Recently Deleted, the toolbar per column on Mac and iPad, and a clickable prototype.', component: ItemPage },
  { slug: 'copy-icons', short: 'Copying', title: 'Copying a field', oldFile: 'copy-icons.html', status: 'Approved by the owner, 2026-11-23 and 2026-11-24; More tab option A chosen 2026-11-26', summary: 'A tap anywhere on a field copies it, the copy icon as its sign, the Copied pill, the eye beside eight dots, and where a field\'s action sits.', component: CopyIcons },
  { slug: 'inline-help', short: 'Inline help', title: 'Inline help', oldFile: 'inline-help.html', status: 'Approved by the owner, 2026-11-23', summary: 'An info button that opens a short bubble: the clipboard line, the setup key in the editor, Mac and iPad popovers, and the rules for what a bubble may hold.', component: InlineHelp },
  { slug: 'unlock-screen', short: 'Unlock', title: 'Unlock screen', oldFile: '', status: 'Approved by the owner, 2026-11-23', summary: 'One unlock form on every device, as built: the app icon, “Unlock [name]”, the password field, Unlock then Use Touch ID or Use Face ID; beside the sidebar on Mac and regular iPad, full screen on iPhone; the system prompt appears by itself.', component: UnlockScreen },
  { slug: 'logo', short: 'Logo', title: 'Logo: one field, shown and hidden', oldFile: '', status: 'Approved by the owner, 2026-11-24; app icon and lock screen not built', summary: 'The logo as one password field in two states: hidden it is a p and three dots, shown it reads psss. It rests hidden and shows the name on hover; the reverse is kept. Varela Round letters a little heavier than the outline, sizes from page to icon, and the decisions.', component: Logo },
  { slug: 'small-mark', short: 'Small mark', title: 'Small mark: toolbar button and favicon', oldFile: '', status: 'Option A chosen by the owner, 2026-11-25', summary: 'The field closed into a ring with one dot, outline or with the butter inside, for the browser toolbar button and the favicon.', component: SmallMarkPage },
  { slug: 'field-mapping', short: 'Field mapping', title: 'KeePass field mapping', oldFile: 'keepass-field-mapping.html', status: 'Approved by the owner, 2026-11-24; native sheet not rebuilt yet', summary: 'A custom item\'s page and its one button, Edit, and the Show as sheet: stored fields on the left, what each is used as on the right, a missing card number, and Custom item.', component: FieldMapping },
  { slug: 'welcome', short: 'Onboarding', title: 'Onboarding: the first screen', oldFile: '', status: 'Approved by the owner, 2026-11-26; built', summary: 'The first screen of a new install: the app icon, “Psss for your secrets” and the five ways to start.', component: WelcomePage },
  { slug: 'import-passwords', short: 'Import', title: 'Import from Apple Passwords', oldFile: '', status: 'Approved and built, 2026-11-26; device check open', summary: 'The direct move from Apple Passwords and the file way, one review with the destination and exceptions, the finished screen and the problems.', component: ImportPasswords },
  { slug: 'create-vault', short: 'Create a vault', title: 'Create a vault: where it is kept', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'The create sheet with a Keep in choice: iCloud Drive by default, so the vault survives deleting the app, or This device only; and the sheet when iCloud Drive is off.', component: CreateVault },
  { slug: 'wifi-place', short: 'Wi-Fi and Recently Deleted', title: 'Wi-Fi and Recently Deleted', oldFile: '', status: 'Direction chosen by the owner, 2026-11-24; Wi-Fi built', summary: 'Wi-Fi networks as an item kind (list, page, Join This Network, a QR code to share) and where Recently Deleted lives. The bottom bar and the More page are on Places.', component: WifiPlace },
  { slug: 'search-fields', short: 'Search fields', title: 'Search: find in a field', oldFile: '', status: 'Approved by the owner, 2026-11-24', summary: 'Pills under the search field for Name, Website and Username, each with its count and dimmed when nothing matches, so a domain that is also a username can be found as a website.', component: SearchFields },
  { slug: 'code-setup', short: 'Code setup', title: 'Verification code setup', oldFile: '', status: 'Option H approved by the owner, 2026-11-24; built, device check open', summary: 'Every way a verification code gets into a login, five options for the Add verification code sheet scored against each other, and the recommended sheet in each state on iPhone, iPad and Mac.', component: CodeSetup },
  { slug: 'settings', short: 'Settings', title: 'Settings: this vault and this app', oldFile: '', status: 'Chosen by the owner 2026-11-24, confirmed 2026-11-25: each vault has its own page; built, Mac device check open', summary: 'Settings lists the vaults and the app rows and each vault has its own page (iPhone and iPad push it; the Mac Settings window has General and Vaults panes), with the Remove Vault alerts.', component: Settings },
  { slug: 'vault-switcher', short: 'Add and switch vaults', title: 'Vaults: add one, switch between them', oldFile: '', status: 'Built, 2026-11-25', summary: 'Each vault is a section of the sidebar on Mac and iPad (Mail-style, with a right-click menu and Add Vault at the foot); iPhone and the iPad with a hidden sidebar have a labeled vault capsule whose menu follows Safari\u2019s profile menu. Several vaults can be open at once; auto-lock locks them all. New Vault, Open Vault File and Import are choices in that menu, the File menu and Settings \u203a Vaults; Open Vault File adds the file and shows its unlock screen.', component: VaultSwitcher },
  { slug: 'vault-states', short: 'Vault states', title: 'Vault states: one picture everywhere', oldFile: '', status: 'Proposal, 2026-11-24, not built', summary: 'The five states a person sees, one vault menu and one Vault row (with Unlock beside it) drawn once, every surface against every state, locking and unlocking, and several vaults open at once.', component: VaultStates },
  { slug: 'autofill', short: 'AutoFill', title: 'AutoFill: choosing a login', oldFile: '', status: 'Redrawn 2026-11-24 from the vault-states model; lead-approved, being built', summary: 'The system picker on iPhone, iPad and Mac: the app\u2019s row and search, the Vault row with Unlock beside it, and the notices when the chosen vault is locked or not available.', component: Autofill },
  { slug: 'browser-extension', short: 'Browser extension', title: 'Browser extension: the popup', oldFile: '', status: 'Redrawn 2026-11-24 from the vault-states model; lead-approved, being built', summary: 'The toolbar popup: filling and searching, the compact Vault row with Unlock, and the notices when the chosen vault is locked or not available.', component: BrowserExtension },
  { slug: 'app-switcher', short: 'Leaving and coming back', title: 'Leaving and coming back', oldFile: '', status: 'Built (2026-11-25); typed dots approved (2026-11-26)', summary: 'A cover of typed dots and the butter mark on charcoal when Psss leaves (so the app switcher shows no items), the lock decided before the first frame on return, and the place and item reopened after unlocking; no cover on pull-downs (E2).', component: AppSwitcher },
  { slug: 'ios-safari-fill', short: 'Cards in Safari (iOS)', title: 'Cards and addresses in Safari (iPhone and iPad)', oldFile: '', status: 'Approved by the owner, 2026-11-26, popup states included (5b and 10 to 21); target and handler built, no popup yet', summary: 'A Safari extension popup on iPhone and iPad that fills a saved card or address into a checkout form: how to open it, locked vault, no cards, iPad popover.', component: IosSafariFill },
  { slug: 'address-item', short: 'Addresses', title: 'Addresses: a new item kind', oldFile: '', status: 'Proposal (2026-11-25), not built', summary: 'An Address kind beside Login, Card, Note, Custom Item and Wi-Fi Network: where it is added and found, how it is stored in a KeePass entry, its page and editor with country-aware order, the list row, import from 1Password, and edge cases.', component: AddressItem },
  { slug: 'safari-extension-reminder', short: 'Safari extension reminder', title: 'Safari extension reminder (iPhone, iPad)', oldFile: '', status: 'Approved by the owner, 2026-11-26; built, switched off until the iOS extension exists', summary: 'A card on the Cards and Addresses places that says cards and addresses need the Psss extension in Safari, a steps sheet (iOS has no link to the switch), a Settings row, the order after AutoFill, and the Mac card\'s words beside it.', component: SafariExtensionReminder },
  { slug: 'autofill-lessons', short: 'AutoFill lessons', title: 'AutoFill picker: lessons from Apple Passwords', oldFile: '', status: 'Partly approved by the owner, 2026-11-26', summary: 'Our picker beside Apple Passwords\u2019 iOS 26 one: the site named, duplicates told apart, the login\u2019s details and New Login inside the sheet, and what the system\u2019s own list lets us change.', component: AutofillLessons },
  { slug: 'menu-bar', short: 'Menu bar', title: 'Mac menu bar: quick search', oldFile: '', status: 'Approved 2026-11-26 (phase 1: copy and page matching), not built', summary: 'A clickable menu bar and \u2303\u2318P panel with a vault switcher and tabs (Search with logins for the page and item values to copy, Generate, New Login), the browser extension card, the later Paste, and a comparison of other apps.', component: MacMenuBar },
  { slug: 'mac-background', short: 'Mac background', title: 'Mac: running in the background, Dock and login', oldFile: '', status: 'Approved 2026-11-26, not built', summary: 'The menu bar, open at login and Dock settings, the one-time sheet that asks, the later reminder, the approval state, and the rules for closing, locking and quitting, and a Browsers section for page logins.', component: MacBackground },
];
