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
| Storage | [KeePass and vault lifecycle](vaults.md) |
| Migration | [Strongbox and 1Password](migration.md) |
| Engineering | [Swift architecture and security](architecture.md) |
| Development | [Xcode, Swift and localization conventions](development.md) |
| Delivery | [Roadmap](roadmap.md) and [App Store release](release.md) |

## Decisions

- Prioritize sign-in and password capture, including passkeys and verification codes. Support cards, secure notes and custom items in the same vault.
- Challenge the format. KDBX stays canonical only if the M0 spikes show it fits the AutoFill extension budget and sync; otherwise a private store with KDBX import and export replaces it.
- Scope 1.0 to Safari (the system AutoFill provider plus the bundled Safari extension). Other browsers come later, through the same WebExtension and a native host that are prototyped.
- The native app is the prototype. The HTML prototype is frozen.
- Native software is written in Swift. A browser content adapter uses WebExtension JavaScript where necessary.
- Use an HTML prototype to validate the interaction before committing to native layouts.

## Roadmap

See [roadmap](roadmap.md). Per-concern checklists in each document feed it.

Update the affected document when a decision changes. Record the reason and the evidence that changed it.
