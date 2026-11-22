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
- Default to one vault, created without asking about files. Offer file-level options only in advanced settings.

- Support local and iCloud Drive storage. No hosted account is required.
- Keep independent encrypted backups of significant revisions and a visible restore path.
- Use audited, standards-compatible primitives and independently generated fixtures. Treat parse limits, malformed input and extension memory budgets as release requirements.

## Roadmap

- [ ] Run spikes S1, S2 and S4 from the [roadmap](roadmap.md) and record the storage decision here.
- [ ] Select a reviewed Swift KDBX implementation or evaluate feasibility and independent review of a new one.
- [ ] Establish interoperability fixtures from KeePassXC and Strongbox and verify open, mutate, save and reopen in both directions.
- [ ] Test concurrent changes from two devices, offline recovery and failed atomic replacement.
