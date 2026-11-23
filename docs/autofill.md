# AutoFill and browser integration

| Surface | First route | Verification required |
| --- | --- | --- |
| iOS Safari and apps | AuthenticationServices Credential Provider Extension | Test inline suggestions, picker, locked continuation and save/update on chosen OS versions. |
| iOS Chrome, Firefox, Edge | System provider. These browsers use WebKit and iOS AutoFill, and extensions do not exist outside Safari. | Record fill and save independently on physical devices. Chrome offers its own manager first. |
| macOS Safari and apps | System provider and system AutoFill menu where exposed, plus the bundled Safari extension for generate and save on sign-up forms (macOS has no system API for them) | Compare inline, menu and picker. Run the extension in a signed build. What it adds is in [browser extension](browser-extension.md#safari-bundled-with-the-app). |
| macOS Chrome, Edge, Firefox, Brave, Arc, Vivaldi | Shared WebExtension plus native host, prototyped and tested in Chrome, Firefox and Zen in [browser extension](browser-extension.md). The system provider is expected not to reach them: confirm once with the provider enabled, and test passkeys, which these browsers may route through the system. | Record real fill, locked behavior and signed installation for each browser. |
| Other macOS browsers | Document tested system surfaces and manual copy fallback. | Test by browser, version and form type before advertising coverage. |

System integration uses `ASCredentialProviderViewController`, credential identity registration and save capability flags as supported by the deployment OS. Index minimal service metadata and stable opaque record references. Resolve a reference and recheck the request origin before releasing the credential. Refresh identities after edits, external changes, removal and access revocation.

The Safari extension is an app extension target embedded in each app, with its own native handler. Chrome and Firefox use browser-specific host registration and distribution; test sandbox compatibility with an archive-installed build before committing to the delivery path. The extension mediates the active page and asks native Swift code for the selected credential or a proposed save. Verify connection identity, tab and frame origin at request and delivery, enforce user intent, and keep secrets out of extension storage. Browsers may call different paths for filling and saving. Treat them as separate capabilities.

[Apple Credential Provider API](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller), [Apple provider capabilities](https://developer.apple.com/documentation/bundleresources/information-property-list/nsextension/nsextensionattributes/ascredentialproviderextensioncapabilities), [Safari Web Extensions](https://developer.apple.com/documentation/SafariServices/safari-web-extensions), [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging).

## Payment cards and other fields

AuthenticationServices documents a user-selected text insertion path. Verify it as a single-field option. Test multi-field checkout fill in browser extensions separately and restrict delivery to the selected checkout origin and verified fields. Keep card data and notes out of password suggestions. OTP uses the dedicated one-time-code request when supported.

[Apple provider APIs](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller/), [Apple one-time-code AutoFill](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill).

## Decisions

- 1.0 covers Safari and apps through the system provider on iPhone, iPad and Mac. Other browsers on iPhone and iPad ride the system provider. Chrome, Edge, Firefox and other Mac browsers need the extension and native host in [browser extension](browser-extension.md), which is a prototype and stays out of 1.0 until its roadmap items are done.
- Bundle a Safari Web Extension with the apps on Mac, iPhone and iPad. Its reason to exist is Mac generate and save on sign-up forms, and it shares one source folder and one protocol implementation with the Chrome and Firefox prototype. On iPhone and iPad it duplicates the system prompts for now. See the comparison in [browser extension](browser-extension.md#safari-bundled-with-the-app).
- Passkeys and verification codes ride the same provider and are required for TestFlight.

- Prefer Apple’s integration anywhere it supports the intended action.
- Use a thin JavaScript adapter for WebExtension page interaction and Swift for native targets.
- Match conservatively across schemes, hosts, ports and frames. Keep manual selections explicit and revalidate on navigation.
- Matching rule (decided 2026-11-22, built 2026-11-23 in `App/Core/SiteMatch.swift` with the public suffix list generated into `App/Core/PublicSuffixList.swift`): a saved login is offered when its host equals the requested host, or the requested host is a subdomain of it. The subdomain case is refused, leaving an exact match only, when the saved host is a public suffix (`github.io`, `co.uk`), the parent of a wildcard rule (`compute.amazonaws.com`), a single label, a local name (`localhost`, `local`, `lan`, `internal` and the reserved test names), or an address (IPv4 in any spelling, IPv6). A login saved for a subdomain is never offered on its parent or a sibling. Hosts are compared after lowercasing, dropping a trailing dot and leading `www.` labels (kept when what remains is a public suffix), and converting international names to punycode. Anything malformed reads as no host and matches nothing: user info before the host, a backslash, `%`, whitespace or control characters in the host, empty labels, names over 253 characters, addresses with no network host such as `javascript:` or `file:`, a bare email address. An item whose website reads as no host is not registered with the system. An independent run of 362 adversarial cases found no way for a login to reach another party's site. `scripts/test-matching.sh` runs the suite and `scripts/build-public-suffix.py` refreshes the list (Mozilla Public License 2.0). `SiteMatch.related` (same registrable domain, not a match) is there for a later “related logins” hint.
- The scheme (built 2026-11-23, `App/Core/FillSite.swift`): when any service identifier the system passes is an `http` address for a host that is not this machine, the page counts as unencrypted. Its logins are then not offered automatically: they sit behind one labeled step and a confirmation that says anything filled can be read on the network. Limits: a suggestion picked from the keyboard carries only the stored domain, so the rule cannot apply there, and Safari may pass only a domain, in which case it never applies in Safari. Both need a signed build to find out.
- Showing a site name (`App/Core/HostDisplay.swift`): an international name is shown in readable form only when every part is made of letters, marks, digits and hyphens, is unchanged by Unicode's compatibility and lower-case forms, uses ordinary digits (or one non-Latin script with its own digits), and carries at most two accents per letter, each from the letter's own script and never an overlay. Anything else shows the encoded `xn--` form alone. A name that mixes scripts, or a Latin name with a letter outside the alphabets of European languages and Vietnamese, shows the encoded form beside it; Japanese, Korean and Chinese combinations count as one script. Matching always uses the encoded form. Known costs: every non-Latin name under a Latin ending such as `.com` shows the encoded form beside it, which is what exposes a Cyrillic lookalike of a Latin name; Turkish names with ı do too; and names in Yoruba, Igbo, Navajo, accented Lithuanian and stress-marked Russian show only the encoded form, because their accents have no single-character form.
- Showing text from the vault (`App/Core/DisplayText.swift`): a login's title and account are cleaned before the provider shows them. Direction-reversing, invisible, control and blank-rendering characters are removed, spaces collapsed, and the text cut to 80 characters as a person sees them (with caps of 8 accents per letter, 10 parts per emoji sequence and 320 characters underneath). The two zero-width joiners are kept between letters of the scripts that need them, such as Persian, Urdu, Hindi, Bengali and Malayalam. Nothing stored or filled changes.
- The confirmation before filling a login from another site, or on an unencrypted page, shows one fact per line with the sites first: “Saved for: …”, “You are signing in to: …”, “Login: “…””, “Account: “…””, “Only continue if you trust this page.” Values from the vault are in quotation marks and site names are not, so one cannot pass for the other. It is Psss's own sheet on iPhone, iPad and Mac, not a system alert, because the iOS 26 alert shows no preferred button for the default-action shortcut and a Mac alert cannot make Cancel both the Return default and the Escape button. Cancel is the default everywhere: a filled (prominent) button that answers Return. “Fill Anyway” is a plain bordered button, not red, because continuing is not a deletion. On iPhone and iPad the sheet is medium height (it can be pulled up) with the two buttons full width, Cancel first; on Mac Return and Escape both cancel.
- The provider's not-ready screen has one plain sentence per cause: no vault yet; Face ID or Touch ID not set up or no longer valid; the key cannot be used right now; the vault file cannot be found; the vault could not be opened.
- Logins for other sites sit behind one labeled step in the fill list, and choosing one asks for a confirmation that names both the login's site and the current site. Today they are one tap away.
- Order of work is set by the [roadmap](roadmap.md#course-correction-review-of-2026-11-22): the real vault in the provider on a signed device first, then the Mac provider and verification codes. Interface polish waits for the M0 gate on 2026-12-20.

## Roadmap

- [x] Add embedded Credential Provider targets with request-cancellation stubs.
- [x] Add matching entitlements, an App Group vault file, identity registration, and a provider that fills, saves and generates (iOS code complete, compiles).
- [ ] Prove fill, save, generate and passkey callbacks on a physical device (see “Prototype status”).
- [~] Mac provider: one implementation for iPhone, iPad and Mac since 2026-11-23 (password fill, passkeys, verification codes; macOS has no save or generate request). Built and checked as far as an unprovisioned build allows: every build variant, the views hosted in a window with Return and Escape on every screen. Never run as a provider: that needs a provisioned build.
- [x] Verification codes in the provider (2026-11-23): `ProvidesOneTimeCodes`, a one-time code identity for each login with a readable code and a website, and release only for a matching site (`ReleaseCheck.oneTimeCode`), with no other-logins path. Codes matched an independent computation for every algorithm, length and period tried. Whether the system offers them needs a signed build.
- [x] Matching as decided above, with hostless tests (2026-11-23).
- [x] The fill list as decided above (2026-11-23): matches first; “Other Logins…” reveals the rest; choosing one asks “Fill a login from another site?” naming both sites, with Cancel as the default (one sheet of ours on every platform: Cancel prominent and answering Return, Fill Anyway bordered; on Mac Escape cancels too). The sheet scrolls, every line wraps at any text size and none is cut short (a shortened site name could hide which site it is), the buttons stay below the scrolling text, and at the accessibility text sizes it opens at full height. No key sequence reached “Fill Anyway” in testing with simulated keys; a real keyboard with full keyboard access is still to check.
- [x] The `http` rule for the provider (2026-11-23), with the limits noted under Decisions.
- [x] Text from the vault shown in the provider is cleaned for display, and lookalike letters in site names show the encoded form (2026-11-23, rules under Decisions). Left as they are, all minor: a value that begins with an accent shows it against the opening quote; a few ornamental quote characters survive inside values; an account made only of quotation marks shows as “Untitled”; the end-of-word joiner exception also covers Thai, Lao, Tibetan, Burmese and Khmer.
- [ ] Passkeys: merge a passkey into the existing login for the same site and user, handle excluded credentials, and test cross-device sync once a vault syncs.

- [ ] Verify checkout frames, hosted payment forms, and individual card fields before publishing payment coverage.
- [x] Prototype the shared WebExtension, native host and per-store packaging (see [browser extension](browser-extension.md)).
- [ ] Confirm the shipping floor at the M0 gate. Availability is settled from the SDK headers (see the table below): iOS 26.2 and macOS 15 are recommended. What remains is behaviour on a device.
- [ ] Publish a tested grid for fill, generate, save and update by OS/browser/version, unlock state, field layout and iframe.
- [ ] Validate Mac App Store host setup and browser-store distribution. Keep unsupported combinations visible in the grid.

## Prototype status (2026-11-22)

- iOS 26.2 added `ASSavePasswordRequest` and `ASGeneratePasswordsRequest` for third-party providers. The extension implements fill list, fill confirmation, save sheet and generated passwords. The iOS floor for 1.0 must be 26.2 or later if save and generate are required. macOS has no equivalent, so save and generate stay a platform gap (see `docs/roadmap.md`).
- `prototype/sample-site/` serves a login and a signup page at `http://localhost:8080` (`python3 prototype/sample-site/server.py`). The Sample Site login in the sample vault matches `localhost`.
- Working in the iOS 26.5 simulator with ad-hoc signing (2026-11-22): the provider appears under Settings, General, AutoFill & Passwords once **both the app and the extension** carry `com.apple.developer.authentication-services.autofill-credential-provider`. With the entitlement on the extension alone the system discovers and elects the extension but never lists it. Real devices additionally need a provisioning profile that allows the entitlement.
- Verified in Safari against the sample site: the keyboard key opens the provider chooser, our list shows “For localhost” first, Fill completes email and password, the system offers “Use Strong Password? Save in Psss”, accepting fills both new-password fields, and our save sheet writes to the App Group file that the app shows after it returns to the foreground. Evidence: `docs/checkpoints/2026-11-22-autofill/fill-flow.png` and `save-flow.png`.
- Passkeys verified in the simulator (iOS 26.5, `prototype/sample-site/passkey.html`): registration (`prepareInterface(forPasskeyRegistration:)`) and assertion (`prepareInterfaceToProvideCredential(for:)` and `prepareCredentialList(for:requestParameters:)`) both complete. The page verifies the ES256 signature with WebCrypto. The provider needs `ProvidesPasskeys` in its capabilities, registers `ASPasskeyCredentialIdentity` records, stores the P-256 key and credential ID in the item, and returns a `none` attestation with synced, user-verified flags. Evidence: `docs/checkpoints/2026-11-22-autofill/passkey-flow.png`.
- The system sheets already ask “Save a passkey?” and “Sign in?”, so the provider adds no second confirmation of its own. It asks for Face ID, Touch ID or the passcode before it signs, and shows its own picker only when more than one passkey matches and the person chose More Options.
- Gaps found: the save request from a generated password carries no username, so the saved login has an empty account. Prompt for it in the save sheet, and test the save-on-submit path with a typed username. Titles derive from the host and should be tidied (for example “localhost” stays lowercase).
- Simulator tip: with a hardware keyboard attached the QuickType bar is hidden, so enable the software keyboard (simulator control `set_keyboard show`) before testing inline suggestions.

## Unlock (prototype)

- `Unlock.authenticate` in `App/Core/UnlockGate.swift` wraps `LocalAuthentication` with the `deviceOwnerAuthentication` policy: Face ID or Touch ID, falling back to the device passcode or Mac login password. The app and the extension share it.
- The extension authenticates before it lists, confirms, saves or signs: password fill, password save, passkey registration and passkey sign-in. Generating a password reads no vault data, so it does not ask. Cancelling returns to the system sheet. `provideCredentialWithoutUserInteraction` still asks the system for the interface, because a biometric prompt needs one.
- The app opens on a lock screen and prompts at launch and when it returns from the background. **Settings → Security → Lock** chooses Immediately, After 1, 5 or 15 minutes. **Lock Now** is in Setup on every platform, in the Mac and iPad “…” menu, and on ⌘L (Psss menu).
- Locking removes the vault view from the tree, so selection and search text do not survive behind the lock screen. Unlocking opens fresh with search focused.
- Policy follows Apple Passwords: authentication is always required and cannot be turned off; only the background timing is a setting. On Mac the vault also locks when the Mac sleeps, the display sleeps or the screen locks. See [experience](experience.md#lock-policy-follow-apple-passwords-2026-11-22).
- For the sample vault this is a user-interface gate only: it is not encrypted. A real vault is encrypted and opens with its vault password or, when switched on, with the Keychain key that Face ID or Touch ID releases, which has no passcode fallback. The always-on device-owner prompt described above applies to the sample vault.
- Simulator test: enroll Face ID with `xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` and `-p` it, then send a match with `-p com.apple.BiometricKit_Sim.fingerTouch.match`.

## Platform facts checked 2026-11-23

From the iOS 27.2 and macOS 27.2 SDK headers on the development machine, and Apple's capability tables and developer forum answers where noted.

| Feature | iOS and iPadOS | macOS | Provider key |
| --- | --- | --- | --- |
| Password fill | 12 | 11 | `ProvidesPasswords` |
| Passkey sign-in and registration | 17 | 14 | `ProvidesPasskeys` |
| Verification codes | 18 | 15 | `ProvidesOneTimeCodes` |
| Automatic passkey upgrade | 18 | 15 | `SupportsConditionalPasskeyRegistration` |
| Text insertion (single fields, such as a card number) | 18 | Not available | `ProvidesTextToInsert` |
| Save password request | 26.2 | Not available | `SupportsSavePasswordCredentials` |
| Generate passwords request | 26.2 | Not available | `SupportsGeneratePasswordCredentials` |
| Credential exchange import and export | 26 | 26 | `ASCredentialImportManager`, `ASCredentialExportManager` |

- The AutoFill credential provider capability needs the paid Apple Developer Program on both platforms. App Groups and Keychain sharing alone do not.
- An App Group name works as a Keychain access group on iOS. On Mac it works only when a provisioning profile validates the entitlements, and `kSecAttrAccessGroup` is ignored outside the data protection keychain. So the Mac app and provider can share the Face ID or Touch ID key only in a provisioned build, and the unsigned Mac build proves the app alone.
- On macOS 15 and later an extension is denied the App Group container, with no prompt, unless the group ID is prefixed with the team ID, a profile authorises it, or the app comes from the Mac App Store.
- The identity store has password (iOS 12), passkey (17) and one-time code (18) identities, replace and incremental calls, and belongs to the system, so suggestions stay while the app is locked.
- A security-scoped bookmark made by the app does not resolve in the extension.
- Apple publishes no memory limit for the provider. Other KeePass apps report 64 to 120 MB. Budget 64 MB until S2 measures it.
- Chrome on iPhone and iPad documents using system providers; Edge and Firefox there are untested. No primary source shows Chrome, Edge or Firefox on Mac offering a third-party provider.

### Mac builds: local and provisioned

The Mac app, provider and Safari extension have two sets of entitlements. The local set is what a build without a development team can carry: sandbox, user-selected file access and bookmarks for the app, sandbox alone for the extensions. The full set adds the team-prefixed App Group, the AutoFill capability and the shared Keychain group, and needs provisioning profiles. `PSSS_MAC_ENTITLEMENTS_SUFFIX` in `Configuration/macOS.xcconfig` chooses, defaulting to `-local`; set it to empty, with the team, in an untracked `Configuration/Local.xcconfig`. A local build cannot enable the provider at all, keeps the vault in the app's own container, and keeps the Touch ID key in the login keychain behind the app's own prompt. A provisioned build uses only the protected Keychain item (current fingers only, this device only), never falls back, and removes leftover login-keychain items once. The provider on Mac only ever reads the protected item. A provisioned Mac build now exists (2026-11-23): all three Mac bundles are signed with the team, carry the AutoFill key (app and provider), the team-prefixed App Group and Keychain group `$(TeamIdentifierPrefix)app.psss`, and embed a provisioning profile. Nothing has been run from it yet, so the checklist below is still open for everything that needs the running provider. The iOS device build is signed and provisioned the same way, with `group.app.psss`.

### What only a signed device can settle

1. That the provider appears under AutoFill & Passwords with the paid team's profile, on iPhone, iPad and Mac, and that the Mac profiles carry the AutoFill capability, the team-prefixed App Group and the Keychain group for all three Mac targets.
2. Peak memory and unlock time in the extension on the oldest supported iPhone, for a small vault and one of a few thousand entries, on a cold start.
3. That the extension can read the biometry-protected Keychain item the app created, on iOS and in the Mac data protection keychain, and that the app's save of that item succeeds on Mac with no fallback.
4. That the Mac provider can open the team-prefixed App Group container, and that the group identifier resolves to the same value in the app, the provider and the Safari extension.
5. A document-scoped bookmark to an iCloud Drive file resolved from the extension, including after a restart.
6. The identity store when the provider is switched off, after a restart before first unlock, when the app registers against when the extension does, and whether one-time code identities are offered.
7. Whether Chrome, Firefox and Edge on Mac offer the provider, and Edge and Firefox on iPhone.
8. Passkeys on Mac in Safari and a native app, including automatic upgrade.
9. The Safari extension's handler reading the shared Keychain group, and how long a message through it takes.
10. Which Keychain errors really occur on a provisioned Mac (after fingerprints change, in a lockout), what the one-time removal of leftover login-keychain items does, and whether macOS prompts for it.
11. The provider's screens in the real system sheet on Mac: size, Return and Escape, whether Tab can reach “Fill Anyway” with full keyboard access, what VoiceOver announces, and the alert's default button on iPhone and iPad.
12. Whether the system passes a URL with its scheme, or several identifiers, so the `http` rule can apply; and whether the save and generate keys in the shared provider settings are ignored on Mac.
13. How right-to-left, very long and encoded site names and titles render in the confirmations.
14. Saving to a vault opened in place from iCloud Drive with the sandbox on, and a not-downloaded iCloud file being refused.
15. On a simulator, which needs only the owner's approval of a device: a credential the extension saved is offered at once; the “not saved”, “not ready” and “can't save this passkey” screens; the sample vault session; the lock-screen and change-password wording.

## Provider screen copy (2026-11-23)

- No vault, or only the sample vault: title “No vault yet”, body “Open Psss and create a vault. Then come back here to fill your logins. The sample vault is not available for AutoFill.” Other not-ready cases keep “Can’t open your vault here”.
- A failed save shows “Can’t save this login” (or passkey) and one body sentence, never the system's description or the vault's internal file name. A write failure reads “The vault file could not be written, so nothing was changed. Check that this device has free space and that the vault file is not locked or read-only, then try again.”
