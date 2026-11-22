# Roadmap

This is the single sequencing document. Concern documents keep decisions and their own checklists; this file decides what happens first and what is cut. Reordered on 2026-11-22: the project had a polished navigation shell and no vault, no crypto and no working AutoFill, so the plan now burns down the existential risks before any more interface work. A review at the end of the same day found the work had not followed that order; see [Course correction](#course-correction-review-of-2026-11-22).

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

## Course correction (review of 2026-11-22)

The reorder above said risk first, interface later. The first day's 27 commits did the opposite: of the seven M0 spikes only S1 has evidence, while work landed on M1 and M2 polish (lock screen copy, row layout, brand icons, brand marks) and on the item ranked first under “Later” (a Chrome and Firefox extension with end-to-end suites). The codec and the lock screen are real progress. The product's one job, filling a sign-in from the person's own encrypted vault, still cannot happen.

| Gap | Evidence in the code | Consequence |
| --- | --- | --- |
| The real vault and AutoFill never meet | `CredentialProviderViewController`, `BrowserProtocol` and the Safari handler read `SharedVault` (sample items plus plain-JSON `saved-logins.json`). Identities are registered only when `store.isSample`. A vault Psss creates lives in the app's Application Support, which the extension cannot read | Someone who creates a vault gets no fill, no save and no passkeys. “First fill within three minutes” is impossible today |
| The Mac provider is a stub | The `#else` branch of the provider cancels every request | Half the product has no system fill. S3 cannot pass |
| Verification codes are not in the provider | No `ProvidesOneTimeCodes` capability and no one-time code credential | A TestFlight requirement has no code path |
| Nothing has run signed | Identifiers are `local.kdbox.prototype`, no team. All AutoFill evidence is from an ad-hoc simulator build | S2, S3 and S5 cannot start. This waits on the owner, not on code |
| Sync, the only paid feature, has no evidence, and one design choice works against it | `markUsed` then `flush` rewrites the whole file on every lock or background after a copy. `keepBackup` runs on every write and keeps five | Two devices that only read still produce conflicting files. Five copies or locks push every useful rollback copy out |
| What Psss Pro sells is undefined | Open a vault file edits a `.kdbx` in iCloud Drive in place, free, on any number of devices | The free tier already contains the paid feature. See open decisions |
| Plain-text secrets are still a supported path | The sample vault saves added and imported logins unencrypted in the App Group, and the Safari handler returns them with no unlock | Acceptable for fictional data only, and the interface invites real data |
| The differentiators are not in the model | `VaultItem` is flat: one secret, one website, no custom fields, no attachments, plain `String` secrets | “Cards, notes, custom items, attachments” is where Psss wins over Apple Passwords, and a custom item is a title and one value |
| Biometric key is weaker than described on Mac | Login keychain item with no access control; Touch ID is asked by the app, not enforced by the Keychain. The composite key is stored, which opens every copy of the file with that password | Fine for disposable vaults. Not for the owner's real logins (M1) |
| Matching is looser than the fill bar promises | `SharedVault.matches` accepts a parent or child host in both directions with no public suffix list, and the fill list offers every other login one tap away | “Wrong-site matches never appear” is not true yet |
| Tests cover the edges, not the middle | One `swiftc` script for the codec. No Xcode test target, nothing for matching, import, TOTP or the provider. The out-of-scope browser extension has three suites | Regressions in the trust boundary go unnoticed |

The table is the state at the review. Later the same day the first row was closed for iPhone in the simulator: the provider fills, saves and signs in with a passkey from the encrypted vault (S0 below has the evidence and the defects). What that run changes in this plan:

- The transformed key, not the composite key, is now what the Keychain holds, on both platforms. The Mac half of the “weaker on Mac” row stands.
- The plain-text path is no longer written for a real vault. It remains for the sample vault, the Safari handler and the browser host.
- Every result so far comes from a simulator with ad-hoc signing, driven by hand or by an agent. Nothing repeats on its own, so the flow can break unnoticed. A scripted simulator smoke run moves into M0 (below S0).
- The risks that decide the product are untouched by the run: extension memory and time on a real phone (S2), a signed device and the Mac provider (S3), and sync (S4). The run makes S0 nearly done; it does not move the gate.

### What changes

Accepted by the owner on 2026-11-22.

1. **Freeze** interface polish, brand work, the lock screen and all browser-extension work (Safari included) until the decision gate. Bug fixes only.
2. **One vertical slice on real data comes first** (S0 below). Every later spike measures that slice, not the sample vault.
3. **Signing is unblocked separately from naming.** Use a development team and throwaway identifiers now. The Psss identifiers are still chosen once, later.
4. **The gate has a date: 2026-12-20.** On that day the storage decision is written down with whatever evidence exists.
5. **Usage data leaves the synced file** before S4 runs, so the sync test measures real edits.

## M0 · Risk burn-down

Goal: decide, with evidence, whether KDBX stays the storage format, and prove one real fill on a device. Time-box to four weeks, ending 2026-12-20. Use disposable vaults only.

- [~] **S0 Real vault in the provider.** (iOS provider built 2026-11-22: App Group storage, shared Keychain item, transformed key, no KDF. Independently re-run the same day on a fresh iPhone 17 Pro simulator, iOS 26.5, ad-hoc signed: create a vault, accept Face ID, add a login, fill it in Safari, save from a sign-up page, create and use a passkey, and the not-ready screen with Face ID off all worked. The vault file in the App Group is KDBX with no readable user name or password, and no plain-JSON file is written. Codec tests pass, 70 checks including KeePassXC interop, and both schemes build. Not verified: a physical device, the Mac provider (the Mac app's vault and Touch ID unlock are checked, the provider is a stub), unlock by vault password in that run, iPad. Open: the defects below, in-place vaults, Safari and browser host, remove the file store.) The vault Psss creates moves to the App Group container, and its unlock key to a Keychain access group both processes share. The provider opens the real vault without running the KDF, registers identities from it, and fills a password, a passkey and a verification code. Saves, new passkeys and sign counts are written to the KDBX through the same coordinated write, and the app reloads when the extension wrote. Then delete `SharedVault`'s file store and make the sample vault read-only and in memory. Note for S2: a saved transformed key stops working when another app rewrites the KDF seed (KeePassXC is believed to on every save, check it), so files opened in place may need the password after each outside edit.
  Defects found by the re-run and a code review, to fix before S0 is ticked:
  - [ ] **Identities are registered only by the extension.** The app registers them for the sample vault alone (`VaultView`), so the keyboard suggests nothing until the provider has opened once, and edits or deletes in the app leave stale suggestions. Seen in the run: after “Passkey created”, the site's sign-in said no passkeys were saved, and it worked only through “More from Psss…”. Likely cause: the extension starts the registration and completes the request before it finishes. Register from the app after unlock and after every save or delete, and wait for it in the extension.
  - [ ] **The extension reports success when a vault write fails.** Saving a login and registering a passkey use `try?`. A failed passkey write hands the site a passkey Psss did not keep. Fail the request and say so.
  - [ ] **The app does not reload after the extension wrote.** Back in the app the new login is missing, and the next edit hits “The vault changed elsewhere”, where Reload discards that edit. Design in [vaults](vaults.md#decisions).
  - [ ] **Every passkey sign-in rewrites the vault file** for the use count. Covered by the device-local usage decision under S4, and needed here because the extension now writes.
  - [ ] Smaller: the Modified row in Setup stays at the old time after saves; saves from a sign-up page are all titled by host, so repeated sign-ups look identical; a second save request for the same login showed a disabled “already saved” sheet; focusing the app's own password field brings up the system strong-password sheet.
- [x] **S1 Codec (first pass, 2026-11-22).** First-party KDBX 3.1 read and 4.x read/write checked against KeePassXC 2.8; Strongbox fixtures, unsupported-feature detection for Twofish and the audit remain. Original text: Read and write KDBX 4.x with Argon2d/id and AES-KDF, ChaCha20 and AES, password and key file. Open fixtures made by KeePassXC and Strongbox, mutate, save, reopen in both. Choose between an audited existing library and a new Swift implementation, and record licenses.
- [ ] **S0b Repeatable smoke run.** One script that builds the ad-hoc signed simulator app on a fresh simulator and walks the S0 flow: create a vault, accept Face ID, add a login, fill in Safari, save from sign-up, create and use a passkey, Face ID off shows the not-ready screen, return to the app and see the saved login, unlock by vault password. It checks the vault file is KDBX with no readable secrets. Run it before every commit that touches the vault, the Keychain or the provider. Add iPad once it passes on iPhone.
- [ ] **S2 Extension budget.** Measure unlock time and peak memory inside the AutoFill extension on the oldest supported iPhone, with a small vault and one of a few thousand entries. The design is built: the transformed key sits in the Keychain behind biometrics and the extension decrypts without running the KDF (2026-11-22). Also settle what happens to that key when another app rewrites the KDF seed.
- [ ] **S3 Signed fill.** Signed app and provider with matching entitlements, on a development team with throwaway identifiers. Build the Mac provider (it is a stub) and add verification codes to both. Register identities, fill a password, a passkey and a verification code in Safari and one native app on iPhone and Mac. Record whether save and update requests are available on the floor OS.
- [ ] **S4 Sync.** First move use counts and last-used dates out of the vault file into device-local storage, and keep rollback copies only for writes that change content. Then: two devices edit one iCloud Drive file offline and reconnect. Measure how often a conflict appears and whether entry-level merge using KeePass history and timestamps resolves it without asking.
- [ ] **S5 Packaging.** Confirm one multiplatform target or two targets, embedded provider on both, Mac App Store sandbox.
- [ ] **S6 Key custody.** Threat-model and prototype a generated recovery phrase with a Keychain-held vault key behind biometrics, with iCloud Keychain sync and device-only variants. Choose the default. See [experience](experience.md#key-custody-the-largest-design-bet).
- [ ] **S7 Multiple vaults.** With two disposable vaults in one App Group, prove that one device-owner unlock opens every Keychain-wrapped vault inside the extension's memory and time budget, that the identity store can carry a vault identifier in `recordIdentifier`, and that a vault protected by its own password or key file stays locked until asked for. See [vaults](vaults.md#multiple-vaults).
- [ ] **Decision gate.** Write the storage decision into [vaults](vaults.md). Fall back to a private store plus KDBX import and export if S2 or S4 fails and cannot be mitigated. Record dependencies, licenses and KDF budgets in [architecture](architecture.md).

## M1 · Daily driver (private alpha, owner dogfoods)

Goal: the owner moves their real day-to-day sign-ins into Psss.

- [ ] Replace the flat `VaultItem` with the field-based domain model and a `VaultStore` boundary. KDBX is a codec behind it. Protected values use a dedicated secret type with limited lifetime, not plain `String` in view state.
- [ ] Create vault with the S6 key-custody default, biometric unlock, auto-lock. Custom vault password stays available.
- [x] Lock screen: Face ID and Touch ID unlock behind a Keychain-saved key, a "What is this?" explainer and lost-password help (2026-11-22). The saved key is the transformed key. Open: S2 extension budget on a device, S6 recovery phrase and iCloud Keychain, Mac Touch ID on a real vault, Apple Watch. Details in [vaults](vaults.md#lock-screen-2026-11-22).
- [ ] Screens 1, 2, 5 and 10 from [experience](experience.md#screens-and-goals): fill sheet, save prompt, unlock, search-first home, item detail, inline generator.
- [x] Screens 6 and 7 (search-first home, copy-first detail with live verification code) in the native sample app; builds on both platforms, not yet checked visually or on an iOS 27 simulator.
- [x] Pill overflow fade, Vault root screen removed on iPhone, copy-expiry notice, 44 pt rows, pinned New button (see [experience](experience.md)).
- [ ] Remaining from the [iPhone review](experience.md#review-of-the-iphone-build-2026-11-22): group repeated titles, “More” section on detail.
- [x] Passkey create and sign-in prototyped and verified in the simulator (see [autofill](autofill.md#prototype-status-2026-11-22)).
- [ ] Mac: File, New Login (⌘N) and the other kinds exist as menu commands. Still to do: re-verify them, the toolbar, inset list and sidebar-first layout in the running Mac app (the last pass was reviewed from a screenshot and built, not driven).
- [ ] Mac biometric key: Keychain-enforced Touch ID (data protection keychain, needs the signed build from S3) instead of an app-side prompt in front of a login keychain item. Required before real logins go in.
- [ ] Matching: public suffix list, no parent-host fill, and other logins in the fill list behind a deliberate step with the site named (rule in [autofill](autofill.md#decisions)). Remove the stale “The prototype has no unlock step yet.” line from the fill confirmation.
- [ ] Text sizes: about a dozen `.caption` and `.footnote` uses in `VaultView`, `VaultFileViews`, `WelcomeView` and the provider break the two-sizes rule in AGENTS.md. Fix them when the freeze lifts.
- [ ] Split `VaultView.swift` (1,250 lines) by screen when the field-based model lands.
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
- [ ] Setup: one screen to enable AutoFill, and on Mac, iPhone and iPad a step to enable the Safari extension. Fewer than ten settings in total.
- [ ] Accessibility and keyboard pass. String Catalog. iPad regular width.
- [ ] Observe five people on TestFlight builds: two from Apple Passwords, two from 1Password, one from Strongbox. Record time to first fill, first wrong turn and wording they look for.
- [ ] Internal security review of origin policy, secret lifecycle and importers.
- [x] Safari Web Extension bundled with both apps (builds unsigned). Remaining: run it in Safari with a signed build, add the enable-it onboarding step, and decide whether iPhone and iPad keep it before 1.0, since it adds little there today. See [browser extension](browser-extension.md#safari-bundled-with-the-app).

## M3 · 1.0 on the App Store

- [ ] External security audit of the codec, extension boundary and importers. Fix findings before launch.
- [ ] Rename Xcode targets, schemes, folders and bundle identifiers from KDBOX to Psss in one change, after the domain is registered.
- [ ] Pricing and licensing decided and implemented. See open decisions.
- [ ] Privacy disclosures with no analytics, support page, seeded review vault, export compliance, reproducible archives.
- [ ] Published tested-coverage grid for fill, save and update by OS and browser.

## Later, in priority order

1. Chrome, Edge, Firefox and other Mac browsers through the extension and native host prototyped in [browser extension](browser-extension.md). On iPhone and iPad the system provider is the only route, so test it per browser.
2. Credit card checkout fill beyond single fields, per verified surface.
3. Breach and weak-password checks computed on device.
4. Entry history interface, Apple Watch, 1PIF import.
5. Sharing and teams, SSH keys, Windows, Android, web, hosted sync. Not planned. Revisit only with evidence of demand.

## Open decisions

| Decision | Options | Owner input needed |
| --- | --- | --- |
| Final prices | Leading option is $19.99 per year or $49.99 lifetime with Family Sharing. Confirm at M2 and set regional price points. | Yes. Gate: before M2 so beta testers see the real offer. |
| Domain, marks and brand architecture | Register psss.app. Decide whether Psss is the collection name (passwords.psss.app, photos.psss.app) and how the photo app's working name fits. Choose bundle identifiers once for both apps. | Yes. Gate: before bundle identifiers are registered for distribution. |
| Mac distribution | Mac App Store only, or also notarized direct download. Direct download unlocks native messaging for other browsers. The extension prototype ([browser extension](browser-extension.md#distribution-formats)) is ready for either, and the sandbox question is part of S5. | Revisit after S5. |
| Storage format | KDBX canonical or private store with KDBX import and export. | Decided at the M0 gate, 2026-12-20. |
| Signing for the spikes | An Apple Developer team and throwaway identifiers for the app, provider, App Group and Keychain group. | Yes, now. S0 on a device, S2, S3 and S5 wait on it. |
| What Psss Pro unlocks | Opening a `.kdbx` from iCloud Drive in place is built and free, so “sync” alone is not a boundary. Recommended: a file the person brings stays free everywhere, with Reload or Overwrite when it changed. Pro is sync for vaults Psss manages: no file to place, entry-level merge, no conflict copies, restore. Alternative: gate a second device, which contradicts “a file you own”. | Yes. Gate: before S4 is designed, since it decides what S4 must prove. |
| First-party crypto | Keep the Swift Argon2, Blake2b, ChaCha20 and Salsa20 and pay to audit them, or vendor the reference C Argon2 (which includes Blake2b) and audit less. Reverses “no custom crypto” either way until decided. | Decide at the M0 gate, before booking the audit. |

## Decisions log

| Date | Decision | Evidence |
| --- | --- | --- |
| 2026-11-22 | Product named Psss; psss.app planned. | Owner. |
| 2026-11-22 | Visual identity: outline field with a typed p and three dots, butter and charcoal, lowercase rounded wordmark. Remaining brand work is listed under open points. | Owner, [brand](brand.md). |
| 2026-11-22 | Product philosophy and commercial approach follow the sibling photo app. | [product](product.md). |
| 2026-11-22 | Business model adopted: free single-device vault and Psss Pro for sync, as $49.99 lifetime or $19.99 per year, with Family Sharing. An annual option was added after owner input, and the photo app's copy changes to “no subscription required”. | [product](product.md#business-model). |
| 2026-11-22 | Several vaults are supported. Local vaults on one device are free in any number; Psss Pro syncs them. One device-owner unlock opens every vault whose key is Keychain-held; a vault with its own password or key file asks separately. Proposal, confirm before M2. | [vaults](vaults.md#multiple-vaults). |
| 2026-11-22 | The Safari web extension is bundled with the Mac, iPhone and iPad apps. It adds Mac generate and save on sign-up forms, a toolbar button and shortcut; the system provider keeps fill, passkeys and codes. | [browser extension](browser-extension.md#safari-bundled-with-the-app). |
| 2026-11-22 | Other Mac browsers are served by one shared WebExtension (popup, no content script, no host permission) with a native host, packaged per store. Prototype, outside 1.0. | [browser extension](browser-extension.md). |
| 2026-11-22 | The app always asks for device-owner authentication (Face ID, Touch ID or passcode), with no switch to turn it off, as Apple Passwords does. | [autofill](autofill.md#unlock-prototype). |
| 2026-11-22 | Interface, brand and browser-extension work is frozen until the M0 gate on 2026-12-20. The next work is the real vault in the provider (S0), signed on a device. | [Course correction](#course-correction-review-of-2026-11-22). |
| 2026-11-22 | Use counts and last-used dates are device-local, not written to the vault file. | They rewrote the file on every lock and rotated out the rollback copies. |

## Platform gaps

- Mac browsers other than Safari: system AutoFill is not expected to reach Chrome or Firefox, so they depend on the extension prototype and are outside 1.0. Confirm the negative result once and record it in the coverage grid.

- Save and generate password requests from the system (Safari signup prompts) exist for third-party providers on iOS 26.2+ only. macOS has no equivalent API, so on Mac the app offers Add login and the generator inside the app, and the bundled Safari extension offers generate and save on sign-up forms in the page. Revisit each macOS release.

- [x] Create a real encrypted vault and open a .kdbx from Files in place (2026-11-22). Remaining onboarding gaps: 1Password .1pux import, Credential Exchange import, AutoFill from a vault opened in place (the extension reads only vaults Psss stores), the Mac provider, entry-level merge for files changed elsewhere, groups, attachments and the Recycle Bin.
- [ ] Recently Deleted: deleting is permanent in the prototype. The real vault keeps deleted items for 30 days with restore, as Apple Passwords and KeePass do.
