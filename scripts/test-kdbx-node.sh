#!/bin/sh
# Runs the @psss/kdbx tests (Packages/kdbx): known answers for the primitives, round trips over every version, KDF, cipher
# and key kind, real KeePassXC files, interop with keepassxc-cli (skipped when it is absent) and hostile input.
# Needs Node 24; compiles nothing, installs nothing. Run one test run at a time.
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
  echo "test-kdbx-node: Node 24 not found. Install it (see .nvmrc, for example 'nvm install 24') and run again." >&2
  exit 1
fi

cd Packages/kdbx
# With no arguments: every suite. Arguments name test files (for example test/kat.test.ts).
[ $# -gt 0 ] || set -- test/*.test.ts
exec "$NODE" --disable-warning=ExperimentalWarning --test "$@"
