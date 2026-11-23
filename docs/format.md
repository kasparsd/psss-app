# Vault format: a record log in place of a single file

**Status: adopted by the owner on 2026-11-23. Not built.** This format becomes the source of truth for a vault, and KDBX becomes import and export. It reverses the decision of the same morning that KDBX is canonical. Today's build still stores KDBX, and [vaults](vaults.md) describes that build. Four narrower decisions in the [table below](#decisions-for-the-owner) are still open.

## Why it changed

The person Psss is for lives in Apple's ecosystem and expects what Apple Passwords gives: every device up to date without thinking, and a family that shares some logins. A KDBX vault is one mutable file, and most of the hard problems in [vaults](vaults.md) come from that single fact.

- **Sync.** Two devices that write one file produce conflicting versions. The whole of [sync and merge design](vaults.md#sync-and-merge-design-2026-11-23-superseded) exists to reconcile them, and it depends on iCloud Drive behaviour that Apple's forums report as unreliable.
- **Sharing.** A KDBX file has one key. The [family design](vaults.md#family-sharing-and-remote-storage-design-2026-11-23) adds a sidecar of wrapped keys, but anyone with the key can write, there is no read-only role, and removing a person means re-encrypting the file.
- **Cost of a write.** Every change rewrites and re-uploads the whole file, attachments included.
- **Changing the vault password** re-encrypts everything, and rollback copies must be re-keyed too.

The earlier decision said to reopen only for an existing, proven alternative that clearly beats KDBX. None exists (see [options](#options-considered)). What was adopted is a new format built only from standard, proven primitives. That is a weaker claim than “proven”, and the review it needs is listed under [costs](#costs-and-risks).

## Requirements

1. **Sync without conflicts.** Edits made on two offline devices merge on their own, field by field. Nobody is asked which file to keep.
2. **Sharing with real membership.** Each person has their own key. Adding or removing someone never means sharing or changing a password.
3. **Untrusted storage.** iCloud, a file server or a self-hosted machine holds ciphertext only and cannot forge or silently change a record.
4. **One format, any transport.** The same vault works in CloudKit, in a plain folder (iCloud Drive, Syncthing, Nextcloud, a USB stick) and behind a minimal server.
5. **Cheap for the AutoFill extension.** Small reads, no password hashing, low memory.
6. **Recovery.** The Apple Account by default, and optionally a vault password, a printed recovery kit and approval from another device.
7. **Implementable anywhere.** Standard primitives only, a specification of a few pages, published test vectors and a reference command-line tool for macOS, Windows and Linux.
8. **A way out.** A KDBX copy can always be exported, and KDBX files can always be imported.
9. **Open.** The format and the sync protocol are published and free to implement.

## Options considered

| Option | Verdict |
| --- | --- |
| KDBX with entry-level merge (the current plan) | Works for one person. Sharing means one shared key, no read-only role, no cheap removal, whole-file writes, and a merge that depends on iCloud Drive file versions. |
| KDBX with KeeShare (KeePassXC) | Exports a group to a second file with its own shared password. The same limits, twice. |
| CloudKit records and `CKShare` as the format | The best Apple experience and the least work. The vault would exist only inside Apple's database: no Windows, no Linux, no self-hosting, no open format. |
| Bitwarden's protocol (self-hosted with Vaultwarden) | Open and proven, with per-item keys and organizations. It requires a server and an account, and has no iCloud path. |
| A file per entry, as in `pass` with age | Closest in spirit. Files are mutable, so conflicts remain; file names leak; nothing is signed, so storage can swap entries. |
| MLS (RFC 9420) for group keys, or a general CRDT library | Far more machinery than a household of under ten people needs. Wrapping one key per member is enough. |
| **A log of immutable records (adopted)** | Meets every requirement above. The cost is owning a protocol. |

## The idea

**A vault is a growing set of small, immutable, encrypted, signed records.** A record is written once and never changed. Two devices never write the same record, so no storage service can produce a conflict. Syncing is taking the union of two sets of records, in any order, over any transport. The current state of the vault is computed from the records, the same way on every device.

Everything else follows from that.

## Vaults and groups

Asked for by the owner on 2026-11-23, reversing “sharing is per vault, not per item”: a person should not need a second vault to share with a partner or children. They put items into a shared group, as in Apple Passwords.

- **A group is the unit that has a key and members.** Everything this document says about a vault's key, epochs, membership chain and locations is true of a group. The word “vault” in the sections below means that keyed unit.
- **A person's vault is every group they belong to, shown as one list.** It always holds one group that only they belong to, which the app calls “Only Me”. Family, Kids or Work are further groups, each shared with whoever is in it. Search, AutoFill and Recently Deleted span all of them.
- **An item is in exactly one group.** Sharing an item is moving it into a group. “Share with Jordan” on one item is a shortcut: it moves the item into the group whose members are exactly the chosen people, and makes that group if there is none. There are no copies that drift.
- **Moving an item carries its current fields, not its past.** Previous passwords stay behind in the group it left. Moving an item out of a shared group does not take back what its members already saw, and the app says so.
- **Groups are flat.** Folders or tags inside a group are for tidying and never change who can see an item. Nested groups with inherited access are not built: “who can see this?” must have one short answer.
- **Not chosen: a key and member list per item.** It multiplies wrapped keys and removals by the number of items and makes an item's audience impossible to see at a glance. A group of one item gives the same result when it is really wanted.
- **Children.** A child's own logins live in a group shared with their parents, which is also how a parent recovers them.
- **Storage.** Each group is its own set of records: a CloudKit zone with a `CKShare` when it has other members, or a subfolder in a folder location. A shared group has to be kept somewhere every member can reach.

## Records

Every change is one record. Its plaintext holds:

- the vault id and the key epoch (see [membership](#membership-and-revocation)),
- the author's device id and that device's sequence number,
- the hash of that device's previous record, which chains each device's records together,
- a hybrid logical clock (wall time plus a counter, so order survives a wrong clock),
- the kind of change and its content: fields set or cleared on one item, an item moved to Recently Deleted or restored, a membership change, a checkpoint,
- an Ed25519 signature by the author's device over all of the above.

The record is serialized in deterministic CBOR (RFC 8949, section 4.2), padded to a size bucket and sealed with one AEAD under a key derived for that record. Its id is the SHA-256 of the sealed bytes. The signature is inside the encryption, so storage does not learn who wrote what.

**Merging.** The state of an item is the fold of its records in clock order.

- Changes to different fields of one item both apply.
- Changes to the same field: the later clock wins, with the device id as tie-break, and the losing value stays in the item's history. Nobody is prompted.
- Fields that must not be half-merged travel in one record and win or lose together: the one-time code's settings, a passkey's five fields, a card number with its expiry. This is the unit rule already written in [vaults](vaults.md#the-merge).
- An edit against a delete: the item is kept and shown, as the approved principle says nothing is deleted outright.

**What the log gives for free.** Previous passwords, Recently Deleted, restore and undo are all reads of the log. The conflict screen is no longer needed.

**Checkpoints and permanent delete.** A checkpoint record carries the folded state up to a stated position in each device's chain. Records it covers can then be removed from storage. This keeps the log small and is how a confirmed permanent delete actually removes a secret. A device that was offline simply adds its newer records on top.

**Attachments** are split into chunks, each sealed and named by its hash, stored beside the records and fetched when opened. A record refers to them by hash and key.

## Keys

Three layers, and one operation throughout: wrap a 32-byte key to a recipient.

```
unlock secret   iCloud Keychain · device key · vault password (Argon2id) · recovery kit
  └─ person key      one per person, wrapped once per unlock secret
       └─ vault key      one per vault and epoch, wrapped once per member
            └─ record key    derived per record with HKDF
```

- **Unlocking** with a device key (held in the Secure Enclave on Apple devices, a TPM or OS keystore elsewhere) needs no password hashing. That is what the AutoFill extension uses.
- **Changing the vault password** rewrites one wrapped key. Nothing is re-encrypted.
- **iCloud Keychain holds the person key by default on Apple devices** (asked for by the owner, 2026-11-23). It is one more wrapped copy, so the format does not depend on it. A new device on the same Apple Account has the key as soon as the keychain arrives, with no approval step and nothing to type. Protection is then exactly that of Apple Passwords: the Apple Account, the device passcode and Apple's own recovery. Without iCloud Keychain, and on Windows and Linux, a device is let in by approving it on one that is already in, or with the vault password or recovery kit.
- **A vault password and a recovery kit are optional,** under Advanced. They matter to someone who wants a way in that does not go through their Apple Account: a non-Apple device, a backup kept elsewhere, or losing the account itself. A kit alone does not survive losing the Apple Account, because the iCloud copy of the vault goes with the account: it has to be paired with a copy somewhere else, on a device, in a folder or server location, or in a backup file. The app says so once, plainly, and does not nag.
- **Recovery** adds more wrapped copies of the person key: a printed kit, which belongs to the person and not to a group. Splitting a key between several holders (Shamir shares, “two of three”) was dropped by the owner on 2026-11-23: each person's key comes back through their own Apple Account, and another manager can let a member back into a group. The remaining risk is a group with one manager who loses their account, and the answer is a second manager.

**Primitives, fixed per format version with no negotiation:** HPKE (RFC 9180) for wrapping to a public key, Argon2id for the password, HKDF-SHA256, ChaCha20-Poly1305, Ed25519, SHA-256. All but Argon2id are in CryptoKit, libsodium and the common libraries on every platform. A new algorithm means a new format version, not an option flag.

## Membership and revocation

A vault begins with a genesis record signed by its creator. The vault id is the hash of that record. Membership changes are records too, each signed by an owner, forming a chain back to genesis that every client verifies.

- **Roles:** owner, member (reads and writes) and reader. Storage cannot enforce who writes, so clients do: a record signed by someone the chain does not allow to write is ignored by everyone. This gives the read-only role that KDBX could not, which suits a child's access to the Family vault.
- **Adding a person** wraps the current vault key to their public key. They can read the vault's history. The invitation is made in person with a code and a short fingerprint, as already designed; the code carries a one-time secret, so the storage provider cannot put its own key in the middle.
- **Removing a person** starts a new epoch: a new vault key, wrapped to those who remain, with the earlier epoch keys sealed under it. New records use the new key.
- **The unit of sharing is a group,** see [vaults and groups](#vaults-and-groups).

## Transports

The specification defines records. A transport needs only three operations: list what is new, get, and put if absent. It never needs to understand a record.

- **CloudKit, the default on Apple devices.** One zone per vault in the person's private database and one `CKRecord` per record. Change tokens fetch only what is new, and push notifications make it prompt. A Family vault is that zone shared with `CKShare`. CloudKit's permissions are a convenience; the cryptography is the security boundary.
- **A folder.** Each device appends to its own segment files and seals them at a size limit, so no file ever has two writers. This works in iCloud Drive, Syncthing, Nextcloud, Dropbox or on a USB stick, with no code specific to any of them.
- **A server.** Three endpoints over any blob store. Psss defines it and never hosts it. WebDAV and S3-compatible storage can also serve as the folder transport directly.
- **Bridging.** A client connected to two transports for one vault joins them, because merging is union. A Mac can keep a CloudKit vault and a folder on a home server in step, and a Windows or Linux client reads the folder.

**The local cache.** Each device keeps the folded state in a local index outside the format, protected by the device key. The app and the AutoFill extension read the index. The extension never reads the log and never syncs.

## What a person sees: locations, backup and self-hosting

**Approved by the owner on 2026-11-23 with the three mock pages in `Design/Mocks/`, and not built.** The words “record”, “log”, “CloudKit” and “transport” never appear in the app; a person sees a vault, its groups and the places it is kept.

**A vault has one or more locations.** Each location holds the same vault, and Psss keeps them in step.

| Location | What it is | Where the person can see it |
| --- | --- | --- |
| This device | Always present. What the app and AutoFill read. | Nowhere outside Psss |
| iCloud | The default when the device is signed in. Psss's own private space in the person's iCloud (a CloudKit zone). | Not in the Files app. In Settings, under the Apple Account's iCloud storage, listed as Psss |
| A folder | Any folder the person picks: iCloud Drive, an external disk, a network share, a folder another tool syncs. The vault is a folder named after it, such as `Personal.psss`, full of unreadable files. | In Files and Finder, where it can be moved or copied whole |
| A server | A WebDAV address, an S3-compatible bucket or the small Psss endpoint, with an address and a credential. | Wherever the person runs it |

- **Onboarding.** Create a vault asks for a name, shows where it will be kept (“On this iPhone and in your iCloud”, with a switch for iCloud) and turns on Face ID or Touch ID. Nothing asks for a password, a recovery kit, a location, a format or a file. With iCloud off, the vault is on this device only and the app offers a recovery kit, because nothing else could bring it back.
- **A second device.** On the same Apple Account with iCloud Keychain, the vault is simply there after Face ID or Touch ID. Otherwise the device is approved from one that already has the vault, or opened with the vault password or recovery kit.
- **Is a single file possible?** Not as a place the vault lives: one file that several devices rewrite is the problem this format removes. A single file is a backup or an export.
- **Backup.** “Save a Backup Copy” writes everything, with its history, as one encrypted file. On a device that has the person's key it opens by itself; for anywhere else the person sets a password for that file when saving it, or uses the vault password or recovery kit if they made one. “Export as KeePass File” writes a `.kdbx` for other apps. Restoring a backup into the vault it came from merges and never overwrites, because merging is union; it can also be opened as a separate new vault.
- **A second location is a live copy, not a backup.** It follows every change, deletions included. The backup copy is the point-in-time one.
- **Several of everything.** One vault with any number of groups, each shared with different people. One vault in several locations and on any number of devices. Separate vaults remain possible and are no longer needed for sharing.
- **Self-hosting, in three steps of effort.** No server at all: a folder on a home server or a disk, synced by whatever the person already uses. Standard storage: WebDAV or an S3-compatible bucket. The Psss endpoint: three operations that anyone can run from the published specification and reference server. Psss never hosts any of them, and all three hold only unreadable data.

To verify before building: whether a `.psss` folder can show as a single item in Files and Finder (a package) and still sync as a folder in iCloud Drive. Also: an app cannot ask the system whether iCloud Keychain is on, so how Psss tells “the key has not arrived yet” from “it never will” needs a spike.

### Approved with the mocks (2026-11-23)

The mock pages hold the frames, the rejected alternatives and the reasons. The decisions:

- **Creating a vault.** iCloud is on by default when the device is signed in, and that one switch is the only storage choice. Create Vault always succeeds on the device, also offline or without iCloud, and then states the risk and the fix. A recovery kit is offered at creation only when nothing else could bring the key back (iCloud or iCloud Keychain off); otherwise it is a quiet row under Advanced with no reminder.
- **A second device.** With the key synced it just opens. Otherwise there is a waiting state, then “Let In from Another Device” (a code typed on the device that already has the vault, valid for 10 minutes) or the recovery kit. Fallback screens show no device names, and the vault's name only once the key has arrived.
- **Words.** “Vault”, “group”, “Kept in”, “location”, “backup copy”, “KeePass file”, “recovery kit”. “iCloud Keychain” appears only where it is explained. “Up to date” and “Behind” have one meaning each, and Behind says what Psss cannot know.
- **Locations.** They belong to a device, not to the vault. Add a Location is in the vault's details under Setup, never on the main path. A second location is described as a live copy where it is added. A single file is never a location. A server has one Address field and can be added only after Test Connection passes. Removing a location never deletes what is in it.
- **Backup.** Manual, not scheduled. Restore offers “Add to” the vault or “Open as a Separate Vault”, never “replace”. The recovery kit screen says the kit brings back the key and not the data, and offers a backup copy too. A KeePass export asks for its own file password and says what does not travel.
- **Simultaneous edits.** No alert. A quiet note appears only on an item whose password was changed on two devices, and History lists every change.
- **Groups.** Role names are “Manages members”, “Can change items” and “Can view only”; managing includes changing. A person is invited once, in person or on a trusted call, with a code and confirmation words on which neither button is primary; after that they are picked for other groups with no code. Moving items into a shared group states the three truths on the sheet. New logins from Safari go to Only Me. A view-only member is not offered backup or export, and view-only protects against accidents, not against the member.
- **Removing a person** comes first, and the list of passwords they could see second, scoped to the group, marked off as each is changed.

Still open, listed as questions on the mock pages: whether a vault needs a name at all; whether an app can tell that iCloud Keychain is off; what opens the vault when Face ID fails; whether a child's Apple Account can accept a shared group; whether one manager can remove another; what happens to a removed person's own items in a group; where the passwords-to-change list is kept; whether `.psss` can show as one item; whether an iCloud Drive folder is reliable as a location; server type detection; the backup file's name; what a KeePass export carries of history; how the iCloud copy is deleted; and removing a lost device.

## Costs and risks

- **Psss would own a protocol.** The primitives are standard; the composition is new, above all the membership chain. It needs an independent review before family data depends on it, and it replaces part of the planned KDBX codec audit rather than adding to it.
- **KeePassXC and Strongbox can no longer open the live vault.** They open an exported copy. This changes the promise in the [product contract](product.md) from “a KeePass-compatible file you own” to “an open format you own, with KDBX in and out”. People who want to keep editing one `.kdbx` in place in two apps lose that.
- **Removal cannot unsend.** A removed person keeps what they already saw. The app lists those passwords to change, as already planned.
- **Storage can withhold recent records.** The per-device hash chains expose gaps and forks. They cannot expose a tail that was never delivered. No design without a trusted server can.
- **More metadata is visible than with one blob:** roughly how many records, when they were written and how many devices write. Padding and opaque names limit it.
- **A member with a far-future clock wins every same-field merge.** Members are trusted to write, losing values stay in history, and clients can refuse clocks too far ahead.
- **Work set aside:** coordinated whole-file writes, rollback copies, the conflict alert and the planned entry-level merge. The KDBX codec, the importers and everything above the store stay.

## What it changes in the plan

- **Kept:** S0 (fill from the real vault), S2 (extension budget, now measured against the local index), S3, S5, S6 (key wrapping, which becomes the key layers above), S7, all interface work, the importers.
- **Replaced:** S4 (sync inside KDBX) and the M1 “iCloud sync” item become a sync spike and a store on this format: two transports, three devices, the same 200 scripted rounds with no lost edit and no prompt.
- **Brought forward:** family sharing stops depending on entry-level merge, and remote storage is a second transport, not a new project.
- **Narrowed:** S1 (the KDBX codec) now serves import and export. Opening a `.kdbx` in place and editing it alongside another app is dropped.
- **Reversed:** “no custom crypto protocol” in [architecture](architecture.md). The primitives stay standard; the protocol is ours and is reviewed before real logins depend on it.
- **Not yet reworked:** the screens in [experience](experience.md) that name a KeePass file, a key file or iCloud Drive as a location (first launch, lock screen, Setup vault details, Recently Deleted footer). They describe today's build and need new mocks before they change.

## Decisions for the owner

| Decision | Recommendation |
| --- | --- |
| Adopt this format as the source of truth, with KDBX as import and export | **Decided 2026-11-23: adopted.** |
| Post-quantum key wrapping from the first version | Yes: the X-Wing hybrid (ML-KEM-768 with X25519) as the HPKE key exchange. Wrapped keys stored in a cloud are exactly what an attacker would collect now and decrypt later. Verified 2026-11-23: CryptoKit has it from iOS 26 and macOS 26 as `XWingMLKEM768X25519_SHA256_AES_GCM_256`, Go has it in `crypto/hpke`, and Python's `cryptography` has it from version 47. It sets the minimum OS at 26. The [specification](format-spec.md) is drafted on this assumption. Still to show: that the three interoperate on the test vectors. |
| Reuse the age file format for wrapped keys | No. Verified 2026-11-23: age has post-quantum recipients from version 1.3.0, but it is a whole-file format with its own header and passphrase mode (scrypt), CryptoKit has no age support, and what is wrapped here is one 32-byte key, which HPKE does directly on every platform. The reference tool gives Windows and Linux the same reach. The [specification](format-spec.md) is drafted on this assumption. |
| The person key: synced by iCloud Keychain, or wrapped to each device | **Decided 2026-11-23, approved with the mocks:** iCloud Keychain by default on Apple devices, with the vault password and recovery kit optional under Advanced. The vault is as safe as the Apple Account and device passcode, no safer. |
| Order | One person on several devices first, with epochs and authors already in every record and every item already in a group. Shared groups second. |

## Roadmap

- [x] Owner decision to adopt (2026-11-23).
- [ ] Owner decision on the four open rows above.
- [x] Verified X-Wing HPKE in CryptoKit, Go and Python, and age's post-quantum recipients (2026-11-23).
- [~] Byte-level [specification](format-spec.md): draft 1 written 2026-11-23, covering records, keys, membership, slots, the folder layout and the server operations. Test vectors and a reference implementation in `Tests/Format/` are in progress. Not yet specified: the item schema, the invitation and approval exchanges, the backup file and the CloudKit record types.
- [ ] Spike: CloudKit zone per vault with `CKShare`, including whether a child's Apple Account can accept the share, and convergence times on real devices.
- [ ] Spike: the folder transport in iCloud Drive and one non-Apple sync tool, with three devices and scripted concurrent edits.
- [ ] Reference command-line tool that reads and writes a folder vault on macOS, Windows and Linux.
- [ ] Independent review of the protocol before real logins depend on it.
- [ ] A record-log store behind `VaultStore`, with the local index the AutoFill extension reads.
- [ ] Native item schema for records, starting from the field model in [items](items.md); the KeePass mapping there becomes the import and export mapping.
- [ ] KDBX export of a whole vault, verified in KeePassXC, as the way out.
- [x] Mocks approved on 2026-11-23: `Design/Mocks/vault-create-and-devices.html`, `vault-locations-and-backup.html` and `family-sharing.html`. They are deleted when their screens are built. Not yet drawn: the lock screen and the vault password screen for the new format.
