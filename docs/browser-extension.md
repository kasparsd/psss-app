# Browser extension

Psss fills in Safari and native apps through the system AutoFill provider. Other browsers need their own route, so there is one shared WebExtension (a flat folder, `Extensions/Browser/src`), one native host for Chrome and Firefox, and a Safari app extension that bundles the same files with the apps. The Safari extension is part of the app targets, not a separate download. Chrome and Firefox remain a prototype outside 1.0 (see [roadmap](roadmap.md)).

## Does system AutoFill reach other browsers?

| Platform | Result | Consequence |
| --- | --- | --- |
| iPhone and iPad | Chrome, Firefox and Edge render with WebKit and use iOS AutoFill, so the credential provider is offered. Reliability varies by browser (Chrome puts its own manager first). Browser extensions do not exist outside Safari. | The system provider is the only route. Test each browser on a device and publish the grid. |
| Mac | The provider is called for Safari and native fields. Chrome and Firefox draw their own web content and are not expected to call it. Apple ships a separate Passwords extension for them, and third-party managers ship their own. | An extension and a native host are the only route. Confirm the negative result once with the provider enabled. |

## Safari: bundled with the app

The Safari extension ships inside Psss-macOS and Psss-iOS (targets `SafariExtension-macOS` and `SafariExtension-iOS`, embedded next to the credential provider). Its web files are the shared `Extensions/Browser/src` folder with no overlay: the Safari manifest is the base manifest, which `build.py check` verifies. Its native half is `Extensions/Safari/SafariWebExtensionHandler.swift`, which answers the same protocol as the Chrome and Firefox host through `App/Core/BrowserProtocol.swift`. The settings page is left out of the Safari bundle because Safari has no browser save prompt to switch off. The extension folder is flat because Xcode's synchronized folders flatten resources into the bundle.

The system AutoFill provider already does most of the work in Safari, so the extension adds a small, specific set of things:

| | App with system AutoFill alone | Added by the Safari extension |
| --- | --- | --- |
| Fill a saved login | Yes, on iPhone, iPad and Mac, through the keyboard suggestion or the picker, which lists all logins | The same fill from a toolbar popup and the ⌘⇧P shortcut on Mac. No new capability. |
| Passkeys and verification codes | Yes | Nothing yet: the popup fills logins only |
| Generate a password on a sign-up form | iPhone and iPad on iOS 26.2 or later (system "Use Strong Password"). **Not on Mac**: macOS has no API for it | **Mac: "Generate password, fill and save"** fills the password and its confirmation. On iPhone and iPad it duplicates the system prompt |
| Save a new login or update a password | iPhone and iPad on iOS 26.2 or later. **Not on Mac** | **Mac: the generate button saves the login** (or updates the saved one for that account). There is no save-on-submit capture yet, so a typed password the person chose is not saved |
| Find a login for a site the auto-match missed | The picker lists all logins | A search field in the popup, with a warning before a login is filled into a site it was not saved for. Same result, second place to do it |
| Toolbar button, keyboard shortcut | None | Yes |
| Setup | Enable Psss under AutoFill & Passwords | Also enable the extension in Safari settings, once per device, and allow it on sites |

In short: on Mac the extension is what gives Safari generate and save on sign-up forms. On iPhone and iPad it adds little today, and exists so the platforms behave alike and so multi-field checkout fill and save-on-submit have a home. Not added yet in any platform: cards and checkout, save-on-submit, update detection when a password is typed by hand.

Status: both targets build unsigned with the apps, the embedded resources are complete, and Apple's packager reports no unsupported keys. It has not been run in Safari (needs a signed build and enabling the extension), and in an unsigned build the App Group is unavailable, so a save from the extension does not persist.

## Design

One extension source in `Extensions/Browser/src`, three small manifest overlays in `Extensions/Browser/targets`, one build script. The extension is a toolbar popup and nothing else.

- **Least privilege.** Permissions are `activeTab`, `scripting` and `nativeMessaging`, plus the optional `privacy` described below. There is no content script, no host permission and no background worker. Nothing runs on a page until the person opens the popup (or presses the command shortcut), which grants `activeTab` for that tab. The fill function is injected into the top frame only. `build.py check` fails if a permission, optional permission, host permission or content script is added without updating this document.
- **Origin.** The extension takes the URL from the browser's tab record, never from the page. It sends only an origin. HTTPS is required, with plain HTTP for localhost. URLs with embedded credentials are refused. The host enforces the same rule and rechecks the origin before it releases a secret, so a reference alone is useless. The popup revalidates the tab origin between listing and filling.
- **Secrets.** The login list carries titles and accounts only. The secret crosses the boundary once, on the person's click, as an argument to the injected function. It is never stored in extension storage, logged or echoed back.
- **Frames.** Cross-origin frames are not filled. Payment iframes and embedded sign-in frames are a separate decision (see [autofill](autofill.md#payment-cards-and-other-fields)).
- **No remote code.** Chrome Web Store MV3 policy requires all logic in the package. The check rejects `eval`, `Function`, inline scripts and remote script or import URLs.

**Browser save prompt.** Chrome and Firefox offer to save the password in their own manager after a sign-in, which doubles Psss's job. The popup's Settings button opens a settings page with one labeled switch, "Turn off browser password prompts". Only then does the extension request the optional `privacy` permission, from that page rather than the popup because Chrome's permission dialog would close the popup mid-request, and set `privacy.services.passwordSavingEnabled` to `false`. "Turn browser password prompts back on" clears the setting and drops the permission. The browser reverts the setting by itself if Psss is disabled or removed. If another extension or a policy controls it, the page says so and disables the button. Saved passwords already in the browser are untouched, and the browser's autofill is not changed. Safari has no such API, so its manifest drops the permission (`null` in `targets/safari.json` removes a key) and the popup hides Settings. The store listing must justify `privacy` as "switch off the browser's own password prompt at the user's request".

**Search.** The popup lists the logins matched to the page and always offers a labeled search over all logins (`search { origin, query }`, metadata only, at most 20 results). A result saved for another site is marked "Saved for …" and its button reads "Fill…". Choosing it replaces the row with a warning that names both sites and a second click, "Fill anyway", sends `credential` with `manual: true`. The host releases a non-matching login only with that flag, never on plain HTTP or any origin the policy refuses, and the shipping app replaces the flag with its own approval prompt. Only extension UI can send it, so a page cannot trigger it.

The messages between extension and host are versioned and listed in `src/protocol.js`: `ping`, `candidates { origin }`, `search { origin, query }` and `credential { ref, origin, manual? }`.

### Host and app

| | Prototype | Shipping design |
| --- | --- | --- |
| Chrome, Edge, Brave, Arc, Vivaldi, Firefox | A small Swift host (`host/main.swift`) that Chrome or Firefox starts per message. It compiles the app's `SharedVault` matching and reads the sample vault. It answers without asking the app. | The host holds no key. It relays each request over a local socket to the running app, which verifies the peer, unlocks with device-owner authentication if needed, and approves the release. |
| Safari | `SafariWebExtensionHandler`, an app extension embedded in the apps, calls the same `BrowserProtocol`. | The app extension receives the same messages through `sendNativeMessage`, in-process with the app group, and asks the app to approve. Safari ignores the host name. Content scripts cannot reach it, which this design does not need. |

The host checks its caller twice. The browser enforces `allowed_origins` or `allowed_extensions`, and the host compares the argument the browser passes (the extension origin for Chrome, the add-on ID for Firefox) with `allowed-callers.txt` next to the binary, which the installer writes.

Prototype finding: Chrome starts a new host process for every `sendNativeMessage`, so references must survive process restarts. The sample vault makes new random item IDs on each launch, so the host derives the reference from website and account. A real vault uses its stable record identifier. The AutoFill extension has the same constraint, since it resolves `recordIdentifier` in another process than the app that registered it.

## Distribution formats

| Artifact | Built by | Reaches | Needs |
| --- | --- | --- | --- |
| Chromium zip | `build.py package -t chromium` | Chrome Web Store (Chrome, Brave, Arc, Vivaldi, Opera install from it) and Edge Add-ons | Developer accounts, permission justifications for each of the three permissions, single-purpose statement, privacy policy URL, screenshots. Store review decides the extension ID. |
| Firefox xpi | `build.py package -t firefox` | addons.mozilla.org, listed or unlisted (signed by Mozilla) | `gecko.id`, `data_collection_permissions` (declared `none`), Firefox 140 or later. No source upload is needed because nothing is minified or bundled. |
| Safari app extension | Xcode, as targets of `Psss.xcodeproj` (`build.py safari-project` only checks the manifest with Apple's packager) | Mac App Store and iOS App Store, inside the app | Nothing extra: it is signed and reviewed with the app. Needs the App Group on both platforms for shared saves. |
| Native host and manifests | `build.py host`, `build.py install-host` | Mac, outside the Mac App Store | Developer ID signature with hardened runtime, notarization, and a first-run step that writes the per-browser manifests. |

The Chromium manifest in a store build has no `key`. `package --dev` adds a generated dev key so the extension ID is stable for the host's `allowed_origins`, and never writes a store archive. A store build has the ID the store assigns, which goes into the host's allowed origins and `allowed-callers.txt` at release.

## Requirements checked (2026-11-22)

- **Chrome Web Store.** [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements): all logic in the package, no remote code. [Policy updates](https://developer.chrome.com/blog/cws-policy-updates-2026) enforced from 2026-08-01: Limited Use, prominent disclosure, a single purpose, justified permissions, a privacy policy. The secure-handling rule does not apply to traffic between an extension and a native program on the same computer.
- **Chrome native messaging.** [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): absolute `path`, `allowed_origins` without wildcards, manifest in the browser's user-data directory under `NativeMessagingHosts`, messages of at most 1 MB from the host.
- **Firefox.** [Native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging): `allowed_extensions` holds the add-on ID, which must be set in `browser_specific_settings`. [Data collection](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/): `data_collection_permissions` is required for new AMO submissions from 2025-11-03, inside `gecko`.
- **Safari.** [Packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari): `xcrun safari-web-extension-packager` (formerly the converter) reports unsupported manifest keys, and the build fails on any warning. [Messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension): needs the `nativeMessaging` permission, only background scripts and extension pages may message the app extension, and an iOS app cannot message the extension's JavaScript.

Not verified: Edge Add-ons review of a Chrome package, how Chrome Web Store review treats `nativeMessaging`, store listing assets, and whether a sandboxed Mac App Store app can write another browser's `NativeMessagingHosts` folder or have its embedded helper started by a browser (spike S5).

## Browser coverage

Chrome and Firefox are the baseline. Every derivative should run the same packages, and the installer registers the host wherever a profile directory exists. Results of the end-to-end suites on this Mac (2026-11-22):

| Browser | Package | Host manifest location | Result |
| --- | --- | --- | --- |
| Chrome 158 | Chromium zip | `Google/Chrome/NativeMessagingHosts` (documented) | 12 of 12 pass |
| Firefox 160 | Firefox xpi | `Mozilla/NativeMessagingHosts` (documented) | 10 of 10 pass |
| Zen (Firefox fork) | Firefox xpi | Reads the shared Mozilla folder (verified: passes with Zen's own folder absent) | 7 of 7 passed before search and settings were added; not rerun |
| Chrome for Testing 157 | Chromium zip | `Google/Chrome for Testing/NativeMessagingHosts` (documented) | Host, ID allowlist and origin refusals pass. The fill tests skip: this build hides tab URLs from the test variant even though its host permission is listed. A harness limit, cause not investigated. |
| Edge, Brave, Vivaldi, Arc, Opera | Chromium zip (Edge Add-ons gives its own extension ID) | Chromium user-data-dir convention, registered by the installer | Not installed here, so not run. Run the Chrome suite with `--browser` on each before listing it as supported. |
| LibreWolf, Waterfox, Tor Browser | Firefox xpi | Expected to read the Mozilla folder like Zen | Not run. Tor Browser's ESR is below the Firefox 140 floor. |

A derivative that is missing from the table registers with `build.py install-host --dir chromium="$HOME/Library/Application Support/Name"` (or `firefox=`). Extension IDs differ by store: the Chrome Web Store ID is shared by every browser that installs from it, Edge Add-ons assigns another, and each goes in `extension-ids.json` so the host accepts it. `build.py doctor` lists each browser that is present, whether it is registered and whether the extension ID is allowed.

## Build and try it

```bash
python3 Extensions/Browser/build.py dev-key        # stable dev extension ID
python3 Extensions/Browser/build.py host           # universal host, ad hoc signed
python3 Extensions/Browser/build.py package --dev  # stage all targets, check, write the xpi
python3 Extensions/Browser/build.py install-host   # register for installed browsers
python3 Extensions/Browser/build.py doctor         # what is registered, and will it work
```

To try the production build by hand, run one of these. Each opens a separate dev profile on the sample login page and stays running until the browser quits.

```bash
node Extensions/Browser/tests/e2e/chrome.mjs --keep
```

```bash
python3 Extensions/Browser/tests/e2e/firefox.py --keep
```

Click the toolbar button or press ⌘⇧P, then choose Fill. In your own profile instead: in Chrome open `chrome://extensions`, enable Developer mode, Load unpacked, `build/browser/chromium`. In Firefox open `about:debugging`, This Firefox, Load Temporary Add-on, `build/browser/firefox/manifest.json`. `build.py install-host --uninstall` removes the manifests. A Chromium store build is `package -t chromium` without `--dev`.

## Testing

| Layer | Command | Covers |
| --- | --- | --- |
| Static | `build.py check` (add `--test` for the test variant) | MV3, permissions, no remote code, store limits, Firefox data consent, per-target keys |
| Unit | `node --test Extensions/Browser/tests/` | Origin policy: https, localhost, credentials in URL, lookalikes, navigation |
| Host protocol | `python3 -m unittest discover -s Extensions/Browser/tests -p "host_test.py"` (build the host first) | Framing, malformed and oversized input, caller allowlist, version mismatch, origin rules, release only for a matching origin |
| Chrome, end to end | `node Extensions/Browser/tests/e2e/chrome.mjs [--browser PATH]` | Real popup, real registered host and injection in a throwaway profile: list, fill, framework input events, `127.0.0.1` is not `localhost`, insecure and lookalike hosts refused, fill aborted after navigation, search with the warn-then-confirm path, the settings switch turning the browser save prompt off and back on, a second extension ID refused by the host |
| Chrome, production path (Playwright) | `cd Extensions/Browser/tests && npm install && npx playwright test` (`HEADED=1` to watch) | Real Google Chrome driven by Playwright over CDP. Loads the production Chromium build with no host permissions, then `Extensions.triggerAction` performs the real toolbar click, which grants `activeTab`. Saves popup and filled-page screenshots to `test-results/`. Playwright does not expose extension pages, so the popup is driven through a raw CDP session. Playwright's own Firefox cannot install add-ons, so Firefox stays on `e2e/firefox.py` |
| Firefox, end to end | `python3 Extensions/Browser/tests/e2e/firefox.py [--browser PATH]` | The same, through Marionette, plus a second add-on ID refused |
| Safari | `build.py safari-project`, and building both app schemes | Apple's packager warns on unsupported keys (build fails on any), and the embedded extension's resources are complete (checked by hand in the built bundle) |

How the end-to-end suites work, and the traps they hit:

- The test variant (`package --test`) is the production code plus localhost and `*.test` host permissions, `privacy` granted up front (automation cannot accept the permission dialog, so the dialog itself is checked by hand) and a small hook that points a popup opened as a tab at a tab by URL pattern. A popup in a tab has no active tab, and `activeTab` cannot be granted without a toolbar click, which automation cannot make. The real `activeTab` flow is therefore checked by hand with `--keep`. The test variant is never archived, and `check --test` allows nothing beyond those hosts.
- Branded Chrome ignores `--load-extension` (from version 137, and `--disable-features=DisableLoadExtensionCommandLineSwitch` no longer restores it in 158). The suite starts Chrome with `--remote-debugging-pipe --enable-unsafe-extension-debugging` and loads the extension with the DevTools command `Extensions.loadUnpacked`. Chrome for Testing accepts the same.
- A custom `--user-data-dir` makes Chrome look for host manifests inside that directory, so the suite registers the host there (`install-host --dir chromium=PROFILE`).
- Match patterns have no port. `http://localhost:8080/*` matches nothing in Firefox, so the hook uses `http://localhost/*`.
- Firefox 160 needs `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` for chrome-context scripts, and grants MV3 host permissions only through the person, so the suite grants them with `ExtensionPermissions`. Fixed `moz-extension://` addresses come from the `extensions.webextensions.uuids` pref.
- `*.test` names resolve to loopback with Chrome's `--host-resolver-rules` and Firefox's `network.dns.localDomains`, which lets the suites test non-local plain-HTTP hosts and lookalikes of `localhost` offline.

Ideas not built yet: HTTPS pages with a local certificate authority (the secure path), cross-origin and sandboxed frames, pages that swap the password field after load, two-step sign-in, a host that is slow or killed mid-reply, a running-app relay once it exists, and the Safari app extension on a simulator and a Mac.

## Status

Frozen on 2026-11-22 until the M0 gate on 2026-12-20, Safari included: bug fixes only. See the [roadmap](roadmap.md#course-correction-review-of-2026-11-22). Since 2026-11-23 the prototype's plain-JSON store (`App/Core/BrowserPrototypeStore.swift`) works only inside the native messaging host, which sets its directory. In the apps and the bundled Safari extension every request for candidates, search, a credential or a save answers `unsupported` and touches no file, until the extension reads the encrypted vault through the app. An origin whose host cannot be read is refused everywhere.

- [x] Shared extension, three targets, reproducible Chromium and Firefox archives, requirement checks in `build.py check`.
- [x] Native host with framing, caller check, origin rules and search; 18 protocol tests.
- [x] Search over all logins with an explicit confirmation for a login saved for another site (found by hand-testing in Chrome).
- [x] Safari extension bundled in both apps (`SafariExtension-macOS`, `SafariExtension-iOS`), built unsigned with each scheme, sharing `BrowserProtocol` with the host.
- [x] Host registered for Chrome, Firefox and the other browsers with a profile directory (`build.py doctor`).
- [x] Fill through the real popup, host and injection in Chrome and Firefox, with negative cases (see Testing).
- [x] Real toolbar click on the production build in Chrome, automated (`Extensions.triggerAction`, Playwright spec). Firefox's toolbar click and the permission dialog wording still need a hand check (`--keep`).
- [x] Suites rerun on Chrome 158, Firefox 160 and Zen after search, settings and sign-up landed (2026-11-22). Only these three are installed here.
- [ ] Host distribution: a copy of the ad-hoc signed host with the quarantine attribute (as after a download) is rejected by `spctl` and killed with SIGKILL when launched. The shipped host needs Developer ID signing and notarization, or must live inside the signed app bundle.
- [ ] Run the end-to-end suites on Edge, Brave, Vivaldi, Arc and Opera.
- [ ] Run the Safari extension in Safari on a Mac and an iPhone with a signed build: enable it, fill, generate and save, and check the shared App Group store. Add an onboarding step that tells the person to enable it.
- [ ] Replace the host's vault access with a socket relay to the app, with peer verification and approval.
- [ ] Spike S5 additions: first-run manifest installation from a sandboxed app, or notarized direct distribution.
- [ ] Real icons, listing copy, privacy policy, accessibility pass on the popup, localization.
- [ ] Save and update capture on submit, passkeys and verification codes (extension only fills a login today).
- [x] Optional switch for the browser's own save prompt (settings page, `privacy` requested on click). Tested through the API; the permission dialog and the browser's own settings page showing "managed by an extension" still need a hand check with `--keep`.
- [ ] Optional inline field affordance through `optional_host_permissions`, requested at the moment of need.
