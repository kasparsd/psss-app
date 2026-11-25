#!/bin/sh
# Builds and runs the hostless site-matching tests (public suffix rules, subdomain direction, lookalikes, and which logins and
# passkeys the passkey-request list offers, and what the picker search finds and releases one value at a time).
# One heavy job at a time on this Mac: see scripts/heavy.sh.
[ -n "$PSSS_HEAVY_LOCKED" ] || exec "$(dirname "$0")/heavy.sh" "$0" "$@"
set -e
cd "$(dirname "$0")/.."
mkdir -p build/matching-test
# The passkey-request list reads vault items, so the sources are the ones the KDBX tests build (see scripts/test-kdbx.sh).
SOURCES="App/Core/KDBX/*.swift App/Core/VaultItem.swift App/Core/TOTP.swift App/Core/Passkey.swift \
  App/Core/SharedVault.swift App/Core/SiteMatch.swift App/Core/PublicSuffixList.swift App/Core/UsageLog.swift App/Core/SampleVault.swift App/Core/VaultStore.swift App/Core/KeePassVaultStore.swift App/Core/BiometricKey.swift App/Core/PasswordGenerator.swift App/Core/PasswordRules.swift App/Core/AppleStyle.swift App/Core/OffensiveFilter.swift App/Core/WordList.swift App/Core/GeneratorSettings.swift App/Core/GeneratorText.swift App/Core/CardBrand.swift App/Core/CardNumber.swift App/Core/FillSite.swift App/Core/PasskeyRequestList.swift App/Core/HostDisplay.swift App/Core/DisplayText.swift App/Core/BrowserProtocol.swift App/Core/Relay/RelayFrame.swift App/Core/BrowserPrototypeStore.swift App/Core/BrowserVaults.swift App/Core/ItemSearch.swift App/Core/ReleaseCheck.swift App/Core/PickerSearch.swift App/Core/ResultGroups.swift App/Core/VaultState.swift App/Core/ReturnPlaces.swift App/Core/ItemFilter.swift App/Core/ItemSort.swift App/Core/ExtensionUnlockBudget.swift App/Core/ProviderNotices.swift App/Core/IncomingCodeMatch.swift App/Core/RecentlyDeletedText.swift App/Core/CSVImport.swift App/Core/Import/*.swift"
swiftc -O -swift-version 6 -D HOSTLESS_TESTS $SOURCES Tests/Matching/main.swift -o build/matching-test/run
build/matching-test/run
