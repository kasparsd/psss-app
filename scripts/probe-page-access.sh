#!/bin/sh
# Builds the throwaway page access probe (Tests/PageProbe). Signs with PSSS_SIGN_IDENTITY, else the first Apple Development identity.
set -eu
cd "$(dirname "$0")/.."
identity="${PSSS_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk '/Apple Development/ {print $2; exit}')}"
[ -n "$identity" ] || { echo "No Apple Development signing identity found." >&2; exit 1; }
app="build/page-probe/Psss Page Probe.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp Tests/PageProbe/Info.plist "$app/Contents/Info.plist"
scripts/heavy.sh xcrun swiftc -swift-version 5 -target "$(uname -m)-apple-macos27.0" Tests/PageProbe/main.swift -o "$app/Contents/MacOS/PageProbe"
codesign --force --options runtime --sign "$identity" --entitlements Tests/PageProbe/probe.entitlements "$app"
codesign --verify --strict "$app"
echo "Built $app"
