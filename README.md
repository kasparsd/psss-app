# Psss

An Apple-native password manager that is as easy as Apple Passwords and also holds cards, notes and custom items in an open format you own, with KeePass files in and out. The [vault format](docs/format.md) is decided and not built yet; today the app stores a KeePass (KDBX) file. Migration from Apple Passwords, 1Password and Strongbox is part of onboarding.

- [Product and engineering documentation](docs/README.md)
- [Roadmap and current status](docs/roadmap.md): the encrypted vault, Face ID unlock and AutoFill from the vault on iPhone work in the simulator. The Mac provider is not built and nothing has run on a signed device. Use disposable vaults and fictional data only.
- Deleting an item never removes it outright: it moves to Recently Deleted for 30 days, with a 10-second Undo, and only a confirmed Delete Now… or Delete All… removes it for good ([items](docs/items.md)).
- [Frozen HTML prototype](prototype/index.html) of the early flows, kept for reference.

## Run the native prototype

Open `Psss.xcodeproj` in Xcode and run **Psss-macOS** on My Mac or **Psss-iOS** on an iPhone or iPad simulator. On first launch the native app shows a Welcome screen: create a vault, import an Apple Passwords CSV, or try a sample vault of about 360 fictional items. Create a vault makes a real encrypted KeePass file (KDBX 4.1, Argon2id, AES-256) protected by a vault password and optional key file, and Open a vault file edits an existing `.kdbx` (KDBX 3.1 and 4.x, including KeePassXC and Strongbox files) in place. On iPhone and iPad the AutoFill extension opens the encrypted vault with the key Face ID releases. The sample vault is in memory only: what you add to it is gone when Psss locks or quits. The bundled Safari extension answers nothing until it reads the encrypted vault; only the browser prototype's native host keeps a plain-JSON file of its own. Setup (the gear) shows the vault, changes its vault password, sets lock timing and has Start Over. `scripts/test-kdbx.sh` runs the codec tests, including KeePassXC interop. See [vaults](docs/vaults.md) and the [roadmap](docs/roadmap.md).

See [native development](docs/development.md) for build commands and [the roadmap](docs/roadmap.md) for what comes next. The HTML prototype is frozen; the native app is now the prototype.

## Browser extension prototype

`Extensions/Browser` holds a shared WebExtension (Chrome, Edge, Firefox, Safari), a native messaging host and a packaging script. The Safari build of it is bundled in both apps; see what it adds over system AutoFill in [browser extension](docs/browser-extension.md#safari-bundled-with-the-app). Start with [browser extension](docs/browser-extension.md); `python3 Extensions/Browser/build.py package` builds the store archives into `build/browser`, and the end-to-end suites in `Extensions/Browser/tests/e2e` drive real Chrome and Firefox.

## Credits

The Words password type uses the [EFF Long Wordlist](https://www.eff.org/dice) by the Electronic Frontier Foundation, licensed under Creative Commons Attribution 4.0 International. Psss removes the dice numbers and the four hyphenated entries; see the header of `App/Core/EFFLongWordList.txt`.
