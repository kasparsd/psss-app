#!/bin/sh
# Builds and runs the hostless Safari fill tests (docs/plans/ios-safari-fill.md): the grant, its two clocks, the store through a
# stand-in, the Keychain queries through recorded calls, what the snapshot takes from a vault, and what the handler answers. No
# Keychain or app data is touched. One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/safari-fill-test
FILES="App/SafariFill/*.swift App/Core/SafariFillSnapshot.swift"

# No value of a card or an address may be logged, printed, or kept anywhere but the one Keychain item.
LEAKS='(^|[^A-Za-z0-9_])(print|debugPrint|dump|NSLog|os_log|Logger|fputs)[[:space:]]*\(|\.(debug|info|error|notice|log|warning|fault)\(|(fatalError|preconditionFailure|assertionFailure|precondition|assert)\(.*\\\('
if grep -nE "$LEAKS" $FILES; then
  echo "test-safari-fill: these files must not log, print or put a value in a message (see the lines above)" >&2
  exit 1
fi
if grep -nE 'UserDefaults|FileManager|NSUbiquit|\.write\(to|FileHandle|Pasteboard|NSCache' $FILES | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//'; then
  echo "test-safari-fill: a grant goes nowhere but the Keychain (see the lines above)" >&2
  exit 1
fi
# The folder the Safari extension compiles: Foundation and Security only, and it type checks on its own, so no vault type is used.
if grep -hE '^[[:space:]]*(@[A-Za-z_]+[[:space:]]+)*import ' App/SafariFill/*.swift | grep -vxE 'import (Foundation|Security)'; then
  echo "test-safari-fill: App/SafariFill may import Foundation and Security only" >&2
  exit 1
fi
swiftc -typecheck -swift-version 6 App/SafariFill/*.swift
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
