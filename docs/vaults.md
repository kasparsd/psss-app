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
- Default to one vault, created without asking about files. Offer file-level options only in advanced settings. More vaults are supported; see [Multiple vaults](#multiple-vaults).

- Support local and iCloud Drive storage. No hosted account is required.
- Keep independent encrypted backups of significant revisions and a visible restore path.
- Use audited, standards-compatible primitives and independently generated fixtures. Treat parse limits, malformed input and extension memory budgets as release requirements.

## Implementation status (2026-11-22)

- **Library decision (S1, first pass).** First-party Swift codec in `App/Core/KDBX`, no package dependencies. Apple frameworks provide SHA-2, HMAC, AES (CommonCrypto) and zlib. Blake2b, Argon2d/i/id, ChaCha20 and Salsa20 are written in the project and checked against the RFC 8439 and RFC 9106 vectors. This knowingly reverses the preference for a reviewed library: no maintained, audited Swift KDBX library was adopted, and the primitives are small. They must go into the external audit before 1.0, which can also replace them with a reviewed library behind the same types.
- **Supported matrix.** Read: KDBX 3.1 and 4.0/4.1, AES-256 or ChaCha20, AES-KDF, Argon2d, Argon2id, password and/or key file (XML v1 and v2, 32 bytes, hex, any file), gzip or none, inner header attachments and the KDBX 3 binary pool. Write: always KDBX 4.1, so a 3.x file is upgraded on its first save (the Setup sheet shows “KDBX 3.1, saved as KDBX 4.1”). Not supported and refused before anything is written: Twofish, Argon2 versions other than 0x13, Salsa20 inner stream in KDBX 4.
- **Round trips.** The document is an XML tree edited in place, so unknown elements, icons, auto-type, custom data, attachments and history survive. Changing an entry pushes the old version into its history (limit from `HistoryMaxItems`). Deleting removes the entry and records a `DeletedObject` (the Recycle Bin is not used yet). `scripts/test-kdbx.sh` opens and edits files made by KeePassXC 2.8 and checks KeePassXC reads the result. Strongbox fixtures are not checked yet.
- **Storage.** A new vault lives in Application Support (`Vaults/`). An opened file stays where it is, reached through a security-scoped bookmark, with a Locate Vault File flow when it moved. Writes are coordinated and atomic. Before each write the app compares the file with what it opened and refuses if it changed, offering Reload or Overwrite. The previous file is kept as one of five encrypted rollback copies. Entry-level merge is not built.
- **Unlock.** Vault password and optional key file, derived in the app on a background task (Argon2id 64 MiB, three passes, two lanes for new vaults). The derived key is kept in memory while the vault is open and reused for saves, so saving never repeats the KDF. Locking writes pending use counts and drops the document. No biometric unlock yet: that is the Keychain-wrapped key work (S2, S6); see [lock screen gaps](#lock-screen-gaps-2026-11-22-handoff).

## Lock screen gaps (2026-11-22, handoff)

The KeePass lock screen ("Unlock Vault:" selector, Vault Password, optional Key file, Unlock, one help block) is built, but it is a password-only screen.
Three gaps stop it from being the screen we want.
Design each from a mock first (ui-clarity skill, step 0), show the normal and error states, and get approval before building.

1. **No Face ID or Touch ID.**
   Every unlock runs Argon2 from the password, which is slow and typed again each time.
   Wanted: after the first successful password unlock, offer "Unlock with Face ID" (Touch ID on Mac, Apple Watch where the system allows).
   The vault key is wrapped in the Keychain behind biometrics, shared with the extension (S2, S6), and the lock screen leads with a labeled biometric button, with the password field below as the fallback.
   Open design points: opt-in prompt wording and where "turn off" lives in Setup; what happens when biometry changes (key invalidated, password required once); whether the wrapped key syncs through iCloud Keychain or stays device-only (S6); Mac Touch ID and Watch behavior; the simulator needs a manual Face ID match (docs/development.md).
   The current `UnlockGate` device-owner prompt is only a UI gate and does not release a key.
2. **Nothing says what "Vault Password" is.**
   People who opened a file made elsewhere may not know which password it wants; people who created one forget they chose it.
   Wanted: one labeled "What is this?" action in the help block that opens a short explainer: it is the password chosen when the vault was created, not the Apple Account or device passcode; for a file from KeePassXC or Strongbox it is the one set there; a key file is a separate file that only some vaults use; Psss cannot see or reset it.
   The wrong-password message already names the vault and mentions the key file; keep it short and link to the explainer.
3. **No help when the password is lost.**
   Psss cannot recover a vault password, and the screen says so, but it offers nothing to try next.
   Wanted, in this order: after a failed attempt show a few plain checks (Caps Lock, keyboard layout, key file chosen); say where a recovery phrase would help (the S6 default for new vaults) or that none exists for this vault; offer "Open Another Vault…" (built) and a safe "Forget This Vault" that removes Psss's reference but never deletes a file the person opened, and for a vault Psss created says clearly that its data is deleted unless they exported a copy.
   Decision to take: an optional device-local password hint set at creation (never written into the KDBX file) versus no hints at all.

Related and not built: the selector lists one vault; it becomes a real list with the multi-vault work below.

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
