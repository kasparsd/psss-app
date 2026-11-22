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
| What Psss Pro sells is undefined | Open a vault file edits a `.kdbx` in iCloud Drive in place, free, on any number of devices | Settled on 2026-11-23: sync is free and there is no Pro |
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

Goal: prove one real fill on a device from a KDBX vault, and find with evidence what the AutoFill extension and sync need to work within KDBX. Time-box to four weeks, ending 2026-12-20. Use disposable vaults only.

- [~] **S0 Real vault in the provider.** (iOS provider built 2026-11-22: App Group storage, shared Keychain item, transformed key, no KDF. Independently re-run the same day on a fresh iPhone 17 Pro simulator, iOS 26.5, ad-hoc signed: create a vault, accept Face ID, add a login, fill it in Safari, save from a sign-up page, create and use a passkey, and the not-ready screen with Face ID off all worked. The vault file in the App Group is KDBX with no readable user name or password, and no plain-JSON file is written. Codec tests pass, 70 checks including KeePassXC interop, and both schemes build. Not verified: a physical device, the Mac provider (the Mac app's vault and Touch ID unlock are checked, the provider is a stub), unlock by vault password in that run, iPad. Open: the defects below, in-place vaults, Safari and browser host, remove the file store.) The vault Psss creates moves to the App Group container, and its unlock key to a Keychain access group both processes share. The provider opens the real vault without running the KDF, registers identities from it, and fills a password and a passkey (verification codes have no code path yet and belong to S3). Saves, new passkeys and sign counts are written to the KDBX through the same coordinated write, and the app reloads when the extension wrote. Then delete `SharedVault`'s file store and make the sample vault read-only and in memory. Observed 2026-11-23 with KeePassXC 2.8.0: KeePassXC rewrites the KDF seed on every save, for Argon2id, Argon2d and AES-KDF, in KDBX 3.1 and 4 files, so a saved transformed key stops working after any KeePassXC save and after a password change. Psss's own saves keep the seed, including the 3.1 to 4.1 upgrade, so a vault only Psss writes keeps working. KeePass 2 and Strongbox are unverified.
  Defects found by the re-run and a code review, to fix before S0 is ticked. Fixes were written on 2026-11-23 and checked by a separate validation run on a fresh simulator (codec tests 86 checks passing twice, both schemes building with no Swift warnings):
  - [~] **Identities.** The app now registers them for the real vault after unlock, save, delete, import and reload, and removes them when the vault is forgotten. Still failing: a passkey or login the extension itself saves is not offered by the system until the app next comes to the foreground, although the extension now waits for registration before it completes. Cause not found; candidates are the identity store reporting not enabled inside the extension, a swallowed error, or the system ignoring a replace from the extension during a request.
  - [x] **A failed vault write is no longer reported as saved.** With the vault read-only, a sign-up save showed “Can't save this login” and the vault was unchanged, and a passkey was not created.
  - [x] **The app reloads after the extension wrote.** Back in the app the new login was there, with no conflict.
  - [x] **Use counts are device-local.** Marking an item used wrote `Usage/<vault>.json` and left the vault file alone. Rollback copies are named to the millisecond, and the Modified row in Setup updates.
  - [ ] **A failed write still makes a rollback copy,** so three failed saves pushed three good copies out of the five kept. Keep a copy only after the write succeeded.
  - [ ] **A failed passkey save can leave a blank sheet** with nothing to tap (seen once in three tries). Show the same “not saved” screen as for a login.
  - [ ] Smaller: saves from a sign-up page are all titled by host, so repeated sign-ups look identical; a stale “already saved” sheet reappeared when Safari was reopened; Recent showed only the passkey item after extension saves; focusing the app's own password field brings up the system strong-password sheet.
  - [ ] **The Safari handler and browser host still serve the plain-text prototype store,** and both Safari extension targets are embedded in the apps. A sign-up save there writes `saved-logins.json` unencrypted, and nothing is asked before a secret is returned. Until they read the encrypted vault they answer `unsupported` when a real vault exists.
  - [ ] Sample items get fixed identifiers. They are random per process today, so a keyboard suggestion for a sample item probably cannot be resolved by the extension (inferred, not run).
- [~] **S1 Codec (first pass, 2026-11-22).** First-party KDBX 3.1 read and 4.x read/write checked against KeePassXC 2.8; Strongbox fixtures, unsupported-feature detection for Twofish and the audit remain. Original text: Read and write KDBX 4.x with Argon2d/id and AES-KDF, ChaCha20 and AES, password and key file. Open fixtures made by KeePassXC and Strongbox, mutate, save, reopen in both. Choose between an audited existing library and a new Swift implementation, and record licenses.
- [ ] **S0b Repeatable smoke run.** First decide the driver: a script cannot tap Safari's keyboard bar or the system AutoFill sheets through `simctl` alone, so it is either a UI test target plus `simctl`, or a written checklist in [development](development.md) that an agent walks with the simulator tools, as the two validation runs did. Then one run that builds the ad-hoc signed simulator app on a fresh simulator and walks the S0 flow: create a vault, accept Face ID, add a login, fill in Safari, save from sign-up, create and use a passkey, Face ID off shows the not-ready screen, return to the app and see the saved login, unlock by vault password. It checks the vault file is KDBX with no readable secrets. Run it before every commit that touches the vault, the Keychain or the provider. Add iPad once it passes on iPhone.
- [ ] **S2 Extension budget.** Measure unlock time and peak memory inside the AutoFill extension on the oldest supported iPhone, with a small vault and one of a few thousand entries. The design is built: the transformed key sits in the Keychain behind biometrics and the extension decrypts without running the KDF (2026-11-22). When another app rewrote the KDF seed the key fails (observed with KeePassXC). Decided: keep the transformed key and never put the composite key in the shared Keychain item, since it opens every copy of the file and would make the extension run Argon2. To build: save the key again on the next successful password unlock when Face ID is on, offer Face ID again instead of leaving it off, and have the lock screen say the vault was changed elsewhere so the password is needed once. The extension shows its not-ready screen until then.
- [ ] **S3 Signed fill.** Needs a paid Apple Developer Program team: the AutoFill credential provider capability is not offered to free accounts on either platform (Apple's capability tables, checked 2026-11-23). Signed app and provider with matching entitlements and throwaway identifiers. Build the Mac provider (it is a stub): password fill needs macOS 11, passkeys macOS 14, verification codes macOS 15 and iOS 18 (`ProvidesOneTimeCodes`); macOS has no save or generate request (SDK headers). On Mac, the app and provider share a Keychain item only through the data protection keychain with an access group a provisioning profile authorises, and on macOS 15 and later an extension is refused the App Group container unless the group ID is team-prefixed, profile-authorised or the build is from the Mac App Store, so use a team-prefixed group on Mac and test it first. Then register identities and fill a password, a passkey and a verification code in Safari and one native app on iPhone and Mac. There is no separate update request: `ASSavePasswordRequest` carries the event (typed, form gone, generated password filled). The checks that only a signed device can settle are listed in [autofill](autofill.md#what-only-a-signed-device-can-settle).
- [ ] **S4 Sync.** Before the test: usage out of the file (built, being validated), entry modification times that always move forward, history without same-second collisions, deleting into the Recycle Bin, the read, compare and write in one coordinated block with no skipped check when the read fails, and no ignored write failures in the extension. Build an entry-level merge: match by identifier, merge field by field against the newest revision both sides share in history, and ask only when the same field changed differently on both sides or an edit meets a delete. Hostless first: merge in both orders gives the same content, merging twice changes nothing, no edit is lost, and the result agrees with `keepassxc-cli merge` where the cases overlap. Then on real devices, iPhone, iPad and Mac on one Apple Account, with a file opened in place from iCloud Drive and, with the signing team, a file in Psss's own iCloud container: no lost edit in 200 scripted rounds each, no prompt for edits to different fields, adds or one-sided changes, no visible conflicted copy in the container, and convergence times recorded. Include atomic against in-place writes, a file not downloaded, an interrupted upload and KeePassXC saving the same file. KDBX stays whatever the result; a failure means changing how Psss writes and merges, not the format. Design and protocol in [vaults](vaults.md#sync-and-merge-design-2026-11-23).
- [ ] **S5 Packaging.** Confirm one multiplatform target or two targets, embedded provider on both, Mac App Store sandbox.
- [ ] **S6 Key custody.** Threat-model and prototype a generated recovery phrase with a Keychain-held vault key behind biometrics, with iCloud Keychain sync and device-only variants. Choose the default. See [experience](experience.md#key-custody-the-largest-design-bet).
- [ ] **S7 Multiple vaults.** With two disposable vaults in one App Group, prove that one device-owner unlock opens every Keychain-wrapped vault inside the extension's memory and time budget, that the identity store can carry a vault identifier in `recordIdentifier`, and that a vault protected by its own password or key file stays locked until asked for. See [vaults](vaults.md#multiple-vaults).
- [ ] **Decision gate, 2026-12-20.** KDBX stays (decided 2026-11-23, see the decisions log), so the gate no longer chooses a format. It records, in [vaults](vaults.md), what S2 and S4 measured and the mitigations chosen inside KDBX where they fell short: for the extension, the Keychain-held key and smaller reads; for sync, entry-level merge and what Psss manages itself. It also decides the first-party crypto question and the shipping OS floor. Record dependencies, licenses and KDF budgets in [architecture](architecture.md).

## M1 · Daily driver (private alpha, owner dogfoods)

Goal: the owner moves their real day-to-day sign-ins into Psss.

- [ ] **Security findings that gate real logins** (independent review, 2026-11-23, listed in [architecture](architecture.md#security-review-2026-11-23)): the provider's plain-text fallback when no vault exists, site matching and the one-tap other logins, the conflict check that can be skipped and is not atomic, rollback copies that keep the old password, and Touch ID on Mac. No real logins, the owner's or anyone else's, before these are closed and the Keychain item is checked on a physical device. The findings that gate TestFlight are in the same section.

- [ ] Replace the flat `VaultItem` with the field-based domain model and a `VaultStore` boundary. The field set, which fields repeat, revisions, the Recycle Bin and the created and edited dates are specified in [items](items.md#field-model-evaluation-of-2026-11-23), with an order of work and eight open decisions; its codec steps (dates, history, one-time code parameters, card validation) are not interface polish and may start before the gate. KDBX is a codec behind it. Protected values use a dedicated secret type with limited lifetime, not plain `String` in view state.
- [ ] Create vault with the S6 key-custody default, biometric unlock, auto-lock. Custom vault password stays available.
- [x] Lock screen: Face ID and Touch ID unlock behind a Keychain-saved key, a "What is this?" explainer and lost-password help (2026-11-22). The saved key is the transformed key. Open: S2 extension budget on a device, S6 recovery phrase and iCloud Keychain, Mac Touch ID on a real vault, Apple Watch. Details in [vaults](vaults.md#lock-screen-2026-11-22).
- [ ] Screens 1, 2, 5 and 10 from [experience](experience.md#screens-and-goals): the fill sheet and save prompt exist in the provider and the unlock screen exists; the inline generator on the editor's password field does not.
- [x] Screens 6 and 7 (search-first home, copy-first detail with live verification code) in the native sample app; checked on iPhone 17, iPad Pro 11-inch and Mac on iOS 26.5 (see [experience](experience.md)); not on an iOS 27 runtime.
- [x] Pill overflow fade, Vault root screen removed on iPhone, copy-expiry notice, 44 pt rows (see [experience](experience.md)).
- [ ] Remaining from the [iPhone review](experience.md#review-of-the-iphone-build-2026-11-22): group repeated titles, “More” section on detail.
- [~] Passkey create and sign-in work from the real vault in the simulator; the identity fix that lets the system offer the new passkey directly is being validated. Earlier prototype (see [autofill](autofill.md#prototype-status-2026-11-22)).
- [ ] Mac: File, New Login (⌘N) and the other kinds exist as menu commands. Still to do: re-verify them, the toolbar, inset list and sidebar-first layout in the running Mac app (the last pass was reviewed from a screenshot and built, not driven).
- [ ] Mac entitlements file for the app and the provider: sandbox with user-selected read and write and app-scoped bookmarks, the App Group (team-prefixed), the AutoFill credential provider capability and the Keychain group. Part of S3, and what opening a vault file on Mac depends on.
- [ ] Hostile vault files: cap the KDF memory and the inflated size a file may ask for to what the extension can afford, and add malformed and truncated-file tests. The Argon2 memory read from a file is only overflow-checked and inflation allows 1 GiB.
- [ ] Setup shows placeholder rows (the AutoFill section says it is a preview, and the sample vault lists three inert vault lines). Remove or implement them: they break “truthful language” and “one screen to enable AutoFill”.
- [ ] Mac biometric key: Keychain-enforced Touch ID (data protection keychain, needs the signed build from S3) instead of an app-side prompt in front of a login keychain item. Required before real logins go in.
- [ ] Matching: public suffix list, no parent-host fill, and other logins in the fill list behind a deliberate step with the site named (rule in [autofill](autofill.md#decisions)). Remove the stale “The prototype has no unlock step yet.” line from the fill confirmation.
- [ ] Text sizes and colour: eleven `.caption` and `.footnote` uses and five `.subheadline` in `VaultView`, `VaultFileViews`, `WelcomeView` and the provider break the two-sizes rule in AGENTS.md, and red text is used for errors that are not deletions (`VaultFileViews`, the editor). Bring every screen to a title and a body size, and keep red for deletion. Fix when the freeze lifts.
- [ ] Split `VaultView.swift` (1,250 lines) by screen when the field-based model lands.
- [ ] AutoFill: ask for the username in the save sheet, test save-on-submit with a typed username, tidy host-derived titles, and verify on a physical device (needs a provisioning profile with the AutoFill entitlement).
- [ ] Multiple vaults, in the order listed in [vaults](vaults.md#multiple-vaults): vault registry and per-vault store, one unlock for all device-key vaults, default vault, vault-aware AutoFill, then the screens in [experience](experience.md#multiple-vaults-screens-and-steps-affected). Single-vault people never see a vault control.
- [ ] Mac: lock after inactivity (Apple Passwords locks after about a minute without use). Locking on sleep, a sleeping display and a locked screen is done; inactivity is not.
- [ ] Characteristics: row badges and filters exist for passkey, verification code and notes. “Needs attention” (reused, weak, found in a breach) waits for the on-device audit under Later and is not M1 work.
- [ ] Mac menu bar quick access with a global shortcut.
- [ ] Items: the five kinds, fill on selection and save and update through the provider exist. Open: the generator inside the app's editor, and everything in the field model (custom fields, several websites, attachments).
- [x] Import: Apple Passwords CSV, and opening a KeePass or Strongbox file in place (no Strongbox fixtures yet).
- [ ] Import: Credential Exchange (iOS and macOS 26).
- [ ] 1Password 7 import, core: the 1PIF reader, a source-neutral import plan, a writer that puts entries straight into the KDBX file (custom fields, several websites, attachments, history, tags, groups, dates), the duplicate rule, fictional fixtures and a KeePassXC round trip. Codec work that may start before the gate. Needs the owner's throwaway 1Password 7 export to sign off. Plan in `docs/plans/1password-7-import.md`, summary in [migration](migration.md#1password).
- [ ] Hostless tests beyond the codec: site matching (subdomains, parents, public suffixes, ports, lookalike hosts), CSV import and one-time codes against the RFC 6238 vectors, which the docs claimed and no test checks. Then move `scripts/test-kdbx.sh` into an Xcode test target. Deterministic previews for locked, empty, save review and failed write; none exist.

## M2 · TestFlight beta

Goal: five people outside the project fill, save and find a login without guidance.

- [ ] iCloud sync, free: vaults Psss manages in its own iCloud container with entry-level merge, a file presenter that reloads on a remote change and clears resolved versions, sync status, a conflict screen for same-field edits and edit against delete, Recently Deleted and restore, and AutoFill reading the synced vault. Files opened in place get the same merge where Psss can reach them, and otherwise detect the change, keep both versions and offer Reload or Overwrite, which always keeps a rollback copy.
- [ ] Import: 1Password 7 screens (choose the export folder, counts, exceptions, one Import button, offer to delete the export) after an approved mock, with read-only custom fields and attachments on the detail page. 1Password 8 (1PUX) next.
- [x] Bundled brand icons (top ~1000, offline, see experience.md).
- [ ] Optional site icons for everything else: off by default, fetched directly from the site, cached in the vault as KeePass custom icons.
- [ ] Screens 3, 4, 8, 9, 12, 13, 14 and 15 from [experience](experience.md#screens-and-goals): first launch, import, add by paste or scan, in-place edit, sync, conflict, recently deleted, settings.
- [ ] Export, free: a KDBX copy (Save a Copy exists) and a CSV in the Apple Passwords layout with the one-time code column.
- [ ] Help: one Help screen and a Help menu entry, the same on every platform. None exists, and AGENTS.md asks for Help text with every cross-platform change.
- [ ] Attachments, groups as folders, expiry. Entry history is stored but its interface is deferred. Recently deleted covers undo.
- [ ] Setup: one screen to enable AutoFill, and on Mac, iPhone and iPad a step to enable the Safari extension. Fewer than ten settings in total.
- [ ] Accessibility and keyboard pass. String Catalog. iPad regular width.
- [ ] Observe five people on TestFlight builds: two from Apple Passwords, two from 1Password, one from Strongbox. Record time to first fill, first wrong turn and wording they look for.
- [ ] Internal security review of origin policy, secret lifecycle and importers.
- [~] Safari Web Extension bundled with both apps (builds unsigned). Remaining: run it in Safari with a signed build, add the enable-it onboarding step, and decide whether iPhone and iPad keep it before 1.0, since it adds little there today. See [browser extension](browser-extension.md#safari-bundled-with-the-app).

## M3 · 1.0 on the App Store

- [ ] External security audit of the codec, extension boundary and importers. Fix findings before launch.
- [ ] Rename Xcode targets, schemes, folders and bundle identifiers from KDBOX to Psss in one change, after the domain is registered.
- [ ] Monetization decided, if any, and implemented. See open decisions. Not a condition for publishing.
- [ ] Privacy manifest with the required-reason declarations (the app uses `UserDefaults`).
- [ ] Privacy disclosures with no analytics, support page, seeded review vault, export compliance, reproducible archives.
- [ ] Published tested-coverage grid for fill, save and update by OS and browser.

## Later, in priority order

1. Chrome, Edge, Firefox and other Mac browsers through the extension and native host prototyped in [browser extension](browser-extension.md). On iPhone and iPad the system provider is the only route, so test it per browser.
2. Credit card checkout fill beyond single fields, per verified surface.
3. Breach and weak-password checks computed on device.
4. Entry history interface, Apple Watch, 1Password 8 (1PUX) and OPVault import.
5. Family sharing (shared vaults, split-key recovery) and remote storage over WebDAV or S3-compatible endpoints, designed in [vaults](vaults.md#family-sharing-and-remote-storage-design-2026-11-23). Needs S4, S6 and S7 first.
6. Teams, SSH keys, Windows, Android, web, hosted sync. Not planned. Revisit only with evidence of demand.

## Open decisions

| Decision | Options | Owner input needed |
| --- | --- | --- |
| Monetization | Deferred by the owner on 2026-11-23. iCloud sync is free. How Psss earns money is decided after people use it, within the rules in [product](product.md#business-model): nothing a person stored, and no sync, fill or export, is ever gated. | Yes, later. No gate. |
| Domain, marks and brand architecture | Register psss.app. Decide whether Psss is the collection name (passwords.psss.app, photos.psss.app) and how the photo app's working name fits. Choose bundle identifiers once for both apps. | Yes. Gate: before bundle identifiers are registered for distribution. |
| Mac distribution | Mac App Store only, or also notarized direct download. Direct download unlocks native messaging for other browsers. The extension prototype ([browser extension](browser-extension.md#distribution-formats)) is ready for either, and the sandbox question is part of S5. | Revisit after S5. |
| Storage format | Decided 2026-11-23: KDBX is canonical and Psss does not roll its own store. Reopen only for an existing, proven option that is clearly better. | No. |
| Signing for the spikes | A paid Apple Developer Program team (the AutoFill provider capability is not available to free accounts) and throwaway identifiers for the app, provider, App Group, Keychain group and, for S4, an iCloud container. | Yes, by 2026-11-27. S0 on a device, S2, S3, S4's container runs and S5 wait on it, and the gate is four weeks out. |
| First-party crypto | Keep the Swift Argon2, Blake2b, ChaCha20 and Salsa20 and pay to audit them, or vendor the reference C Argon2 (which includes Blake2b) and audit less. Reverses “no custom crypto” either way until decided. | Decide at the M0 gate, before booking the audit. |

## Decisions log

| Date | Decision | Evidence |
| --- | --- | --- |
| 2026-11-22 | Product named Psss; psss.app planned. | Owner. |
| 2026-11-22 | Visual identity: outline field with a typed p and three dots, butter and charcoal, lowercase rounded wordmark. Remaining brand work is listed under open points. | Owner, [brand](brand.md). |
| 2026-11-22 | Product philosophy and commercial approach follow the sibling photo app. | [product](product.md). |
| 2026-11-22 | Business model adopted: free single-device vault and Psss Pro for sync, as $49.99 lifetime or $19.99 per year, with Family Sharing. Superseded on 2026-11-23. | [product](product.md#business-model). |
| 2026-11-22 | Several vaults are supported. Vaults are free in any number, synced or not. One device-owner unlock opens every vault whose key is Keychain-held; a vault with its own password or key file asks separately. Proposal, confirm before M2. | [vaults](vaults.md#multiple-vaults). |
| 2026-11-22 | The Safari web extension is bundled with the Mac, iPhone and iPad apps. It adds Mac generate and save on sign-up forms, a toolbar button and shortcut; the system provider keeps fill, passkeys and codes. | [browser extension](browser-extension.md#safari-bundled-with-the-app). |
| 2026-11-22 | Other Mac browsers are served by one shared WebExtension (popup, no content script, no host permission) with a native host, packaged per store. Prototype, outside 1.0. | [browser extension](browser-extension.md). |
| 2026-11-22 | The app always asks for device-owner authentication (Face ID, Touch ID or passcode), with no switch to turn it off, as Apple Passwords does. | [autofill](autofill.md#unlock-prototype). |
| 2026-11-22 | Interface, brand and browser-extension work is frozen until the M0 gate on 2026-12-20. The next work is the real vault in the provider (S0), signed on a device. | [Course correction](#course-correction-review-of-2026-11-22). |
| 2026-11-22 | Use counts and last-used dates are device-local, not written to the vault file. | They rewrote the file on every lock and rotated out the rollback copies. |
| 2026-11-23 | KDBX is the canonical storage format. No private store is built; the fallback is removed from the plan. Reopen only for an existing, proven alternative that is clearly better. | Owner. |
| 2026-11-23 | iCloud sync is free. There is no Psss Pro; monetization is deferred and stays an open decision. The purpose is the most secure and least frustrating experience, starting with the owner's family. | Owner. [product](product.md#purpose). |
| 2026-11-23 | Simplicity budget exceptions, recorded as the product contract requires: deleting is permanent and confirmed until Recently Deleted ships, and enabling AutoFill has no single screen yet. Both are open roadmap items. | Docs audit against the code. |
| 2026-11-23 | A ticked box means fully done. Items that were ticked with a “remaining” list are marked partly done. | Docs audit. |
| 2026-11-23 | Independent security review: no critical issue in the encrypted vault path; five findings gate real logins and eleven gate TestFlight. | [architecture](architecture.md#security-review-2026-11-23). |

## Platform gaps

- Mac browsers other than Safari: system AutoFill is not expected to reach Chrome or Firefox, so they depend on the extension prototype and are outside 1.0. Confirm the negative result once and record it in the coverage grid.

- Shipping floor from the SDK headers (2026-11-23): iOS 26.2 is the lowest version with password, passkey, verification code, save and generate; macOS 15 is the lowest with password, passkey and verification code. Recommended floor: iOS 26.2 and macOS 15, to confirm at the gate. Text insertion for single card fields is iOS 18 and later only, not macOS.

- AutoFill from a vault opened in place: a bookmark the app makes is valid only in the app's process, so the provider cannot use it. The options are a copy kept in the App Group or a document-scoped bookmark the extension resolves itself; both need a signed device to test. Until then only vaults Psss stores are filled.

- Save and generate password requests from the system (Safari signup prompts) exist for third-party providers on iOS 26.2+ and visionOS 26.2+ only (confirmed in the SDK headers). macOS has no equivalent API, so on Mac the app offers Add login and the generator inside the app, and the bundled Safari extension offers generate and save on sign-up forms in the page. Revisit each macOS release.

- [~] Create a real encrypted vault and open a .kdbx from Files in place (2026-11-22). Opening a file on Mac is unverified: the Mac targets have no entitlements file, so the sandboxed app may lack user-selected file access and bookmarks. Remaining onboarding gaps: 1Password .1pux import, Credential Exchange import, AutoFill from a vault opened in place (the extension reads only vaults Psss stores), the Mac provider, entry-level merge for files changed elsewhere, groups, attachments and the Recycle Bin.
- [ ] Recently Deleted: deleting is permanent in the prototype. The real vault keeps deleted items for 30 days with restore, as Apple Passwords and KeePass do.
