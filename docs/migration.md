# Migration

## Strongbox

Open a selected KDBX in place once capability and permissions are verified, or offer a copy in the chosen location. Ask for the existing vault password and key file where applicable. Verify group hierarchy, custom fields, attachments, entry history, tags and OTP data before offering writes. Unsupported encryption, credentials or document features require a clear recovery path.

## Apple Passwords

First-class source and the largest cohort. Accept the CSV export and, where the OS offers it, the Credential Exchange format, which can carry passkeys and verification codes. Verify availability and field coverage on the floor OS before promising passkey transfer. Same preview, duplicate and loss-report rules as 1Password.

## 1Password

Start with a Mac file-based 1Password 8 migration. Prefer 1PUX for richer data and accept CSV for basic logins. Map source vaults to named KeePass vaults or groups through an explicit preview. Map 1PUX logins, credit cards and secure notes to their matching templates. Map other categories to a general KeePass entry when every source field can be represented. Preserve URLs, notes, tags, custom fields, OTP, attachments and history where mappings have been tested. Surface unsupported or partial items individually before commit. Treat passkeys as a separate migration path that requires research and testing. 1Password 7’s 1PIF is a follow-up compatibility item.

Parse the selected export on-device under bounded archive and attachment handling. Create a plan before writing, distinguish exact duplicates from apparent matches, and default to skipping exact duplicates and keeping separate ambiguous items pending review. Commit per vault atomically and report successes and failures by destination. Make retries idempotent with stable source identifiers where available. Remind users that file exports are readable and should be removed when they have verified the encrypted import.

[1Password export formats](https://support.1password.com/export/), [1PUX schema](https://support.1password.com/1pux-format/), [Strongbox getting started](https://strongboxsafe.com/getting-started/).

## Decisions

- Order of work: Apple Passwords, Strongbox open-in-place, then 1Password. Migration is an onboarding step, not the product identity.
- Make the preview and data-loss report central to migration.
- Prototype file selection and review with synthetic fixtures. Retain the source files untouched.

## Roadmap

- [ ] Build Apple Passwords CSV and Credential Exchange import for M1.
- [ ] Build a representative mapping and fixture inventory for both sources.
- [ ] Test counts and field fidelity after reopening the resulting KDBX with an independent client.
- [ ] Evaluate mobile direct transfer, passkeys, 1PIF and category-specific templates beyond cards, notes and logins after the general entry mapping is verified.
