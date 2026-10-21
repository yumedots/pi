#!/bin/bash
# Guard for this machine, which panics its kernel when it is pushed too hard.
#
# The macOS kernel panic ("no checkins from watchdogd in 94 seconds") and the
# desktop stalls both come from the same place: the machine runs out of memory
# and the swap starts moving pages while the compilers and the linker are
# holding gigabytes. This script watches the signs of that and acts:
#
#   check    exit 0 when a build may start, exit 1 with the reason when not
#   watch    the loop that keeps the pause state current
#   start    run the watcher in the background
#   stop     stop the watcher
#   status   print the readings and the pause state
#   prune    cargo's automatic garbage collection, which needs a nightly cargo
#
# The build wrapper calls "check" before every build, so a build that would
# start on a machine that is already in trouble waits instead. When the
# machine is critical the watcher also stops the compilers, because a build
# that is killed costs a few minutes and a frozen desktop costs the user
# their session.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${PI_GUARD_STATE_DIR:-/tmp/rpi-machine-guard}"
PAUSE_FILE="$STATE_DIR/paused"
PID_FILE="$STATE_DIR/daemon.pid"
LOG_FILE="$STATE_DIR/guard.log"

MAX_LOAD=${PI_GUARD_MAX_LOAD:-8}
MAX_COMPRESSED_GB=${PI_GUARD_MAX_COMPRESSED_GB:-4}
MAX_SWAP_MB=${PI_GUARD_MAX_SWAP_MB:-512}
MIN_DISK_FREE_GB=${PI_GUARD_MIN_DISK_FREE_GB:-8}
CRITICAL_SWAP_MB=${PI_GUARD_CRITICAL_SWAP_MB:-2048}
CRITICAL_COMPRESSED_GB=${PI_GUARD_CRITICAL_COMPRESSED_GB:-8}
SAMPLE_SECONDS=${PI_GUARD_SAMPLE_SECONDS:-5}

mkdir -p "$STATE_DIR"

read_stat() {
	vm_stat | awk -v key="$1" 'index($0, key) == 1 { value = $NF; gsub(/\./, "", value); print value; exit }'
}

page_size() {
	vm_stat | sed -n '1s/.*page size of \([0-9]*\).*/\1/p'
}

load_one() {
	sysctl -n vm.loadavg | tr -d '{}' | awk '{ print $1 }'
}

swap_used_mb() {
	sysctl -n vm.swapusage | sed -n 's/.*used = \([0-9.]*\)[MG].*/\1/p'
}

disk_free_gb() {
	df -k / | awk 'NR == 2 { printf "%.1f", $4 / 1048576 }'
}

compiler_count() {
	pgrep -x rustc 2>/dev/null | wc -l | tr -d ' '
}

over() {
	awk -v value="$1" -v limit="$2" 'BEGIN { exit !(value > limit) }'
}

under() {
	awk -v value="$1" -v limit="$2" 'BEGIN { exit !(value < limit) }'
}

evaluate() {
	REASONS=()
	LOAD=$(load_one)
	COMPRESSED_GB=$(( $(read_stat "Pages occupied by compressor") * $(page_size) / 1073741824 ))
	SWAP_MB=$(swap_used_mb)
	DISK_FREE_GB=$(disk_free_gb)
	COMPILERS=$(compiler_count)
	if over "$LOAD" "$MAX_LOAD"; then
		REASONS+=("the load average is $LOAD")
	fi
	if [ "${COMPRESSED_GB:-0}" -gt "$MAX_COMPRESSED_GB" ]; then
		REASONS+=("$COMPRESSED_GB GB of memory is compressed")
	fi
	if over "${SWAP_MB:-0}" "$MAX_SWAP_MB"; then
		REASONS+=("$SWAP_MB MB of swap is in use")
	fi
	if under "$DISK_FREE_GB" "$MIN_DISK_FREE_GB" 2>/dev/null; then
		REASONS+=("only $DISK_FREE_GB GB of disk is free")
	fi
	if [ "${COMPILERS:-0}" -gt 1 ]; then
		REASONS+=("$COMPILERS compiler processes are running at once")
	fi
}

is_critical() {
	over "${SWAP_MB:-0}" "$CRITICAL_SWAP_MB" || [ "${COMPRESSED_GB:-0}" -gt "$CRITICAL_COMPRESSED_GB" ]
}

stop_compilers() {
	pkill -x rustc 2>/dev/null
	pkill -x cargo 2>/dev/null
	pkill -x cc 2>/dev/null
	pkill -x clang 2>/dev/null
	pkill -x ld 2>/dev/null
}

cmd_check() {
	evaluate
	if [ ${#REASONS[@]} -gt 0 ]; then
		local joined=""
		for reason in "${REASONS[@]}"; do
			joined="${joined}${joined:+; }${reason}"
		done
		printf '%s\n' "$joined"
		return 1
	fi
	return 0
}

cmd_watch() {
	while true; do
		evaluate
		if is_critical; then
			stop_compilers
			printf '%s\n' "$(date +%H:%M:%S) stopped the compilers" >>"$LOG_FILE"
		fi
		if [ ${#REASONS[@]} -gt 0 ]; then
			{
				printf '%s\n' "$(date +%H:%M:%S) paused:"
				printf '  %s\n' "${REASONS[@]}"
			} >>"$LOG_FILE"
			printf '%s\n' "${REASONS[@]}" >"$PAUSE_FILE"
		elif [ -f "$PAUSE_FILE" ]; then
			rm -f "$PAUSE_FILE"
			printf '%s\n' "$(date +%H:%M:%S) resumed" >>"$LOG_FILE"
		fi
		sleep "$SAMPLE_SECONDS"
	done
}

cmd_start() {
	if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
		echo "the guard is already running (pid $(cat "$PID_FILE"))"
		return 0
	fi
	nohup "$0" watch >>"$LOG_FILE" 2>&1 &
	echo $! >"$PID_FILE"
	echo "the guard is running (pid $(cat "$PID_FILE")), the log is $LOG_FILE"
}

cmd_stop() {
	if [ -f "$PID_FILE" ]; then
		kill "$(cat "$PID_FILE")" 2>/dev/null
		rm -f "$PID_FILE"
	fi
	rm -f "$PAUSE_FILE"
	echo "the guard is stopped"
}

cmd_status() {
	evaluate
	echo "load            $LOAD"
	echo "compressed      ${COMPRESSED_GB} GB"
	echo "swap used       ${SWAP_MB} MB"
	echo "disk free       ${DISK_FREE_GB} GB"
	echo "compilers       ${COMPILERS}"
	if [ ${#REASONS[@]} -gt 0 ]; then
		echo "state           paused"
		printf '  %s\n' "${REASONS[@]}"
	else
		echo "state           ok"
	fi
}

cmd_prune() {
	local cargo_bin
	cargo_bin=$(rustup which --toolchain nightly cargo 2>/dev/null)
	if [ -z "$cargo_bin" ]; then
		echo "no nightly cargo is installed, so cargo's automatic garbage collection is not available"
		return 1
	fi
	echo "this removes the build artifacts the machine has not used recently"
	echo "run it when nothing else is building: the next build recompiles what it removed"
	cd "$ROOT/rpi" || return 1
	CARGO_TARGET_DIR="$ROOT/rpi/target" "$cargo_bin" clean --gc
}

case "${1:-status}" in
check) cmd_check ;;
watch) cmd_watch ;;
start) cmd_start ;;
stop) cmd_stop ;;
status) cmd_status ;;
prune) cmd_prune ;;
*)
	echo "usage: $0 {check|watch|start|stop|status|prune}"
	exit 2
	;;
esac
