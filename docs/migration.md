# Migration

## Strongbox

Import a selected KDBX into a Psss vault and leave the original file untouched (changed 2026-11-23 with the [vault format](format.md): a `.kdbx` is no longer edited in place once the record-log store exists; today's build still opens one in place). Ask for the existing vault password and key file where applicable. Verify group hierarchy, custom fields, attachments, entry history, tags and OTP data before finishing the import. Unsupported encryption, credentials or document features require a clear recovery path.

## Apple Passwords

First-class source and the largest cohort. Accept the CSV export and, where the OS offers it, the Credential Exchange format, which can carry passkeys and verification codes. Verify availability and field coverage on the floor OS before promising passkey transfer. Same preview, duplicate and loss-report rules as 1Password.

## 1Password

1Password 7 comes first (decided 2026-11-23). The first real person to move is on it, and it is being retired in early 2027. Version 7 exports only 1PIF, CSV and tab-delimited text, from the Mac or Windows app, one vault at a time; its iPhone app has no export. 1PUX exists only in 1Password 8, which needs a membership that standalone-licence owners do not have, so asking them to subscribe to export is the wrong request.

Read the 1PIF export folder, `data.1pif` with its attachments folder, and keep the 1Password 7 CSV as a fallback for logins only. Map logins, cards and secure notes to their templates and every other category (identity, bank account, router, server, licence, passport, membership and unknown types) to a custom item whose fields carry the section title in their label. Keep every website, notes, tags, custom fields, one-time codes, attachments, password history as KDBX history, and the created and edited dates. Folders become groups, favourites a tag, and deleted items are skipped and counted. Each entry records the 1Password identifier it came from, so importing twice adds nothing.

The importer writes KDBX entries directly, below today's flat `VaultItem`, so it does not wait for the field model and nothing is lost in the file. Until the detail page shows custom fields and attachments, though, the person cannot see them in Psss, so a first usable version includes a read-only “Other fields” section and an attachments list. Both are approved ([items](items.md#detail-page-additions-approved-2026-11-23)) and are built before the import screens.

Parse on the device under size, line and path limits. Build a plan, show one line of counts and a short list of exceptions, write nothing until Import, then commit once so a failure leaves the vault unchanged. Skip exact duplicates (the same 1Password identifier, or the same site, username and password) and add similar ones separately, listing them. Say plainly that the export is not encrypted and offer to delete it afterwards, as a bordered button next to Done.

1PIF has no official specification. The mapping comes from the owner's own 1Password 7 export of a fictional vault (note, password item, login, card) and from open-source importers and their sample exports, which cover every category, attachments, folders, favourites, deleted items and password history. Published fixtures are GPL or AGPL and are not copied; the tests use hand-written fictional ones. Still to confirm on a real 1Password 7 export: attachments and password history. The working plan, with the mapping tables, limits, copy and fixtures, is `docs/plans/1password-7-import.md`. 1Password 8's 1PUX comes next and shares the plan type and the mapping; reading an OPVault folder directly is a later option that avoids the unencrypted export at the cost of a good deal of sensitive code. Passkeys are a separate path.

[1Password export formats](https://support.1password.com/export/), [import and 1PIF](https://support.1password.com/import/), [1PUX schema](https://support.1password.com/1pux-format/), [OPVault design](https://support.1password.com/cs/opvault-design/), [Strongbox getting started](https://strongboxsafe.com/getting-started/).

### Screens (approved 2026-11-23)

The owner approved the mock `Design/Mocks/import-1password.html` and its decisions. Build plan, copy for every state and checks: [approved screens](plans/approved-screens.md) package D, built last, after the importer's current round is committed and after Recently Deleted and the detail page additions ship. Mapping detail stays in `docs/plans/1password-7-import.md`.

- **Entry points.** A labeled “Import from 1Password” button on Welcome (replacing the alert that wrongly names `.1pux`), a row in Setup, and File, Import from 1Password… on Mac. No source picker: the content decides. The sample vault refuses imports.
- **Flow.** Instructions with one button, “Choose Export Folder…”, and the sentence that the export is not encrypted, nothing is uploaded and 1Password is not changed. On iPhone and iPad a second sentence says 1Password 7 exports from a Mac or Windows PC, so the folder must be brought over first (it does not claim the iPhone app cannot export; that is unverified). Then one review screen, then Import, progress, and a finished screen. Cancel is on every screen before Import. One write: it finishes or nothing is added, so there is no Cancel while importing. Rejected: a separate step for the list, a mapping screen per item, and a Cancel that rolls back (nothing exists to roll back before the commit).
- **Review.** One summary line, the destination vault, then what needs reading, in this order: changed secrets, things to know, the rest as one-liners, with look-alike logins and long groups folded behind one labeled Show. One filled Import pinned at the bottom with “Nothing is added until you choose Import.” A clean import shows “Nothing here needs reading.” instead of a missing list.
- **Changed secrets come first**, in a box with a warning mark and its own heading, not red and not a blocking dialog, because a changed password is the one thing that can lock someone out later. The box returns on the finished screen with “Keep 1Password until you have [checked them]”, so the warning is still on screen when the person is about to delete the export. Rejected: red text (red is for deletion), a confirmation before Import that lists them (a second modal for something the person cannot fix in Psss), and a second “Import Anyway” button. The shared advice sentence is said once in the box, so the importer's per-line “Check it in 1Password before you rely on it.” is trimmed.
- **Part of the file unreadable.** A leading sentence (“Read 410 of 412 items. 2 could not be read and are listed below. You can import the rest.”) because it changes what Import means.
- **Finished.** “Imported 398 items into Personal. Nothing was uploaded.” and a filled Done beside a bordered, not red, “Delete Export Folder…” (on Mac it only moves the folder to the Trash). The export is never deleted automatically (rejected, and a prominent Delete, and no offer at all, since an unencrypted copy of every password would stay on disk). On Mac the confirmation says “Move to the Trash?” and that emptying the Trash removes it; on iPhone and iPad it does not say “Trash”, because what happens to a folder deleted from a file provider is unverified.
- **Errors** are boxed lines with a warning mark and ordinary text, with one or two labeled buttons: not an export (names 1Password 8 `.1pux` so people know why), no items, attachments missing (only for a lone `data.1pif`: “Choose Folder Again” or “Import Without Attachments”), too large, already imported (Done only), write failed (“Try Again”). Rejected: red text and an alert for each (an alert cannot be read twice).
- **A second import.** New items, changed items updated in place (with the importer's own sentences) and items the person deleted in Psss that were not brought back. The last has a labeled, bordered “Import These Too” inside its box, so the filled Import stays the only primary action; “Don’t Import Them” undoes it. Nothing returns unless pressed. Rejected: never offering it (the plan's flag exists for a reason and deleted items are gone for good after 30 days) and sending people to Recently Deleted (works only while the item is still there). The importer's line for an item still in Recently Deleted keeps its own wording.
- **Departures from Apple's guidance** (orange warning glyph, pinned bottom action on a sheet, no Cancel while importing) are in [experience](experience.md#departures-from-apples-guidance-accepted-with-the-mocks).
- Open: what Welcome does with no vault yet, and trimming the per-line sentence; see the open questions in [approved screens](plans/approved-screens.md#open-questions-the-mocks-did-not-settle).

## Decisions

- Order of work: Apple Passwords CSV and Strongbox open-in-place are built; 1Password 7 (1PIF) is next, then 1Password 8 (1PUX). Migration is an onboarding step, not the product identity.
- Make the preview and data-loss report central to migration.
- Prototype file selection and review with synthetic fixtures. Retain the source files untouched.

## Roadmap

- [x] Apple Passwords CSV import.
- [ ] Credential Exchange import (iOS and macOS 26).
- [~] 1Password 7 import per `docs/plans/1password-7-import.md`: the importer, the direct KDBX writer and fixtures are built and validated (2026-11-23); the screens are approved (2026-11-23) and planned in [approved screens](plans/approved-screens.md), to build last.
- [ ] Build a representative mapping and fixture inventory for both sources.
- [ ] Test counts and field fidelity by exporting the imported vault to KDBX and opening it with an independent client.
- [ ] After 1PIF: 1Password 8 (1PUX), OPVault, Windows export variants, mobile direct transfer and passkeys.
