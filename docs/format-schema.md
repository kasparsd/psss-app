# Psss vault format, version 1: item schema

**Status: draft 1, 2026-11-23. Not reviewed, not implemented.** The [byte-level specification](format-spec.md) says how a change to an item is sealed, ordered and merged, and leaves open what the fields of an item are. This document fills that in: the field names, the shape of each value, what merges as one unit, how much history is kept, and how the things the app shows (previous passwords, Added and Edited dates, Recently Deleted, tags) are read from the fields. The design reasons are in [vault format](format.md) and the interface it serves is in [items](items.md).

Everything here sits inside the item change record of the specification, section 5.1: a map from field name to value, where each field wins or loses whole. So the main decision this document makes, over and over, is where to draw the line between fields.

## 1. Rules for every field

- **A field name** is ASCII text of at most 64 bytes, made of lowercase letters, digits, `_`, `/` and `-`.
- **Fixed fields** have a name with no `/`, listed in section 2. There is at most one of each per item.
- **Repeated fields** have a name of the form `kind/id`, where `id` is 8 random bytes in lowercase hexadecimal chosen when the entry is added. Websites, custom fields, attachments and tags are repeated fields. Two devices that each add a website offline therefore write two different fields and both survive; had websites been one list in one field, one of them would be lost.
- **Removing** a fixed or repeated field is clearing it (specification 5.1).
- **Order.** Repeated fields that the person can reorder carry a position `pos`: text of the characters `0` to `9` and `a` to `z`, compared bytewise, never empty and never ending in `0`. Entries are shown in order of `(pos, field name)`. To put an entry between two others a device picks any text that sorts between their positions, which always exists; to add at the end it picks one after the last. Two entries may share a position, and the field name then decides.
- **Text a person typed** is stored as they typed it. A device normalizes names, labels, titles and notes to Unicode NFC when writing. It never normalizes or trims a secret: a password, a concealed custom value, a PIN or a security code is stored exactly as entered or imported.
- **Unknown fields.** A reader keeps a field it does not know, never shows it and never clears it, and carries it along when an item moves. A later version can then add a field without an older app destroying it.
- **A value of the wrong shape** is treated as if the field were cleared, and is kept. It is not a reason to reject the record: the record's signature and form are the specification's concern, and one bad field must not take the rest of a change with it.
- **Sizes.** A text value is at most 65,536 bytes, except `notes` at 262,144. An item has at most 64 websites, 128 custom fields, 64 attachments and 64 tags. A device does not write more; a reader shows what it finds.

## 2. Fixed fields

| Field | Value | For |
| --- | --- | --- |
| `type` | `1` login, `2` card, `3` secure note, `4` custom item | Which template the app uses. An unknown number is shown as a custom item. |
| `title` | text | The name. May be absent on a login, which is then shown by its first website. |
| `username` | text | Logins. |
| `password` | text, a secret | Logins. |
| `password_rules` | text | The site's password rules as the generator recorded them. Never shown as a field. |
| `otp` | `{ 1: secret (bytes), 2: digits, 3: period in seconds, 4: algorithm, 5: issuer, 6: account }` | A verification code. `algorithm` is `1` SHA-1, `2` SHA-256, `3` SHA-512. Keys 5 and 6 are optional text. One unit, so a secret never meets another code's settings. |
| `passkey` | `{ 1: credential id (bytes), 2: private key (bytes, PKCS#8), 3: relying party (text), 4: user name (text), 5: user handle (bytes), 6: created (ms) }` | One passkey. One unit. Several passkeys for a site are several items. |
| `cardholder` | text | Cards. |
| `card` | `{ 1: number (text of digits), 2: expiry year, 3: expiry month }` | The card number with its expiry, as one unit. The year has four digits; year and month are absent together when the card has no expiry. |
| `card_code` | text, a secret | The security code. |
| `card_pin` | text, a secret | The PIN. |
| `notes` | text | Any type. For a secure note this is the note. |
| `created` | milliseconds since 1970 | When the item was made. For an imported item, the date in the source. Written once. |
| `edited` | milliseconds since 1970 | Only for an imported item: the date of the last edit in the source (section 5). |
| `source` | `{ 1: kind (text), 2: id (text), 3: baseline (bytes) }` | Where an imported item came from, so that a second import updates it and does not duplicate it. `kind` is for example `1password-7`, `keepass` or `csv`. `baseline` is the importer's hash of what it last imported. |
| `password_history` | array of `[password (text), replaced (ms)]`, newest first, at most 10 | Earlier passwords that came with an import, with the dates the source gave. Written once by the importer. |
| `history_hidden` | a place in the order: `[wall_ms, counter, author, device, seq]` | Set by Clear Previous Passwords (section 4). |
| `moved` | `{ 1: gid (bytes), 2: when (ms) }` | The item was moved to another group (section 7). |
| `deleted` | milliseconds since 1970 | Specification 5.1. |

A password that changes on a site is one field changing. A card that is reissued with a new number and a new expiry is one field changing. Those are the cases the unit rule exists for.

## 3. Repeated fields

| Field | Value | Notes |
| --- | --- | --- |
| `web/id` | `{ 1: address (text), 2: pos }` | A website of a login. The first in order is the primary one. The address is stored as entered, with `https://` added when the person gave no scheme. Matching for AutoFill is the app's and is not part of the format. |
| `f/id` | `{ 1: label (text), 2: value (text), 3: concealed (true or false), 4: pos }` | A custom field. Label and value are one unit. A concealed value is a secret. |
| `a/id` | `{ 1: file name (text), 2: attachment, 3: pos, 4: added (ms) }` | An attachment. Key 2 is the map of specification 5.2. Renaming writes the field again with the same attachment; replacing the file writes a new attachment with a new key. |
| `t/id` | text | A tag. A tag is its text; two fields with the same text are one tag to the person, and removing the tag clears both. |

## 4. History and previous passwords

History is not a field. It is the earlier writes of a field, which the specification keeps as long as their records exist and which a checkpoint may carry forward (specification 5.3). This schema says what is carried:

| Field | Earlier writes a checkpoint keeps |
| --- | --- |
| `password` | The 10 most recent |
| Every other field | None |

- **Previous Passwords** on the detail page are the earlier writes of `password` that set a value different from the one after it, newest first, each dated by the `wall_ms` of the write that replaced it, followed by the entries of `password_history`. At most 10 are shown.
- **Restoring** a previous password sets `password` to that value. It is a new write, and the password it replaces becomes the newest previous one.
- **Clear Previous Passwords** sets `history_hidden` to the place of the current winning write of `password` and clears `password_history`. Every reader then leaves out earlier writes at or before that place. This hides them everywhere at once. They leave storage when a manager's device next writes a checkpoint, which no longer carries them, and the records it covers are deleted; until then they exist in the records. The app's wording for this action has to say so.
- **A password changed on two devices at once.** The later write wins and the other is the newest previous password. The app's quiet note for this case is shown when the newest previous password's write and the winning write come from different devices and neither device had accepted the other's when it wrote; a reader can tell from the chains.

## 5. Dates

- **Added** is `created`. If the field is absent it is the `wall_ms` of the earliest write of the item.
- **Edited** is the `wall_ms` of the latest write to a content field. If the item carries `edited` and no content field was written later in the order than `edited` was, Edited is the value of `edited`: an imported item shows the source's date until someone changes it here.
- **Content fields** are all fields except `created`, `edited`, `source`, `history_hidden`, `moved`, `deleted` and unknown fixed fields.
- A date that cannot be shown truthfully is not shown. An item imported from a source with no dates has `created` set to the time of the import and no `edited`.

## 6. Deleting

The specification defines `deleted` and the rule that a later edit brings an item back. This schema adds only which writes count as an edit for that rule: a write to a content field, as defined in section 5. Setting `source` again during a second import, for example, does not bring back an item the person deleted.

## 7. Moving an item to another group

An item is in one group. Moving it is two writes, in this order:

1. In the group it goes to: one record that sets every current field of the item under the same `item_id`. Earlier writes are not copied, so previous passwords do not travel, and `created` is kept. Attachments are sealed again as new attachments, since their chunks live with a group.
2. In the group it leaves: one record that sets `moved`.

An item with `moved` set is not shown. It is kept for 30 days like a deleted item and then purged, which is what “previous passwords stay behind” means in practice. Moving it back within that time is the same two writes in the other direction.

The two writes are in different groups and cannot be made together. If a device stops between them, the item is in both groups; the device that wrote the first finishes the second when it next runs, and until then other devices show the item in the group it went to and a mark on the copy that is about to go. The same `item_id` in two groups with neither marked `moved` is otherwise not an error, and the two are separate items.

## 8. Settings of a group and of a person

The item whose `item_id` is 16 zero bytes is not an item. It holds the group's own settings, as fields that merge like any others:

| Field | Value | For |
| --- | --- | --- |
| `name` | text | The group's name, such as “Family”. |
| `gone/id` | `{ 1: kind (text), 2: id (text), 3: when (ms) }` | An imported item that the person deleted for good, so that a later import of the same source does not bring it back. `id` in the field name is the first 8 bytes of the SHA-256 of kind and id, in hexadecimal. |

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
- Whether a moved item's 30 days should be shorter when it leaves “Only Me” for a shared group, since nobody else could have seen it there.
- How the quiet note for a password changed on two devices is dismissed, and whether dismissing it is a field or stays on the device.
- Whether a group needs a colour or an icon beside its name.
- The wording of Clear Previous Passwords, given that storage is cleaned when a manager's device next runs.
