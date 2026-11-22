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

## Roadmap

- [ ] Verify multiplatform target packaging, extension embedding and signing on both platforms. [Apple’s Xcode multiplatform guidance](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target).

- [x] Establish native app and inert extension process boundaries in Xcode.

- [ ] Run M0 spikes and record results in this document.
- [ ] Record dependencies, licenses, KDF budgets and extension-process access model.
- [ ] Validate origin policy, secret lifecycle, importer behavior and cross-process races in a security review.
- [ ] Add accessibility, keyboard navigation and VoiceOver coverage before TestFlight.
