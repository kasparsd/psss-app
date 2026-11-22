# Psss

Product design for an Apple-native password manager that is as easy as Apple Passwords and also holds cards, notes and custom items in a KeePass-compatible file you own. Migration from Apple Passwords, 1Password and Strongbox is part of onboarding.

- [Product and engineering documentation](docs/README.md)
- [Interactive HTML prototype](prototype/index.html)

Open the prototype in a browser and use the scenario menu to switch between filling, signing up, changing a password, filling a card at checkout, managing a vault, and starting a migration. All entries are fictional and changes disappear on reload. In **Manage the vault → New item**, select a Login, Credit card, Secure note or KeePass entry. Attachment names and checkout are simulated. Use fictional input in the demo.

## Run the native prototype

Open `KDBOX.xcodeproj` in Xcode and run **KDBOX-macOS** on My Mac or **KDBOX-iOS** on an iPhone or iPad simulator. On first launch the native app shows a Welcome screen: create a vault, import an Apple Passwords CSV, or try a sample vault of about 360 fictional items. Create a vault makes a real encrypted KeePass file (KDBX 4.1, Argon2id, AES-256) protected by a vault password and optional key file, and Open a vault file edits an existing `.kdbx` (KDBX 3.1 and 4.x, including KeePassXC and Strongbox files) in place. The sample vault and the AutoFill extension still use a plain-JSON App Group prototype store until the extension opens the real vault. Setup (the gear) shows the vault, changes its vault password, sets lock timing and has Start Over. `scripts/test-kdbx.sh` runs the codec tests, including KeePassXC interop. See [vaults](docs/vaults.md) and the [roadmap](docs/roadmap.md).

See [native development](docs/development.md) for build commands and [the roadmap](docs/roadmap.md) for what comes next. The HTML prototype is frozen; the native app is now the prototype.

## Browser extension prototype

`Extensions/Browser` holds a shared WebExtension (Chrome, Edge, Firefox, Safari), a native messaging host and a packaging script. The Safari build of it is bundled in both apps; see what it adds over system AutoFill in [browser extension](docs/browser-extension.md#safari-bundled-with-the-app). Start with [browser extension](docs/browser-extension.md); `python3 Extensions/Browser/build.py package` builds the store archives into `build/browser`, and the end-to-end suites in `Extensions/Browser/tests/e2e` drive real Chrome and Firefox.
