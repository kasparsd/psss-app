#!/bin/sh
# Runs the tests of the psss command line (Packages/cli): commands, exit codes, configuration, secrets and the approved terminal frames.
# Needs Node 24; compiles nothing, installs nothing, and touches only temporary folders.
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
  echo "test-cli: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

cd Packages/cli
exec "$NODE" --disable-warning=ExperimentalWarning --test test/*.test.ts
