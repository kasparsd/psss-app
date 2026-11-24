# App Store release

Milestones, exit criteria and cuts live in the [roadmap](roadmap.md). This document keeps distribution, signing and review requirements.

## Decisions

- Use Xcode targets for macOS, iOS and their credential provider extensions. The Safari web extension is an embedded app extension of the Mac app (`SafariExtension-macOS`), signed and reviewed with it. iPhone and iPad have none. Its web files are `Extensions/Browser/src`.
- Plan App Sandbox, provisioning, signing, Keychain access groups, App Groups and iCloud capabilities from the first signed spike.
- Chrome and Firefox are out of 1.0. Their store listings (Chrome Web Store and Edge Add-ons share one archive, Firefox AMO is another) are separate artifacts built by `Extensions/Browser/build.py`, and the Safari extension ships inside the app. Confirm sandbox-compatible native host onboarding first. Notarized direct distribution is the alternative if the Mac App Store blocks it. Requirements and formats: [browser extension](browser-extension.md#distribution-formats).

[Preparing an Xcode app for distribution](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Encryption export compliance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations).

## Roadmap

- [x] Define milestones and release gates.
- [x] Create Xcode schemes with sample items and inert provider targets.
- [ ] Replace setup previews with navigable synthetic unlock, migration review and save-review flows.
- [ ] Sign the apps and extensions, then validate real AutoFill and KDBX interoperability using disposable vaults.
- [ ] Prepare reproducible archives, seeded review vault, support pages and privacy disclosures.
