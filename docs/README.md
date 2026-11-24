# Psss product and engineering plan

Psss is a native macOS and iOS password manager that is as easy as Apple Passwords and holds what it does not: cards, notes, custom items and attachments, in an open format you own, with KeePass files in and out. No account. Fill and save where you sign in. Vaults live on the device and sync through iCloud, a folder you choose or your own server.

See the [product contract](product.md) for positioning, principles and business model.

| Area | Document |
| --- | --- |
| Product | [Positioning, principles, business model](product.md) |
| Brand | [Mark, colour, type and reuse rules](brand.md) |
| Research | [Existing product flows](research.md) |
| Experience | [User flows and prototype](experience.md) |
| Platform | [AutoFill and browser coverage](autofill.md), [browser extension](browser-extension.md) |
| Command line | [Command line and AI agents](cli.md) (proposal, not approved) |
| Items | [Cards, notes and KeePass entries](items.md) |
| Verification codes | [Adding a TOTP code by paste, image or camera](verification-codes.md) |
| Storage | [KeePass and vault lifecycle](vaults.md), [vault format](format.md), [byte-level specification](format-spec.md), [item schema](format-schema.md) |
| Migration | [Strongbox and 1Password](migration.md) |
| Engineering | [Swift architecture and security](architecture.md) |
| Development | [Xcode, Swift and localization conventions](development.md) |
| Delivery | [Roadmap](roadmap.md) and [App Store release](release.md) |

## Decisions

- Prioritize sign-in and password capture, including passkeys and verification codes. Support cards, secure notes and custom items in the same vault.
- The vault format is a log of immutable, encrypted, signed records, published as an open specification (decided by the owner, 2026-11-23, see [vault format](format.md)). It syncs over CloudKit, a plain folder or a small server. A single mutable file makes reliable sync and family sharing hard, and the person Psss is for expects both. Not in the app yet.
- The product ships in two phases (owner, 2026-11-24, see [roadmap](roadmap.md#two-phases-owner-2026-11-24)). Version 1.0 keeps the vault as a KeePass (KDBX) file in iCloud Drive or on the device, for one person, as a replacement for Strongbox. In phase 2 one tap moves a vault to the Psss vault format above, which adds sync without conflicts and family sharing; after the move KDBX is import and export for that vault.
- Scope 1.0 to Safari (the system AutoFill provider plus the bundled Safari extension). Other browsers come later, through the same WebExtension and a native host that are prototyped.
- The native app is the prototype. The HTML prototype is frozen.
- Until the M0 gate on 2026-12-20, work goes to filling from the real encrypted vault on a signed device and to the remaining spikes. Interface, brand and browser-extension work is frozen. See the [roadmap](roadmap.md#course-correction-review-of-2026-11-22).
- Native software is written in Swift. A browser content adapter uses WebExtension JavaScript where necessary.

## Roadmap

See [roadmap](roadmap.md). Per-concern checklists in each document feed it.

Update the affected document when a decision changes. Record the reason and the evidence that changed it.
