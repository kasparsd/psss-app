#!/bin/sh
# Builds and runs the hostless checks for the order of the Codes list.
# One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/codes-test
SOURCES="App/Core/VaultItem.swift App/Core/CodesOrder.swift App/Core/AddressLayout.swift App/Core/TOTP.swift App/Core/Passkey.swift \
  App/Core/SharedVault.swift App/Core/SiteMatch.swift App/Core/PublicSuffixList.swift App/Core/CardBrand.swift App/Core/CardNumber.swift \
  App/Core/DisplayText.swift App/Core/HostDisplay.swift"
swiftc -O -swift-version 6 -D HOSTLESS_TESTS $SOURCES Tests/Codes/main.swift -o build/codes-test/run
build/codes-test/run
