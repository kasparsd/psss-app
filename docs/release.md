# App Store release

Milestones, exit criteria and cuts live in the [roadmap](roadmap.md). This document keeps distribution, signing and review requirements.

## Decisions

- Use Xcode targets for macOS, iOS and their credential provider extensions. Add a Safari extension to the containing app if the capability spike warrants it.
- Plan App Sandbox, provisioning, signing, Keychain access groups, App Groups and iCloud capabilities from the first signed spike.
- Chrome and Firefox are out of 1.0. If added later, treat their store listings as separate artifacts and confirm sandbox-compatible native host onboarding first. Notarized direct distribution is an alternative if the Mac App Store blocks it.

[Preparing an Xcode app for distribution](https://developer.apple.com/documentation/Xcode/preparing-your-app-for-distribution), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Encryption export compliance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations).

## Roadmap

- [x] Define milestones and release gates.
- [x] Create Xcode schemes with sample items and inert provider targets.
- [ ] Replace setup previews with navigable synthetic unlock, migration review and save-review flows.
- [ ] Sign the apps and extensions, then validate real AutoFill and KDBX interoperability using disposable vaults.
- [ ] Prepare reproducible archives, seeded review vault, support pages and privacy disclosures.
