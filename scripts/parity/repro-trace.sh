#!/bin/bash
# Reproduce with the key trace on: shows when the key loop starts and when
# each keystroke arrives.
#
# Usage: scripts/parity/repro-trace.sh <delay-ms> [binary] [keys...]
set -uo pipefail

DELAY="${1:-4000}"
BIN="${2:-/Users/gabriel/pi-native/rpi/target/debug/rpi}"
shift 2 2>/dev/null || true
KEYS=("$@")
if [ ${#KEYS[@]} -eq 0 ]; then KEYS=("hello world"); fi

SCRATCH="/tmp/rpi-repro"
SESSION="rpi-repro-$$"
LOG="$SCRATCH/keys.log"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/home" "$SCRATCH/agent" "$SCRATCH/work"

cat > "$SCRATCH/agent/models.json" <<'JSON'
{
  "providers": {
    "mock": {
      "baseUrl": "http://127.0.0.1:9/v1",
      "api": "openai-completions",
      "apiKey": "parity-key",
      "models": [{ "id": "mock-1", "name": "Mock Model", "contextWindow": 128000, "maxTokens": 4096 }]
    }
  }
}
JSON

cat > "$SCRATCH/agent/settings.json" <<'JSON'
{ "threeDEmptySession": false }
JSON

tmux -L rpi-repro kill-session -t "$SESSION" 2>/dev/null
tmux -L rpi-repro new-session -d -s "$SESSION" -x 100 -y 30 sh -c "
  cd '$SCRATCH/work' &&
  HOME='$SCRATCH/home' PI_CODING_AGENT_DIR='$SCRATCH/agent' RPI_DEBUG_KEYS='$LOG' '$BIN' \
    --offline --no-session --provider mock --model mock/mock-1 --api-key parity-key
"

sleep "$(awk "BEGIN{print $DELAY/1000}")"
for key in "${KEYS[@]}"; do
  tmux -L rpi-repro send-keys -t "$SESSION" "$key"
  sleep 0.05
done
sleep 3
echo "--- pane ---"
tmux -L rpi-repro capture-pane -p -t "$SESSION" | grep -v '^$' | tail -12
echo "--- key trace ---"
cat "$LOG" 2>/dev/null
tmux -L rpi-repro kill-session -t "$SESSION" 2>/dev/null
