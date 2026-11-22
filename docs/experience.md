# User flows and interaction design

The [HTML prototype](../prototype/index.html) uses fictional accounts and simulated browser fields. Each scenario is selectable from the prototype header. Changes last for the current page session.

| Flow | Steps | Recovery |
| --- | --- | --- |
| Fill | Focus sign-in → see site and matching accounts → choose → fill. | Unlock in place and return to the same account list. With no match, offer another account or a new login. Unknown or unsafe origins require a deliberate decision. |
| Create on a site | In signup, generate and fill a password → submit → review site, account and vault → save. | Keep the pending draft through a retry or vault unlock. Allow dismissal. Report a failed write and preserve the draft. |
| Update on a site | After submitting a changed password, choose the matching item → confirm update → retain old password in history. | Offer save as new if none of the matches is correct. Leave existing items intact until confirmation and a successful write. |
| Add in the app | New item → choose Login, Credit card, Secure note or KeePass entry → enter the relevant fields → choose vault → save. | Keep field values on validation errors. Allow explicit cancellation. |
| Fill at checkout | Choose a card by name and last four digits → fill cardholder, number and expiry → review the form. | For unmatched or unsafe fields, use explicit single-field insertion where supported. Enter the security code separately. |
| Retrieve a secure note or custom field | Search by title or tag → open the item → reveal protected fields on request. | Keep sensitive values out of list previews. |
| Open Strongbox vault | Choose file → provide password and key file if needed → unlock → check entries → enable AutoFill. | Explain unsupported variants, wrong key or unavailability and keep the source safe. |
| Import 1Password | Choose export → review counts, duplicates and unsupported items → choose vault → import → enable AutoFill. | Cancel before writing. Change duplicate choices or retry after failure. |
| Start empty | Name vault → choose local or iCloud Drive → set vault password → add first item or enable AutoFill. | Offer local storage when iCloud is unavailable. |
| Enable AutoFill | See provider setup → open system settings → enable Psss → test on a demo login. | Show verified browser support and installation steps for any extension needed. |
| Offline or conflicting changes | Read the last available encrypted revision → stage an encrypted revision for sync → surface edits requiring review. | Keep both revisions recoverable while the user resolves conflicts. |

## Screens and goals

Review of 2026-11-22. The native shell is a vault browser: sidebar of categories, list, detail. That is the surface people see least. Most of the product's life happens in the system fill sheet and the save prompt, so those come first, and the vault browser is a search box with a detail pane. Each row states the one job, the bar for “easy” (measured in taps, seconds or words, and checked on TestFlight builds) and the radical change from the current design.

| # | Screen | The one job | Easy means | Radical change |
| --- | --- | --- | --- | --- |
| 1 | Fill sheet (system surface) | Sign in to the thing in front of me | One tap on the best match after Face ID. Zero typing. Under 2 s from field focus to filled | The best match is preselected and the sheet is only ever a confirmation. Cards and codes never mix into the password list. Wrong-site matches never appear |
| 2 | Save and update prompt | Keep a new or changed password without thinking | One tap on Save. Site, username and destination are visible and need no editing. Nothing to choose | No vault, folder or title questions. The title is the site name, and update is the default when the username matches. Undo for 10 s instead of a confirmation |
| 3 | First launch | Be ready to fill in under three minutes | Three screens: Create, Import (skippable), Turn on AutoFill. One primary button each | Replace the vault password with a generated recovery phrase, shown once, with the vault key held behind Face ID. A custom password is one link away. See key custody below |
| 4 | Import | Bring everything I have, losslessly | Drop or pick one file. One line of result: “412 logins, 9 cards, 3 notes. 14 duplicates skipped.” One Import button | Detect the source from the file. No source picker. Problems appear as a short list of exceptions only, never as a mapping screen. Offer to delete the export file afterward |
| 5 | Unlock | Get in | No screen at all in the normal case: Face ID or Touch ID on launch and in the extension | The lock screen is only the app icon and a Retry button. The recovery phrase and password paths hide behind one “Other ways” link |
| 6 | Home: search and list | Find the thing in under two seconds | The search field is focused, one character narrows results, the top result is Return-ready. Recents show before any typing | Kill the category-first start. Types become a filter menu next to search, not a navigation level. Mac and iPad keep the standard sidebar, collapsed by default |
| 7 | Item detail | Copy or fill the one field I came for | One tap or click copies a field with feedback. The verification code is large, live and tap-to-copy. Password is hidden until a deliberate reveal | Fields are the interface. “Protected value” and similar labels go. The primary action is Fill or Copy, with Edit secondary. Card shows number grouped with a copy-last-four option |
| 8 | Add item | Store something new in one gesture | Paste or scan, and the type is inferred. Manual entry is the fallback | One “Add” field: paste a URL, an otpauth link, a card number, or point the camera at a card (iOS). Type picker only on ambiguity |
| 9 | Edit | Fix a field without fear | Autosave, no Save button. Every change is undoable. A field has one control | Remove the modal editor. Edit in place in the detail pane. Generator appears inline on any password field, with one tap to regenerate and use |
| 10 | Generator | Get a strong password and move on | One tap, already a good default, already inserted | There is no generator screen. It is a button on the password field and in the signup fill sheet. Length and character rules live behind “Customize”, remembered per site |
| 11 | Mac quick access | Find and fill without opening the app | A global shortcut opens a compact search over the same list. Return fills or copies. Escape closes | Menu bar item plus shortcut is the Mac's fastest path, faster than the window. Required for the Strongbox and 1Password crowd |
| 12 | Sync and Psss Pro | Use the vault on more than one device | One screen that shows both prices and Family Sharing. Buy, restore and “not now” are equally prominent. Free vault keeps working | Appears only when a second device exists or the person turns sync on. Never a modal at launch. After purchase, sync just starts |
| 13 | Conflict | Never lose an edit | Usually invisible. The only visible case is the same field edited on two devices | A two-line comparison, “Edited on iPhone, 14:02” against “Edited on Mac, 14:05”, one tap to keep either. Never a conflicted copy file |
| 14 | Recently Deleted and restore | Undo a mistake | Delete is always a move. Restore is one tap. Items purge after 30 days, with the date visible | Replaces confirmation dialogs for single items. A bulk delete asks once, with the count |
| 15 | Settings | Change the few things that matter | Fewer than ten rows: Lock timing, AutoFill status, Vaults, Sync, Import and Export, Recovery phrase, Appearance, Help, About, Pro | Every setting needs a defense. Anything with a safe default is not a setting |
| 16 | Empty and error states | Know what to do next | One sentence and one button. A failure says what happened and keeps the person's data | The first-run empty vault shows the same Add and Import actions as the first launch. Offline and read-only states never block fill |

## Key custody: the largest design bet

A vault password is the main source of first-run friction and of support burden. The proposal: generate a vault key as a short recovery phrase, store the derived key in the Keychain behind Face ID or Touch ID, and let the person set their own password instead if they prefer. The KDBX file still opens in KeePassXC or Strongbox with the phrase. This also fits the extension design that keeps Argon2 out of the AutoFill process.

Trade-off to decide in the security spike S6: a Keychain item that syncs through iCloud Keychain makes Apple account security part of the vault's security. A device-only Keychain item avoids that but each new device needs the phrase. The default has to be chosen with the threat model, not with the interface alone. Until S6 completes, a custom vault password remains the safe fallback.

## Cross-cutting rules

- Every screen has one primary action and no more than two secondary actions.
- Important actions are visible, labeled and prominent, never icon-only and never behind a menu or a hidden gesture. The primary action is a filled button with a text label. Secondary actions are bordered or plain buttons with text. Icons may accompany a label and never replace it for an action people need often. Tap-to-copy rows also show a “Copy” label.
- Progressive disclosure applies to detail, not to the main job. Hide what is rarely needed or risky (protected values, type choice after tapping New item, advanced options) behind one clearly named control such as “Show” or “Customize”. Never hide the action a screen exists for.
- Where the platform default is icon-only, as in macOS toolbars and iOS navigation bars, add the title with `labelStyle(.titleAndIcon)` or move the action into the content. This departs from Apple's compact toolbar convention. The tradeoff is less toolbar economy for discoverability, and it is a design choice, not a requirement.
- Nothing asks the person to choose where something is stored.
- A secret is never visible without a deliberate gesture and never appears in a list preview, accessibility value or screenshot of the app switcher.
- Every destructive action is a move with Undo, except bulk deletes.
- The standard platform idiom wins. On iPhone, search-first is a recommendation that departs from Apple's sidebar and tab guidance for apps with deep hierarchies. It fits here because the hierarchy is shallow, but it is a design choice and not a requirement. Mac and iPad keep the split view.

## Review of the iPhone build, 2026-11-22

Captured on an iPhone 17 simulator (iOS 26.5, built with a temporary 26.0 floor). Evidence: [states](checkpoints/2026-11-22-iphone-review/states.png), [rows before and after](checkpoints/2026-11-22-iphone-review/rows-before-after.png), [pills before the row change](checkpoints/2026-11-22-iphone-review/before-pills.png).

### What works

- Typing starts on launch and results narrow with the first character. The floating search sits within thumb reach and content scrolls under it legibly.
- Pills filter in one tap, the selected pill is unmistakable, and Recent is a sensible default. Search from a usage pill switches the highlight to All.
- The labeled “New item” button beside search is always visible, and its menu opens upward so the most common choice, Login, lands nearest the thumb.
- Detail leads with a filled “Copy password”, shows a legible code with a countdown ring, and gives every field a visible “Copy”. The “Copied” confirmation is immediate. “Show” reveals a card number grouped by four.
- Adding from a failed search pre-fills the title and focuses it.

### What was wrong, and is fixed

- Returning from an item refocused search, which collapsed the navigation bar and hid “New item”. Focus now happens only on launch.
- Account emails rendered as blue links. “New item” and the setup gear were icon-only. The countdown rendered as a spinner. The title appeared twice on detail. “Copy card number” wrapped and made the page jump when it changed to “Copied”. The new-item editor did not focus its first field, so typed text went nowhere.
- A failed search showed a dead end. It now offers “Add “text” as a login”.

### What could be better, in priority order

1. **No real data behind the lock.** The app and the extension now unlock with Face ID, Touch ID or the passcode (see [autofill](autofill.md#unlock-prototype)), but the vault is still the unencrypted sample. The first-launch screens do not exist yet.
2. **Density.** Two-line rows gave about eight items per screen. One-line rows with tighter insets give about fifteen, nearly double.
3. **Repeated titles dominate All.** Seven “Acorn Fitness” logins in a row hide the rest of the alphabet. Group entries by site with a count and expand on tap, or sort recently used first within All.
4. **Pills overflow.** Cards, Notes and Custom are off screen at launch and nothing hints they scroll. Consider a trailing fade, or hide empty types.
5. **The Vault root screen is a leftover.** The iPhone Back button leads to a sidebar that duplicates the pills and has no purpose on a phone. Remove it on compact width and put Setup in a visible control on the list.
6. **Copy gives no feedback outside the page.** On iPhone the system shows a paste banner later, but nothing here says the copy will expire. Add “Copied. Clears in 60 s” once.
7. **Editor is a plain form.** No generator on the password field, no paste detection, no Save feedback. Screens 8 to 10 in the table are still open.
8. **Detail hides the rest.** Notes, attachments and history have no place yet. Add them under a clearly named “More” section, not a menu.
9. **Only dark mode was checked.** Verify light mode, largest Dynamic Type (the row switches to two lines), iPad and Mac.

### One-line rows and site icons

Decision: each row is one line, [icon] name … login, with the icon at 30 pt.

- The layout lets the name take what it needs and caps it so the login always keeps at least 40% of the width. A long email truncates in the middle, which keeps the domain visible. At accessibility text sizes the row returns to two lines.
- The name is not hard-capped at a character count. A width-based cap adapts to Dynamic Type and to wider iPad and Mac columns, where a fixed count would waste space or still truncate.
- Today the icon is a monogram tile whose colour derives from the site, so it is stable and works offline. Non-login items use their type symbol on grey. This is the slot for a site icon.
- Site icons are worth having and carry a privacy cost. Fetching a favicon tells a third party, or the site, that the person has an account there, and that contradicts “nothing leaves the device”. Rules:
  - Off by default. Offer once, in plain words, and keep it as one setting.
  - Fetch directly from the site over HTTPS. Never through a third-party icon service.
  - Cache the image in the vault as a KeePass custom icon, so it syncs, works offline and is never fetched twice. KeePassXC and Strongbox read custom icons, so the file stays portable.
  - Fall back to the monogram when there is no icon, and verify contrast of the letter on every tint.
- Risk to test: icons make many near-identical logos, so the login becomes the real identifier. The one-line layout keeps it on screen.

## Decisions

- Keep autofill on the system surface or browser form and use the app for viewing and editing the vault.
- On Mac and regular-width iPad, give categories, results and item details their own columns. On iPhone, open the searchable All items list and put category navigation one native Back action away. Categories are scopes in the same vault workflow, so they share a navigation stack.
- Most people have one vault. Create it silently and show vault choice only when more than one exists. Say “vault” in the UI and show “KeePass (.kdbx)” only when choosing or exporting a file.
- Do not show “KeePass entry” as an item type. Use “Custom item”.
- The HTML prototype is frozen. Validate the remaining flows on native TestFlight builds, where the real AutoFill surface exists.
- Fill on explicit selection and leave form submission to the user.

## Roadmap

- [x] Prototype the three everyday browser actions and onboarding routes.
- [x] Prototype card and secure note creation, custom KeePass fields, and checkout selection.
- [x] Add native category counts, alphabetical browsing, scoped search, and account labels for repeated login titles.
- [ ] Exercise large-vault browsing with migrated users. Validate keyboard navigation, search scope, and category switching with a real-world mix of groups and item names.
- [ ] Prototype failed saves, conflict review and browser setup variants after the feasibility spike.
- [ ] Observe five people on TestFlight (two Apple Passwords, two 1Password, one Strongbox). Aim for four of five to fill, save and locate a login without guidance. Record time, first wrong turn and wording users look for.
- [x] Rename the “KeePass entry” type to “Custom item” in the native app. The frozen HTML prototype keeps the old name.

## Native interface conventions

- Use `NavigationSplitView`, native lists and system search to browse and select vault items. On iPhone use the system’s compact navigation. Confirm the collapsed stack can return from details directly to results. Adapt regular-width iPad and Mac layouts to make effective use of the available space.
- Keep frequently used actions in the toolbar and give them clear labels and SF Symbols. Keep passive status in the title, section header or detail view. Respect the user’s accent color and use semantic styles for secondary text and destructive controls.
- Keep item semantics, wording and safety consistent across platforms. Use the appropriate platform idiom for each action, including keyboard shortcuts and commands on Mac and system sheets on iPhone.
- Preserve keyboard focus and list position unless the person’s action calls for navigation. Keep actions available to VoiceOver and avoid exposing masked content in accessibility values.
- Use the actual system AutoFill or browser surface for filling. The HTML test form and picker are a storyboard. The native build implements screens 6 and 7 from the table above: a search-first home and a copy-first item detail.
- Home: iPhone opens on the list, and Mac and iPad open with the sidebar collapsed. A row of pills sits above the list: Recent, Most used, All, Logins, Cards, Notes, Custom. Recent is selected by default and falls back to All until something has been used. Recent shows the last ten items by use and Most used the ten with the highest counts. Typing always searches the whole vault, even from a usage pill. Selection is shown with a filled pill, and each pill has a label as well as an icon. On iPhone, search is the iOS 26 floating field in the bottom bar, within thumb reach, with a labeled “New item” button beside it, and takes focus on every launch, as on Mac, so typing starts immediately. While search is focused the navigation bar collapses and the pills stay on screen. Only Recent and Most used carry icons, so more pills fit; the rest scroll. On Mac, search is in the toolbar and Return opens the top result, and “New item” is a full-width button at the bottom. Verified on an iPhone 17 simulator running iOS 26.5. The sidebar remains the standard navigation and also lists Recent and Most used.
- Detail: a filled “Copy password” button and a bordered “Copy username” button lead the page, with the matching actions for cards, notes and custom items. Each field is also one row with a visible “Copy” label, and a click or tap copies it with a short “Copied” confirmation and a haptic on iOS. Passwords, card numbers and secure note bodies stay hidden until the labeled Show button is used, and accessibility reads them as hidden. Copies stay on the device, are marked concealed on Mac, and expire after 60 seconds. A login with a seed shows a live six-digit code with a countdown ring, verified against the RFC 6238 test vectors.
- The sample vault contains 300 logins, 10 cards, 20 secure notes and 30 custom items. Some logins carry a code seed and a recent-use date to exercise those paths.

Adapted from `macos-photo-db` at `71732c0`, principally `AGENTS.md` and `docs/user-interface.md`. [Apple sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [Apple toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Apple search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields), [SwiftUI adaptive navigation](https://developer.apple.com/documentation/swiftui/navigationsplitview).

### Row height

List rows on iPhone and iPad are at least 44 pt tall, the HIG minimum touch target, with 8 pt vertical padding. The earlier 38 pt rows were too tight for confident taps. Mac rows stay compact at 32 pt for pointer use.

### Clipboard expiry notice

Detail pages say, under the copy buttons, that copied values leave the clipboard after 60 seconds, so the expiry is visible before the first copy and the layout never jumps.

### iPhone layout review, round 2

- iPhone uses a plain navigation stack: the pills already switch categories, so there is no Vault root screen to go back to. iPad and Mac keep the split view.
- The labeled New button is pinned at the trailing end of the pill row, so it stays visible while search is focused on launch. The bottom bar holds only search. The pills fade out under the button to show that the row scrolls.
- Show and Hide on protected fields are bordered capsule buttons with a 44 pt target, spaced apart from the row's copy area, so a reveal cannot be mistaken for a copy.

### iPhone layout review, round 3

- The pinned New button next to the pills was confusing and is gone. iPhone now reads top to bottom: Setup and a labeled New button in the navigation bar, the large category title, the pills in their own row, then the list. `searchPresentationToolbarBehavior(.avoidHidingContent)` keeps the title and New on screen while search has focus on launch.
- The large Copy password and Copy username buttons are removed from detail pages. The page is a plain list: every field is one row with a visible “Copy” label, and a footer says that copied values expire after 60 seconds. This still meets the visible-actions rule because each row labels its action.
- Passkeys show as a section on the login that holds them, and a passkey glyph before the login tells apart rows that share a title.

### Copy feedback and field actions

- A “Copied” toast appears at the bottom of the detail page (glass capsule, 2 seconds, success haptic on iPhone) instead of swapping text inline, so the value never shifts.
- Rows carry a copy icon at the trailing edge; the whole row is the copy action, and the footer says “Tap a row to copy it.” Only secret fields (password, card number, secure note body) get an eye button beside the copy icon to reveal or hide. Both icon buttons carry spoken labels. This trades the earlier labeled “Copy” text for a quieter list, which is acceptable because the footer names the action once and the icon is the platform convention. Revisit if testing shows people miss it.
- Pills use a tight icon and label spacing (4 pt) instead of the default `Label` spacing.

### iPhone layout review, round 4

- Setup and New sit together at the top right of the navigation bar, above the large title.
- The reveal eye sits inline, right after the hidden value, with a high-priority tap so it never triggers a copy. Copy icons stay visible at the trailing edge of every row, in the secondary color: hiding them would make the tap-to-copy affordance undiscoverable, so they stay but are quiet.
- Login names are optional; see [items](items.md#names-are-optional-for-logins).

### Mac and iPad review against Notes (2026-11-22)

Compared the Mac build with Apple Notes. Changes, all in shared code so iPad follows Mac:

- **New moves to the window toolbar.** The big bottom “New item” button looked foreign. It is now a labeled “+ New” menu in the toolbar (Notes uses an icon-only compose button; we keep the label to follow the visible-actions rule). The File menu now carries New Login (⌘N), New Credit Card (⌥⌘N), New Secure Note (⇧⌘N) and New Custom Item, driven by a focused scene value. Verified in the running Mac app.
- **Sidebar first.** Mac and iPad open with the sidebar visible, since it already filters like Notes folders. The pills appear only on iPhone and whenever the sidebar is hidden (iPad portrait, collapsed Mac sidebar).
- **List column** gets a count subtitle (“6 items”), an inset list style with rounded selection, and a wider default column so domains and logins truncate less.
- **Setup** moves into a “…” overflow menu next to New (“Vault setup…”), as Notes keeps rare actions. iPhone keeps Setup as a visible button beside New.
- **Detail page on Mac** leads with the item name as plain header text above the fields, not in a card (no large title there), says “Click a row” instead of “Tap”, and keeps rows the same height with the inline eye.
- iPad was found without a New button after the pill row changed. That is fixed by the shared toolbar. Checked in portrait and landscape.
- Editor sheets show a caption above every field (Website first, focused), on iPhone, iPad and Mac.
- Mac list rows stack the name above the login (Notes title/preview), so logins no longer truncate in the narrow column. iPhone and iPad keep name and login side by side.
- **Edit placement.** Checked against Apple Passwords: a labeled Edit (⌘E) sits in the detail column's toolbar, left of Search, and only appears once an item is selected. We keep that, and the Mac detail now leads with a centered icon and name like Passwords so Edit reads as belonging to that item. iPhone and iPad keep a labeled Edit at the trailing end of the navigation bar, as in Contacts.
- **Lock screen.** A lock glyph, “Psss is locked” and one labeled, prominent Unlock button; the prompt also appears on its own at launch. The iPhone pill row was duplicated (one in the list, one pinned) and is now only the pinned one.
- **Spacing review (Mac, 2026-11-22).** Measured every element in a Mac screenshot. Fixed: the Password row was about 6 pt taller than Username and Website because the reveal glyph carried a minimum height; the tap target now grows past the glyph (iPhone and iPad too, where the gap was larger) so all field rows share one height. Checked and fine: the detail card is centered under the icon and name, the footer aligns with the field text, row insets are 20 pt left and right, copy icons are centered in each row, and list rows are 48 pt. Left to the system: the toolbar title sits about 6 pt left of the row icons, list separators end slightly inside the selection capsule, the “Sample vault” header starts left of the sidebar icons, and Edit is placed by the toolbar next to Search. Overriding those would fight standard sidebar, list and toolbar metrics.
- **Vault password lock screen (KeePass vaults).** Mocked first, then built. The heading is the vault name with its file name and folder underneath, and the button says “Unlock Personal”. The key file is always a visible plain row (“None. Only needed if you added one.” with Choose…), because a KeePass file does not say whether it needs one. A wrong password names the vault and mentions the key file. The vault is a labeled row at the top (“Unlock Vault:” as a plain label with the pop-up beside it, its folder when it is a file opened in place, and a bordered pop-up button with the vault name): the pop-up menu checks the current vault and offers “Open Another Vault…”, which for a vault Psss created first warns that the vault can’t be reopened from here. All help text is one block under the button, and the screen uses one text size. “Master password” is called “vault password” everywhere.
- **Spacing review (iPhone, iPad, every sheet, 2026-11-22).** Measured the list, detail, editor, New menu, Setup and lock screens on iPhone 17 and iPad Pro 11-inch against the 16 pt content margin. Fixed: list separators started at three slightly different x positions, so they now start where the text starts on every row; the verification-code card put its copy icon (accent-colored, mid-row) away from the trailing column every other row uses, so the countdown moved left of a quiet secondary copy icon; the editor repeated each caption as its placeholder (“Username” over “Username”), so placeholders now appear only where they add information (`example.com`, “Same as the website”, `MM/YY`); the Setup “preview” sentence was a stray card and is now the footer of its section; the Lock setting had no icon and its label started 29 pt left of the icon rows, so it has one. Checked and fine: 16 pt margins for title, pills, rows and cards, 46 pt list rows, equal field-row heights, 8 pt pill gaps, the system New menu and floating search bar. Section gaps, nav-bar buttons and the search bar inset are system metrics.

## Multiple vaults: screens and steps affected

Principle: with one vault the app looks exactly as it does today. Every change below appears only once a second vault exists, except the Vaults row in Settings and the Add vault action. See [vaults](vaults.md#multiple-vaults) for the model and rules.

| # | Screen | Change with two or more vaults | Single-vault behavior |
| --- | --- | --- | --- |
| 1 | Fill sheet | Same list across unlocked vaults. If one site and username exist in two vaults, both show, vault name first on the secondary line, default vault first. A vault that needs its own password shows one line, “Unlock Work”, instead of its items. | Unchanged |
| 2 | Save and update prompt | Names the destination, “Saving to Personal”, with one tap to change. Update is still the default when the username matches in any unlocked vault, and says which vault it updates. | Unchanged |
| 3 | First launch | Still one vault, created silently. “Open or add another vault” is a link on the last screen and in Settings, never a step. | Unchanged |
| 4 | Import | Gains one line, “Import into Personal”, with a change control. Duplicates are checked against the destination vault, and a note appears if another vault already holds the site. | Unchanged |
| 5 | Unlock | One Face ID opens every Keychain-wrapped vault. A vault with its own password or key file shows a locked row in the sidebar with a labeled Unlock button. The lock screen never lists vaults. | Unchanged |
| 6 | Home: search and list | Search covers every unlocked vault. Rows gain a small vault name or color dot on the secondary line only when two or more vaults exist. The vault is also a filter, in the same bar as Passkeys and Codes. | Unchanged |
| 7 | Item detail | A Vault row at the bottom of the card, “Personal”, with Move to… as a visible action. | Hidden |
| 8 | Add item | New items go to the default vault. The editor shows the destination as a labeled row, changeable. | Hidden |
| 9 | Edit | Same Vault row as Add. Moving an item saves it to the new vault and removes it from the old in one step, with Undo. | Hidden |
| 10 | Generator | Unaffected. | Unaffected |
| 11 | Mac quick access | Searches every unlocked vault. Result rows carry the vault name as in screen 6. | Unchanged |
| 12 | Sync and Psss Pro | Per-vault sync state. The offer names the vaults it would sync. A lapsed Pro stops sync for all vaults and locks none. | Unchanged |
| 13 | Conflict | Names the vault and the item. Conflicts are resolved per vault. | Unchanged |
| 14 | Recently Deleted | One list, grouped by vault, each item says where Restore puts it. | Unchanged |
| 15 | Settings | A Vaults row lists vaults with name, color, location, sync state, a default marker and per-vault lock rules. Add vault, Rename, Make default, Remove from this device, Delete contents. | A Vaults row with one entry and Add vault |
| 16 | Empty and error states | “This vault is empty” names the vault. A vault whose file moved shows Relink as the one button. A locked vault is never an error. | Unchanged |

Browser shell on every platform:

- **Sidebar (Mac, iPad).** One section per vault, each with Recent, All items and its kinds, collapsible, and an **All vaults** row at the top that spans them. Filters (Passkeys, Codes, With notes) stay global at the bottom. With one vault, the current single section stays, titled by the vault's name.
- **Pills (iPhone, and iPad with the sidebar hidden).** A vault pill leads the row only when two or more vaults exist. It opens a menu of vaults plus All vaults. Selecting one scopes the other pills.
- **Toolbar.** New always creates in the default vault. The Mac File menu gains nothing; Make default lives in Settings and the sidebar context menu.
- **Detail on Mac and iPad.** The vault name is a secondary line under the item name, not a header.
- **Lock.** Lock Now locks the whole app. Per-vault lock exists only for vaults with their own password or key file.

Steps affected, in build order, are listed in [vaults](vaults.md#steps-in-order). The roadmap carries spike S7 and the M1 item.

## KeePass lock screen (2026-11-22)

Built: "Unlock Vault:" with a bordered pop-up, Vault Password field, "Key file (optional)" with Choose…, a full-width Unlock button and one help block under it. One text size, 16 pt rhythm, same layout on iPhone, iPad and Mac.
Not built: biometric unlock, a "What is this?" explainer for the password and key file, and lost-password help. These are specified in [vaults](vaults.md#lock-screen-gaps-2026-11-22-handoff).
Rules learned while building it: mock first, help text in one place, never shrink text to fit, and no unlabeled or text-looking actions.

## Lock policy: follow Apple Passwords (2026-11-22)

Apple Passwords always asks for Face ID, Touch ID or the device password to open, offers no switch to turn that off, locks when the device or Mac locks or sleeps, and on Mac also after about a minute of inactivity. Psss follows that: authentication is not opt-in and not a setting. The only setting is how long the app may stay in the background (Immediately, 1, 5 or 15 minutes), because people hold different views on that and it never weakens the floor. Mac already locks on sleep, a sleeping display and a locked screen; inactivity locking is on the roadmap.

## Row badges and filters (2026-11-22)

Rows show one quiet glyph after the name for each characteristic: a passkey, a verification code, notes (not on secure notes, which always have them). Glyphs never truncate; the name does. Each badge has a matching filter, so a person who sees a glyph can find all items with it: Passkeys, Codes and With notes, in a Filters sidebar section on Mac and iPad and at the end of the pill row on iPhone. The verification code row now sits inside the credentials card, after the password, because it is used after the username and password, and so that on Mac the item's icon and name lead the page. Reused and weak passwords will join as a fourth characteristic once an audit exists.

### Welcome, TOTP and brand icons (2026-11-22)

- **Welcome screen.** Shown once, before any lock screen. One list of identical bordered buttons, the first filled: Create a vault, Open a vault file, Import from Apple Passwords, Import from 1Password, Try a sample vault. A single footnote warns that exports are not encrypted. No section headers, links or per-button captions: an earlier version mixed four element types and read as inconsistent. Apple Passwords CSV import is real (`CSVImport`, accepts Title, URL, Username, Password, Notes, OTPAuth). Create a vault first says what is made (an encrypted vault, one standard KeePass file, stored on this device, nothing uploaded, Save a Copy in Setup for backups), then asks for a name and a vault password (optional key file, with a warning that Psss cannot recover the password; no system password suggestions), and Open a vault file asks for the password of the chosen `.kdbx`. An Apple Passwords CSV waits until the vault exists. 1Password .1pux is not built and says so in an alert. A KeePass vault locks to a master-password screen (no biometrics until the Keychain-wrapped key exists); Setup shows name, location, format, encryption, items and Change Vault Password.
- **Start over.** Vault setup, Reset, “Start Over…” removes logins you added or imported and shows Welcome again. It is destructive and confirmed.
- **TOTP is the name.** The row reads “One-time code (TOTP)”, the badge “Has a TOTP code”. The editor takes a TOTP secret as Base32 or an `otpauth://` link and validates it. Detail has a “TOTP setup” section with the secret (hidden, reveal, copy), “Copy setup link” (otpauth, SHA1, 6 digits, 30 s) and “Show QR code”. This is the export path; a full vault export follows the Apple Passwords CSV layout with an OTPAuth column.
- **Brand icons.** About 1000 of the most visited brands ship as vector glyphs from Simple Icons (CC0 files) on the brand colour. Domain matching includes parent domains, so mail.google.com finds Google. Everything else keeps the monogram. No network request is made. `scripts/build-brand-icons.py` regenerates the catalog and `App/Core/BrandIcons.swift`, using the Tranco list only on the developer machine to rank brands. Caveats: Simple Icons has removed some large brands at their owners' request (Amazon, Microsoft, LinkedIn, Slack and Adobe are absent), so those use the monogram; brand names and logos remain trademarks of their owners; domain matching by source link can occasionally pick a related brand, so review the generated table before a release. Third-party icon APIs (Clearbit is shut down; Logo.dev and Brandfetch exist) would leak which sites you use and stay out.
- Mac list rows no longer add a custom 16 pt inset on top of the system one.
- **One line per row on Mac too.** The Mac list column is widened (360 pt minimum) so [icon] name … login fits on a line, matching iPhone and iPad. The separator starts at the text, not under the icon. Rows get 8 pt vertical and 12 pt horizontal inset on Mac and 10 pt vertical on iOS for larger targets.
- **Empty vault.** A vault with no items keeps the regular chrome (sidebar or pills, toolbar, search, Setup). The list area holds the ways to fill it: add a login, card or note, import from Apple Passwords, and a note about saving from the browser through AutoFill. The detail column stays blank because there is nothing to choose.
- **Add, not New.** The toolbar menu and the empty-vault button say “Add” (“Add item” where there is room), as Apple Passwords does: Apple uses “New” for creating a document and “Add” for putting something into a collection. File menu commands stay “New Login” and so on, the menu convention. On iPhone the Setup button is the standard gear icon with the spoken label “Setup”: a deliberate, user-approved exception to the labeled-actions rule, because the gear is the platform's universal settings symbol and Setup is not a daily action.
- **Notes are always shown**, including the body of a secure note. Only secrets (password, card number, TOTP secret) are hidden behind the eye.
- **Card network icon.** `CardBrand` reads the first digits of the card number (Visa 4, Mastercard 51–55 and 2221–2720, American Express 34 and 37, Discover 6011, 644–649 and 65, JCB 3528–3589, Diners Club 300–305 and 36, 38, 39) and shows its Simple Icons mark on the row and detail icon. Local only. UnionPay, Maestro and Mir are not yet recognized.
- **Saving persists (prototype store).** Items you add or edit are written to the App Group file the AutoFill extension also reads, and survive relaunch. Sample items are never written. A real KeePass vault replaces this store for the person’s own data; the sample vault and the extension still use it. Deleting items and persisting usage counts are not built yet.
- **Empty-vault crash fixed.** Swapping the whole layout for an empty state removed and re-added the iOS search field, which asserted inside UIKit when the first item was saved. The empty state is now an overlay inside the regular list, so the search field never goes away. With an empty vault the search field no longer takes focus at launch, so the keyboard does not cover the actions.
- **One Setup concept everywhere.** Mac and iPad now use the same gear button as iPhone, in place of the “…” overflow menu. Lock Now is not a toolbar action: it lives in Setup, under Security, and in the Psss menu as ⌘L, because the vault already locks itself on sleep, screen lock and timing. Mac toolbar: Add, gear, search.
- **No search focus on an empty vault**, on any platform: there is nothing to search, and the keyboard would cover the actions.
- **iPad and iPhone review (2026-11-22, iPad Pro 11-inch and iPhone 17 simulators, iOS 26.5).** Both match Mac: gear, labeled Add, filled Edit, one-line rows with brand icons, pills above the list, notes and TOTP shown. The iPad list column is capped by the balanced split at roughly 40% of the window in portrait, so a long name plus login (daybreakstudio.example, alex1@example.net) truncates the login in the middle; the list column's width range is now 380 to 560 pt, which helps only slightly. Open: the Mac detail header (64 pt icon above the name) is not on iPhone or iPad; decide whether to add it everywhere.
- **Detail header on every platform.** The 64 pt icon and the name now lead the detail page on Mac, iPad and iPhone, as in Apple Passwords; on iOS the navigation bar stays quiet instead of repeating the name. Verified on iPhone 17 and iPad Pro 11-inch simulators and built for Mac. This closes the gap noted in the iPad and iPhone review.
- **Delete.** Editing an existing item shows a red “Delete Item…” at the bottom of the form, and a confirmation names the item and says it cannot be recovered. Deleting returns to the list from any depth. Added items are removed from the prototype store; sample items disappear only until the next launch. New items show no Delete. No undo or Recently Deleted yet: roadmap item for the real vault.


## Button and action audit (2026-11-22)

**Destructive styling.** Keep `role: .destructive`. SwiftUI renders it in system red, which is the platform behavior ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [ButtonRole.destructive](https://developer.apple.com/documentation/swiftui/buttonrole/destructive)). Apple's own destructive form rows and dialogs use red text, so we add no custom red or tint.
Rules: destructive is never the prominent style, the row is text-only, a specific title names the action, and every destructive action confirms or can be undone ([Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)).
This was checked against Apple's guidance, not by capturing Apple's apps side by side.

**Conventions after the audit.**

| Context | Style | Icon |
| --- | --- | --- |
| Primary action on a screen (Welcome, empty vault, Unlock, Fill, Save) | Prominent | Label only where it clarifies |
| Secondary choices beside it | Bordered | No |
| Toolbar | Labeled Text (Edit, Add), gear for Setup | Gear only |
| Setup form rows (Lock Now, Start Over…, Lock picker, placeholders) | Plain row | No icon |
| Destructive (Delete Item…, Start Over…) | System red role, text-only | No icon |
| Sheet dismissal | Cancel on the left for edits, Done for read-only sheets | No |
| Menu bar | “New …” commands with shortcuts, Lock Psss ⌘L | No |

Fixed: icons removed from Setup rows so action rows match Delete Item…. Open: toolbar “Add” is menu-based and the AutoFill preview rows are placeholders.
