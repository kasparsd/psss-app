#!/bin/bash
# Sync spike runner (docs/plans/sync-spike-cloudkit.md). Starts two sides of the Debug-only sync harness with the same seed,
# start time, interval and run id, waits for both, collects their output under build/sync-spike/<run id>/ and compares them.
#
#   scripts/spike-sync.sh mac-mac    [rounds] [interval seconds]   two processes of the signed Mac app on this Mac
#   scripts/spike-sync.sh mac-iphone [rounds] [interval seconds]   the Mac app plus the iPhone (installs the iOS build first)
#
# Defaults: 200 rounds, 3 s. Build first with scripts/xcb.sh (see docs/development.md), using
#   -derivedDataPath build/sync-spike-dd -allowProvisioningUpdates
# Environment: SPIKE_DD (derived data, default build/sync-spike-dd), SPIKE_PHONE (default Posti), SPIKE_LEAD (seconds before
# the start time, default 25 for mac-mac and 60 for mac-iphone), SPIKE_POLL (seconds between fetches, default 0.5),
# SPIKE_EXTRA (extra launch arguments for both sides, for example "-psss-sync-asset-threshold 0").
# Writes only to the development environment of iCloud.app.psss, private database, in the zone spike-<run id>.

set -u
cd "$(dirname "$0")/.."
mode="${1:-}"
rounds="${2:-200}"
interval="${3:-3}"
dd="${SPIKE_DD:-build/sync-spike-dd}"
phone="${SPIKE_PHONE:-Posti}"
poll="${SPIKE_POLL:-0.5}"
extra="${SPIKE_EXTRA:-}"
bundle="app.psss.Psss"
mac_app="$dd/Build/Products/Debug/Psss.app"
ios_app="$dd/Build/Products/Debug-iphoneos/Psss.app"

case "$mode" in
  mac-mac) lead="${SPIKE_LEAD:-25}"; side_b="mac-b" ;;
  mac-iphone) lead="${SPIKE_LEAD:-60}"; side_b="posti" ;;
  *) sed -n '2,12p' "$0"; exit 64 ;;
esac

[ -x "$mac_app/Contents/MacOS/Psss" ] || { echo "no signed Mac build at $mac_app" >&2; exit 66; }

run="r$(date +%m%d%H%M%S)$RANDOM"
seed="$(openssl rand -hex 32)"
out="build/sync-spike/$run"
mkdir -p "$out"
echo "run $run  mode $mode  rounds $rounds  interval ${interval}s  output $out"

if [ "$mode" = "mac-iphone" ]; then
  [ -d "$ios_app" ] || { echo "no signed iOS build at $ios_app" >&2; exit 66; }
  echo "installing on $phone ..."
  xcrun devicectl device install app --device "$phone" "$ios_app" > "$out/install.log" 2>&1 || {
    echo "install failed, see $out/install.log:"; tail -15 "$out/install.log"; exit 70; }
fi

start="$(node -e "console.log((Date.now()/1000 + $lead).toFixed(3))")"
args=(-psss-sync-spike -psss-sync-seed "$seed" -psss-sync-start "$start" -psss-sync-rounds "$rounds"
      -psss-sync-interval "$interval" -psss-sync-run "$run" -psss-sync-poll "$poll")
# shellcheck disable=SC2206
[ -n "$extra" ] && args+=($extra)

"$mac_app/Contents/MacOS/Psss" "${args[@]}" -psss-sync-device mac-a > "$out/mac-a.log" 2>&1 &
pid_a=$!
if [ "$mode" = "mac-mac" ]; then
  "$mac_app/Contents/MacOS/Psss" "${args[@]}" -psss-sync-device mac-b > "$out/mac-b.log" 2>&1 &
  pid_b=$!
else
  xcrun devicectl device process launch --device "$phone" --console --terminate-existing "$bundle" -- \
    "${args[@]}" -psss-sync-device posti > "$out/posti.log" 2>&1 &
  pid_b=$!
fi
echo "started at $(date +%H:%M:%S); round 1 is due at $(node -e "console.log(new Date(($start + $interval)*1000).toTimeString().slice(0,8))")"
echo "expected to take about $(node -e "console.log(Math.round($lead + $rounds*$interval))") s plus the final wait"

wait "$pid_a"; code_a=$?
wait "$pid_b"; code_b=$?
echo "exit codes: mac-a=$code_a $side_b=$code_b"

if [ "$mode" = "mac-iphone" ]; then
  xcrun devicectl device copy from --device "$phone" --domain-type appDataContainer --domain-identifier "$bundle" \
    --source "Documents/sync-spike-$run-posti.txt" --destination "$out/posti.file.txt" > "$out/copy.log" 2>&1 \
    || echo "could not copy the phone's own output file (see $out/copy.log); the console log is $out/posti.log"
fi

echo
# devicectl's console ends each line of the phone's output with a carriage return; without removing it no line ever compares equal.
get() { grep -h "^summary $2" "$out/$1.log" 2>/dev/null | head -1 | sed "s/^summary //" | tr -d '\r'; }
for side in mac-a "$side_b"; do
  echo "== $side"
  grep -h "^summary " "$out/$side.log" 2>/dev/null | sed 's/^/   /' || echo "   (no summary)"
done
echo
verdict=0
cmp_line() {
  local what="$1" key="$2"
  local a b; a="$(get mac-a "$key")"; b="$(get "$side_b" "$key")"
  if [ -n "$a" ] && [ "$a" = "$b" ]; then echo "same  $what"; else echo "DIFF  $what"; echo "        mac-a: $a"; echo "        $side_b: $b"; verdict=1; fi
}
ta="$(get mac-a records | sed 's/.*total=\([0-9]*\).*/\1/')"; tb="$(get "$side_b" records | sed 's/.*total=\([0-9]*\).*/\1/')"
if [ -n "$ta" ] && [ "$ta" = "$tb" ]; then echo "same  total records ($ta)"; else echo "DIFF  total records ($ta vs $tb)"; verdict=1; fi
cmp_line "id hash" "id_hash"
cmp_line "state hash" "state_hash"
cmp_line "winning value" "winner="
for side in mac-a "$side_b"; do grep -q "^summary result=OK" "$out/$side.log" 2>/dev/null || { echo "FAIL  $side did not report result=OK"; verdict=1; }; done
[ "$code_a" = 0 ] && [ "$code_b" = 0 ] || { echo "FAIL  non-zero exit code"; verdict=1; }
if [ "$verdict" = 0 ]; then echo "RESULT: converged"; else echo "RESULT: NOT converged or a side failed"; fi
exit "$verdict"
