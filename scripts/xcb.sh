#!/bin/sh
# xcodebuild, one at a time and with few parallel compile jobs, so a build cannot exhaust this Mac's memory.
# Use it for every build: scripts/xcb.sh -project KDBOX.xcodeproj -scheme KDBOX-macOS build
exec "$(dirname "$0")/heavy.sh" xcodebuild -jobs "${PSSS_BUILD_JOBS:-3}" "$@"
