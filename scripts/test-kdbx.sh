#!/bin/sh
# Builds and runs the hostless KDBX codec tests (RFC vectors, round trips, KeePassXC interop).
# One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/kdbx-test
SOURCES="App/Core/KDBX/*.swift App/Core/VaultItem.swift App/Core/TOTP.swift App/Core/Passkey.swift \
  App/Core/SharedVault.swift App/Core/SiteMatch.swift App/Core/PublicSuffixList.swift App/Core/UsageLog.swift App/Core/SampleVault.swift App/Core/VaultStore.swift App/Core/KeePassVaultStore.swift App/Core/BiometricKey.swift App/Core/PasswordGenerator.swift App/Core/CardBrand.swift App/Core/CardNumber.swift App/Core/FillSite.swift App/Core/HostDisplay.swift App/Core/DisplayText.swift App/Core/BrowserProtocol.swift App/Core/BrowserPrototypeStore.swift App/Core/ReleaseCheck.swift App/Core/CSVImport.swift App/Core/Import/*.swift Tests/KDBX/TimeFuzz.swift"
swiftc -O -swift-version 6 -D HOSTLESS_TESTS -D HOSTLESS_UNLOCKGATE $SOURCES App/Core/UnlockGate.swift Tests/KDBX/main.swift -o build/kdbx-test/run
# The time parser tests again, without optimization (-Onone), so a parser that only behaves under the optimizer's code generation
# fails here.
swiftc -Onone -swift-version 6 -D HOSTLESS_TESTS $SOURCES Tests/KDBX/TimeParser/main.swift -o build/kdbx-test/time-parser-onone
# The tests keep every file they write (vaults, backups, usage, the vault reference) under build/, never in real app data.
rm -rf build/kdbx-test/root
PSSS_TEST_ROOT="$PWD/build/kdbx-test/root" build/kdbx-test/run build/kdbx-test/fixtures
build/kdbx-test/time-parser-onone > build/kdbx-test/time-parser-onone.log || { tail -20 build/kdbx-test/time-parser-onone.log; exit 1; }
tail -2 build/kdbx-test/time-parser-onone.log
