#!/bin/sh
# Runs the format reference implementation's tests (Packages/format): vectors regenerate byte for byte, every vector is
# checked against the library, and the seeded property tests. Needs Node 24; compiles nothing, installs nothing.
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
  echo "test-format: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

cd Packages/format
exec "$NODE" --disable-warning=ExperimentalWarning --test test/*.test.ts
