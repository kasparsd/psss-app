# Vault items and KeePass compatibility

With the [record-log vault format](format.md) adopted on 2026-11-23, the item types and field model here stay, and the KeePass mapping becomes the import and export mapping. The native record schema is still to be defined from this model. Until the record-log store is built, the mapping below is also how items are stored.

| Item | What users can store | Where it appears |
| --- | --- | --- |
| Login | Website, username, password, verification code setup, notes and supplemental fields | Vault, site-matched password and verification-code pickers |
| Card | Name on card, card number, expiry, optional security code and notes | Vault and explicit card selection at supported checkouts |
| Note | Multiline text and attachments | Vault, with the note body hidden until the user reveals it |
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
- [ ] Build group navigation, attachment add/extract and expiration. Other fields is built. Attachments, Previous passwords and dates are approved (2026-11-23) and planned in [approved-screens](plans/approved-screens.md).
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

With no explicit mapping or `PSSS_TYPE`, an entry with a website, username, code or passkey is a login, notes alone make a note, and anything else opens as a custom item. The view shows retained custom strings by default. A non-card edit preserves a custom string named `Expiry`.

### Showing and mapping KeePass fields

- **Show the fields before asking anyone to map them.** Show template fields first and every remaining user field in an expanded **Other fields** section on shared Mac, iPhone and iPad details. Keep original labels, order, values and protection flags. Show a row for an explicitly stored empty custom field. Exclude app metadata and internal passkey material. Give recognized verification-code fields their existing dedicated UI and hide setup secrets by default. Mask protected fields and fields with recognized sensitive labels such as card number or CVV, with explicit reveal and copy using the existing item conventions. Keep custom values out of search previews and credential indexes.
- **Edit the current values.** Edit includes the same Other fields with their original names. Plain values can span lines and concealed values use secure entry. Saving only changes the selected values in place, keeping their keys and protection flags. The store compares original rows before applying the edit and refuses a stale draft. Cancel discards pending value changes.
- **Make mapping an explicit choice.** Place one button below Other fields and in Edit: **Show as Card or Login…** on a custom item, **Change how fields are used…** once shown as a Card or Login, **Review fields…** when a mapped field changed. No separate Card and Login buttons; the sheet’s Show as menu chooses. For an already-typed item with no additional fields, keep the action in Edit. Pick **Show as** Card or Login, then list the stored fields with their values and use the menu beside each to say what it is used as (a role, or Other field). Protected values and sensitive destinations remain masked until revealed. A role belongs to one field, so choosing it moves it. Only Card number is required. A missing required role disables Save and is named in the line under Show as, at the top, so it is found however many fields there are. Values are never checked when saving a mapping (build note: the sheet must call `validationIssues(requireValues: false)`; today only resolving a saved mapping on open does). A role on an empty field, or on a value in the wrong format, gets a `ProblemText` notice under its row on the item page, and the person corrects it in Edit. A role such as Expiry can format a recognized value for display while keeping the stored text. Keep unassigned fields under **Other fields**. Choose **Custom item** to clear the mapping and return to the original field labels.
- **Suggest assignments in the app.** The editor suggests unique source fields by name, preferring fields that hold a value so KeePass’s empty standard fields do not compete, and still picks a single empty field named for the role, using the item's known layout, standard KeePass keys and a table of common field-name aliases. The user reviews assignments before saving. Strongbox-specific profiles need fixtures.
- **Save the mapping in the same encrypted vault.** Store a Psss-specific entry custom-data record with the selected type and exact source keys. Resolve those roles for the detail, editor and relevant lists. Edits to mapped fields update the chosen source field. Avoid renaming keys or duplicating secrets just to conform to the native-card layout. Validate duplicate assignments, ambiguous or missing source keys and required roles before applying. A rejected or stale write keeps the draft and leaves the vault as found. If an external edit invalidates the mapping, show the original fields and let the user fix the assignment. Login AutoFill uses only valid, explicitly resolved roles and normal site matching.
- **Verify using synthetic KeePass and Strongbox files.** Open without writing. Check that custom fields, including protected fields and a non-card `Expiry`, appear on first open and survive ordinary edits. Map a card, confirm it appears in Cards, reopen, update a mapped value and clear the mapping. Check raw keys, protection flags, UUID, group, attachments and existing history in an independent KeePass client. Check invalid assignments, cancellation and concurrent edits. On Mac, iPhone and regular-width iPad, verify display, masking, VoiceOver and that no extra values enter credential indexes.

**Deferred on-device suggestions.** For unresolved labels, evaluate Apple's on-device `SystemLanguageModel` with a guided result containing only source IDs and allowed roles. The input is field labels and opaque IDs. Exclude values, item titles, notes, vault names and website contents. Treat labels as data and validate model output with the same rules as manual assignments. The user reviews suggestions before saving. Evaluate the model against the alias table using synthetic fixtures and varied languages. Measure correct suggestions and incorrect guesses, with no cloud inference. [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)

#### Canonical fill roles

Use [WHATWG HTML autocomplete field names](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill) as the stable role IDs for supported fillable fields. Keep the vocabulary as an allowlist shared by the mapping, model suggestions, native AutoFill and browser host. UI labels stay human-readable. For example, the KeePass key `Valid Thru` maps to role `cc-exp` and displays as **Expiry**.

| Meaning | Canonical role |
| --- | --- |
| Login username | `username` |
| Saved login password | `current-password` |
| Generated verification code | `one-time-code` |
| Cardholder name | `cc-name` |
| Card number | `cc-number` |
| Card expiry | `cc-exp` |
| Card security code | `cc-csc` |

Derive `cc-exp-month` and `cc-exp-year` at fill time from a valid `cc-exp`. Keep the original expiry text in the vault. `new-password` is a signup or password-change destination for a new value. The stored TOTP setup key is separate from the generated `one-time-code`. Login site matching, passkeys, notes and other vault-only data use their own fields or credential types. A login's site binding and the HTML `url` input have different meanings.

## Names are optional for every kind (owner, 2026-11-24)

No item needs a name. `VaultItem.displayTitle` is the one function every screen uses (lists, search, sort by name, the heading, the Undo capsule, Recently Deleted, the AutoFill extension, accessibility labels): the trimmed name if there is one, otherwise a name made from what the item holds (`derivedTitle`):

| Kind | Name made from the item, in this order |
| --- | --- |
| Login | The website's host (`github.com`), else the username, else “Login” |
| Card | Short brand and last four digits (“Visa •• 4417”); the brand alone or “•• 4417” alone when only one is known; else “Card” |
| Note | The first line of the text, about 40 characters cut at a word with no trailing punctuation; else “Note” |
| Custom item | The website's host, else the username, else “Custom item” |

There is no “Untitled” anywhere. The editor and the new-item sheet have no Name row: the heading under the icon is the name field (see “Item card” and “Editing” in [experience](experience.md)), showing the derived name in grey until one is typed. Save is enabled as soon as the item has any content (and a typed setup key is valid); an entirely empty item cannot be saved. A card without a name of its own has the name on card as its list row's second line instead of the brand (`VaultItem.cardSecondLine`). Saves from AutoFill and passkeys leave the name empty. Trade-offs: several accounts on one site show identical titles, so the list shows the username beside the title, and long hosts truncate (the login keeps at least 40% of the row). Subdomains stay as written; grouping by registrable domain is a later refinement.

## Field order and optional fields (owner, 2026-11-24)

The same groups in the same order in view, edit and new. Login: Website, Username, Password, then the “Verification code” group, then Notes in its own card, then the passkey (read-only). Card: Card number, Valid from, Expiry, Security code, PIN, Name on card, Card issuer, then Notes. Note: the note text. Custom item: Website, Username, Value, then Notes. In edit and new, optional fields say “(optional)”: Website, Username, Notes, Security code, Setup key, Name on card, Expiry, Valid from, PIN, Card issuer. Password, Card number, the note text and Value do not. A new login focuses Website first. New-item sheets are titled “New Login”, “New Card”, “New Note” and “New Custom Item”.

## KeePass import and export in the record-log vault

Built 2026-11-24 in `Packages/vault/src/keepass.ts` (pure functions over the KDBX codec's model) and the vault's `importKdbx` and `exportKdbx`; the command is described in [cli](cli.md#import-and-export). It reads and writes the same fields as the app's `EntryMapping` (`App/Core/KDBX/KeePassEntries.swift`): the `PSSS_TYPE` hint and `PSSS_FIELD_MAPPING` decide the kind, a card keeps Card number, Valid from, Expiry, Security code, PIN, Name on card, Card issuer and Notes in that order (a mapped card keeps Valid from, PIN and Card issuer as Other fields), Expiry is `MM/YY`, a verification code is read from `otp` or from the KeePassXC `TimeOtp-*` strings, a passkey from the `KPEX_PASSKEY_*` strings, and the Recycle Bin holds deleted items. Never fields, exactly the strings `EntryMapping.internalStrings` names in the Swift source: `PSSS_TYPE`, `PSSS_FIELD_MAPPING`, `PSSS_SOURCE`, `PSSS_IMPORT_HASHES`, `PSSS_PASSKEY_CREATED` and the five `KPEX_PASSKEY_*` passkey strings. Any other string, whatever it starts with (`PSSS_NOTE`, `KPEX_PASSKEY_X`), is an ordinary field, as in the app; `PSSS_DELETED_FROM` and `PSSS_DELETED_AT` are custom data of an entry, not strings. The names that mean a role (`FieldRole.aliases`) are one table in `keepass.ts`, and a test compares it with the Swift source text, so the two cannot drift.

**Where the source id and the hashes live.** The app keeps them in the KDBX entry (`PSSS_SOURCE`, `PSSS_IMPORT_HASHES`) because its vault is the KDBX file. The record-log vault has its own place: the item's `source` field (`{ kind: "keepass", id: <the entry's UUID, 32 hexadecimal digits>, baseline }`, [format schema](format-schema.md) section 2) and, for an item deleted for good, a `gone/` entry in the group's settings item (section 8, `kind` `keepass`, `id` the UUID). `baseline` is 16 bytes: SHA-256 of the item's whole content as the file said it, salted with the source id. It is one hash and not one per field, because the engine's per-field merge and its fuzzy pairing of items without a stable id do not apply to a source that has a UUID for every entry: an entry is the same entry or it is a new one.

**What a second run does**, for each entry of the file, in this order:

| The vault has | Result | Counted as |
| --- | --- | --- |
| `gone/` for the UUID | Not brought back | skipped, deleted here |
| An item with that source (or, for a file this vault exported, that item id), in Recently Deleted | Not brought back | skipped, deleted here |
| It, and its content equals the file's | Nothing | unchanged |
| It, the file's content equals the baseline (the file did not change) and the vault differs | Left as it is here | kept, changed here |
| It, the vault equals the baseline and the file differs | Left alone, reported; replaced only with `--update` | changed in the file, or updated |
| It, and both differ from the baseline (or there is none) | The version here is kept, reported | changed in both |
| Nothing | A new item with its attachments, `created` and `edited` from the file | added |

Importing the same file again therefore adds nothing and rewrites nothing. Purging an imported item writes the `gone/` entry first.

**The UUID of an exported entry** is the UUID of the KeePass entry the item came from (its `source`), when the item came from a file and no other exported item would use that UUID; any other item, and an item whose source UUID is taken, is written under its item id. So KeePassXC's `merge` with the original database pairs the entries it should, and importing an export back into the same vault finds its own items whichever of the two it was (an export read back into its own vault says `Nothing new`, counted `unchanged`). The verification code is compared by its secret, digits, period and algorithm and not by its issuer and account label, because an export fills the label in from the title and the username when the item has none; the cost is that a change of only the label in a file is not noticed.

**Entries that share a UUID** in one file (a database copied by hand, a bad merge) are separate items, and none overwrites another: the first keeps the UUID, each later one gets the id `SHA-256("psss/keepass-duplicate-id", UUID, n)` cut to 32 hexadecimal digits, where `n` counts the entries with that UUID in file order (the Recycle Bin's too, whether or not it is read, so `--include-trash` does not shift the ids). The same file therefore gives the same ids on every run and `--update` cannot make two entries take turns on one item. The report has one finding, `an entry has the same id as another entry in the file`, naming up to three of them. If the file's order of such entries changes, the later ones are read as new items, which is the safe side. Items exported from such entries have different UUIDs.

**Whole import, one lock.** A real import takes the lock of the device state before it reads what the vault holds and keeps it until its last record is stored, reading the vault again after taking it, so two imports of one file at once cannot both find an entry new: the second says `Nothing new to add`. It refreshes the lock while it runs, so a long import is never taken for an abandoned one, and another command that needs the vault meanwhile is told `Another psss is importing into this vault right now`. A dry run takes no lock and writes nothing. Records are stored one by one, each in the outbox before it is delivered, and delivered together, a hundred at a time, as one segment file (the format allows a file to hold a run of records), so the cost grows with the size of the file: 20,000 entries take about three minutes, with fsync as the main cost. If an import stops part of the way, what was stored stays, and the message says how many items were added or updated and that the same command, run again, does the rest, since an item that is already here is left alone.

**Differences from the app, on purpose.**
A Wi-Fi network (`PSSS_TYPE` `wifi`, with `Security` and `Hidden network` as strings, as the app writes it since 2026-11-24) becomes a custom item (`type` 4): the network name is its username, the password is its password, and `Security` and `Hidden network` are ordinary fields. The record format has four item kinds (`docs/format-schema.md`, `type` 1 to 4) and neither a Wi-Fi kind nor fields for its security and hidden flag, so the kind cannot be kept, and an export writes the item as a custom item; the app then reads it as a custom item, not as a Wi-Fi network. Closing the gap needs a fifth `type` and two fields in the format, which is the owner's decision (recorded in [roadmap](roadmap.md#platform-gaps)).
**Similar logins.** The app marks a login that merely resembles one already there (`similarLogin`); the command line has no such heuristic. An entry is recognized only by its UUID: a file with UUIDs is exact, and a file that merely holds the same logins as items already in the vault (a CSV turned into a KeePass file, an export from another manager with new UUIDs) imports them again as new items. Compare with `--dry-run` first.
More websites (`KP2A_URL`, `KP2A_URL_1`, ...) become websites of the item, as the format's section 10 says; the app keeps them as Other fields. Folders are not kept (the vault has groups and tags, no folders); the report counts the items that were in one. Earlier passwords are kept for logins only, as in the app; for other kinds the report says they were not imported. An attachment's `protected` flag is not kept. A second verification code or passkey becomes a hidden custom field and is reported (section 9).

**What an import reports** (names of things, never a value; the command prints one warning for each kind of finding and part of an item, so that a too-long title and too-long notes are two lines and each is true of everything it names; an item's name is cut to 60 characters, and a control or direction character in a name is shown as `\u{202e}` and never sent to the terminal): added, with attachments; updated; unchanged; kept (changed here); changed in the file; changed in both; skipped, deleted here; entries in the file's Recycle Bin left out (or brought in as deleted items with `--include-trash`); items that were in folders; fields not imported for characters XML cannot hold (or removed, with `--strip-invalid`, which is offered only for those); fields over a size or number limit, which the flag does not help; entries that share an id with another entry of the file; items over a vault limit (a record holds 1 MiB); protected fields that Psss shows in plain text and kept as hidden fields; a second verification code; a verification code that is a counter or in a form Psss cannot make codes from; an incomplete passkey; earlier versions that changed more than the password; a mapping that no longer holds; a missing creation date.

**What an export reports it leaves out:** the people in shared groups (named only when a group has more than one member); passkeys that cannot be written as KeePassXC passkeys; fields this version of Psss does not know; fields that XML cannot hold (left out, or written without those characters with `--strip-invalid`); a field named like one KeePass uses (`Title`, `Password`, `otp`, `PSSS_*`, ...) is written as `<name> (field)` and reported; an attachment that no location holds. Items from Recently Deleted go to the Recycle Bin.

## Characteristics and moving between vaults

Each item reports its characteristics through `VaultItem.traits`: passkey, verification code, notes (see [experience](experience.md#row-badges-and-filters-2026-11-22)). Add a trait only together with its row glyph and its filter. With several vaults, an item can be moved or copied to another vault, and its passkey and verification code travel with it; see [vaults](vaults.md#multiple-vaults).

## Field model: evaluation of 2026-11-23

An evaluation of every field, its input, which fields repeat, revisions and dates. It describes the code as found and proposes the field-based model that replaces the flat `VaultItem`. The proposals are recommendations until the owner settles the open decisions at the end; the interface parts wait for the M0 gate and a mock-and-approve step.

### What exists today

`VaultItem` is one flat struct: `title`, `account`, `website`, `secret`, `expiry`, `securityCode` (cards only), `notes`, `otpSecret`, `otpSettings`, `passkey`. Everything else in an entry (custom strings, attachments, tags, icons, groups, expiry, auto-type, history) is preserved in the file and invisible in the interface.

| Kind | Fields in the interface | Input today | Missing |
| --- | --- | --- | --- |
| Login | Website (optional), username (optional), password, verification code, notes (optional), passkey (read-only); the name is the heading | URL keyboard on website; password and setup key are secure fields; the code is added by paste, image or camera ([verification codes](verification-codes.md)) or by typing a setup key or `otpauth://` link | Generator and reveal in the editor, more than one website, custom fields, attachments |
| Card | Card number, expiry (optional), security code (optional, a secure field with the number pad on iPhone), name on card (optional), notes (optional); the name is the heading | Number is a secure field with the default keyboard; expiry is typed as MM/YY (digits only, the slash is added; pasted `02/2029`, `2/29`, `0229` and `02 29` become `02/29`), shown and copied as MM/YY, and a stored value that cannot be read is shown as stored. The security code is stored as the protected custom string `Security code` (the name the importer already uses) and read and written only for cards; a login or note with a custom field of that name keeps it untouched | Numeric keyboard, grouping while typing, Luhn check, expiry parsing, PIN |
| Note | The note text; the name is the heading | Multi-line text | Attachments |
| Wi-Fi network | Network name, Password, Security (WPA2 or WPA3, WEP, None), Hidden network; Join This Network and Show QR Code | Text fields and a Security menu in the editor | Notes beyond the standard string, several passwords |
| Custom item | Website (optional), username (optional), “Value”, notes (optional); the name is the heading | One secure field, labelled “Value” on the page and in the editor | Named fields |

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
| Note | Title, note text | Attachments, custom fields, tags | Rich text |
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

  Built 2026-11-23 (package A of the build plan): the editor's “Move to Recently Deleted” (once “Delete Item”, renamed 2026-11-24; default button colour, not red, with “You can bring it back for 30 days.” under it) moves the item (`moveToRecentlyDeleted`) and the store no longer has a permanent `delete`; only `deletePermanently` and `emptyRecentlyDeleted` remove for good, from Delete Now… and Delete All…. Details the mock left open: a deletion one day ago reads “Deleted yesterday”, from two days “Deleted n days ago”; with one item the confirmations read “Delete 1 item for good?” and “Delete 1 Item Now” and use the singular “It is removed…”; while Recently Deleted is selected, typing filters that list only and deleted items never appear in whole-vault results; Undo is also an entry in the window's undo stack (Edit, Undo Move to Recently Deleted, ⌘Z), one level, dropped when the vault locks; shake to undo is switched off. The words and the date arithmetic are `App/Core/RecentlyDeletedText.swift` (calendar days, never blocks of 24 hours; the removal date is the deletion plus 30 days, the instant the purge uses). Known gap: `recentlyDeleted()` reports an entry with no readable deletion time as deleted now, so such a row says “Deleted today · removed for good on …” although it is never purged. The text helper already says only “Deleted” for an unknown time; the codec has to expose it first.
- **Showing it.** Approved 2026-11-23 (mock `Design/Mocks/item-detail.html`). No history table. The detail page gets a “Previous passwords” section only when an earlier, different password exists: each row says “Replaced 3 Nov 2026” with labeled Show, Copy and Restore. Consecutive versions with the same password are one row. The section is shown by default whenever an earlier, different password exists, with every value hidden until Show. Rejected: collapsing it behind a disclosure row (that hides Restore, the safety net when an AutoFill update saved a wrong password) and a setting to turn it off (a setting for a safe default).
- **Restore.** Restoring puts that password back through the normal save, so it is itself a revision and the replaced password joins the list. It is one tap with no confirmation, because Restore on the row it creates undoes it; a short message (“Password restored. The one it replaced is in Previous passwords.”, about three seconds) names what happened. Rejected: confirming first, and requiring Show first.
- **Privacy.** Old passwords stay in the file. The section says so and offers a labeled “Clear Previous Passwords”, which always confirms once, names the item and the count, and says it cannot be recovered and that backup copies of the vault may still hold the passwords. Rollback copies and iCloud's older versions may still hold them, and the copy does not promise otherwise. Rejected: no confirmation (irreversible), and a switch that turns history off (a feature, not a screen). Cards, notes and custom items never show Previous passwords: the history of the password field is defined only for a login (revisit after the field model).
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

- **Other fields use the stored names and the field row convention.** Show hidden values behind the eye and offer the copy icon. The 2026-11-24 update adds editing of existing custom values and role mapping through [Show as Card or Login…](#showing-and-mapping-keepass-fields). Attachments are still planned as a read-only list with a labeled “Save…” action. Its footer says “Save… puts a copy of the file where you choose. The copy is not encrypted.”
- **Cards, notes and custom items** get Other fields and Attachments, never Previous passwords.
- **Labeled buttons.** The new rows use text buttons (Show, Copy, Restore, Save…), not the quiet copy glyph of today's rows, following the visible-actions rule. Rejected: Copy as an icon, Restore in a menu. Today's rows are unchanged for now; whether to relabel them is open.
- **Row layout.** Mac and wide iPad: label and value left, buttons right on one line. iPhone and narrow iPad: buttons on their own line under the value, each at least 44 pt tall. Save… opens the system file saver on iPhone and iPad and a save panel on Mac.
- **Departures from Apple's guidance**, recorded in [experience](experience.md#approved-mocks-2026-11-23): section headers and footers at body size, several buttons in one row, and a plain red “Clear Previous Passwords” row.

### Built so far (2026-11-23)

In the codec and the store, with no screen yet: created and edited dates on every item; history with the ten-minute folding rule, a reader for previous passwords, restore and clear; the Recycle Bin (move, list, restore, delete permanently, empty, purge after 30 days when the app unlocks, never in the AutoFill extension); every change all-or-nothing, so a failed write leaves nothing behind in memory; attachments nothing refers to dropped on save. An entry's deletion time is the latest evidence there is, including the folder it was deleted with, and without readable evidence nothing is purged automatically. Move to Recently Deleted moves the item with Undo; the permanent delete is Delete Now… (see Deleting above). Reserved `PSSS_` fields now also include `PSSS_PASSKEY_CREATED`, `PSSS_DELETED_FROM`, `PSSS_DELETED_AT`, `PSSS_SOURCE`, `PSSS_IMPORT_HASHES` and, in the vault's Meta data, `PSSS_DELETED_SOURCES`.

Known limits: rapid automated saves push an entry's modification time one second ahead per save, since KDBX 4 stores whole seconds; and each save rewrites the whole file, about 0.18 s at 5,000 entries.

### Order of work

1. Dates on the model, `Times` for entries that lack it, base64 times for KDBX 4, the passkey's own date. Additive, safe now.
2. History: size limit, folding rapid edits, a reader for previous passwords, restore, a complete `sameContent`. Codec work, safe now, and merge depends on it.
3. Recycle Bin, the 30-day purge and the duplicate-identifier fix. Codec and the Recently Deleted screen done (2026-11-23).
4. The field-based `VaultItem` and its mapping, hostless tests first. It touches the store, the importer, the provider and the views, so it goes in when nothing else is in flight.
5. Several websites, with matching and identity registration.
6. Verification code parameters, card validation and expiry forms, more card networks. Independent, safe now.
7. Editor and detail controls. Other fields is built with value editing and mapping. Dates, Attachments and Previous passwords on the detail page are approved (2026-11-23) and planned in [approved-screens](plans/approved-screens.md). Still needing a mock: adding and removing fields, changing field names and protection, editing attachments and the generator.
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

## Recognized fields: review of 2026-11-24

What Psss recognizes today, set against what other apps use, and what to add. “From memory” means not re-read this session; check against the apps before building a role from it. The unset-field treatment in the last part is **proposed, mocked on [Item page](../Design/Mocks/app/src/pages/ItemPage.tsx) section 4 and waiting for the owner**.

### What each convention stores

| Convention | Fields it defines |
| --- | --- |
| KeePass file format (KeePass, KeePassXC, Strongbox) | Title, UserName, Password, URL, Notes; entry tags, icon, expiry time, attachments, Auto-Type, history; any number of custom strings, each protected or not. No card or identity types |
| TOTP (KeePass 2.55, KeePassXC, KeeOtp, TrayTOTP) | `otp` (an otpauth link), `TimeOtp-Secret-Base32` with Length, Period and Algorithm, `TOTP Seed` and `TOTP Settings`. Already read and written |
| KeePassXC passkeys, browser extension | `KPEX_PASSKEY_*` strings (already kept apart), `KP2A_URL_n` extra addresses (preserved as Other fields) |
| Strongbox (from memory) | The KeePass fields plus TOTP, tags, expiry and attachments; no card template. A card is a custom item with custom fields |
| KeePassDX templates (from memory) | Credit card: card holder, number, expiration (a date), CVV (protected), PIN (protected). Also ID card, Wi-Fi, email account, bank account |
| 1Password credit card (the importer reads it) | Cardholder, type (a code such as `mc`, `visa`, `amex`), number, verification number, expiry, valid from, PIN, issuing bank, bank phone numbers, credit and cash limits, interest rate |
| Browser autofill (`autocomplete`) | `username`, `current-password`, `one-time-code`, `cc-name`, `cc-number`, `cc-exp` (or `cc-exp-month` and `cc-exp-year`), `cc-csc`, `cc-type` |

### What Psss has, and the gaps

| Kind | Recognized now | Add | Not a field |
| --- | --- | --- | --- |
| Login | Website, Username, Password, Verification code (setup key) | Entry expiry (KeePass “Expires”): later, needs a date row and a reminder decision | Extra addresses stay Other fields; tags need a tag model |
| Card | Card number, Expiry, Security code, Name on card | **Valid from** (card issue date; 1Password, UK and Amex cards), **PIN** (protected; KeePassDX, 1Password), **Card issuer** (bank). **Card type**, shown only when the file stores one | The network is read from the number (`CardBrand`), so Card type is never asked for and never an empty row |
| Custom item, Note | None beyond the standard strings | None: they are the places for fields Psss does not know | |

**Card type.** 1Password writes its own codes (`mc` for Mastercard, `visa`, `amex`, `discover`, `diners`, `jcb`, from memory). A stored value is shown as the network's name (“Mastercard”, not “mc”), matched case-insensitively against these codes and the names `CardBrand` knows, and written back exactly as it was read. The detected network wins for the icon and the name when the two disagree.

**Names that count as a role** (`FieldRole.aliases`, matched with case, spaces, dashes and punctuation removed). The review widened these so the editor suggests more of them: Username adds user, user id, login, e-mail address; Password adds pass, passwd, pwd, passphrase; Website adds URI, link, web address, home page; Card number adds number, card no, credit card; Name on card adds owner, holder, card owner; Expiry adds exp, exp date, expires, valid until, good thru; Security code adds CVN, CID, verification number, verification value. A split expiry (`cc-exp-month` with `cc-exp-year`) needs the importer to join two fields and is not done.

### Recognized fields that are not filled in (owner, 2026-11-24, variant A; built)

On the item page, a recognized field the item has no value for is a quiet row: its label in the usual place, “Not set” in the tertiary style and a labelled **Add** at the end (`UnsetFieldRow`). It has no copy icon; pressing the row or Add turns the page to Edit with that field focused (`ItemFields.focusField`). Rows keep their place, so filling one in moves nothing (`VaultItem.firstCardRows`). Nothing is written to the file until a value is typed. They are drawn for a login (Website, Username, Password) and for a card that is not shown from a KeePass mapping (all seven card fields). Not part of it: Notes, the verification code (it already says “None” with Set Up Code…), Card type, custom items and notes, a mapped card (its strings stay under Other fields, so no row offers a field the entry stores under another name), and Recently Deleted. The one-row variant (B) was drawn and dropped. The same code serves iPhone, iPad and Mac.

Valid from, PIN and Card issuer are `VaultItem.validFrom`, `pin` and `issuer`, stored as the custom strings `Valid from`, `PIN` (protected) and `Card issuer`, the names the 1Password importer already gives them, so an imported card's values appear in these rows. Valid from is typed and shown as MM/YY like Expiry. They have no field-mapping role yet and AutoFill never offers the PIN. Card type is not built: the network shows from the number, and a stored `Type` stays under Other fields.
