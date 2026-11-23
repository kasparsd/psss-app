#!/bin/sh
# Runs one heavy command (a compile, a build, a test run) at a time on this Mac, at low priority.
# Several Swift compiles or xcodebuild runs at once have exhausted memory and crashed the machine, so every build and test
# run goes through here: scripts/heavy.sh xcodebuild …, and the test scripts call it themselves.
# The lock is one file for every checkout and snapshot of the project. A command that already holds it runs straight through.
if [ -n "$PSSS_HEAVY_LOCKED" ]; then exec "$@"; fi
export PSSS_HEAVY_LOCKED=1
exec /usr/bin/lockf -k /tmp/psss-heavy.lock nice -n 10 "$@"
