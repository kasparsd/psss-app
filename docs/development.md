# Native development

The product is named Psss. Xcode project, scheme and folder names still say KDBOX and are renamed together with the bundle identifiers, once the domain is registered, so identifiers are chosen once.

Open [KDBOX.xcodeproj](../KDBOX.xcodeproj/project.pbxproj) in Xcode. Choose **KDBOX-macOS → My Mac** or **KDBOX-iOS → an iPhone or iPad simulator** and run. The app starts with a fictional vault. Try searching across All items, narrowing to a category, distinguishing logins with the same title by account, opening and editing an item, and reviewing the setup sheet. Changes last for the current app window. Use fictional inputs.

The project is maintained directly in Xcode. Synchronized source folders automatically include new Swift files. Shared settings live in `Configuration/Base.xcconfig`. Platform files hold SDK, deployment and sandbox settings. Both apps reuse `App/Core`, `App/Features` and `App/Bootstrap`. Separate extension targets compile `Extensions/CredentialProvider` and are embedded by Xcode. The workspace has no code generation step, package dependencies or shell build phases.

## Command-line verification

```sh
xcodebuild -project KDBOX.xcodeproj -scheme KDBOX-macOS \
  -destination 'platform=macOS' -derivedDataPath /tmp/KDBOX-macOS \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project KDBOX.xcodeproj -scheme KDBOX-iOS \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/KDBOX-iOS \
  CODE_SIGNING_ALLOWED=NO build
```

Reuse derived-data directories to keep incremental builds fast. Verify both schemes after shared changes. Check iPhone compact width and iPad regular width when editing navigation. Use Xcode for signing and archiving. Unsigned builds verify compilation and bundle assembly. Enabling a real credential provider requires registered identifiers, team profiles, and matching app and extension entitlements. See [AutoFill](autofill.md) and [release](release.md).

## Decisions

- Swift 6 language mode and explicit isolation at boundaries. Keep UI state on the main actor. Isolate document writes and run expensive KDF and parsing work outside the UI actor. Pass values across isolation boundaries with `Sendable` where applicable.
- Use platform-native SwiftUI on both targets. Prototype on the latest OS and SDK: deployment floors are macOS 27 and iOS 27 (Xcode 27.2). Decided 2026-11-22. Choose the shipping floor, probably one release back, from the AutoFill compatibility matrix in spike S3, and update `Configuration/*.xcconfig` then. This machine has iOS 18.6 and 26.5 simulator runtimes only, so install an iOS 27 runtime in Xcode to run the iOS app in a simulator. Until then, temporarily set `IPHONEOS_DEPLOYMENT_TARGET = 26.0` in `Configuration/iOS.xcconfig` to build for a 26.5 simulator, and restore 27.0 afterward. Unsigned simulator builds work without it.
- Use typed domain outcomes and map them to localizable messages in the view layer. Keep user-provided text verbatim. Use String Catalogs for translatable interface copy, and locale-aware FormatStyle and plural rules for dates and counts. Verify pseudolocalized string lengths and right-to-left layout as copy stabilizes.
- Keep development fixtures independent of real accounts, credential stores and user files. The scaffold uses in-memory fixtures and the provider cancels requests.

Adapted from `macos-photo-db` at `71732c0`, principally `docs/development.md`, `docs/architecture.md` and `docs/i18n.md`.

## Roadmap

- [x] Create Xcode app schemes and embedded provider targets.
- [ ] Add a hostless Swift test target when the first codec or import contract lands. Verify any filtered test run executes tests.
- [ ] Add deterministic preview scenarios for empty, locked, save review and failed write states.
- [ ] Add a String Catalog and audit VoiceOver labels with the first localization pass.

## Testing AutoFill in the simulator

1. Start the sample site: `python3 prototype/sample-site/server.py` (http://localhost:8080).
2. Build for the simulator with ad-hoc signing and a temporary 26.2 floor (the simulator has no iOS 27 runtime): set `IPHONEOS_DEPLOYMENT_TARGET = 26.2`, build with `CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM=`, and restore 27.0.
3. Install, then enable Psss under Settings, General, AutoFill & Passwords. If it is missing, check that the app and extension both have the AutoFill entitlement, then run `xcrun simctl spawn <udid> pluginkit -e use -i local.kdbox.prototype.credential-provider` and restart Settings.
4. Open the sample login, signup and passkey pages in Safari with the software keyboard enabled. `passkey.html` creates a passkey, signs in with it and verifies the signature in the browser.
