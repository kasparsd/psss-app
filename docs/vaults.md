# KeePass vaults and storage

The encrypted KDBX document is the source of truth. New vaults target KDBX 4.1 with a reviewed KDF and cipher configuration. Inventory the formats Strongbox users actually bring, including KDBX 3.1/4.x, AES-KDF, Argon2 variants, AES and ChaCha20, and password plus key file. Publish the supported matrix after round-trip verification. Detect unsupported features before enabling writes.

Local vaults use on-device storage or a user-selected file. iCloud vaults use coordinated access to an encrypted file in iCloud Drive. Keep the location explicit per vault. For imported local copies, preserve the original file. Bookmarks and file-provider access must survive relaunch, while moved or revoked files should lead to a relink flow.

Serialize writes per vault and compare the base revision before replacing the document. Use coordinated, atomic replacement with encrypted rollback copies. Handle placeholders, stale bookmarks, offline edits, disk-full errors and concurrent revisions. Preserve both conflicting revisions, automatically reconcile only changes that can be merged safely by stable entry identity, and ask about conflicting edits and deletes before publishing a merged document.

[KeePass KDBX specification](https://keepass.info/help/kb/kdbx.html), [KDBX compatibility](https://keepass.info/help/kb/kdbx_4.html), [Apple sandbox file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox).

See [vault items](items.md) for the entry templates and preservation rules. Verify standard and custom strings, protection flags, attachments, expiry, nested groups, tags and history on every supported round trip.

## Decisions

- Cached site icons live in the vault as KeePass custom icons, so they sync, work offline and stay portable. Fetch only when the person opts in. See [experience](experience.md#one-line-rows-and-site-icons).

- KDBX is canonical (decided by the owner, 2026-11-23). Psss does not build a private store, and the earlier fallback is dropped; reopen only for an existing, proven alternative that is clearly better. Keep KDBX behind the `VaultStore` boundary so the app domain does not depend on KeePass structures. What used to be kill criteria are now problems to solve inside the format: the AutoFill extension must unlock within its memory and time budget (the Keychain-held transformed key is the answer so far, to be measured in S2), and two-device edits must merge at entry level without losing an edit (S4).
- Keep the Argon2 cost out of the extension. After the app unlocks, wrap the derived key in the Keychain behind biometrics so the provider only decrypts.
- Use counts and last-used dates are device-local and never written to the vault file (built 2026-11-23): a small per-vault usage file in the App Group container (`Usage/<vault>.json`, no secrets), read by `items()` and removed with the vault. A rollback copy is kept only for a write that changed content and succeeded, and all of them are removed when the vault password changes. KDBX `LastAccessTime` and `UsageCount` are left as found.
- The app reloads the vault when the file changed while it was in the background (the AutoFill extension writes to the same file), using the key it already holds, and locks if that key no longer opens it. Built 2026-11-23.
- The vault reference (name, file, bookmark, settings, no secrets) lives in the App Group defaults. Where those cannot be opened it is a file in the app's own Application Support, which the provider cannot see, so the provider shows its not-ready screen. There is no fallback to the process's own defaults.
- The sample vault is in memory only. What is added to it is gone when Psss locks or quits, nothing from it is written to disk, and it offers no AutoFill.
- Default to one vault, created without asking about files. Offer file-level options only in advanced settings. More vaults are supported; see [Multiple vaults](#multiple-vaults).

- Support local and iCloud Drive storage. No hosted account is required.
- Keep independent encrypted backups of significant revisions and a visible restore path.
- Use audited, standards-compatible primitives and independently generated fixtures. Treat parse limits, malformed input and extension memory budgets as release requirements.

## Implementation status (2026-11-22)

- **Library decision (S1, first pass).** First-party Swift codec in `App/Core/KDBX`, no package dependencies. Apple frameworks provide SHA-2, HMAC, AES (CommonCrypto) and zlib. Blake2b, Argon2d/i/id, ChaCha20 and Salsa20 are written in the project and checked against the RFC 8439 and RFC 9106 vectors. This knowingly reverses the preference for a reviewed library: no maintained, audited Swift KDBX library was adopted, and the primitives are small. They must go into the external audit before 1.0, which can also replace them with a reviewed library behind the same types.
- **Supported matrix.** Read: KDBX 3.1 and 4.0/4.1, AES-256 or ChaCha20, AES-KDF, Argon2d, Argon2id, password and/or key file (XML v1 and v2, 32 bytes, hex, any file), gzip or none, inner header attachments and the KDBX 3 binary pool. Write: always KDBX 4.1, so a 3.x file is upgraded on its first save (the Setup sheet shows “KDBX 3.1, saved as KDBX 4.1”). Not supported and refused before anything is written: Twofish, Argon2 versions other than 0x13, Salsa20 inner stream in KDBX 4.
- **Round trips.** The document is an XML tree edited in place, so unknown elements, icons, auto-type, custom data, attachments and history survive. Changing an entry pushes the old version into its history (limit from `HistoryMaxItems`). Deleting removes the entry and records a `DeletedObject` (the Recycle Bin is not used yet). `scripts/test-kdbx.sh` opens and edits files made by KeePassXC 2.8 and checks KeePassXC reads the result. Strongbox fixtures are not checked yet.
- **Storage.** A new vault lives in Application Support (`Vaults/`). An opened file stays where it is, reached through a security-scoped bookmark, with a Locate Vault File flow when it moved. Writes are coordinated and atomic. Before each write the app compares the file with what it opened and refuses if it changed, offering Reload or Overwrite. The previous file is kept as one of five encrypted rollback copies. Entry-level merge is not built.
- **Unlock.** Vault password and optional key file, derived in the app on a background task (Argon2id 64 MiB, three passes, two lanes for new vaults). The derived key is kept in memory while the vault is open and reused for saves, so saving never repeats the KDF. Locking writes pending use counts and drops the document. Face ID and Touch ID unlock are built (see [lock screen](#lock-screen-2026-11-22)); the iOS AutoFill extension opens the real vault with the same saved key (see [AutoFill](#autofill-extension-2026-11-22)).

## Lock screen (2026-11-22)

Built and verified on the iPhone simulator; Mac builds and the Keychain path is untested on a real Mac vault.

- **Face ID and Touch ID.** After a password unlock, or after creating a vault, an alert offers "Unlock Passwords with Face ID?" ("Not Now" is remembered per vault; Setup has an "Unlock with Face ID" switch). Accepting saves the vault's transformed key (the password after the KDF) in the Keychain (`BiometricKey`). On iOS and iPadOS the item uses `kSecAttrAccessControl` with `.biometryCurrentSet` on this device only, so it disappears when the enrolled face or fingers change. On macOS there are two modes, decided once per process: a provisioned build keeps the key in the data protection keychain with the same access control as iOS and never falls back; a local build without a development team keeps it in the login keychain and asks for Touch ID itself before reading it (see [autofill](autofill.md#mac-builds-local-and-provisioned)). The lock screen asks for biometry on appearance and has a labeled "Face ID" or "Touch ID" button beside the password field to retry. The password always still works. Changing the vault password refreshes the saved key; a key that no longer opens the file (biometry changed, password changed elsewhere) switches the feature off and asks for the password once. Forgetting a vault deletes its key.
- **Saved key and other apps (observed 2026-11-23).** The saved transformed key is tied to the file's KDF seed and password. Psss keeps the seed on save, and opening a KDBX 3.1 file and saving it as 4.1 keeps it too. KeePassXC 2.8 changes the seed on every save, so any save by KeePassXC invalidates the key and the next unlock needs the password; KeePass 2 and Strongbox are unverified. Today that turns Face ID off until the person switches it on again, and the saved key is not refreshed by a password unlock: both are to fix (roadmap S2). KeePassXC also rewrites a 4.1 file as 4.0; entries read back correctly.
- **Not yet done for biometrics.** The extension's memory and time are not yet measured on a device (S2). The Mac Keychain path, Apple Watch unlock and iCloud Keychain sync (S6) are untested or undecided. Simulator testing needs an ad-hoc signed build (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`), because an unsigned build cannot use the Keychain.
- **What is this?** A labeled button under the password opens a short explainer: the password chosen when the vault was created, not the Apple Account or device passcode, the password set in KeePassXC or Strongbox for files made there, what a key file is, and that Psss cannot see or reset it.
- **Forgot Password?** A second labeled button opens plain help: nothing to reset, three things to try (Caps Lock and keyboard language, the key file, an older copy), then "Open Another Vault…" and "Forget This Vault…". Forgetting a vault Psss created deletes it from the device after a confirmation; forgetting an opened file only removes Psss's reference.
- **Still open.** A recovery phrase (S6) is not built, so the help does not promise one. A device-local password hint was considered and not built; decide before adding. The selector lists one vault; it becomes a real list with the multi-vault work.

## Roadmap

- [ ] Run spikes S1, S2 and S4 from the [roadmap](roadmap.md) and record the storage decision here.
- [x] Decide on the codec: first-party for now, audit before 1.0 (see Implementation status).
- [ ] Establish interoperability fixtures from KeePassXC and Strongbox and verify open, mutate, save and reopen in both directions.
- [ ] Test concurrent changes from two devices, offline recovery and failed atomic replacement.

## Sync and merge design (2026-11-23)

An evaluation of how sync should work inside KDBX. It replaces the one-sentence S4 spike; the test protocol is in the [roadmap](roadmap.md). Nothing here is built except where it says so.

### What happens today

The app notices an outside change only when it next writes, by comparing the file's hash with the one it opened. Then it offers Reload (the edit just made is discarded), Overwrite (the other writer's change survives only as a rollback copy) or Cancel (the list shows an edit the file does not hold, and it is gone at the next lock). Reloading when the app becomes active is being added now.

Defects that matter for sync:

- [x] The check and the write were two separate coordinated steps. Now one coordinated read, compare and write (2026-11-23).
- [x] When the read before a write failed, the check was skipped. Now the write is refused, also when the file disappeared under an open vault (2026-11-23).
- [ ] Coordinated reads run on the main actor and block while iCloud downloads a file.
- [x] Two saves of one entry within a second made two history items with the same time. Entry times now always move forward (2026-11-23).
- [ ] A saved file never has the same bytes twice, since seeds and IVs are fresh each time. “Nothing to merge” has to compare decrypted content, never file hashes.
- [~] Deleting was permanent in the codec. The Recycle Bin exists in the codec and the store (2026-11-23, see [items](items.md#built-so-far-2026-11-23)); the app's delete button still deletes permanently until the Recently Deleted screen is approved.

### How iCloud Drive presents two edits

From Apple's technical note on version conflicts and the iCloud design guide: two devices editing one file produce versions of that file, not extra files, read with `NSFileVersion.unresolvedConflictVersionsOfItem(at:)`. The app resolves them itself and must then remove the other versions, or they keep syncing to every device and using storage. An app that is not document-based implements `NSFilePresenter` to hear about new versions and coordinates every access. A file that was evicted keeps its metadata and downloads on a coordinated read. Visible duplicates named “file 2” come from two devices creating a file of the same name, not from editing.

Reported on Apple's forums and to be tested, not relied on: the current version can differ between devices after a simultaneous edit; a write made before the metadata query has gathered can overwrite the cloud version without a conflict; atomic replacement of an iCloud file fails now and then. Unverified: whether a file opened from iCloud Drive through the Files picker gets the same hidden versions as a file in the app's own container, whether complete file protection delays upload while the device is locked, and whether KeePassXC's save pattern produces visible copies.

A vault in Psss's own iCloud container needs the iCloud entitlement on the app and the provider, so a paid developer account. A file the person picked needs no entitlement, but any app can rewrite it in any way, and the AutoFill extension cannot reach it today.

### The merge

KeePass and KeePassXC merge at entry level: entries match by identifier, the one modified later becomes current and the other goes into history, histories are combined, and a deletion wins only over an entry not modified after it. KeePass states it will not merge at field level. Psss needs one step more, because the experience asks only when the same field changed on both sides.

1. Match entries by identifier. An entry only one side has is added, subject to the delete rule.
2. Find the newest revision both sides share, current or in history. If one side's current version is in the other's history, the newer side simply wins.
3. Otherwise merge field by field against that shared revision. A field changed on one side takes that change.
4. Ask only when one field changed to different values on both sides, or an edit meets a delete: “Edited on iPhone, 14:02” against “Edited on Mac, 14:05”, keep either. The later one is the default, the other stays in history, and when the two times are within two minutes Psss asks instead of defaulting.
5. Combine the histories and trim to the limit.
6. Treat these as one unit each, never half-merged: the one-time code, the passkey's five fields, and a card's number with its expiry.

When history was trimmed and no shared revision remains, fall back to KeePass's rule: the later entry wins whole and the other goes to history. A copy of the last agreed state, kept encrypted on the device, is the later improvement that makes deletes and moves exact.

The merge must give the same content whichever side runs it and change nothing when run twice. A delete never removes a later edit, and what it does remove goes to the Recycle Bin. The AutoFill extension is one more writer and uses the same path. Psss's saves keep the KDF seed, so the other device's Face ID key keeps working after a merge. Passkeys have no counter and one-time codes no state, so neither needs merging beyond the unit rule.

To never lose an edit: write this device's change as a revision first, then merge, then replace the file; keep the file from before the merge as a rollback copy until the upload is confirmed; and remove iCloud's other versions only after the merged file was written and read back.

### Order of work

1. Usage out of the file and rollback copies for content writes only (built, being validated).
2. Entry times that always move forward, history without collisions, a comparison of decrypted content.
3. Recycle Bin on delete, with restore.
4. The merge as a pure function in `App/Core/KDBX`, with tests that merge in both orders and compare with `keepassxc-cli merge`.
5. One coordinated read, compare and write, off the main actor, with merge in place of Overwrite.
6. The extension on the same path.
7. A file presenter, version listing and cleanup, and sync status.
8. The conflict and sync screens, after the gate.
9. A scripted writer for the device runs.
10. The iCloud container, its entitlements and AutoFill on the synced vault. Needs the paid account.

Steps 1 to 6 need no signing and can start now.

## Multiple vaults

Decided 2026-11-22: the app supports several vaults. People bring more than one KeePass file (personal and work, a shared family file), and a second vault is the cleanest way to keep a work login out of a personal list. It must cost single-vault people nothing: the first vault is still created without a question, and no vault control appears until a second one exists.

### Model

- A vault is a file or store, a key, a name, a color and a sync state. Items belong to exactly one vault. The same site in two vaults is two items, never merged silently.
- A small **vault registry** in the App Group lists every vault: identifier, name, color, storage location, whether it is the default, and how it unlocks. The app and the AutoFill extension both read it. It holds no secrets.
- **Unlock.** Vaults whose key is wrapped in the Keychain behind biometrics open together after one Face ID or Touch ID. A vault protected by its own password or key file stays locked until asked for, and the extension offers it only when its identities can be matched. Lock state is per vault, but the app-level lock covers all of them.
- **Default vault.** Where new logins, saves from Safari, generated passwords and imports go. Always visible wherever it matters. Changing it is one tap.
- **Storage and sync.** Each vault serializes its own writes and resolves its own conflicts, exactly as described above. Vaults sync independently, and sync is free.
- **Deleting.** Removing a vault from the app never deletes its file. Deleting its contents is a separate, explicit, counted action. Recently Deleted is per vault and listed together.

### Rules for the whole app

1. Search, fill and filters look across every unlocked vault. A vault name appears only when two or more vaults exist, and only as a small secondary label.
2. A result that exists in two vaults for the same site and username shows both, with the vault name leading the secondary line, and the default vault first. Never auto-pick across vaults.
3. Saving never asks which vault. It uses the default, names it in the prompt when two or more vaults exist, and offers a one-tap change. This keeps the “one tap on Save” bar.
4. Moving an item between vaults is a visible action, “Move to…”, on the detail page and in the context menu. Copy to another vault is a second option, not the default.
5. Passkeys and verification codes move with their item. A passkey is registered in the default vault unless the person changed it in the sheet.
6. Nothing about vault choice appears in the system fill sheet unless there is ambiguity.

### Steps, in order

1. **Domain.** `Vault` and `VaultRegistry` types. `VaultStore` becomes one instance per vault. `VaultItem` gains a vault identifier that is not stored inside the item.
2. **Storage.** Per-vault file bookmarks, key wrapping and write serialization. The registry lives in the App Group.
3. **Unlock.** One biometric unlock opens all Keychain-wrapped vaults. Own-password and key-file vaults unlock individually. Spike S7 proves this fits the extension budget.
4. **AutoFill.** The credential identity store registers identities for every unlocked vault, with the vault identifier in `recordIdentifier`. Ranking prefers the default vault. The save prompt shows its destination.
5. **Browser.** Sidebar sections, search scope, detail and editor changes from [experience](experience.md#multiple-vaults-screens-and-steps-affected).
6. **Import and export.** Import chooses a destination vault, defaulting to the default one. Export is per vault, and the export-all option says how many files it writes.
7. **Sync.** Per-vault sync status and conflicts. People who keep sync off can still move a vault between their own devices by file.
8. **Tests.** Fixtures with two vaults and a shared domain. Matching, ranking and move/copy round trips. Lock one vault while the other is open.

Shared vaults for a family are a sharing feature, not multi-vault, and stay out of 1.0 as in the [roadmap](roadmap.md). The design is below.

## Family sharing and remote storage (design, 2026-11-23)

Proposal, not built, after the 2026-12-20 gate. Built for a household such as two adults and two children, with no Psss server.

- **Per vault, not per item.** Each person keeps a personal vault and the family shares one Family vault. Per-item sharing would mean copies that drift or references KDBX cannot express.
- **Key wrapping.** The vault has a random key, wrapped to each member's device-held public key with HPKE and stored in a sidecar next to the `.kdbx`. The file stays plain KDBX, so KeePassXC opens it with the key. Whether a person's key is synced through iCloud Keychain or bound to each device is decided in S6.
- **Invite in person.** A QR code and a short fingerprint both people confirm. The code can carry the remote endpoint and credential, encrypted to the recipient.
- **Recovery.** Shamir splitting only where no one person should recover alone: Family vault 2 of 3 (two adults and a printed card), an adult's vault 2 of 3 (partner, trusted person, printed card). A child's vault is wrapped to both parents, and either can recover it. Needs an audited implementation or published test vectors.
- **Stated limits.** There is no read-only role: anyone with the key can write, and an app-side switch could be bypassed in another KeePass app, so separate vaults are the answer. Removing a member rotates the key and lists the passwords that person saw. Four writers make entry-level merge (S4) a prerequisite.
- **Transport.** KDBX stays. Storage sits behind one transport interface: local and iCloud Drive, then WebDAV, then S3-compatible, with an optional own HTTP endpoint (`GET`, conditional `PUT`) that Psss defines and never hosts. A conditional write with `If-Match` on the ETag is an atomic compare-and-swap, so S4 tests it against iCloud coordination. The server holds ciphertext and the sidecar only. The AutoFill extension reads a local cached copy and the app syncs. A version counter in the sidecar warns when a fetched version is older than the last one seen. Large attachments make whole-file transfer slow and need measuring.
- **Not chosen.** A per-entry record format (private, breaks KeePassXC), MLS (no Apple API, too heavy), CRDT documents, git-based stores, Dropbox and Google Drive SDKs. If entry-level merge proves too weak, add an internal per-entry revision layer beside the KDBX instead of a new format.
- **Open spike.** Shared iCloud Drive folder or CloudKit share, and whether child Apple Accounts can use either.

## AutoFill extension (2026-11-22)

- On iOS and iPadOS the provider opens the vault through `VaultSession.unlockWithBiometrics()`: Face ID releases the transformed key, `KDBX.open(_:transformedKey:)` decrypts without Argon2, and saves go through the same coordinated write and conflict check as the app.
- Shared storage: `VaultReference`, managed vault files and rollback copies live in the App Group container (falling back to Application Support where the group is unavailable, such as the test script). The Keychain item uses the App Group as its access group.
- Without a vault of their own, people still get the sample vault behind the device passcode. If Face ID unlock is off, was reset or the file is unreachable, the provider shows "Can't open your vault here" and changes nothing.
- Verified 2026-11-22 on the iPhone 17 Pro simulator (ad-hoc signed build, Face ID enrolled): create a vault, accept Face ID, add a login, turn Psss on under Settings, General, AutoFill & Passwords, open a login page in Safari, tap the Passwords key. The provider listed the login from the real vault and filled the user name and password. Sign-up with password generation also worked: on a new-password field iOS offered a strong password saved in Psss, filled it, the provider's save sheet appeared, and Save login wrote the entry to the encrypted vault; the app showed it after a relaunch. Passkeys and the not-ready screen were not exercised.
- Mac, checked 2026-11-22 with an ad-hoc signed build: create a vault, add a login, Setup shows "Unlock with Touch ID" on, Lock Psss from the app menu and the lock screen unlocked again with the saved login-keychain key and no password. The build has no App Group entitlement, so the vault file and rollback copies sit in the app's sandbox container (the group path is not writable), where a Mac extension could not read them. The file is KDBX and does not contain the user name in plain text. The Mac provider is still a stub, so Mac AutoFill is untested. Not seen: the Touch ID system prompt itself.
- Gaps: vaults opened in place from Files probably cannot be read by the extension (bookmark scope, unverified), so they must be moved into Psss; the app does not yet reload when the extension wrote; the Mac provider is still a stub; Safari and the browser host still read `SharedVault`; extension memory and time are unmeasured; nothing here has run on a signed device build.
