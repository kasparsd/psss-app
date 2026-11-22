#!/bin/sh
# Builds and runs the hostless site-matching tests (public suffix rules, subdomain direction, lookalikes).
set -e
cd "$(dirname "$0")/.."
mkdir -p build/matching-test
swiftc -O -swift-version 6 App/Core/SiteMatch.swift App/Core/PublicSuffixList.swift Tests/Matching/main.swift -o build/matching-test/run
build/matching-test/run
