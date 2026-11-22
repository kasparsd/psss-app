# AutoFill and browser integration

| Surface | First route | Verification required |
| --- | --- | --- |
| iOS Safari and apps | AuthenticationServices Credential Provider Extension | Test inline suggestions, picker, locked continuation and save/update on chosen OS versions. |
| iOS Chrome, Firefox, Edge | System provider where invoked by each browser | Record fill and save independently on physical devices. |
| macOS Safari and apps | System provider and system AutoFill menu where exposed | Compare inline, menu and picker. Evaluate Safari Web Extension for gaps in signup and update. |
| macOS Chrome, Edge, Firefox | Test system provider and context menu first. Prototype a browser adapter for gaps. | Record real inline support, save requests, locked behavior and signed installation for each browser. |
| Other macOS browsers | Document tested system surfaces and manual copy fallback. | Test by browser, version and form type before advertising coverage. |

System integration uses `ASCredentialProviderViewController`, credential identity registration and save capability flags as supported by the deployment OS. Index minimal service metadata and stable opaque record references. Resolve a reference and recheck the request origin before releasing the credential. Refresh identities after edits, external changes, removal and access revocation.

A Safari extension uses Xcode packaging and native messaging. Chrome and Firefox use browser-specific host registration and distribution; test sandbox compatibility with an archive-installed build before committing to the delivery path. The extension mediates the active page and asks native Swift code for the selected credential or a proposed save. Verify connection identity, tab and frame origin at request and delivery, enforce user intent, and keep secrets out of extension storage. Browsers may call different paths for filling and saving. Treat them as separate capabilities.

[Apple Credential Provider API](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller), [Apple provider capabilities](https://developer.apple.com/documentation/bundleresources/information-property-list/nsextension/nsextensionattributes/ascredentialproviderextensioncapabilities), [Safari Web Extensions](https://developer.apple.com/documentation/SafariServices/safari-web-extensions), [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging).

## Payment cards and other fields

AuthenticationServices documents a user-selected text insertion path. Verify it as a single-field option. Test multi-field checkout fill in browser extensions separately and restrict delivery to the selected checkout origin and verified fields. Keep card data and notes out of password suggestions. OTP uses the dedicated one-time-code request when supported.

[Apple provider APIs](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller/), [Apple one-time-code AutoFill](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill).

## Decisions

- 1.0 covers Safari and apps through the system provider on iPhone, iPad and Mac. Chrome, Edge and Firefox move to “later” and will be tried through the system provider before any adapter is built.
- Build a Safari Web Extension only for gaps proven in spike S3.
- Passkeys and verification codes ride the same provider and are required for TestFlight.

- Prefer Apple’s integration anywhere it supports the intended action.
- Use a thin JavaScript adapter for WebExtension page interaction and Swift for native targets.
- Match conservatively across schemes, hosts, ports and frames. Keep manual selections explicit and revalidate on navigation.

## Roadmap

- [x] Add embedded Credential Provider targets with request-cancellation stubs.
- [x] Add matching entitlements, an App Group vault file, identity registration, and a provider that fills, saves and generates (iOS code complete, compiles).
- [ ] Prove fill, save, generate and passkey callbacks on a physical device (see “Prototype status”).
- [ ] Passkeys: merge a passkey into the existing login for the same site and user, handle excluded credentials, and test cross-device sync once a vault syncs.

- [ ] Verify checkout frames, hosted payment forms, and individual card fields before publishing payment coverage.
- [ ] Pick minimum OS versions after testing API availability and coverage.
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
- This is a user-interface gate. The sample vault is not encrypted, so it does not protect data at rest. Real protection arrives with the Keychain-held vault key behind biometrics (roadmap S2 and S6).
- Simulator test: enroll Face ID with `xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` and `-p` it, then send a match with `-p com.apple.BiometricKit_Sim.fingerTouch.match`.
