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

- Define a `VaultStore` boundary now. The app domain, extension and importers talk to it. KDBX is the implementation in the build; the [record log](format.md) is the second (decided 2026-11-23). Since 2026-11-24 they are two phases: KDBX is the source of truth in 1.0, and a vault that its owner moves to the record log uses the second store from then on, with KDBX as import and export. Both stores sit behind this boundary at the same time, one per vault, and the move is a conversion from one to the other.
- Protected values use a dedicated secret type with limited lifetime and no logging or accessibility exposure. The scaffold keeps secrets in plain `String` view state, which is acceptable for fictional data only.
- Plan an external security audit before 1.0. Nothing in the vault, extension boundary or importers ships on a self-review alone.

- Maintain one Swift and SwiftUI application codebase across Mac, iPhone and iPad. The scaffold currently packages that code with two app targets, each embedding its platform’s provider. Prefer one multiplatform app target if both destinations can embed and sign their provider using platform-specific settings. Confirm that during the signed feasibility spike. Use WebExtension resources as required by browsers.
- Standard cryptographic primitives only, and no new primitive. The vault protocol is our own (decided 2026-11-23, reversing “no custom crypto protocol”): the [record log](format.md) composes HPKE, Argon2id, HKDF, one AEAD and Ed25519, is published with test vectors, and gets an independent review before real logins depend on it. KeePass documents stay interoperable through import and export.
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

- [x] **The provider fell back to a plain-text store when it found no vault.** Fixed 2026-11-23: with no vault the provider shows the not-ready screen and writes nothing; the sample vault is in memory only and registers no suggestions; the JSON file store is gone from the apps and the provider and a leftover file is deleted at start; the browser prototype's store (`BrowserPrototypeStore`) works only inside the native messaging host, so the apps and the Safari extension answer credential requests with `unsupported`. Checked hostless: no file appears anywhere when the browser protocol is called with no store. The provider screens still need a simulator.
- [~] **Matching could release a login to the wrong site.** The rule is built and independently probed (see [autofill](autofill.md#decisions)). Open: plain `http` pages in the provider, and other logins one tap from release with no site named.
- [x] **The conflict check could be skipped and was not atomic.** Fixed 2026-11-23: one coordinated block reads, compares and writes; a file that exists but cannot be read, or that disappeared under an open vault, is refused with or without Overwrite; a rollback copy is kept only after a successful write. With two and three processes writing for eight seconds every reported save was present and none of some 900 observed file states was unreadable. Saving to a file opened in place from iCloud Drive still needs a device.
- [x] **Rollback copies kept the old password.** Fixed 2026-11-23: a password change is all-or-nothing (a failed change leaves the old password, the copies and the saved biometric key as they were) and a successful one removes every rollback copy for that vault.
- [ ] **Mac Touch ID is a prompt in front of an unprotected Keychain item.** Do not offer it for real vaults on Mac until the data protection keychain works in a signed build, and switch on the hardened runtime.
- [ ] Read the Keychain item's access control back on a physical device, and confirm it is gone after re-enrolling Face ID and after removing the passcode.

### Before TestFlight

- [ ] A hostile vault file can ask for 4 GiB of Argon2 memory or 2^40 AES rounds before anything is authenticated, and file size is uncapped. Cap memory, passes, rounds and size, make the KDF cancellable, and name the numbers when a vault is unusually expensive.
- [ ] KDBX 3.1 files: the header hash in `Meta` is never checked, and a protected value with bad base64 is read as empty without advancing the key stream, which garbles every later secret and writes the damage back on the next save. Verify the hash and treat bad base64 as corruption.
- [ ] No privacy cover: the app switcher snapshot shows the vault list, and a revealed password stays revealed. Cover when the scene is not active and clear reveals.
- [x] The provider released by record identifier alone. Now `ReleaseCheck` requires a login whose site matches the request, and for a passkey the same relying party and credential, with hostless tests (2026-11-23).
- [x] A biometric error that was not a cancel deleted the saved key. Now only “no enrolled biometry” and a missing item do; a lockout leaves the key and the setting, and the lock screen asks for the password this once. A key made stale by another app is saved again on the next password unlock (2026-11-23). The real Keychain paths need a device.
- [ ] A failed save is still shown in the list as saved, and the new reload on return can drop the edit a conflict alert is still asking about.
- [x] The unused composite key is no longer kept in the open document (2026-11-23).
- [~] Passkeys always claim to be synced (backup flags set): open. Signing now refuses a request whose relying party differs from the stored one (2026-11-23).
- [ ] After a CSV import, say the export is unencrypted and offer to delete it.
- [ ] Smaller: the generator's forced lowercase letter can overwrite the forced capital; control characters in a secret are dropped on save; Keychain items outlive an uninstall; the Mac clipboard clears only while the app runs; note text has autocorrect on; the Safari extension holds the App Group entitlement it should not need.
- [ ] The browser host and the Safari handler answer any request with no unlock, trust a caller-supplied “manual” flag to release a secret to any origin, and the host's caller check is not authentication. They stay out of any build that handles real data until they relay to the unlocked app.

Test builds only: the hostless scripts compile with `HOSTLESS_TESTS`, which swaps the Keychain for an in-memory table, drops the file-protection class and lets `PSSS_TEST_ROOT` move vault storage under `build/`. No Xcode configuration defines the flag, and the built app, provider and Safari extension binaries contain no trace of the variable. Keep it that way: a storage override in a real build would be a vulnerability.

### Found sound

Every path in the provider that returns a secret goes through the unlock, and fill without interaction always asks for the interface. On iOS the key is device-only, tied to the enrolled biometry, with no passcode fallback. KDBX 4 files are authenticated before use: header hash, header HMAC and every block HMAC including the last, with constant-time comparison and bounded lengths. Every save draws a fresh master seed, IV and inner stream key from the system generator. XML parsing resolves no external entities and caps depth and node count. Argon2, Blake2b, ChaCha20 and Salsa20 read correctly against their RFCs. The app logs nothing, uses no network, and copies with a local-only, expiring clipboard.

### Tests to add

Hostless: the matching table; hostile files (every header byte flipped, truncation at every offset, KDF caps, inflation limit, XML limits, a tampered 3.1 header hash); written bytes contain no known secret and differ between saves; two stores interleaving, a write when the read fails, and no rollback copy opening with the old password; Blake2b, Argon2, ChaCha20 and Salsa20 against reference implementations across lengths and parameters; passkey authenticator data and signature; one-time codes against RFC 6238; the generator's guarantees over many runs; CSV edge cases.

### First-party crypto

The reviewer's view, for the gate: keep the Swift primitives and add the differential tests above. A wrong KDF fails loudly, since files from other apps would not open and Psss's own are checked against KeePassXC, and vendoring the reference C adds unsafe memory that the audit must cover anyway. Revisit only if S2 shows Argon2 is too slow on the oldest phone.
