# Psss vault format, version 1: item schema

**Status: draft 3, 2026-11-23. Not reviewed.** Draft 2 answered the 16 findings of the first implementation and draft 3 answers the second pass and its independent validation; the [changes](#12-changes) are at the end. The [byte-level specification](format-spec.md) says how a change to an item is sealed, ordered and merged, and leaves open what the fields of an item are. This document fills that in: the field names, the shape of each value, what merges as one unit, how much history is kept, and how the things the app shows (previous passwords, Added and Edited dates, Recently Deleted, tags) are read from the fields. The design reasons are in [vault format](format.md) and the interface it serves is in [items](items.md).

Everything here sits inside the item change record of the specification, section 5.1: a map from field name to value, where each field wins or loses whole. So the main decision this document makes, over and over, is where to draw the line between fields.

## 1. Rules for every field

- **A field name** is ASCII text of at most 64 bytes, made of lowercase letters, digits, `_`, `/` and `-`.
- **Fixed fields** have a name with no `/`, listed in section 2. There is at most one of each per item.
- **Repeated fields** have a name of the form `kind/id`, where `id` is 8 random bytes in lowercase hexadecimal chosen when the entry is added. Websites, custom fields, attachments and tags are repeated fields. Two devices that each add a website offline therefore write two different fields and both survive; had websites been one list in one field, one of them would be lost.
- **Removing** a fixed or repeated field is clearing it (specification 5.1).
- **Order.** Repeated fields that the person can reorder carry a position `pos`: text of the characters `0` to `9` and `a` to `z`, compared bytewise, never empty and never ending in `0`. Entries are shown in order of `(pos, field name)`. To put an entry between two others a device picks any text that sorts between their positions, which always exists; to add at the end it picks one after the last. Two entries may share a position, and the field name then decides.
- **Text a person typed** is stored as they typed it. A device normalizes titles, labels, notes, the cardholder, file names, tags and the group name to Unicode NFC when writing. A username is not normalized, because a site may compare it byte for byte. It never normalizes or trims a secret: a password, a concealed custom value, a PIN or a security code is stored exactly as entered or imported.
- **Unknown fields.** A reader keeps a field it does not know, never shows it and never clears it, and carries it along when an item moves. A later version can then add a field without an older app destroying it.
- **A value of the wrong shape** is treated as if the field were cleared, and is kept, also when the item moves. A map with keys this document does not define is not the wrong shape: the extra keys are kept and ignored. It is not a reason to reject the record: the record's signature and form are the specification's concern, and one bad field must not take the rest of a change with it.
- **Sizes.** A text value is at most 65,536 bytes, except `notes` at 262,144. An item has at most 64 websites, 128 custom fields, 64 attachments and 64 tags. A device does not write more; a reader shows what it finds.

## 2. Fixed fields

| Field | Value | For |
| --- | --- | --- |
| `type` | `1` login, `2` card, `3` secure note, `4` custom item | Which template the app uses. An unknown number, or no `type`, is shown as a custom item. |
| `title` | text | The name. May be absent on a login, which is then shown by its first website. |
| `username` | text | Logins. |
| `password` | text, a secret | Logins. |
| `password_over` | a place in the order, or `null` | Written in the same record as every change of `password`: the place of the write this device saw as the current password, or `null` when there was none. It is how a reader later tells that a password was changed on two devices at once (section 4). |
| `password_rules` | text | The site's password rules as the generator recorded them. Never shown as a field. |
| `otp` | `{ 1: secret (bytes), 2: digits, 3: period in seconds, 4: algorithm, 5: issuer, 6: account }` | A verification code. `digits` is 4 to 10 and `period` 1 to 86,400. `algorithm` is `1` SHA-1, `2` SHA-256, `3` SHA-512; any other number is the wrong shape. Keys 5 and 6 are optional text. One unit, so a secret never meets another code's settings. |
| `passkey` | `{ 1: credential id (bytes), 2: private key (bytes, PKCS#8), 3: relying party (text), 4: user name (text), 5: user handle (bytes), 6: created (ms) }` | One passkey. One unit. Several passkeys for a site are several items. |
| `cardholder` | text | Cards. |
| `card` | `{ 1: number (text of digits), 2: expiry year, 3: expiry month }` | The card number with its expiry, as one unit. The year has four digits; year and month are absent together when the card has no expiry. |
| `card_code` | text, a secret | The security code. |
| `card_pin` | text, a secret | The PIN. |
| `notes` | text | Any type. For a secure note this is the note. |
| `created` | milliseconds since 1970 | When the item was made. For an imported item, the date in the source. The first record of every item sets it. |
| `edited` | milliseconds since 1970 | For an imported or moved item: the date of its last edit before it arrived (section 5). |
| `source` | `{ 1: kind (text), 2: id (text), 3: baseline (bytes) }` | Where an imported item came from, so that a second import updates it and does not duplicate it. `kind` is for example `1password-7`, `keepass` or `csv`. `baseline` is the importer's hash of what it last imported. |
| `password_history` | array of `[password (text), replaced (ms)]`, newest first, at most 10 | Earlier passwords that came with an import, with the dates the source gave. Written once by the importer. More than 10 entries is the wrong shape. |
| `history_hidden` | `1` | Set by Clear Previous Passwords (section 4). What it hides follows from where its own write stands in the order, not from its value. |
| `moved` | `{ 1: gid (bytes), 2: when (ms) }` | The item was moved to another group (section 7). |
| `moved_from` | `{ 1: gid (bytes), 2: when (ms) }` | The item arrived from another group (section 7). |
| `deleted` | milliseconds since 1970 | Specification 5.1. |

A password that changes on a site is one field changing. A card that is reissued with a new number and a new expiry is one field changing. Those are the cases the unit rule exists for.

## 3. Repeated fields

| Field | Value | Notes |
| --- | --- | --- |
| `web/id` | `{ 1: address (text), 2: pos }` | A website of a login. The first in order is the primary one. The address is stored as entered, with `https://` put in front when it does not contain `://`. Matching for AutoFill is the app's and is not part of the format. |
| `f/id` | `{ 1: label (text), 2: value (text), 3: concealed (true or false), 4: pos }` | A custom field. Label and value are one unit. A concealed value is a secret. |
| `a/id` | `{ 1: file name (text), 2: attachment, 3: pos, 4: added (ms) }` | An attachment. Key 2 is the map of specification 5.2. Renaming writes the field again with the same attachment; replacing the file writes a new attachment with a new key. |
| `t/id` | text | A tag. A tag is its text; two fields with the same text are one tag to the person, and removing the tag clears every such field the device holds. Tags have no position and are shown in the bytewise order of their text as UTF-8. If another device added the same tag at the same moment, its field may survive a removal, and the tag is then still there. |

## 4. History and previous passwords

History is not a field. It is the earlier writes of a field, which the specification keeps as long as their records exist and which a checkpoint may carry forward (specification 5.3). This schema says what is carried:

| Field | Earlier writes a checkpoint keeps |
| --- | --- |
| `password` | The write just before the winning one; for each of the first 10 entries of Previous Passwords the entry's own write and the write after it; and the last write before the winning `history_hidden` |
| Every other field | None |

- **Previous Passwords** on the detail page are built from the earlier writes of `password`, newest first, each dated by the `wall_ms` of the write that replaced it, followed by the entries of `password_history`. A write that cleared the password, or set the value the write after it also set, is not an entry. An entry equal to the current password, or to a newer entry, is left out. At most 10 are shown.
- **Restoring** a previous password sets `password` to that value. It is a new write, and the password it replaces becomes the newest previous one.
- **Clear Previous Passwords** sets `history_hidden` and clears `password_history`. Take the writes of `password` that come before the winning write of `history_hidden` in the order: every reader leaves out all of them except the last, which is the password that was current when the person cleared and which becomes a previous password when it is next replaced. Because the hidden part is measured from the clearing record's own place, a clearing that is later in the order always hides at least what an earlier one hid, whatever its device had seen. This hides the earlier ones everywhere at once. They leave storage when a manager's device next writes a checkpoint, which no longer carries them, and the records it covers are deleted; until then they exist in the records. The app's wording for this action has to say so.
- **A password changed on two devices at once.** The later write wins and the other is the newest previous password. A reader shows the app's quiet note for this when the winning write's `password_over` is not the place of the write just before it in the order: the winner was made by a device that had not seen that write. Nothing else in the format records what a device had seen, so this field is what makes the note possible.
- **What a checkpoint cannot keep exactly.** A checkpoint keeps a bounded number of writes, so the list read after one can differ from the list read from all the records. The entries it shows are always from the front of the full list, never other passwords, and the note is always the same. Found by the reference implementation and confirmed independently, in a handful of cases per several thousand random runs: an entry can be dated later, when a change made earlier on an offline device arrives after the checkpoint among writes that set the same password; the list can be one entry shorter, when a later write repeats an old entry; and an older password can show that the full records would hide, when a clearing arrives after the checkpoint and sorts before a write it dropped.

## 5. Dates

- **Content fields** are `type`, `title`, `username`, `password`, `password_rules`, `otp`, `passkey`, `cardholder`, `card`, `card_code`, `card_pin`, `notes` and the repeated fields `web/`, `f/`, `a/` and `t/`. Nothing else is one, including fields this version does not know.
- **Added** is `created`. If an item has none, it is the `wall_ms` of the earliest write the reader holds, which can drift once a checkpoint has dropped older writes; that is why every item's first record sets `created`.
- **Edited** is the `wall_ms` of the latest write to a content field. If the item carries `edited` and no content field was written strictly later in the order than `edited` was, Edited is the value of `edited`: an imported or moved item shows its earlier date until someone changes it here.
- Edited is shown only when it is later than Added. An item imported from a source with no dates has `created` set to the time of the import and no `edited`, so it shows Added alone.

## 6. Deleting

The specification defines `deleted` and the rule that a later edit brings an item back, and says that an edit is a write to a content field as defined here. Setting `source` again during a second import, for example, does not bring back an item the person deleted.

## 7. Moving an item to another group

An item is in one group. Moving it is two writes, in this order:

1. In the group it goes to, one record under the same `item_id` that:
   - sets every content field the item currently has, every unknown field and every field whose value has the wrong shape;
   - sets `created` to the item's Added and `edited` to its Edited, so the dates survive;
   - sets `source` if the item has one;
   - sets `moved_from` to the group it leaves;
   - sets `password_over` to the place of the winning write of `password` in the copy this group already holds, or to `null` when it holds none, so that arriving is not mistaken for a change on two devices;
   - clears every content field that the copy this group already holds has and the arriving item does not;
   - clears `moved`, in case the item was here before and is coming back;
   - sets `deleted` only if the item is in Recently Deleted now, and clears it otherwise;
   - does not carry `password_history` or `history_hidden`. Earlier writes are not copied either, so previous passwords do not travel.
   Attachments are sealed again as new attachments, since their chunks live with a group.
2. In the group it leaves, one record that sets `moved`, naming the group it went to.

An item with `moved` set is not shown. It is kept for 30 days and then purged, counted on the purging device's own clock from when it accepted the record, as for a deleted item. That is what “previous passwords stay behind” means in practice. Moving it back within that time is the same two writes in the other direction.

The two writes are in different groups and cannot be made together. If a device stops between them, the item is in both groups. A reader recognises this: the copy in one group carries `moved_from` naming the other, and the copy in the other has no `moved` later than it. It shows the item in the group it went to and marks the other copy as about to go; the device that wrote the first record writes the second when it next runs. The same `item_id` in two groups with no `moved_from` pointing from one to the other is not a move, and the two are separate items.

## 8. Settings of a group and of a person

The item whose `item_id` is 16 zero bytes is not an item. It holds the group's own settings, as fields that merge like any others:

| Field | Value | For |
| --- | --- | --- |
| `name` | text | The group's name, such as “Family”. |
| `gone/id` | `{ 1: kind (text), 2: id (text), 3: when (ms) }` | An imported item that the person deleted for good, so that a later import of the same source does not bring it back. `id` in the field name is the first 8 bytes, in hexadecimal, of the SHA-256 of the deterministic CBOR array `[kind, id]`. |

Settings that belong to a person and not to a group, such as which group new logins go to, are fields of the same zero item in the person's own group, “Only Me”. None are defined in this draft. Counts of how often an item was used and when it was last used stay on each device and are not in the vault, as already decided.

## 9. What is not in the schema

- No identity, address, phone or date field types. A custom field is text or concealed text.
- No rich text.
- No folders inside a group. Tags are the only grouping below a group.
- No per-item sharing: who can see an item is the group it is in.
- No second verification code or second passkey on one item. An import that finds more keeps the extra ones as concealed custom fields and reports them.

## 10. KeePass files

Import and export use the mapping in [items](items.md#keepass-field-mapping-implemented-2026-11-22), which this schema was drawn to fit: title, username, password, the first website and notes are the standard KeePass fields, further websites use the `KP2A_URL` convention, `otp` is an `otpauth` link, `passkey` is the `KPEX_PASSKEY` fields, and custom fields are KeePass strings with the protected flag for concealed ones. An export writes the 10 previous passwords as KeePass history entries. A group becomes a KeePass group. `source`, `history_hidden`, `moved`, positions and unknown fields do not travel, and the export screen says what is left behind.

## 11. Open points

- Whether 10 previous passwords is the right number, and whether any other field should keep history.
- Whether an imported item's earlier passwords should travel with a move, since the mocks say previous passwords stay behind.
- Whether a moved item's 30 days should be shorter when it leaves “Only Me” for a shared group, since nobody else could have seen it there.
- How the quiet note for a password changed on two devices is dismissed, and whether dismissing it is a field or stays on the device.
- Whether a group needs a colour or an icon beside its name.
- The wording of Clear Previous Passwords, given that storage is cleaned when a manager's device next runs.

Left open on purpose when iteration on this document stopped (2026-11-23), from the last implementation pass:

- A later write of `history_hidden` with the wrong shape counts as cleared, which shows hidden passwords again in the full records and not after a checkpoint. A reader should probably ignore such a write and keep the earlier one.
- On a move, “sets `edited` to its Edited” means the underlying date, also when Edited is not shown because it equals Added.
- The two-devices note is judged among the writes that are not hidden, so a winning write that is the one a clearing kept shows no note.
- On arrival, `password_over` names the target copy's winning write of `password` even when that write cleared it, and is set even when the arriving item has no password.
- A move clears content fields only, so an unknown field of a later version left in the old copy comes back with the item.
- “No `://`” turns `mailto:a@b.c` into `https://mailto:a@b.c`. Websites of a login are web addresses, so this is accepted for now.
- Removing a tag the item does not have writes nothing.

## 12. Changes

### From draft 2

- **Clear Previous Passwords** is measured from the clearing record's own place in the order, so a device with an older view can no longer bring hidden passwords back (2, 4).
- **Moving back** to a group that still holds the old copy clears what the item no longer has, and sets `password_over` from that copy so that no false note appears (7).
- **What a checkpoint keeps** for `password` is stated exactly, with the one way a date can differ afterwards (4).
- **Usernames are not normalized**; a website gets `https://` when it has no `://`; tags are ordered as UTF-8; a wrong-shaped value travels with a move (1, 3, 7).

### From draft 1

From the findings of the first implementation:

- **`password_over`** records which write a device replaced, which is the only way a reader can tell that a password was changed on two devices at once (2, 4).
- **Moving** is spelled out field by field: dates are carried in `created` and `edited`, `moved` is cleared on arrival so that moving back works, `deleted` is carried only for an item that is deleted now, and `password_history` and `history_hidden` stay behind. `moved_from` marks the arriving copy, so an interrupted move can be told from two separate items (7).
- **Content fields** are listed. Unknown fields are not content, so they neither change Edited nor bring back a deleted item (5, 6).
- **Previous Passwords** leaves out cleared and repeated values and the current password, the checkpoint keeps what the list needs, and Clear Previous Passwords hides writes before the current one, not the current one (4).
- **Dates.** Every item's first record sets `created`, and Edited is shown only when later than Added (5).
- **`gone/` ids** hash a CBOR array, so two different pairs cannot collide (8).
- **Small points.** Ranges for a verification code's digits and period, tags without positions, extra keys inside a value, no `type`, the list of text that is normalized, and the clock a moved item's 30 days are counted on.

