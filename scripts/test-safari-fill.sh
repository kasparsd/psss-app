#!/bin/sh
# Builds and runs the hostless Safari fill tests (docs/plans/ios-safari-fill.md): the extension target, the popup, the grant, its
# two clocks, the store through a stand-in, the Keychain queries through recorded calls, what the snapshot takes from a vault,
# and what the handler answers. No Keychain or app data is touched. Needs Node 24 and, for the popup's drawing, the Playwright
# browsers of Extensions/Browser/tests. One of the shared heavy-job slots: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/safari-fill-test
FILES="App/SafariFill/*.swift App/Core/SafariFillSnapshot.swift"

# No value of a card or an address may be logged, printed, or kept anywhere but the one Keychain item. LEAKS covers print and
# every Logger level.
LEAKS='(^|[^A-Za-z0-9_])(print|debugPrint|dump|NSLog|os_log|Logger|fputs)[[:space:]]*\(|\.(trace|debug|info|notice|error|warning|fault|critical|log)\(|(fatalError|preconditionFailure|assertionFailure|precondition|assert)\(.*\\\('
STORES='UserDefaults|FileManager|NSUbiquit|\.write\(to|FileHandle|Pasteboard|NSCache|localStorage|sessionStorage|indexedDB|\.storage([^A-Za-z0-9_]|$)|document\.cookie|[Cc]lipboard'
# The files' lines as "file:line:text", with each text of ALLOWED (one per line) cut out. Only that text goes: whatever else
# stands on the same line is still searched.
without_allowed() {
  awk 'BEGIN { n = split(ENVIRON["ALLOWED"], allowed, "\n") }
    { line = $0
      for (i = 1; i <= n; i++)
        while (allowed[i] != "" && (at = index(line, allowed[i])))
          line = substr(line, 1, at - 1) substr(line, at + length(allowed[i]))
      print FILENAME ":" FNR ":" line }' "$@"
}
if grep -nE "$LEAKS" $FILES; then
  echo "test-safari-fill: these files must not log, print or put a value in a message (see the lines above)" >&2
  exit 1
fi
# SafariExtensionSeen.swift is the one exception: it keeps a yes-or-no note in the App Group.
if grep -nE "$STORES" $(ls $FILES | grep -v '/SafariExtensionSeen.swift$') | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//'; then
  echo "test-safari-fill: a grant goes nowhere but the Keychain (see the lines above)" >&2
  exit 1
fi
# The extension, Swift and web files. The handler may only open the App Group's preferences, to read the vault list.
if ALLOWED='extension UserDefaults: SafariFillVaultSource {}
private static func appGroup() -> UserDefaults? {
FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SafariFillAppGroup.id)
return UserDefaults(suiteName: SafariFillAppGroup.id)' without_allowed $(find Extensions/SafariIOS -type f \( -name '*.swift' -o -name '*.js' -o -name '*.html' \)) |
   grep -E "$STORES" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//'; then
  echo "test-safari-fill: the Safari extension keeps and writes nothing (see the lines above)" >&2
  exit 1
fi
# The folder the Safari extension compiles: Foundation and Security only, and it type checks on its own, so no vault type is used.
if grep -hE '^[[:space:]]*(@[A-Za-z_]+[[:space:]]+)*import ' App/SafariFill/*.swift | grep -vxE 'import (Foundation|Security)'; then
  echo "test-safari-fill: App/SafariFill may import Foundation and Security only" >&2
  exit 1
fi
swiftc -typecheck -swift-version 6 App/SafariFill/*.swift
# The extension's whole source list type checks on its own, so it uses no vault codec and no store. Its one log line takes the
# request's type, the error word and the time, and nothing it received or answered.
swiftc -typecheck -swift-version 6 App/SafariFill/*.swift Extensions/SafariIOS/*.swift
if ALLOWED='private static let log = Logger(subsystem: "app.psss", category: "safari-fill")
Self.log.info("request \(reply.type ?? "unknown", privacy: .public) \(reply.refusal?.rawValue ?? "ok", privacy: .public) \(milliseconds, privacy: .public) ms")' without_allowed Extensions/SafariIOS/*.swift |
   grep -E "$LEAKS"; then
  echo "test-safari-fill: the Safari handler logs only the type, the error word and the time (see the lines above)" >&2
  exit 1
fi
node Tests/SafariFill/target-check.mjs

# The popup: its logic with a faked browser, then drawn in headless Chromium and WebKit over the test site's pages with the real
# page fill. Node 24.
NODE=
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = "24" ]; then
  NODE=$(command -v node)
else
  for n in $(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V -r); do
    if [ -x "$n/bin/node" ]; then NODE="$n/bin/node"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "test-safari-fill: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi
"$NODE" --test Tests/SafariFill/popup.test.mjs Tests/SafariFill/popup-guard.test.mjs
if [ ! -x Extensions/Browser/tests/node_modules/.bin/playwright ]; then
  echo "test-safari-fill: Playwright is missing. Run 'npm install' in Extensions/Browser/tests and run again." >&2
  exit 1
fi
(cd Extensions/Browser/tests && "$NODE" node_modules/.bin/playwright test safari-popup)
group_id='static let id = "group.app.psss"'
if ! grep -qF "$group_id" App/SafariFill/SafariExtensionSeen.swift ||
   ! grep -qF 'defaultGroupID = "group.app.psss"' App/Core/SharedVault.swift; then
  echo "test-safari-fill: the App Group differs between the app and the Safari extension" >&2
  exit 1
fi
# The handler reads the app's vault list under the keys the app writes it with.
for key in vaultReference rememberedVaults forgottenVaultIDs vaultOrder; do
  if ! grep -qE "static let [a-zA-Z]+Key = \"$key\"" App/Core/KeePassVaultStore.swift ||
     ! grep -qE "static let [a-zA-Z]+Key = \"$key\"" App/SafariFill/SafariFillProtocol.swift; then
    echo "test-safari-fill: the vault list key $key differs between the app and the Safari handler" >&2
    exit 1
  fi
done

# The snapshot is tested against a real vault document, built from the same source list as the hostless KDBX tests (read from
# scripts/test-kdbx.sh, without that script's own test files).
VAULT_SOURCES=$(sed -n '/^SOURCES="/,/"$/p' scripts/test-kdbx.sh | sed 's/^SOURCES="//; s/"$//; s/\\$//' | tr -s ' \n' '\n\n' | grep -v '^Tests/' | grep -v '^$' | grep -v '/SafariFill' | tr '\n' ' ')
# shellcheck disable=SC2086
swiftc -O -swift-version 6 -D HOSTLESS_TESTS -D HOSTLESS_UNLOCKGATE $VAULT_SOURCES App/Core/UnlockGate.swift $FILES Tests/SafariFill/main.swift -o build/safari-fill-test/run
rm -rf build/safari-fill-test/root
PSSS_TEST_ROOT="$PWD/build/safari-fill-test/root" build/safari-fill-test/run
