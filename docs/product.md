# Product contract

Psss Passwords is a private, native password manager for iPhone, iPad and Mac. It is as easy as Apple Passwords and also holds cards, notes, custom items and attachments in a KeePass-compatible file the person owns. The person decides what is stored, where it lives and whether to leave. It shares its philosophy with the sibling photo app (`macos-photo-db`, working name Bad Photo Finder / Memory Darling), and the two are meant to read as one family.

## Shared philosophy

Carried over from the photo app's product contract and brand notes.

- Private by construction. Everything runs on the device. No account, no server, no advertising, no analytics or telemetry, no inference in the cloud. The privacy label should be “Data Not Collected”, and it is claimed only if actual behavior matches Apple's definition.
- Native and calm. Standard platform controls, the system accent color, semantic text styles, no custom branded tint. Calm comes from predictable behavior and understandable choices, not from decoration.
- The person decides. Nothing is saved, changed, filled or deleted without an explicit action. Safety rules live in shared code and apply on every platform.
- Honest commercial terms stated up front, near the first call to action, never buried in a FAQ and never a pressure paywall.
- Greenfield. No migration of private formats and no compatibility with earlier choices. Prefer the clean design.
- Truthful language. Say what happened and what the limits are. No guarantees the platform does not give.

## Positioning

For people on Apple devices who outgrew Apple Passwords, or who want less than 1Password and Strongbox ask of them. Migration from those products is an onboarding feature, not the product identity.

| Against | We must match | We win by |
| --- | --- | --- |
| Apple Passwords | Zero-setup feel, system fill reliability, passkeys, verification codes | Cards, notes, custom items, attachments, a file you own and can open elsewhere |
| 1Password | Polish, import quality, fill coverage | No account, no server, an open format, a quieter interface, honest pricing |
| Strongbox | KeePass interoperability, local and iCloud files | Fewer concepts, no file or database vocabulary, sync that avoids conflict copies |

These are intended differentiators, not verified claims that no competitor offers them. Verify before using them in marketing.

## Simplicity budget

Every release must hold these. A change that breaks one needs an explicit entry in the roadmap decisions log.

- First fill within three minutes of install, with no account.
- One screen to enable AutoFill.
- Fewer than ten settings.
- No file-format vocabulary on the main path.
- No write that cannot be undone.
- No analytics or telemetry.

## Business model

Adopted 2026-11-22. Family Sharing is decided and prices are the leading option. It adapts the photo app's model (free allowance, then a one-time purchase) to a product whose recurring cost to the maker is zero.

- Free forever: local vaults on one device, in any number, with unlimited items, fill, passkeys, verification codes, generator, import and export. Nothing the person already has is ever held back.
- Psss Pro unlocks iCloud Drive sync and use across devices, and other features that exist only because more than one device is involved. Two ways to buy it with the same entitlement: **$49.99 lifetime** (non-consumable) or **$19.99 per year** (auto-renewable). Both support Family Sharing (decided 2026-11-22). US prices; regional price points are set in App Store Connect. Prices are the leading option and are confirmed at M2. Purchase and restore never alter or delete data. Restore works on every shipping platform.
- Never gate viewing, fill, export or data the person already stored. If a yearly subscription lapses, sync stops and the vault stays fully readable, editable on that device and exportable. Nothing is held hostage.
- No trial clock, no weekly pricing, no early modal paywall. State the boundary during setup and at the moment sync is first offered, with both options shown together.
- Market position, from public listings checked 2026-11-22 (verify before using in marketing): Strongbox Pro lifetime is listed at $69.99 to $99.99 and its standalone Lifetime Edition at $124.99, with yearly at $24.99 to $34.99. 1Password Individual is $47.88 per year after the March 2026 increase. $49.99 lifetime equals about one year of 1Password.
- Copy says “Pay once, or yearly” and “No subscription required”, never “No subscription”.

Why not a free item cap like the photo app's 100 deletions: a cap bites during migration, when the person has just moved everything in, which feels like being held hostage. Sync is the natural value boundary and costs nothing to demonstrate.

### Shared offer with the photo app

Both apps offer an annual and a lifetime purchase: the photo app at $29.99 and $49.99, this app at $19.99 and $49.99. The photo app's brand copy says “No subscription”, which contradicts that offer. Change the copy, not the offer, to “One-time purchase available, no subscription required” before either app launches, so the family promise stays honest.

## Collection and brand

Psss is the collection name, with one app per concern and one address each: `passwords.psss.app`, `photos.psss.app`, and others later. The name suggests discretion, which suits both a vault and a private photo reviewer.

- Open decision: whether the photo app takes the Psss name (Psss Photos) or keeps its working name Memory Darling under a “from Psss” line. The photo app's brand direction is people-centered and warm, and the password manager needs to feel trustworthy and quiet. They should share principles, pricing language and native interface rules, and may differ in character.
- Shared engineering where it pays: purchase and entitlement handling, restore, a Help and Settings scaffold, and Developer settings. Extract a shared Swift package only when the second app needs the same code in production, as the photo app does with its core.
- Choose bundle identifiers once for both apps after the domain is registered. The photo app's tentative identifier is `net.kaspars.darling-photos`. Product identifiers cannot contain hyphens.
- Visual identity (decided 2026-11-22): an outline password field with a lowercase p typed in and three dots for “sss”, in butter and charcoal, with a lowercase rounded wordmark. Marks, colour, type and reuse rules are in [brand](brand.md), assets in `Design/`.
- Naming risk: “psss” is hard to search for and needs deliberate copy such as “Psss Passwords”. Check trademarks and App Store availability.
- Do not announce a collection until a second app is close to shipping.
