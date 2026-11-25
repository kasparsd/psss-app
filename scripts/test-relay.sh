#!/bin/sh
# The browser relay harness: the hostile-input and secrecy checklist (AGENTS.md, "Delegated work and validation") for the socket
# between the native host and the app. Builds the test host (reads PSSS_RELAY_SOCKET, skips the app check), a release-style host
# (ad hoc, no team) and the stand-in relay (the app's real relay server over the prototype's vaults), then runs
#   - the generated extension-id list check,
#   - Extensions/Browser/tests/relay/relay.test.mjs (framing fuzz, deadlines, limits, lock and socket files, refused peers,
#     kill -9 both ways, hostile names, the secret scan, `save` over the socket and, over real encrypted vaults through
#     Tests/Relay/VaultRelay, `kill -9` in the middle of saves with the vault file opened again afterwards),
#   - Extensions/Browser/tests/host_test.py (the host's protocol tests, through the stand-in),
#   - build.py check (the release host must not contain PSSS_RELAY_SOCKET).
# Needs Node 24. Compiles go through scripts/heavy.sh; everything it writes is under build/browser or a folder in /tmp.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."

NODE=
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = "24" ]; then
  NODE=$(command -v node)
else
  for n in $(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V -r); do
    if [ -x "$n/bin/node" ]; then NODE="$n/bin/node"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "test-relay: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

"$NODE" scripts/generate-extension-ids.mjs --check
python3 Extensions/Browser/build.py host --testing
python3 Extensions/Browser/build.py standin
rm -rf build/relay-test && mkdir -p build/relay-test
# The app's relay and protocol over real encrypted vaults (Tests/Relay/VaultRelay), for the kill -9 during a save. It is built from
# the same source list as the hostless KDBX tests (read from scripts/test-kdbx.sh, without that script's own test files).
VAULT_SOURCES=$(sed -n '/^SOURCES="/,/"$/p' scripts/test-kdbx.sh | sed 's/^SOURCES="//; s/"$//; s/\\$//' | tr -s ' \n' '\n\n' | grep -v '^Tests/KDBX/' | grep -v '^$' | tr '\n' ' ')
# shellcheck disable=SC2086
scripts/heavy.sh swiftc -O -swift-version 6 -D HOSTLESS_TESTS -D HOSTLESS_UNLOCKGATE $VAULT_SOURCES App/Core/UnlockGate.swift \
  App/Core/Relay/PeerIdentity.swift App/Core/Relay/RelayClient.swift App/Core/SafariRelay.swift App/Features/BrowserRelayServer.swift Tests/Relay/VaultRelay/main.swift -o build/relay-test/psss-relay-vault
export PSSS_VAULT_RELAY="$PWD/build/relay-test/psss-relay-vault"
python3 Extensions/Browser/build.py host --output build/relay-test/release-host
PSSS_RELEASE_HOST="$PWD/build/relay-test/release-host/psss-native-host" "$NODE" --disable-warning=ExperimentalWarning --test Extensions/Browser/tests/relay/relay.test.mjs
python3 -W error::ResourceWarning -m unittest discover -s Extensions/Browser/tests -p "host_test.py"
python3 Extensions/Browser/build.py check
