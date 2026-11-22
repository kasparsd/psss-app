# Existing product flows

These are reconstructions from first-party documentation. They describe documented behavior and serve as scripts for a later hands-on comparison with clean test vaults.

| Product | Fill a login | Save or change a login | Move existing data |
| --- | --- | --- | --- |
| 1Password | Focus a sign-in field, choose the suggested account, unlock when prompted. Browser and macOS AutoFill are documented paths. | Use the browser generator in a password field; accept the save prompt and choose a vault or update the existing item. | On Mac, File → Export → account → authenticate → 1PUX or CSV. Version 7 also documents 1PIF. |
| Strongbox | Choose a vault, enable system AutoFill for Safari, then select the matching entry. For Chrome and Firefox install the extension and unlock the database. | In the database, add an entry, enter title, username, password and URL, then save. | Open an existing KeePass database or import an exported 1Password file. Database setup asks where to store the file. |
| Apple Passwords | Turn on system AutoFill, then choose the suggested credential on a supported surface. Apple documents extensions for supported third-party Mac browsers. | Choose a suggested strong password on a supported form, or create a password entry in Passwords. | Apple Passwords documents export and 1Password documents direct mobile import from supported apps. |
| Bitwarden | Select a matching vault item from the extension or use inline AutoFill. | Enable save and update prompts, then review the proposed action after submitting a form. | Import is outside this comparison. |

Sources: [1Password browser guide](https://support.1password.com/explore/browser/), [1Password on macOS](https://support.1password.com/macos-autofill/), [1Password export](https://support.1password.com/export/), [1Password import](https://support.1password.com/import/), [Strongbox guide](https://strongboxsafe.com/getting-started/), [Apple Passwords](https://support.apple.com/en-ie/120758), [Bitwarden browser guide](https://bitwarden.com/pdf/help-getting-started-browserext.pdf).

## Decisions

- Apple Passwords users are the largest underserved cohort. Include them in migration and in usability studies.
- Walkthroughs against competitors are done with clean profiles on the native build, not the HTML prototype.

- Start fill with the site and its matching accounts. Keep global search in the vault.
- Present proposed saves and updates with the site, account and destination together.
- Put “Open KeePass vault” and “Import from 1Password” at the entry point before asking for storage.

## Roadmap

- [x] Capture documented happy paths.
- [ ] Record clean-profile walkthroughs for locked, multiple-match, no-match, signup, password-change and cancelled flows.
- [ ] Compare action counts and errors for those same scenarios in Psss.
