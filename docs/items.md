# Vault items and KeePass compatibility

With the [record-log vault format](format.md) adopted on 2026-11-23, the item types and field model here stay, and the KeePass mapping becomes the import and export mapping. The native record schema is still to be defined from this model. Until the record-log store is built, the mapping below is also how items are stored.

| Item | What users can store | Where it appears |
| --- | --- | --- |
| Login | Website, username, password, verification code setup, notes and supplemental fields | Vault, site-matched password and verification-code pickers |
| Card | Name on card, card number, expiry, optional security code and notes | Vault and explicit card selection at supported checkouts |
| Secure note | Multiline text and attachments | Vault, with the note body hidden until the user reveals it |
| Custom item | Standard KeePass fields and arbitrary named fields. Use it for software licenses, Wi-Fi credentials, keys, identity records and other structured data. | Vault, with explicitly selected fields available for manual insertion where supported |

Across types, support nested groups, tags, item expiration, custom fields with protection flags, encrypted file attachments and entry history. Show item type and title in results. Search titles and non-sensitive metadata by default. Keep passwords, note bodies, verification seeds, protected fields and full card numbers out of search previews and system credential indexes.

[KeePass entry fields, attachments and history](https://keepass.info/help/v2/entry.html), [KDBX 4.1 format](https://keepass.info/help/kb/kdbx.html).

## Decisions

- Passkeys are part of a login. Store them in a documented, fixture-tested field mapping and verify compatibility with KeePassXC before writing. Verification codes are required for logins, not a later add-on.
- Replace the flat native `VaultItem` (one `secret` string) with a field-based model that carries protection flags, groups, tags and unknown fields before building more editor UI.
- Treat types as editor templates over KeePass entries. Store readable fields using KeePass built-in or named custom strings and store type hints separately where round trips preserve them.
- Infer types only from recognized mappings. Open ambiguous entries with the general KeePass editor and preserve the original fields and metadata.
- Mask saved card numbers by default, showing the last four digits. A checkout fill targets cardholder, number and expiry after explicit selection. Security-code insertion requires a separate intentional action.
- Preserve item and group metadata even where its UI is deferred. Examples include icons, per-entry Auto-Type settings and unknown custom data. Define the supported preservation boundary before permitting writes.
- The HTML demo models attachment names, hidden fields, expiry and tags. Attachment bytes, verification-code generation, nested group navigation and history restoration require native implementations.

## Roadmap

- [x] Prototype creating, viewing and editing all four item types and picking a card in a demo checkout.
- [x] Define the passkey and verification-code field mappings and check them in KeePassXC (`scripts/test-kdbx.sh`). Strongbox is not checked.
- [ ] Define and fixture-test field names, protection flags, type metadata and OTP mappings across Strongbox and KeePassXC.
- [ ] Build group navigation, attachment add/extract and expiration. The read-only detail sections (Other fields, Attachments, Previous passwords, dates) are approved (2026-11-23) and planned in [approved-screens](plans/approved-screens.md); editing and adding fields and attachments is not.
- [ ] Validate assisted checkout fills and show tested browser coverage per field and surface.

## KeePass field mapping (implemented 2026-11-22)

`EntryMapping` in `App/Core/KDBX/KeePassEntries.swift` maps entries to `VaultItem`:

| Item data | KeePass field |
| --- | --- |
| Name, username, password, website, notes | `Title`, `UserName`, `Password` (protected), `URL`, `Notes` |
| Verification code | `otp` (protected `otpauth://` link, KeePassXC). Reads `TimeOtp-Secret-Base32` and `TOTP Seed` too. Digits, period and algorithm are read from the link (and the KeeOtp fields) into `otpSettings` and make the code. Rewritten only when the secret or those parameters change, so the issuer set elsewhere survives |
| Passkey | KeePassXC fields `KPEX_PASSKEY_CREDENTIAL_ID`, `KPEX_PASSKEY_PRIVATE_KEY_PEM` (protected PKCS#8), `KPEX_PASSKEY_RELYING_PARTY`, `KPEX_PASSKEY_USERNAME`, `KPEX_PASSKEY_USER_HANDLE`. Credential ID and user handle are base64url |
| Card | cardholder in `UserName`, number in `Password`, expiry in `Expiry`, plus `PSSS_TYPE=card` |
| Secure note, custom item | `PSSS_TYPE=note` or `custom` |
| Usage | Not in the file. Use counts and last-used dates are device-local (see [vaults](vaults.md#decisions)); the file's `UsageCount` and `LastAccessTime` are left as found |

Without `PSSS_TYPE`, an entry with a website, username, code or passkey is a login, notes alone make a secure note, and anything else opens as a custom item. Every other string, attachment and element is left untouched. Not mapped yet: groups (new items go to the root group), tags, expiry, attachments in the interface, custom fields in the interface, and the Recycle Bin.

## Names are optional for logins

A login is identified by its website. The list, search, AutoFill and passkeys all use the host (for example `github.com`), and `VaultItem.displayTitle` falls back to it when the name is empty. The editor asks for the website first and offers an optional name for people who want “Work email”. Cards, notes and custom items have no domain and still require a title. Saves from AutoFill and passkeys leave the name empty. Trade-offs: several accounts on one site show identical titles, so the list shows the username beside the title, and long hosts truncate (the login keeps at least 40% of the row). Subdomains stay as written; grouping by registrable domain is a later refinement.

## Characteristics and moving between vaults

Each item reports its characteristics through `VaultItem.traits`: passkey, verification code, notes (see [experience](experience.md#row-badges-and-filters-2026-11-22)). Add a trait only together with its row glyph and its filter. With several vaults, an item can be moved or copied to another vault, and its passkey and verification code travel with it; see [vaults](vaults.md#multiple-vaults).

## Field model: evaluation of 2026-11-23

An evaluation of every field, its input, which fields repeat, revisions and dates. It describes the code as found and proposes the field-based model that replaces the flat `VaultItem`. The proposals are recommendations until the owner settles the open decisions at the end; the interface parts wait for the M0 gate and a mock-and-approve step.

### What exists today

`VaultItem` is one flat struct: `title`, `account`, `website`, `secret`, `expiry`, `securityCode` (cards only), `notes`, `otpSecret`, `otpSettings`, `passkey`. Everything else in an entry (custom strings, attachments, tags, icons, groups, expiry, auto-type, history) is preserved in the file and invisible in the interface.

| Kind | Fields in the interface | Input today | Missing |
| --- | --- | --- | --- |
| Login | Name (optional), website, username, password, verification code, notes, passkey (read-only) | URL keyboard on website; password and setup key are secure fields; the code is added by paste, image or camera ([verification codes](verification-codes.md)) or by typing a setup key or `otpauth://` link | Generator and reveal in the editor, more than one website, custom fields, attachments |
| Card | Title, name on card, card number, expiry, security code (optional, a secure field with the number pad on iPhone), notes | Number is a secure field with the default keyboard; expiry is free text. The security code is stored as the protected custom string `Security code` (the name the importer already uses) and read and written only for cards; a login or note with a custom field of that name keeps it untouched | Numeric keyboard, grouping while typing, Luhn check, expiry parsing, PIN |
| Secure note | Title, notes | Multi-line text | Attachments |
| Custom item | Title, “Protected value”, notes | One secure field | Named fields. A custom item is a title and one value, and “Protected value” is jargon |

Defects found while reading the code:

- [x] Verification codes honour the link's digits (6 to 8), period and algorithm (SHA-1, SHA-256, SHA-512). Counter-based (HOTP) links and other values are refused, not guessed.
- [x] The passkey's date was the entry's creation date. It is now stored with the passkey (`PSSS_PASSKEY_CREATED`), falling back to the entry's date for passkeys from other apps (2026-11-23).
- [x] Protected flags on the password, one-time code and passkey key are corrected whenever an entry is written; other strings keep theirs (2026-11-23).
- [x] `sameContent` now covers every field the codec stores (2026-11-23). Custom fields and attachments join it with the field model.
- [x] `HistoryMaxSize` is honoured with `HistoryMaxItems`, oldest first, and a value that is not a number is saved as the default (2026-11-23).
- [x] Saving an item whose entry is in the Recycle Bin restores and updates it; a restore never duplicates a live identifier (2026-11-23).
- [x] Times are written in the KDBX 4 base64 form everywhere, and a file that still holds text times is converted on its next save with every instant unchanged. Checked against KeePassXC in both directions (2026-11-23).
- [x] An entry with no `Times` element gets one when it is next changed, and modification times always move forward (2026-11-23).
- [~] Card grouping (4-6-5 for American Express and the rest) and Maestro, UnionPay, Mir and Elo detection exist as pure functions with expiry parsing and a Luhn check (`CardBrand`, `CardNumber`, 2026-11-23). Not yet used by any screen, and the new networks have no logo.

### Proposed fields and inputs

Each kind keeps a few standard fields. Anything else is added through one labeled “Add Field” control that offers Website, Text, Secret, Verification code and Attachment.

| Kind | Always shown | Added on demand | Left out, and why |
| --- | --- | --- | --- |
| Login | Website, username, password with generator and reveal, notes | More websites, one-time code, custom fields, attachments, tags | A security-question type (two custom fields do it), a separate email field, password expiry reminders |
| Card | Cardholder, card number, expiry, security code | PIN, custom fields, notes | Billing address, phone, valid-from, bank. They belong to an identity item, which is outside the simplicity budget |
| Secure note | Title, note text | Attachments, custom fields, tags | Rich text |
| Custom item | Title and the fields the person adds, each text or secret | Notes, attachments, tags | Typed fields such as date, phone and address |

| Field | Keyboard | Validation and format |
| --- | --- | --- |
| Website | URL, no capitals, no autocorrect | Trim, add `https://` when no scheme, reject spaces, show the host |
| Username | Default, no capitals, no autocorrect | None |
| Password | Default | Reveal, generator button, no strength policing |
| Verification code | Default | A pasted link or secret, keeping digits, period and algorithm, and honouring them |
| Card number | Number pad | Strip spaces, group while typing (4-4-4-4, or 4-6-5 for Amex), 12 to 19 digits. A failed Luhn check warns and does not block, since gift cards fail it |
| Expiry | Number pad | Insert the slash, month 1 to 12, accept `0830`, `08/2030` and `2030-08`, store `MM/YY`, flag when past |
| Security code, PIN | Number pad | Concealed, protected in the file, copied by its own action |
| Custom text or secret | Default | A name that is unique within the item; secrets are protected in the file |

System content types (`.username`, `.creditCardNumber` and the rest) are not added to the app's own editor until a device test shows they raise no keyboard suggestions. The validation run already saw the system strong-password sheet appear over the app's own password field.

Cards keep cardholder in `UserName`, number in `Password` and expiry in `Expiry`, so KeePassXC and Strongbox show a usable copy button. Security code and PIN become protected custom strings.

### One or several

| Field | How many | In the file |
| --- | --- | --- |
| Website | Several, the first is primary | `URL`, then `KP2A_URL`, `KP2A_URL_1`…, the convention KeePassXC's browser integration uses (unverified for Strongbox) |
| Username | One. Several accounts on a site are several items | `UserName` |
| Password | One current, earlier ones in history | `Password`, `History` |
| Verification code | One in the interface | `otp`. Extra codes from an import stay as concealed custom fields and appear in the import report |
| Passkey | One per item, as KeePassXC stores it. Several passkeys on a site are several items | `KPEX_PASSKEY_*` |
| Custom field | Several: name, value, concealed | `String` with the protected flag |
| Attachment | Several, names unique within the item | `Binary` references into the inner header |
| Tag | Several. Preserved now, shown later | `Tags` |
| Notes, group, each card field | One | `Notes`, the parent group, as above |

Several websites change AutoFill: one password identity is registered per distinct host with the same record identifier (whether the system accepts that is unverified, test it), and matching checks every host. Passkey identities use the relying party and are unaffected. Every host shows on the detail page, so a poisoned import is visible. KeePass URL patterns that are not plain URLs are skipped for matching and kept untouched.

The model is a list of ordered fields on the item, each with a role (username, password, website, code, passkey, card number, cardholder, expiry, security code, PIN, notes, custom), a label, a value and a concealed flag, plus attachments, tags, a group and read-only created and edited dates. The XML tree is still edited in place, so unknown strings survive. Strings with reserved prefixes (`KPEX_`, `KP2A_` other than the URLs, `KPH:`, `PSSS_`, `otp`, `TOTP`, `TimeOtp-`, `Expiry`) are hidden and never rewritten, and the tests cover a custom field whose name collides with one.

### Revisions

KDBX keeps earlier versions as whole copies of the entry under `History`, bounded by `HistoryMaxItems` and `HistoryMaxSize`. Today `upsert` pushes the old version before a change and trims by count; nothing reads history, restores from it or shows it.

- **When.** A revision is made when stored content changes, judged over every field. A change within ten minutes of the last one that touches no secret is folded into it. A changed password, code, card number or passkey always makes a revision, including one saved by the AutoFill extension.
- **What.** The whole entry, as the format does. It is what other KeePass apps read and what merge needs. No diffs.
- **Bounds.** The file's `HistoryMaxItems`, plus `HistoryMaxSize`, oldest first.
- **Deleting.** Decided 2026-11-23: nothing is deleted outright, as in Photos. Deleting an item moves it to the standard Recycle Bin group, which is what “Recently Deleted” shows, with no confirmation and a 10-second Undo (mock `Design/Mocks/recently-deleted.html`, plan [approved-screens](plans/approved-screens.md)). Psss purges items older than 30 days when the vault opens and records them in `DeletedObjects`. Other KeePass apps show the bin and do not purge it, and the interface says so once, under the list and in the empty state. Deleting for good (“Delete Now…” for one item, “Delete All…” for all, the count on the button) always confirms once, says the item cannot be recovered and that backup copies of the vault may still hold it. Rejected: a confirmation on Delete (it asks about something that can be undone and teaches people to click through), no confirmation for one item deleted for good (the one irreversible step), typing a word to confirm (too heavy), calling the bulk button “Empty” (a bin word) or “Delete Everything” (loud). An item in Recently Deleted opens read-only, with Show and Copy for secrets and no Edit (“To change this item, restore it first.”): looking is harmless and often why the person came, editing a deleted item makes no sense. A failed Restore reuses the conflict alert. Recently Deleted is the last row of the vault section in the sidebar and the last pill on iPhone. Rejected: a Filters entry (Filters are traits of live items), a row in Setup (hidden, and needed in a panic) and a search scope (not discoverable).

  Built 2026-11-23 (package A of the build plan): the editor's Delete Item moves the item (`moveToRecentlyDeleted`) and the store no longer has a permanent `delete`; only `deletePermanently` and `emptyRecentlyDeleted` remove for good, from Delete Now… and Delete All…. Details the mock left open: a deletion one day ago reads “Deleted yesterday”, from two days “Deleted n days ago”; with one item the confirmations read “Delete 1 item for good?” and “Delete 1 Item Now” and use the singular “It is removed…”; while Recently Deleted is selected, typing filters that list only and deleted items never appear in whole-vault results; Undo is also an entry in the window's undo stack (Edit, Undo Delete Item, ⌘Z), one level, dropped when the vault locks; shake to undo is switched off. The words and the date arithmetic are `App/Core/RecentlyDeletedText.swift` (calendar days, never blocks of 24 hours; the removal date is the deletion plus 30 days, the instant the purge uses). Known gap: `recentlyDeleted()` reports an entry with no readable deletion time as deleted now, so such a row says “Deleted today · removed for good on …” although it is never purged. The text helper already says only “Deleted” for an unknown time; the codec has to expose it first.
- **Showing it.** Approved 2026-11-23 (mock `Design/Mocks/item-detail.html`). No history table. The detail page gets a “Previous passwords” section only when an earlier, different password exists: each row says “Replaced 3 Nov 2026” with labeled Show, Copy and Restore. Consecutive versions with the same password are one row. The section is shown by default whenever an earlier, different password exists, with every value hidden until Show. Rejected: collapsing it behind a disclosure row (that hides Restore, the safety net when an AutoFill update saved a wrong password) and a setting to turn it off (a setting for a safe default).
- **Restore.** Restoring puts that password back through the normal save, so it is itself a revision and the replaced password joins the list. It is one tap with no confirmation, because Restore on the row it creates undoes it; a short message (“Password restored. The one it replaced is in Previous passwords.”, about three seconds) names what happened. Rejected: confirming first, and requiring Show first.
- **Privacy.** Old passwords stay in the file. The section says so and offers a labeled “Clear Previous Passwords”, which always confirms once, names the item and the count, and says it cannot be recovered and that backup copies of the vault may still hold the passwords. Rollback copies and iCloud's older versions may still hold them, and the copy does not promise otherwise. Rejected: no confirmation (irreversible), and a switch that turns history off (a feature, not a screen). Cards, secure notes and custom items never show Previous passwords: the history of the password field is defined only for a login (revisit after the field model).
- **Sync.** Entry-level merge needs every content change to advance `LastModificationTime` (never backward on a slow clock), the two histories combined, and a deletion to win only when it is later than the last edit. Keeping usage out of the file is what makes this workable.

“Password last changed” needs no new storage: it is the oldest history version that still has the current password.

### Created and edited dates

The file has `CreationTime` and `LastModificationTime` for every entry. The code sets both on a new entry and updates the second on each content change, and reads neither for display.

| Source | Created | Edited |
| --- | --- | --- |
| Made in Psss | When it was made | Each content change |
| A KeePass file opened or imported | The entry's own dates | The entry's own dates |
| 1Password 1PUX | `createdAt` | `updatedAt` |
| Apple Passwords and browser CSV | None in the export, so the import time | The import time |

Display (approved 2026-11-23, mock `Design/Mocks/item-detail.html`), the same on iPhone, iPad and Mac: one last section on the detail page with two passive rows, below the fields and never beside an action (rejected: dates under the header, beside the actions people use most). The Edited date moves after Restore and after Clear Previous Passwords, since both write the entry; the page does not claim it is an edit of the content. Body size with a secondary-colour value, read by VoiceOver as one element each, no copy control.

| State | Copy |
| --- | --- |
| Normal | “Added 12 Mar 2025” and “Edited 3 Nov 2026, 14:02” |
| Never edited | “Added 12 Mar 2025” only |
| Imported from CSV | “Added 23 Nov 2026”, the import date, which is true: it was added to this vault then |
| A date is missing | That row is hidden. With both missing the section is hidden. Never “Unknown” |

Dates are absolute and follow the person's locale (day, abbreviated month, year, and the time on the edited row). Relative wording such as “3 days ago” goes stale on screen and reads worse in VoiceOver. The one exception, approved 2026-11-23, is a Recently Deleted row, which says “Deleted 3 days ago” (it answers “was it me?”) beside the absolute “removed for good on 20 Dec”, the date that matters and does not go stale. Rejected for those rows: absolute only, relative only. Rejected for Added and Edited: relative, and the file words “Created” and “Modified”. “Added” stays true for imports.

### Detail page additions, approved 2026-11-23

Mock `Design/Mocks/item-detail.html`, plan [approved-screens](plans/approved-screens.md) package B. Order at the bottom of a login's page: Other fields, Attachments, Previous passwords, then the dates, always last. Each section appears only when it has content, so a login with none of it shows only “Added 23 Nov 2026”. Rejected order: Previous passwords above Other fields (more useful, but only some logins have it, so the stable sections go first).

- **Other fields and Attachments are read-only.** Other fields show each custom field's own name and value, hidden values behind the eye, with the copy icon (the field row convention in [experience](experience.md)). Footer: “Psss shows these fields but cannot edit them yet. They stay in the vault.” Attachments list name and size with a labeled “Save…”. Footer: “Save… puts a copy of the file where you choose. The copy is not encrypted.” Attachments are never opened or decrypted anywhere else. Rejected: hiding them until editing exists (imported data would be invisible), and showing them as editable and failing on save. Not promised, so not built: editing, adding and removing other fields and attachments, and tags.
- **Cards, secure notes and custom items** get Other fields and Attachments, never Previous passwords.
- **Labeled buttons.** The new rows use text buttons (Show, Copy, Restore, Save…), not the quiet copy glyph of today's rows, following the visible-actions rule. Rejected: Copy as an icon, Restore in a menu. Today's rows are unchanged for now; whether to relabel them is open.
- **Row layout.** Mac and wide iPad: label and value left, buttons right on one line. iPhone and narrow iPad: buttons on their own line under the value, each at least 44 pt tall. Save… opens the system file saver on iPhone and iPad and a save panel on Mac.
- **Departures from Apple's guidance**, recorded in [experience](experience.md#approved-mocks-2026-11-23): section headers and footers at body size, several buttons in one row, and a plain red “Clear Previous Passwords” row.

### Built so far (2026-11-23)

In the codec and the store, with no screen yet: created and edited dates on every item; history with the ten-minute folding rule, a reader for previous passwords, restore and clear; the Recycle Bin (move, list, restore, delete permanently, empty, purge after 30 days when the app unlocks, never in the AutoFill extension); every change all-or-nothing, so a failed write leaves nothing behind in memory; attachments nothing refers to dropped on save. An entry's deletion time is the latest evidence there is, including the folder it was deleted with, and without readable evidence nothing is purged automatically. Delete Item moves the item to Recently Deleted with Undo; the permanent delete is Delete Now… (see Deleting above). Reserved `PSSS_` fields now also include `PSSS_PASSKEY_CREATED`, `PSSS_DELETED_FROM`, `PSSS_DELETED_AT`, `PSSS_SOURCE`, `PSSS_IMPORT_HASHES` and, in the vault's Meta data, `PSSS_DELETED_SOURCES`.

Known limits: rapid automated saves push an entry's modification time one second ahead per save, since KDBX 4 stores whole seconds; and each save rewrites the whole file, about 0.18 s at 5,000 entries.

### Order of work

1. Dates on the model, `Times` for entries that lack it, base64 times for KDBX 4, the passkey's own date. Additive, safe now.
2. History: size limit, folding rapid edits, a reader for previous passwords, restore, a complete `sameContent`. Codec work, safe now, and merge depends on it.
3. Recycle Bin, the 30-day purge and the duplicate-identifier fix. Codec and the Recently Deleted screen done (2026-11-23).
4. The field-based `VaultItem` and its mapping, hostless tests first. It touches the store, the importer, the provider and the views, so it goes in when nothing else is in flight.
5. Several websites, with matching and identity registration.
6. Verification code parameters, card validation and expiry forms, more card networks. Independent, safe now.
7. Editor and detail controls. Approved 2026-11-23 and planned in [approved-screens](plans/approved-screens.md), to build: the read-only dates section, Other fields, Attachments and Previous passwords on the detail page. Still needing a mock: Add Field, editing custom fields and attachments, the generator.
8. 1PUX import with dates (M2).
9. Entry-level merge (S4), after steps 1 and 2.

Every new mapping gets a round trip through KeePassXC in `scripts/test-kdbx.sh`.

### Open decisions

| Decision | Recommended |
| --- | --- |
| Card number in `Password` and cardholder in `UserName`, or named custom strings | Keep them, for KeePass interop. Add security code and PIN as protected custom strings. The security code is needed by the approved Cards tab ([experience](experience.md#cards-tab-approved-2026-11-23)) |
| Several websites per login in 1.0 | Yes. Imports and KeePassXC files already have them |
| What “Add Field” offers | Website, Text, Secret, Verification code, Attachment. No Date, Phone, Email or Address |
| Write KDBX 4 times as base64 | Yes, with the KeePassXC round trip checking dates |
| System content types on the editor's own fields | Not until a device test shows no keyboard suggestions |

Closed on 2026-11-23 by the approved mocks: show previous passwords (yes, by default, values hidden), the date labels “Added” and “Edited”, and deleting to the Recycle Bin with a 30-day purge, saying that other KeePass apps keep showing the bin. Still open: the five rows above.
