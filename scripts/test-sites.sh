#!/bin/sh
# Runs the tests of the disposable test sites (Packages/test-sites): TOTP vectors, passkey verification, form and script flows.
# Needs Node 24; installs nothing and listens only on 127.0.0.1 with a random port.
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
  echo "test-sites: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

cd Packages/test-sites
exec "$NODE" --disable-warning=ExperimentalWarning --test "${@:-test/*.test.ts}"
