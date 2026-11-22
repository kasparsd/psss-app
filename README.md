# Psss

Product design for an Apple-native password manager that is as easy as Apple Passwords and also holds cards, notes and custom items in a KeePass-compatible file you own. Migration from Apple Passwords, 1Password and Strongbox is part of onboarding.

- [Product and engineering documentation](docs/README.md)
- [Interactive HTML prototype](prototype/index.html)

Open the prototype in a browser and use the scenario menu to switch between filling, signing up, changing a password, filling a card at checkout, managing a vault, and starting a migration. All entries are fictional and changes disappear on reload. In **Manage the vault → New item**, select a Login, Credit card, Secure note or KeePass entry. Attachment names and checkout are simulated. Use fictional input in the demo.

## Run the native prototype

Open `KDBOX.xcodeproj` in Xcode and run **KDBOX-macOS** on My Mac or **KDBOX-iOS** on an iPhone or iPad simulator. The native app uses an in-memory sample vault with 360 items. Browse by category or search from All items. Its setup sheet previews planned routes, and its embedded AutoFill provider currently cancels all requests.

See [native development](docs/development.md) for build commands and [the roadmap](docs/roadmap.md) for what comes next. The HTML prototype is frozen; the native app is now the prototype.
