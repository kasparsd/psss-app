#!/bin/sh
# Runs heavy commands (a compile, a build, a test run) at most PSSS_HEAVY_SLOTS at a time on this Mac (default 4), at low
# priority. Unlimited Swift compiles and xcodebuild runs from several agents exhausted memory and crashed the machine, so
# every build and test run goes through here: scripts/heavy.sh xcodebuild …, and the test scripts call it themselves.
# The slots are lock files shared by every checkout and snapshot of the project. A command that already holds a slot runs
# straight through. A command waits when every slot is taken.
if [ -n "$PSSS_HEAVY_LOCKED" ]; then exec "$@"; fi
export PSSS_HEAVY_LOCKED=1
slots="${PSSS_HEAVY_SLOTS:-4}"
started="$(mktemp -t psss-heavy)" && rm -f "$started"
while :; do
  n=1
  while [ "$n" -le "$slots" ]; do
    # -t 0: do not wait for this slot. The marker tells a busy slot (no marker) from the command's own exit status.
    /usr/bin/lockf -k -s -t 0 "/tmp/psss-heavy.$n.lock" /bin/sh -c 'm="$1"; shift; : > "$m"; exec nice -n 10 "$@"' heavy "$started" "$@"
    status=$?
    if [ -e "$started" ]; then rm -f "$started"; exit "$status"; fi
    n=$((n + 1))
  done
  sleep 3
done
