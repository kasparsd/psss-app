# Competitor reference collection

Purpose: screenshots and notes for evaluating Psss product decisions against
existing password managers. Keep one folder per product, with PNG screenshots
named in capture order and a short `notes.md` describing the flow and source.

## Installability on this Mac

- iOS Simulator (`xcrun simctl`) installs only simulator-compatible `.app`
  bundles. It cannot install arbitrary App Store apps.
- Open-source apps can be built from source for the simulator when their build is
  practical: Bitwarden, Proton Pass, KeePassium, KeePassIO, MiniKeePass.
- Closed-source apps (1Password, Keeper, Dashlane, LastPass, etc.) cannot be
  installed in the simulator. They can be run in a virtual iPhone using
  [vphone-cli](https://github.com/Lakr233/vphone-cli), or captured from App
  Store marketing material and manual device screenshots.
- `simforge` can run decrypted iOS apps in the simulator, but requires a
  decrypted IPA and re-signing; it is not a route to App Store builds.
- Apple Passwords ships in the iOS 18+ simulator and is captured here.

## Main competitors

| Product | Why it matters to Psss | Installability |
| --- | --- | --- |
| Apple Passwords | Largest built-in competitor; migration source and UX baseline | Simulator (built in) |
| Strongbox | Direct KeePass competitor; import/export and AutoFill expectations | Source available but not buildable |
| KeePassium | KeePass UX reference on iOS | Open source, buildable |
| Bitwarden | Cross-platform open-source baseline | Open source, buildable but heavy |
| Proton Pass | Privacy-focused open-source competitor | Open source, buildable |
| KeePassIO | Small open-source KeePass client | Open source, buildable |
| 1Password | Market leader for families/sharing and save flows | Closed source |
| Keeper | Enterprise/family features | Closed source |
| Dashlane | Consumer onboarding and autofill | Closed source |
| LastPass | Legacy migration source | Closed source |

## Capture conventions

- One folder per product.
- Screenshot files: `01-...png`, `02-...png`, in flow order.
- Include locked, empty, list, detail, edit, search, settings, and AutoFill
  surfaces where reachable.
- Record the app version and capture date in `notes.md`.

## Current captures

- `apple-passwords/01-home.png` — Passwords home on iOS 27.2 simulator.
"