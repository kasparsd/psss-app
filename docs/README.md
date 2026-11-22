# Psss product and engineering plan

Psss is a native macOS and iOS password manager that is as easy as Apple Passwords and holds what it does not: cards, notes, custom items and attachments, in a KeePass-compatible file you own. No account. Fill and save where you sign in. Vaults live on the device or in iCloud Drive.

See the [product contract](product.md) for positioning, principles and business model.

| Area | Document |
| --- | --- |
| Product | [Positioning, principles, business model](product.md) |
| Brand | [Mark, colour, type and reuse rules](brand.md) |
| Research | [Existing product flows](research.md) |
| Experience | [User flows and prototype](experience.md) |
| Platform | [AutoFill and browser coverage](autofill.md), [browser extension](browser-extension.md) |
| Items | [Cards, notes and KeePass entries](items.md) |
| Verification codes | [Adding a TOTP code by paste, image or camera](verification-codes.md) |
| Storage | [KeePass and vault lifecycle](vaults.md) |
| Migration | [Strongbox and 1Password](migration.md) |
| Engineering | [Swift architecture and security](architecture.md) |
| Development | [Xcode, Swift and localization conventions](development.md) |
| Delivery | [Roadmap](roadmap.md) and [App Store release](release.md) |

## Decisions

- Prioritize sign-in and password capture, including passkeys and verification codes. Support cards, secure notes and custom items in the same vault.
- KDBX is the storage format (decided by the owner, 2026-11-23). Psss does not build its own store. The M0 spikes find how to make the AutoFill extension and sync work within KDBX, not whether to keep it. Revisit only if an existing, proven alternative clearly beats it.
- Scope 1.0 to Safari (the system AutoFill provider plus the bundled Safari extension). Other browsers come later, through the same WebExtension and a native host that are prototyped.
- The native app is the prototype. The HTML prototype is frozen.
- Until the M0 gate on 2026-12-20, work goes to filling from the real encrypted vault on a signed device and to the remaining spikes. Interface, brand and browser-extension work is frozen. See the [roadmap](roadmap.md#course-correction-review-of-2026-11-22).
- Native software is written in Swift. A browser content adapter uses WebExtension JavaScript where necessary.

## Roadmap

See [roadmap](roadmap.md). Per-concern checklists in each document feed it.

Update the affected document when a decision changes. Record the reason and the evidence that changed it.
