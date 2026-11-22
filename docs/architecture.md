# Native architecture and security

| Boundary | Responsibility |
| --- | --- |
| macOS / iOS SwiftUI app | Onboard, manage vaults, search, edit, import and guide system setup. |
| Shared Swift vault module | KDBX codec orchestration, snapshots, entry operations and write transactions. |
| Shared Swift migration module | Parse validated source formats and produce reviewable import plans. |
| Storage adapters | Local and iCloud document selection, coordinated I/O and revision history. |
| Credential Provider targets | Resolve system requests, unlock, select and deliver one credential or process a save. |
| Safari / browser adapters | Relay origin-scoped requests; check active tab/frame before user-approved delivery. |
| Keychain and LocalAuthentication | Device-local opt-in biometric unlock with vault password fallback. |

The prototype compiles shared Swift source folders into both Xcode app targets. Extract a shared Swift package when the app and provider need the same production vault API. Use Apple frameworks for UI, access control, and supported cryptographic primitives, along with an independently reviewed implementation for KDBX requirements Apple frameworks do not expose. Treat the app, AutoFill extension and browser companion as separate processes. Keep the shared App Group narrowly scoped to encrypted data and essential index or routing metadata. Gate Keychain access by platform availability and entitlements.

Threat model includes phishing pages, malicious frames and extensions, tampered vaults and exports, filesystem races, and unlocked-device exposure. Bind credentials to verified origin and explicit intent. Keep plaintext out of logs, analytics, sync files, browser storage and crash attachments. Lock on configured inactivity or system lock, clear pending grants at session changes, and limit clipboard exposure where supported. Extension termination or stale identity must lead back to an unlock or selection path. A compromised unlocked OS is outside the security guarantees.

Use [item templates](items.md) in the app layer and preserve underlying KeePass fields in the shared vault module. Return only the selected credential or approved fields across the extension boundary. Keep card selection and checkout requests distinct from login requests.

## Decisions

- Define a `VaultStore` boundary now. The app domain, extension and importers talk to it. KDBX is one implementation, which keeps the M0 storage decision reversible.
- Protected values use a dedicated secret type with limited lifetime and no logging or accessibility exposure. The scaffold keeps secrets in plain `String` view state, which is acceptable for fictional data only.
- Plan an external security audit before 1.0. Nothing in the vault, extension boundary or importers ships on a self-review alone.

- Maintain one Swift and SwiftUI application codebase across Mac, iPhone and iPad. The scaffold currently packages that code with two app targets, each embedding its platform’s provider. Prefer one multiplatform app target if both destinations can embed and sign their provider using platform-specific settings. Confirm that during the signed feasibility spike. Use WebExtension resources as required by browsers.
- No custom crypto protocol. Preserve the KeePass document as an interoperable format.
- Begin with local vaults and an AutoFill spike. Verify the trust boundary before expanding browser access.

## Dependencies and licenses (2026-11-22)

No package dependencies. `App/Core/KDBX` holds the KDBX container, a small XML tree, and first-party Blake2b, Argon2, ChaCha20 and Salsa20, with SHA-2, HMAC, AES and zlib from Apple frameworks. `App/Core/VaultStore.swift` is the boundary the interface uses, `KeePassVaultStore.swift` the file-backed KDBX implementation and `VaultSession` the owner of the open vault. Argon2 runs only in the app, never the extension. The primitives need the external audit before 1.0. KDF budget: Argon2id 64 MiB, three passes takes about 0.2 s on an M-series Mac in a release build; measure on the oldest iPhone (S2).

## Roadmap

- [ ] Verify multiplatform target packaging, extension embedding and signing on both platforms. [Apple’s Xcode multiplatform guidance](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target).

- [x] Establish native app and inert extension process boundaries in Xcode.

- [ ] Run M0 spikes and record results in this document.
- [ ] Record dependencies, licenses, KDF budgets and extension-process access model.
- [ ] Validate origin policy, secret lifecycle, importer behavior and cross-process races in a security review.
- [ ] Add accessibility, keyboard navigation and VoiceOver coverage before TestFlight.

## Security review, 2026-11-23

An independent read of the last commit against the threat model above. Nothing was built or run. No critical issue was found in the encrypted vault path. Each finding has a roadmap item; the order below is the order to fix them in.

### Before real logins go in

- [ ] **The provider falls back to a plain-text store when it finds no vault.** With no vault reference it uses the sample store behind a device prompt, and a password saved from a sign-up page, or a new passkey with its private key, is written unencrypted to `saved-logins.json`. Someone who turns on AutoFill before creating a vault hits this with real credentials. The same happens if the shared defaults cannot be opened. Fix: the sample store is read-only and in memory, switched on only by the app; with no vault the provider shows the not-ready screen and writes nothing; no fallback to the extension's own defaults.
- [ ] **Matching can release a login to the wrong site.** A saved `github.io` or `blogspot.com` matches any site under it, a login for `login.bank.com` matches `bank.com`, scheme and port are ignored so plain `http` pages match, and every other login is one tap from release with no site named. Fix: the rule in [autofill](autofill.md#decisions) with the public suffix list, https only except localhost, and a confirmation that names the site.
- [ ] **The conflict check can be skipped and is not atomic.** When the read before a write fails, the write goes ahead with no check and no rollback copy, and the read, compare and write are separate steps that the app and the extension can interleave. Fix: one coordinated block that fails when an existing file cannot be read.
- [ ] **Rollback copies keep the old password.** After a password change, up to five copies encrypted with the old password remain, old logins included, and device backups carry them. Fix: delete or re-encrypt them on a credential change, and say so in the sheet.
- [ ] **Mac Touch ID is a prompt in front of an unprotected Keychain item.** Do not offer it for real vaults on Mac until the data protection keychain works in a signed build, and switch on the hardened runtime.
- [ ] Read the Keychain item's access control back on a physical device, and confirm it is gone after re-enrolling Face ID and after removing the passcode.

### Before TestFlight

- [ ] A hostile vault file can ask for 4 GiB of Argon2 memory or 2^40 AES rounds before anything is authenticated, and file size is uncapped. Cap memory, passes, rounds and size, make the KDF cancellable, and name the numbers when a vault is unusually expensive.
- [ ] KDBX 3.1 files: the header hash in `Meta` is never checked, and a protected value with bad base64 is read as empty without advancing the key stream, which garbles every later secret and writes the damage back on the next save. Verify the hash and treat bad base64 as corruption.
- [ ] No privacy cover: the app switcher snapshot shows the vault list, and a revealed password stays revealed. Cover when the scene is not active and clear reveals.
- [ ] The provider releases by record identifier alone. Recheck the identity's site, and a passkey's relying party and credential, before release.
- [ ] A biometric error that is not a cancel deletes the saved key (lockout, a closed lid, a tampered header). Delete only when the item is gone or biometry is not enrolled.
- [ ] A failed save is still shown in the list as saved, and the new reload on return can drop the edit a conflict alert is still asking about.
- [ ] Remove the unused composite key from the open document. It is equivalent to the password and nothing reads it.
- [ ] Passkeys always claim to be synced (backup flags set) and sign with the stored relying party, not the request's.
- [ ] After a CSV import, say the export is unencrypted and offer to delete it.
- [ ] Smaller: the generator's forced lowercase letter can overwrite the forced capital; control characters in a secret are dropped on save; Keychain items outlive an uninstall; the Mac clipboard clears only while the app runs; note text has autocorrect on; the Safari extension holds the App Group entitlement it should not need.
- [ ] The browser host and the Safari handler answer any request with no unlock, trust a caller-supplied “manual” flag to release a secret to any origin, and the host's caller check is not authentication. They stay out of any build that handles real data until they relay to the unlocked app.

### Found sound

Every path in the provider that returns a secret goes through the unlock, and fill without interaction always asks for the interface. On iOS the key is device-only, tied to the enrolled biometry, with no passcode fallback. KDBX 4 files are authenticated before use: header hash, header HMAC and every block HMAC including the last, with constant-time comparison and bounded lengths. Every save draws a fresh master seed, IV and inner stream key from the system generator. XML parsing resolves no external entities and caps depth and node count. Argon2, Blake2b, ChaCha20 and Salsa20 read correctly against their RFCs. The app logs nothing, uses no network, and copies with a local-only, expiring clipboard.

### Tests to add

Hostless: the matching table; hostile files (every header byte flipped, truncation at every offset, KDF caps, inflation limit, XML limits, a tampered 3.1 header hash); written bytes contain no known secret and differ between saves; two stores interleaving, a write when the read fails, and no rollback copy opening with the old password; Blake2b, Argon2, ChaCha20 and Salsa20 against reference implementations across lengths and parameters; passkey authenticator data and signature; one-time codes against RFC 6238; the generator's guarantees over many runs; CSV edge cases.

### First-party crypto

The reviewer's view, for the gate: keep the Swift primitives and add the differential tests above. A wrong KDF fails loudly, since files from other apps would not open and Psss's own are checked against KeePassXC, and vendoring the reference C adds unsafe memory that the audit must cover anyway. Revisit only if S2 shows Argon2 is too slow on the oldest phone.
