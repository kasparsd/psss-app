# Product contract

Psss Passwords is a private, native password manager for iPhone, iPad and Mac. It is as easy as Apple Passwords and also holds cards, notes, custom items and attachments in an open, documented format the person owns, with KeePass files in and out (in 1.0 the vault is itself a KeePass file; a later, optional move to the [Psss vault format](format.md) adds sync without conflicts and family sharing, see [two phases](roadmap.md#two-phases-owner-2026-11-24)). The person decides what is stored, where it lives and whether to leave. It shares its philosophy with the sibling photo app (`macos-photo-db`, working name Bad Photo Finder / Memory Darling), and the two are meant to read as one family.

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
| Apple Passwords | Zero-setup feel, system fill reliability, passkeys, verification codes | Cards, notes, custom items, attachments, a vault you own in an open format, with a KeePass copy whenever you want one |
| 1Password | Polish, import quality, fill coverage | No account, no server, an open format, a quieter interface, honest pricing |
| Strongbox | KeePass import and export without loss, local and iCloud storage | Fewer concepts, no file or database vocabulary, sync that leaves no conflict copies to sort out, and family sharing after the move to the Psss format (phase 2) |

These are intended differentiators, not verified claims that no competitor offers them. Verify before using them in marketing.

## Simplicity budget

Every release must hold these. A change that breaks one needs an explicit entry in the roadmap decisions log.

- First fill within three minutes of install, with no account.
- One screen to enable AutoFill.
- Fewer than ten settings.
- No file-format vocabulary on the main path.
- No write that cannot be undone.
- No analytics or telemetry.

## Purpose

Decided by the owner, 2026-11-23: the goal is to give people the most secure and least frustrating way to keep and use their passwords, starting with the owner's own family. Every plan is judged against that first. Making money from it is a later question.

## Business model

Undecided, and deliberately deferred (owner, 2026-11-23). It replaces the model adopted on 2026-11-22, which sold iCloud sync as “Psss Pro” for $49.99 once or $19.99 a year.

- Sync through iCloud is free, and so is everything else today: any number of vaults and items, fill, passkeys, verification codes, the generator, import and export.
- How Psss earns money is worked out later, once people use it. It stays an open decision in the [roadmap](roadmap.md#open-decisions).
- Whatever is chosen keeps these rules. Never gate viewing, fill, sync, export or anything the person already stored. Nothing is held hostage, and a purchase or its lapse never alters or deletes data. No trial clock, no weekly pricing, no early modal paywall. Terms are stated up front.
- No interface, copy or landing page mentions Pro, a price or a paid tier until this is decided.
- Kept for when the question is taken up, from public listings checked 2026-11-22 (verify before use): Strongbox Pro lifetime is listed at $69.99 to $99.99 and its standalone Lifetime Edition at $124.99, with yearly at $24.99 to $34.99. 1Password Individual is $47.88 per year after the March 2026 increase. The sibling photo app offers $29.99 a year and $49.99 lifetime, and its copy should say “no subscription required”, not “no subscription”.

## Collection and brand

Psss is the collection name, with one app per concern. The password app’s website is at the top-level `psss.app` (owner, 2026-11-27; before that `passwords.psss.app`); other apps get their own addresses, such as `photos.psss.app`. The name suggests discretion, which suits both a vault and a private photo reviewer.

- Open decision: whether the photo app takes the Psss name (Psss Photos) or keeps its working name Memory Darling under a “from Psss” line. The photo app's brand direction is people-centered and warm, and the password manager needs to feel trustworthy and quiet. They should share principles, pricing language and native interface rules, and may differ in character.
- Shared engineering where it pays: purchase and entitlement handling, restore, a Help and Settings scaffold, and Developer settings. Extract a shared Swift package only when the second app needs the same code in production, as the photo app does with its core.
- Choose bundle identifiers once for both apps after the domain is registered. The photo app's tentative identifier is `net.kaspars.darling-photos`. Product identifiers cannot contain hyphens.
- Visual identity (decided 2026-11-22): an outline password field with a lowercase p typed in and three dots for “sss”, in butter and charcoal, with a lowercase rounded wordmark. Marks, colour, type and reuse rules are in [brand](brand.md), assets in `Design/`.
- Naming risk: “psss” is hard to search for and needs deliberate copy such as “Psss Passwords”. Check trademarks and App Store availability.
- Do not announce a collection until a second app is close to shipping.
