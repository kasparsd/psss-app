# Page access probe

Shows the two permission prompts behind "logins for the browser page", as a person would see them. Throwaway: delete it once the answers are in `docs/plans/mac-menu-bar.md` (P9, P10). It stores no address; the window shows only the host name.

## Safari and Chrome

`scripts/probe-page-access.sh` builds and signs a sandboxed app, `build/page-probe/Psss Page Probe.app`, with an Apple Development identity. Open it, open a web page in the browser, then use the buttons. The bottom of the window lists each press and the macOS status (Copy Log), never an address. The same lines go to the system log:

```bash
log show --last 15m --predicate 'subsystem == "app.psss.page-probe"'
```

To see the macOS prompt again:

```bash
tccutil reset AppleEvents app.psss.page-probe
```

## Zen and Firefox

Open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and pick `Tests/PageProbe/zen/manifest.json`. Click its toolbar button (it may be under the extensions button), then Allow. If the popup closes when the question appears, click the button again to see the result, or use "Open as a Page" and Allow from there. "Remove Access" lets you try again. The add-on goes when the browser quits.
