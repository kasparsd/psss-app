# KeePass vaults and storage

The encrypted KDBX document is the source of truth. New vaults target KDBX 4.1 with a reviewed KDF and cipher configuration. Inventory the formats Strongbox users actually bring, including KDBX 3.1/4.x, AES-KDF, Argon2 variants, AES and ChaCha20, and password plus key file. Publish the supported matrix after round-trip verification. Detect unsupported features before enabling writes.

Local vaults use on-device storage or a user-selected file. iCloud vaults use coordinated access to an encrypted file in iCloud Drive. Keep the location explicit per vault. For imported local copies, preserve the original file. Bookmarks and file-provider access must survive relaunch, while moved or revoked files should lead to a relink flow.

Serialize writes per vault and compare the base revision before replacing the document. Use coordinated, atomic replacement with encrypted rollback copies. Handle placeholders, stale bookmarks, offline edits, disk-full errors and concurrent revisions. Preserve both conflicting revisions, automatically reconcile only changes that can be merged safely by stable entry identity, and ask about conflicting edits and deletes before publishing a merged document.

[KeePass KDBX specification](https://keepass.info/help/kb/kdbx.html), [KDBX compatibility](https://keepass.info/help/kb/kdbx_4.html), [Apple sandbox file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox).

See [vault items](items.md) for the entry templates and preservation rules. Verify standard and custom strings, protection flags, attachments, expiry, nested groups, tags and history on every supported round trip.

## Decisions

- Cached site icons live in the vault as KeePass custom icons, so they sync, work offline and stay portable. Fetch only when the person opts in. See [experience](experience.md#one-line-rows-and-site-icons).

- KDBX is canonical only until the M0 gate. Keep it behind a `VaultStore` boundary so the app domain never depends on KeePass structures. Kill criteria: the AutoFill extension cannot unlock within its memory and time budget even with a biometric-wrapped key, or two-device edits produce conflicts that entry-level merge cannot resolve. Fallback is a private encrypted store with KDBX import and export.
- Keep the Argon2 cost out of the extension. After the app unlocks, wrap the derived key in the Keychain behind biometrics so the provider only decrypts.
- Use counts and last-used dates are device-local and never written to the vault file (decided 2026-11-22, not built yet). Today `markUsed` edits the entry and the next lock rewrites the whole file, which makes devices that only read conflict with each other and rotates out the five rollback copies. The plan: a small per-vault usage file in the App Group container, read by `items()`, removed with the vault; a rollback copy is kept only for writes that change content. KDBX `LastAccessTime` and `UsageCount` are left as found.
- The app reloads the vault when the file changed while it was in the background (the AutoFill extension writes to the same file), using the key it already holds, and locks if that key no longer opens it. Not built yet.
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

- **Face ID and Touch ID.** After a password unlock, or after creating a vault, an alert offers "Unlock Passwords with Face ID?" ("Not Now" is remembered per vault; Setup has an "Unlock with Face ID" switch). Accepting saves the vault's transformed key (the password after the KDF) in the Keychain (`BiometricKey`). On iOS and iPadOS the item uses `kSecAttrAccessControl` with `.biometryCurrentSet` on this device only, so it disappears when the enrolled face or fingers change. On macOS the item sits in the login keychain, readable only on this device, and the app asks for Touch ID itself before reading it, because the data protection keychain with a biometric access control needs a provisioned build. The lock screen asks for biometry on appearance and has a labeled "Face ID" or "Touch ID" button beside the password field to retry. The password always still works. Changing the vault password refreshes the saved key; a key that no longer opens the file (biometry changed, password changed elsewhere) switches the feature off and asks for the password once. Forgetting a vault deletes its key.
- **Not yet done for biometrics.** The saved transformed key skips the KDF but is tied to the file's KDF seed and password: changing either (including another app rewriting the seed) makes it fail once, and the app asks for the password. The extension's memory and time are not yet measured on a device (S2). The Mac Keychain path, Apple Watch unlock and iCloud Keychain sync (S6) are untested or undecided. Simulator testing needs an ad-hoc signed build (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`), because an unsigned build cannot use the Keychain.
- **What is this?** A labeled button under the password opens a short explainer: the password chosen when the vault was created, not the Apple Account or device passcode, the password set in KeePassXC or Strongbox for files made there, what a key file is, and that Psss cannot see or reset it.
- **Forgot Password?** A second labeled button opens plain help: nothing to reset, three things to try (Caps Lock and keyboard language, the key file, an older copy), then "Open Another Vault…" and "Forget This Vault…". Forgetting a vault Psss created deletes it from the device after a confirmation; forgetting an opened file only removes Psss's reference.
- **Still open.** A recovery phrase (S6) is not built, so the help does not promise one. A device-local password hint was considered and not built; decide before adding. The selector lists one vault; it becomes a real list with the multi-vault work.

## Roadmap

- [ ] Run spikes S1, S2 and S4 from the [roadmap](roadmap.md) and record the storage decision here.
- [x] Decide on the codec: first-party for now, audit before 1.0 (see Implementation status).
- [ ] Establish interoperability fixtures from KeePassXC and Strongbox and verify open, mutate, save and reopen in both directions.
- [ ] Test concurrent changes from two devices, offline recovery and failed atomic replacement.

## Multiple vaults

Decided 2026-11-22: the app supports several vaults. People bring more than one KeePass file (personal and work, a shared family file), and a second vault is the cleanest way to keep a work login out of a personal list. It must cost single-vault people nothing: the first vault is still created without a question, and no vault control appears until a second one exists.

### Model

- A vault is a file or store, a key, a name, a color and a sync state. Items belong to exactly one vault. The same site in two vaults is two items, never merged silently.
- A small **vault registry** in the App Group lists every vault: identifier, name, color, storage location, whether it is the default, and how it unlocks. The app and the AutoFill extension both read it. It holds no secrets.
- **Unlock.** Vaults whose key is wrapped in the Keychain behind biometrics open together after one Face ID or Touch ID. A vault protected by its own password or key file stays locked until asked for, and the extension offers it only when its identities can be matched. Lock state is per vault, but the app-level lock covers all of them.
- **Default vault.** Where new logins, saves from Safari, generated passwords and imports go. Always visible wherever it matters. Changing it is one tap.
- **Storage and sync.** Each vault serializes its own writes and resolves its own conflicts, exactly as described above. Psss Pro syncs vaults independently, so a lapsed subscription never strands one.
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
7. **Sync.** Per-vault sync status and conflicts. Free-tier people can still move vaults between their own devices by file.
8. **Tests.** Fixtures with two vaults and a shared domain. Matching, ranking and move/copy round trips. Lock one vault while the other is open.

Open question for later: shared vaults for Family Sharing (a vault two people hold keys to). That is a sharing feature, not multi-vault, and stays out of 1.0 as in the [roadmap](roadmap.md).

## AutoFill extension (2026-11-22)

- On iOS and iPadOS the provider opens the vault through `VaultSession.unlockWithBiometrics()`: Face ID releases the transformed key, `KDBX.open(_:transformedKey:)` decrypts without Argon2, and saves go through the same coordinated write and conflict check as the app.
- Shared storage: `VaultReference`, managed vault files and rollback copies live in the App Group container (falling back to Application Support where the group is unavailable, such as the test script). The Keychain item uses the App Group as its access group.
- Without a vault of their own, people still get the sample vault behind the device passcode. If Face ID unlock is off, was reset or the file is unreachable, the provider shows "Can't open your vault here" and changes nothing.
- Verified 2026-11-22 on the iPhone 17 Pro simulator (ad-hoc signed build, Face ID enrolled): create a vault, accept Face ID, add a login, turn Psss on under Settings, General, AutoFill & Passwords, open a login page in Safari, tap the Passwords key. The provider listed the login from the real vault and filled the user name and password. Sign-up with password generation also worked: on a new-password field iOS offered a strong password saved in Psss, filled it, the provider's save sheet appeared, and Save login wrote the entry to the encrypted vault; the app showed it after a relaunch. Passkeys and the not-ready screen were not exercised.
- Mac, checked 2026-11-22 with an ad-hoc signed build: create a vault, add a login, Setup shows "Unlock with Touch ID" on, Lock Psss from the app menu and the lock screen unlocked again with the saved login-keychain key and no password. The build has no App Group entitlement, so the vault file and rollback copies sit in the app's sandbox container (the group path is not writable), where a Mac extension could not read them. The file is KDBX and does not contain the user name in plain text. The Mac provider is still a stub, so Mac AutoFill is untested. Not seen: the Touch ID system prompt itself.
- Gaps: vaults opened in place from Files probably cannot be read by the extension (bookmark scope, unverified), so they must be moved into Psss; the app does not yet reload when the extension wrote; the Mac provider is still a stub; Safari and the browser host still read `SharedVault`; extension memory and time are unmeasured; nothing here has run on a signed device build.
