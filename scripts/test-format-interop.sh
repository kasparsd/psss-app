#!/bin/sh
# Opens what the Swift implementation sealed (build/format-test/sealed-by-swift.json, written by scripts/test-format-swift.sh)
# with the TypeScript reference implementation in Packages/format, and fails if any entry does not open to the expected
# content. Needs Node 24; compiles nothing, installs nothing.
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
  echo "test-format-interop: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

JSON=build/format-test/sealed-by-swift.json
if [ ! -f "$JSON" ]; then
  echo "test-format-interop: $JSON is missing. Run scripts/test-format-swift.sh first; it writes that file." >&2
  exit 1
fi

cd Packages/format
exec "$NODE" --disable-warning=ExperimentalWarning scripts/open-swift-sealed.ts "../../$JSON"
