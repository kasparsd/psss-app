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
6. **Recovery.** Password, device key, printed recovery kit and the Shamir splits already planned for families.
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
unlock secret   vault password (Argon2id) · device key · recovery kit · Shamir shares
  └─ person key      one per person, wrapped once per unlock secret
       └─ vault key      one per vault and epoch, wrapped once per member
            └─ record key    derived per record with HKDF
```

- **Unlocking** with a device key (held in the Secure Enclave on Apple devices, a TPM or OS keystore elsewhere) needs no password hashing. That is what the AutoFill extension uses.
- **Changing the vault password** rewrites one wrapped key. Nothing is re-encrypted.
- **Adding a device** is approved from a device that is already in, by scanning a code, or by typing the vault password.
- **Recovery** adds more wrapped copies of the person key: a printed kit, or Shamir shares held as the [family design](vaults.md#family-sharing-and-remote-storage-design-2026-11-23) lays out.

**Primitives, fixed per format version with no negotiation:** HPKE (RFC 9180) for wrapping to a public key, Argon2id for the password, HKDF-SHA256, ChaCha20-Poly1305, Ed25519, SHA-256. All but Argon2id are in CryptoKit, libsodium and the common libraries on every platform. A new algorithm means a new format version, not an option flag.

## Membership and revocation

A vault begins with a genesis record signed by its creator. The vault id is the hash of that record. Membership changes are records too, each signed by an owner, forming a chain back to genesis that every client verifies.

- **Roles:** owner, member (reads and writes) and reader. Storage cannot enforce who writes, so clients do: a record signed by someone the chain does not allow to write is ignored by everyone. This gives the read-only role that KDBX could not, which suits a child's access to the Family vault.
- **Adding a person** wraps the current vault key to their public key. They can read the vault's history. The invitation is made in person with a code and a short fingerprint, as already designed; the code carries a one-time secret, so the storage provider cannot put its own key in the middle.
- **Removing a person** starts a new epoch: a new vault key, wrapped to those who remain, with the earlier epoch keys sealed under it. New records use the new key.
- **Sharing stays per vault, not per item,** as decided. A personal vault is simply a vault with one member.

## Transports

The specification defines records. A transport needs only three operations: list what is new, get, and put if absent. It never needs to understand a record.

- **CloudKit, the default on Apple devices.** One zone per vault in the person's private database and one `CKRecord` per record. Change tokens fetch only what is new, and push notifications make it prompt. A Family vault is that zone shared with `CKShare`. CloudKit's permissions are a convenience; the cryptography is the security boundary.
- **A folder.** Each device appends to its own segment files and seals them at a size limit, so no file ever has two writers. This works in iCloud Drive, Syncthing, Nextcloud, Dropbox or on a USB stick, with no code specific to any of them.
- **A server.** Three endpoints over any blob store. Psss defines it and never hosts it. WebDAV and S3-compatible storage can also serve as the folder transport directly.
- **Bridging.** A client connected to two transports for one vault joins them, because merging is union. A Mac can keep a CloudKit vault and a folder on a home server in step, and a Windows or Linux client reads the folder.

**The local cache.** Each device keeps the folded state in a local index outside the format, protected by the device key. The app and the AutoFill extension read the index. The extension never reads the log and never syncs.

## What a person sees: locations, backup and self-hosting

Proposed on 2026-11-23 and drawn in `Design/Mocks/` (see the roadmap below). None of it is approved or built. The words “record”, “log”, “CloudKit” and “transport” never appear in the app; a person sees a vault and the places it is kept.

**A vault has one or more locations.** Each location holds the same vault, and Psss keeps them in step.

| Location | What it is | Where the person can see it |
| --- | --- | --- |
| This device | Always present. What the app and AutoFill read. | Nowhere outside Psss |
| iCloud | The default when the device is signed in. Psss's own private space in the person's iCloud (a CloudKit zone). | Not in the Files app. In Settings, under the Apple Account's iCloud storage, listed as Psss |
| A folder | Any folder the person picks: iCloud Drive, an external disk, a network share, a folder another tool syncs. The vault is a folder named after it, such as `Personal.psss`, full of unreadable files. | In Files and Finder, where it can be moved or copied whole |
| A server | A WebDAV address, an S3-compatible bucket or the small Psss endpoint, with an address and a credential. | Wherever the person runs it |

- **Onboarding.** Create a vault asks for a name, shows where it will be kept (“On this iPhone and in your iCloud”, with a switch for iCloud), turns on Face ID or Touch ID and hands over a recovery kit to print or save. Nothing asks for a location, a format or a file.
- **A second device.** On the same Apple Account the vault is found in iCloud, and the new device is let in by approving it on a device that already has the vault, or with the recovery kit or vault password.
- **Is a single file possible?** Not as a place the vault lives: one file that several devices rewrite is the problem this format removes. A single file is a backup or an export.
- **Backup.** “Save a Backup Copy” writes the whole vault, with its history, as one encrypted file that opens with the vault password or recovery kit. “Export as KeePass File” writes a `.kdbx` for other apps. Restoring a backup into the vault it came from merges and never overwrites, because merging is union; it can also be opened as a separate new vault.
- **A second location is a live copy, not a backup.** It follows every change, deletions included. The backup copy is the point-in-time one.
- **Several of everything.** Several vaults, each with its own locations. One vault in several locations. One vault on any number of devices.
- **Self-hosting, in three steps of effort.** No server at all: a folder on a home server or a disk, synced by whatever the person already uses. Standard storage: WebDAV or an S3-compatible bucket. The Psss endpoint: three operations that anyone can run from the published specification and reference server. Psss never hosts any of them, and all three hold only unreadable data.

To verify before building: whether a `.psss` folder can show as a single item in Files and Finder (a package) and still sync as a folder in iCloud Drive.

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
| Post-quantum key wrapping from the first version | Yes: the X-Wing hybrid (ML-KEM-768 with X25519) as the HPKE key exchange. Wrapped vault keys stored in a cloud are exactly what an attacker would collect now and decrypt later. It sets the minimum at iOS 26 and macOS 26. To verify: availability in CryptoKit and in libraries for Windows and Linux. |
| Reuse the age file format for wrapped keys | Evaluate. It would give Windows and Linux tooling for free. To verify: its current post-quantum recipients, and whether its passphrase mode (scrypt) is acceptable in place of Argon2id. |
| The person key: synced by iCloud Keychain, or wrapped to each device | Wrapped to each device, so the format does not depend on Apple. iCloud Keychain can hold a copy as a convenience. This is the open question in S6. |
| Order | Personal vaults on several devices first, with epochs and authors already in every record. Sharing second. |

## Roadmap

- [x] Owner decision to adopt (2026-11-23).
- [ ] Owner decision on the four open rows above.
- [ ] Verify the two items marked “to verify”.
- [ ] Write the byte-level specification with test vectors: record layout, key derivation labels, wrapped-key layout, folder layout, the three server operations.
- [ ] Spike: CloudKit zone per vault with `CKShare`, including whether a child's Apple Account can accept the share, and convergence times on real devices.
- [ ] Spike: the folder transport in iCloud Drive and one non-Apple sync tool, with three devices and scripted concurrent edits.
- [ ] Reference command-line tool that reads and writes a folder vault on macOS, Windows and Linux.
- [ ] Independent review of the protocol before real logins depend on it.
- [ ] A record-log store behind `VaultStore`, with the local index the AutoFill extension reads.
- [ ] Native item schema for records, starting from the field model in [items](items.md); the KeePass mapping there becomes the import and export mapping.
- [ ] KDBX export of a whole vault, verified in KeePassXC, as the way out.
- [~] Mocks drawn on 2026-11-23 and awaiting approval: `Design/Mocks/vault-create-and-devices.html`, `vault-locations-and-backup.html` and `family-sharing.html`. Not yet drawn: the lock screen and the vault password screen for the new format.
