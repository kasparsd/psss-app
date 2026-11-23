#!/bin/sh
# xcodebuild through scripts/heavy.sh (at most two heavy jobs at once) and with few parallel compile jobs, so a build cannot exhaust this Mac's memory.
# Use it for every build: scripts/xcb.sh -project Psss.xcodeproj -scheme Psss-macOS build
exec "$(dirname "$0")/heavy.sh" xcodebuild -jobs "${PSSS_BUILD_JOBS:-3}" "$@"
