#!/bin/sh
# Builds and runs the hostless KDBX codec tests (RFC vectors, round trips, KeePassXC interop).
set -e
cd "$(dirname "$0")/.."
mkdir -p build/kdbx-test
swiftc -O -swift-version 6 \
  App/Core/KDBX/*.swift App/Core/VaultItem.swift App/Core/TOTP.swift App/Core/Passkey.swift \
  App/Core/SharedVault.swift App/Core/SampleVault.swift App/Core/VaultStore.swift App/Core/KeePassVaultStore.swift Tests/KDBX/main.swift \
  -o build/kdbx-test/run
build/kdbx-test/run build/kdbx-test/fixtures
