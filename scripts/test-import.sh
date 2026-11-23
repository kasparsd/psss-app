#!/bin/sh
# Builds and runs the hostless importer tests: 1PIF reader and mapping, duplicates, the KDBX writer, the store, CSV, limits,
# a large generated export and a KeePassXC round trip. Everything it writes goes under build/import-test.
# PSSS_IMPORT_LARGE_ITEMS, PSSS_IMPORT_LARGE_FILES and PSSS_IMPORT_LARGE_FILE_MB scale the large case (default 50000 items
# and 20 files of 5 MB).
# One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/import-test
swiftc -O -swift-version 6 -D HOSTLESS_TESTS \
  App/Core/KDBX/*.swift App/Core/VaultItem.swift App/Core/TOTP.swift App/Core/Passkey.swift \
  App/Core/SharedVault.swift App/Core/SiteMatch.swift App/Core/PublicSuffixList.swift App/Core/UsageLog.swift App/Core/SampleVault.swift App/Core/VaultStore.swift App/Core/KeePassVaultStore.swift App/Core/BiometricKey.swift \
  App/Core/CSVImport.swift App/Core/Import/*.swift Tests/Import/main.swift \
  -o build/import-test/run
# The tests keep every file they write (vaults, backups, usage, the vault reference) under build/, never in real app data.
rm -rf build/import-test/root
PSSS_TEST_ROOT="$PWD/build/import-test/root" build/import-test/run build/import-test/work
