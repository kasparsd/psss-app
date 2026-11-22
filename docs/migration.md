# Migration

## Strongbox

Open a selected KDBX in place once capability and permissions are verified, or offer a copy in the chosen location. Ask for the existing vault password and key file where applicable. Verify group hierarchy, custom fields, attachments, entry history, tags and OTP data before offering writes. Unsupported encryption, credentials or document features require a clear recovery path.

## Apple Passwords

First-class source and the largest cohort. Accept the CSV export and, where the OS offers it, the Credential Exchange format, which can carry passkeys and verification codes. Verify availability and field coverage on the floor OS before promising passkey transfer. Same preview, duplicate and loss-report rules as 1Password.

## 1Password

1Password 7 comes first (decided 2026-11-23). The first real person to move is on it, and it is being retired in early 2027. Version 7 exports only 1PIF, CSV and tab-delimited text, from the Mac or Windows app, one vault at a time; its iPhone app has no export. 1PUX exists only in 1Password 8, which needs a membership that standalone-licence owners do not have, so asking them to subscribe to export is the wrong request.

Read the 1PIF export folder, `data.1pif` with its attachments folder, and keep the 1Password 7 CSV as a fallback for logins only. Map logins, cards and secure notes to their templates and every other category (identity, bank account, router, server, licence, passport, membership and unknown types) to a custom item whose fields carry the section title in their label. Keep every website, notes, tags, custom fields, one-time codes, attachments, password history as KDBX history, and the created and edited dates. Folders become groups, favourites a tag, and deleted items are skipped and counted. Each entry records the 1Password identifier it came from, so importing twice adds nothing.

The importer writes KDBX entries directly, below today's flat `VaultItem`, so it does not wait for the field model and nothing is lost in the file. Until the detail page shows custom fields and attachments, though, the person cannot see them in Psss, so a first usable version includes a read-only “Other fields” section and an attachments list.

Parse on the device under size, line and path limits. Build a plan, show one line of counts and a short list of exceptions, write nothing until Import, then commit once so a failure leaves the vault unchanged. Skip exact duplicates (the same 1Password identifier, or the same site, username and password) and add similar ones separately, listing them. Say plainly that the export is not encrypted and offer to delete it afterwards.

1PIF has no official specification. The mapping comes from the owner's own 1Password 7 export of a fictional vault (note, password item, login, card) and from open-source importers and their sample exports, which cover every category, attachments, folders, favourites, deleted items and password history. Published fixtures are GPL or AGPL and are not copied; the tests use hand-written fictional ones. Still to confirm on a real 1Password 7 export: attachments and password history. The working plan, with the mapping tables, limits, copy and fixtures, is `docs/plans/1password-7-import.md`. 1Password 8's 1PUX comes next and shares the plan type and the mapping; reading an OPVault folder directly is a later option that avoids the unencrypted export at the cost of a good deal of sensitive code. Passkeys are a separate path.

[1Password export formats](https://support.1password.com/export/), [import and 1PIF](https://support.1password.com/import/), [1PUX schema](https://support.1password.com/1pux-format/), [OPVault design](https://support.1password.com/cs/opvault-design/), [Strongbox getting started](https://strongboxsafe.com/getting-started/).

## Decisions

- Order of work: Apple Passwords CSV and Strongbox open-in-place are built; 1Password 7 (1PIF) is next, then 1Password 8 (1PUX). Migration is an onboarding step, not the product identity.
- Make the preview and data-loss report central to migration.
- Prototype file selection and review with synthetic fixtures. Retain the source files untouched.

## Roadmap

- [x] Apple Passwords CSV import.
- [ ] Credential Exchange import (iOS and macOS 26).
- [ ] 1Password 7 import per `docs/plans/1password-7-import.md`: the importer, the direct KDBX writer and fixtures first, then the screens after an approved mock.
- [ ] Build a representative mapping and fixture inventory for both sources.
- [ ] Test counts and field fidelity after reopening the resulting KDBX with an independent client.
- [ ] After 1PIF: 1Password 8 (1PUX), OPVault, Windows export variants, mobile direct transfer and passkeys.
