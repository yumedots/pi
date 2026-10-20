#!/bin/bash
# Watch the port's build and record the first break, so the fleet is not left
# with a broken tree for more than a couple of minutes.
#
# Usage: scripts/parity/build-watch.sh [interval-seconds]
#
# Writes the latest state to scripts/parity/out/build-state.txt:
#   OK                     the workspace builds
#   BROKEN <file> <error>  the first error, with the file it is in
set -u
INTERVAL="${1:-180}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/scripts/parity/out"
mkdir -p "$OUT"
STATE="$OUT/build-state.txt"

while true; do
  ERR="$(cd "$ROOT/rpi" && cargo build --workspace 2>&1 | grep -E "^error" -A 3 | head -20)"
  if [ -z "$ERR" ]; then
    printf 'OK %s\n' "$(date +%H:%M:%S)" > "$STATE"
  else
    FILE="$(printf '%s\n' "$ERR" | grep -oE '\-\-> [^ ]+' | head -1 | sed 's/--> //')"
    MSG="$(printf '%s\n' "$ERR" | grep -E "^error" | head -1)"
    printf 'BROKEN %s %s %s\n' "$(date +%H:%M:%S)" "$FILE" "$MSG" > "$STATE"
  fi
  sleep "$INTERVAL"
done
