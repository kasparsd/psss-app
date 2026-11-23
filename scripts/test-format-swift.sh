#!/bin/sh
# Builds and runs the hostless test of the Swift core of the vault format (App/Core/Format) against the vectors in
# Packages/format/vectors, and writes build/format-test/sealed-by-swift.json for the Node package to open.
# One heavy job at a time on this Mac: see scripts/heavy.sh. PSSS_HEAVY=1 also runs the 1 GiB Argon2id vector.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/format-test
swiftc -O -swift-version 6 App/Core/Format/*.swift App/Core/KDBX/Argon2.swift App/Core/KDBX/Blake2b.swift Tests/Format/main.swift -o build/format-test/run
build/format-test/run Packages/format/vectors build/format-test
