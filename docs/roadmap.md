# Roadmap

This is the single sequencing document. Concern documents keep decisions and their own checklists; this file decides what happens first and what is cut. Reordered on 2026-11-22: the project had a polished navigation shell and no vault, no crypto and no working AutoFill, so the plan now burns down the existential risks before any more interface work.

## What changed and why

| Before | Now | Reason |
| --- | --- | --- |
| Product defined as a migration tool for 1Password and Strongbox users | Product is the simplest full-featured Apple password manager. Migration is an onboarding feature | Apple Passwords users who need cards, notes and attachments are a larger and less served group than people already invested in two competitors. |
| Next step: observe five people on the HTML prototype | Next step: signed feasibility spikes on real devices | Fill, save, extension memory and sync conflicts decide whether the product exists. Interface comprehension does not. |
| "KeePass entry" is a top-level item type | "Custom item" in the interface. KeePass terms live only in import, export and advanced settings | KeePass vocabulary contradicts "simpler". |
| Passkeys and verification codes not in any milestone | Both required before the first TestFlight | Apple Passwords has them. A manager without them is not better. |
| Chrome and Firefox adapters planned for 1.0 | Deferred. 1.0 covers Safari and the system provider | Native messaging from a sandboxed App Store app is the highest-cost, lowest-certainty work in the plan. |
| macOS 15 and iOS 18 floor | Prototype on macOS 27 and iOS 27, the latest. Choose the shipping floor, likely one release back, in spike S3 | A new app has no installed base to protect during prototyping. Newer provider APIs and the current design language outweigh the lost audience. |
| iCloud sync as a late feature | Sync correctness is a gate for TestFlight, with the storage decision made in M0 | Conflicted file copies are the reason people leave file-based managers. |
| HTML prototype kept as a design tool | Frozen. The native app is the prototype | Duplicate maintenance, and it cannot test the system AutoFill surface. |

## M0 · Risk burn-down

Goal: decide, with evidence, whether KDBX stays the storage format, and prove one real fill on a device. Time-box to four weeks. Use disposable vaults only.

- [ ] **S1 Codec.** Read and write KDBX 4.x with Argon2d/id and AES-KDF, ChaCha20 and AES, password and key file. Open fixtures made by KeePassXC and Strongbox, mutate, save, reopen in both. Choose between an audited existing library and a new Swift implementation, and record licenses.
- [ ] **S2 Extension budget.** Measure unlock time and peak memory inside the AutoFill extension on the oldest supported iPhone. Prototype wrapping the derived vault key in the Keychain behind biometrics, so the extension decrypts without running the KDF. This is the preferred design if the KDF does not fit.
- [ ] **S3 Signed fill.** Signed app and provider with matching entitlements. Register identities, fill a password, a passkey and a verification code in Safari and one native app on iPhone and Mac. Record whether save and update requests are available on the floor OS.
- [ ] **S4 Sync.** Two devices edit one iCloud Drive file offline and reconnect. Measure how often a conflict appears and whether entry-level merge using KeePass history and timestamps resolves it without asking.
- [ ] **S5 Packaging.** Confirm one multiplatform target or two targets, embedded provider on both, Mac App Store sandbox.
- [ ] **S6 Key custody.** Threat-model and prototype a generated recovery phrase with a Keychain-held vault key behind biometrics, with iCloud Keychain sync and device-only variants. Choose the default. See [experience](experience.md#key-custody-the-largest-design-bet).
- [ ] **S7 Multiple vaults.** With two disposable vaults in one App Group, prove that one device-owner unlock opens every Keychain-wrapped vault inside the extension's memory and time budget, that the identity store can carry a vault identifier in `recordIdentifier`, and that a vault protected by its own password or key file stays locked until asked for. See [vaults](vaults.md#multiple-vaults).
- [ ] **Decision gate.** Write the storage decision into [vaults](vaults.md). Fall back to a private store plus KDBX import and export if S2 or S4 fails and cannot be mitigated. Record dependencies, licenses and KDF budgets in [architecture](architecture.md).

## M1 · Daily driver (private alpha, owner dogfoods)

Goal: the owner moves their real day-to-day sign-ins into Psss.

- [ ] Replace the flat `VaultItem` with the field-based domain model and a `VaultStore` boundary. KDBX is a codec behind it. Protected values use a dedicated secret type with limited lifetime, not plain `String` in view state.
- [ ] Create vault with the S6 key-custody default, biometric unlock, auto-lock. Custom master password stays available.
- [ ] Screens 1, 2, 5 and 10 from [experience](experience.md#screens-and-goals): fill sheet, save prompt, unlock, search-first home, item detail, inline generator.
- [x] Screens 6 and 7 (search-first home, copy-first detail with live verification code) in the native sample app; builds on both platforms, not yet checked visually or on an iOS 27 simulator.
- [x] Pill overflow fade, Vault root screen removed on iPhone, copy-expiry notice, 44 pt rows, pinned New button (see [experience](experience.md)).
- [ ] Remaining from the [iPhone review](experience.md#review-of-the-iphone-build-2026-11-22): group repeated titles, “More” section on detail.
- [x] Passkey create and sign-in prototyped and verified in the simulator (see [autofill](autofill.md#prototype-status-2026-11-22)).
- [ ] Mac: add File, New Login (⌘N) and the other kinds as menu commands, and re-verify the toolbar, inset list and sidebar-first layout in the running Mac app (the last pass was reviewed from a screenshot and built, not driven).
- [ ] AutoFill: ask for the username in the save sheet, test save-on-submit with a typed username, tidy host-derived titles, and verify on a physical device (needs a provisioning profile with the AutoFill entitlement).
- [ ] Multiple vaults, in the order listed in [vaults](vaults.md#multiple-vaults): vault registry and per-vault store, one unlock for all device-key vaults, default vault, vault-aware AutoFill, then the screens in [experience](experience.md#multiple-vaults-screens-and-steps-affected). Single-vault people never see a vault control.
- [ ] Mac: lock after inactivity (Apple Passwords locks after about a minute without use). Locking on sleep, a sleeping display and a locked screen is done; inactivity is not.
- [ ] Characteristics: row badges and filters exist for passkey, verification code and notes. Add “Needs attention” (reused, weak, found in a breach) once the audit exists, with the same badge and filter pair.
- [ ] Mac menu bar quick access with a global shortcut.
- [ ] Items: login with verification code, passkey, card, note, custom item. Generator. Fill on selection. Save new and update changed passwords.
- [ ] Import: Apple Passwords export (CSV and, if available, Credential Exchange), then Strongbox open-in-place.
- [ ] Hostless unit tests for codec, importer and matching. Deterministic previews for locked, empty, save review, failed write.
- [ ] Origin matching tests, including subdomains, ports, frames and lookalike hosts.

## M2 · TestFlight beta

Goal: five people outside the project fill, save and find a login without guidance.

- [ ] iCloud Drive vaults with the M0 sync decision implemented, encrypted rollback copies and a visible restore path.
- [ ] Import: 1Password 1PUX and CSV with preview and loss report.
- [x] Bundled brand icons (top ~1000, offline, see experience.md).
- [ ] Optional site icons for everything else: off by default, fetched directly from the site, cached in the vault as KeePass custom icons.
- [ ] Screens 3, 4, 8, 9, 12, 13, 14 and 15 from [experience](experience.md#screens-and-goals): first launch, import, add by paste or scan, in-place edit, sync and Pro, conflict, recently deleted, settings.
- [ ] Attachments, groups as folders, expiry. Entry history is stored but its interface is deferred. Recently deleted covers undo.
- [ ] Setup: one screen to enable AutoFill. Fewer than ten settings in total.
- [ ] Accessibility and keyboard pass. String Catalog. iPad regular width.
- [ ] Observe five people on TestFlight builds: two from Apple Passwords, two from 1Password, one from Strongbox. Record time to first fill, first wrong turn and wording they look for.
- [ ] Internal security review of origin policy, secret lifecycle and importers.
- [ ] Safari Web Extension only for gaps the system provider cannot cover, as proven in S3.

## M3 · 1.0 on the App Store

- [ ] External security audit of the codec, extension boundary and importers. Fix findings before launch.
- [ ] Rename Xcode targets, schemes, folders and bundle identifiers from KDBOX to Psss in one change, after the domain is registered.
- [ ] Pricing and licensing decided and implemented. See open decisions.
- [ ] Privacy disclosures with no analytics, support page, seeded review vault, export compliance, reproducible archives.
- [ ] Published tested-coverage grid for fill, save and update by OS and browser.

## Later, in priority order

1. Chrome, Edge and Firefox through the system provider if it works, else adapters.
2. Credit card checkout fill beyond single fields, per verified surface.
3. Breach and weak-password checks computed on device.
4. Entry history interface, Apple Watch, 1PIF import.
5. Sharing and teams, SSH keys, Windows, Android, web, hosted sync. Not planned. Revisit only with evidence of demand.

## Open decisions

| Decision | Options | Owner input needed |
| --- | --- | --- |
| Final prices | Leading option is $19.99 per year or $49.99 lifetime with Family Sharing. Confirm at M2 and set regional price points. | Yes. Gate: before M2 so beta testers see the real offer. |
| Domain, marks and brand architecture | Register psss.app. Decide whether Psss is the collection name (passwords.psss.app, photos.psss.app) and how the photo app's working name fits. Choose bundle identifiers once for both apps. | Yes. Gate: before bundle identifiers are registered for distribution. |
| Mac distribution | Mac App Store only, or also notarized direct download. Direct download unlocks native messaging for other browsers. | Revisit after S5. |
| Storage format | KDBX canonical or private store with KDBX import and export. | Decided at the M0 gate. |

## Decisions log

| Date | Decision | Evidence |
| --- | --- | --- |
| 2026-11-22 | Product named Psss; psss.app planned. | Owner. |
| 2026-11-22 | Product philosophy and commercial approach follow the sibling photo app. | [product](product.md). |
| 2026-11-22 | Business model adopted: free single-device vault and Psss Pro for sync, as $49.99 lifetime or $19.99 per year, with Family Sharing. An annual option was added after owner input, and the photo app's copy changes to “no subscription required”. | [product](product.md#business-model). |
| 2026-11-22 | Several vaults are supported. Local vaults on one device are free in any number; Psss Pro syncs them. One device-owner unlock opens every vault whose key is Keychain-held; a vault with its own password or key file asks separately. Proposal, confirm before M2. | [vaults](vaults.md#multiple-vaults). |
| 2026-11-22 | The app always asks for device-owner authentication (Face ID, Touch ID or passcode), with no switch to turn it off, as Apple Passwords does. | [autofill](autofill.md#unlock-prototype). |

## Platform gaps

- Save and generate password requests from the system (Safari signup prompts) exist for third-party providers on iOS 26.2+ only. macOS has no equivalent API, so on Mac the app offers Add login and the generator inside the app. Revisit each macOS release.

- [ ] Onboarding gaps: open a .kdbx from Files or iCloud Drive, 1Password .1pux import, Credential Exchange import, and a real encrypted new vault (today Create makes an empty prototype vault).
