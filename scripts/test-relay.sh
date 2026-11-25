#!/bin/sh
# The browser relay harness: the hostile-input and secrecy checklist (AGENTS.md, "Delegated work and validation") for the socket
# between the native host and the app. Builds the test host (reads PSSS_RELAY_SOCKET, skips the app check), a release-style host
# (ad hoc, no team) and the stand-in relay (the app's real relay server over the prototype's vaults), then runs
#   - the generated extension-id list check,
#   - Extensions/Browser/tests/relay/relay.test.mjs (framing fuzz, deadlines, limits, lock and socket files, refused peers,
#     kill -9 both ways, hostile names, the secret scan),
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
python3 Extensions/Browser/build.py host --output build/relay-test/release-host
PSSS_RELEASE_HOST="$PWD/build/relay-test/release-host/psss-native-host" "$NODE" --disable-warning=ExperimentalWarning --test Extensions/Browser/tests/relay/relay.test.mjs
python3 -W error::ResourceWarning -m unittest discover -s Extensions/Browser/tests -p "host_test.py"
python3 Extensions/Browser/build.py check
