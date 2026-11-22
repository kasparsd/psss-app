# Vault items and KeePass compatibility

| Item | What users can store | Where it appears |
| --- | --- | --- |
| Login | Website, username, password, verification code setup, notes and supplemental fields | Vault, site-matched password and verification-code pickers |
| Credit card | Cardholder, card number, expiry, optional security code and notes | Vault and explicit card selection at supported checkouts |
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
- [ ] Define the passkey and verification-code field mappings and fixture-test them in KeePassXC.
- [ ] Define and fixture-test field names, protection flags, type metadata and OTP mappings across Strongbox and KeePassXC.
- [ ] Build group navigation, attachment add/extract and expiration. Keep history stored and defer its interface; “Recently deleted” covers undo.
- [ ] Validate assisted checkout fills and show tested browser coverage per field and surface.

## KeePass field mapping (implemented 2026-11-22)

`EntryMapping` in `App/Core/KDBX/KeePassEntries.swift` maps entries to `VaultItem`:

| Item data | KeePass field |
| --- | --- |
| Name, username, password, website, notes | `Title`, `UserName`, `Password` (protected), `URL`, `Notes` |
| Verification code | `otp` (protected `otpauth://` link, KeePassXC). Reads `TimeOtp-Secret-Base32` and `TOTP Seed` too. Rewritten only when the secret changes, so period, digits and issuer set elsewhere survive |
| Passkey | KeePassXC fields `KPEX_PASSKEY_CREDENTIAL_ID`, `KPEX_PASSKEY_PRIVATE_KEY_PEM` (protected PKCS#8), `KPEX_PASSKEY_RELYING_PARTY`, `KPEX_PASSKEY_USERNAME`, `KPEX_PASSKEY_USER_HANDLE`. Credential ID and user handle are base64url |
| Card | cardholder in `UserName`, number in `Password`, expiry in `Expiry`, plus `PSSS_TYPE=card` |
| Secure note, custom item | `PSSS_TYPE=note` or `custom` |
| Usage | `UsageCount`, `LastAccessTime` |

Without `PSSS_TYPE`, an entry with a website, username, code or passkey is a login, notes alone make a secure note, and anything else opens as a custom item. Every other string, attachment and element is left untouched. Not mapped yet: groups (new items go to the root group), tags, expiry, attachments in the interface, custom fields in the interface, and the Recycle Bin.

## Names are optional for logins

A login is identified by its website. The list, search, AutoFill and passkeys all use the host (for example `github.com`), and `VaultItem.displayTitle` falls back to it when the name is empty. The editor asks for the website first and offers an optional name for people who want “Work email”. Cards, notes and custom items have no domain and still require a title. Saves from AutoFill and passkeys leave the name empty. Trade-offs: several accounts on one site show identical titles, so the list shows the username beside the title, and long hosts truncate (the login keeps at least 40% of the row). Subdomains stay as written; grouping by registrable domain is a later refinement.

## Characteristics and moving between vaults

Each item reports its characteristics through `VaultItem.traits`: passkey, verification code, notes (see [experience](experience.md#row-badges-and-filters-2026-11-22)). Add a trait only together with its row glyph and its filter. With several vaults, an item can be moved or copied to another vault, and its passkey and verification code travel with it; see [vaults](vaults.md#multiple-vaults).
