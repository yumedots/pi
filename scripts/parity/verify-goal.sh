#!/usr/bin/env bash
# One command that shows the state of the 1:1 work.
#
# Every check prints what it proved. The script does not hide a failure: it runs
# all of them and prints a summary at the end.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPI="$ROOT/rpi"
cd "$ROOT"

fail=0
run() {
	local label="$1"
	shift
	printf '\n=== %s\n' "$label"
	if "$@"; then
		printf 'ok: %s\n' "$label"
	else
		printf 'FAILED: %s\n' "$label"
		fail=1
	fi
}

run "the Rust port builds" bash -c "cd '$RPI' && cargo build --workspace"
run "the Rust port's tests pass" bash -c "cd '$RPI' && cargo test --workspace"
run "the 3dicon matches the reference frame by frame" bash -c "cd '$RPI' && cargo build -p rpi-tui --example logo3d && cd '$ROOT' && node scripts/parity/3dicon.mjs"
run "the parity harness finds no difference" bash -c "cd '$ROOT' && node scripts/parity/run-all.mjs"
run "the benchmarks have a Rust arm" bash -c "test -f bench/harness/results-rpi.json && test -f bench/tokens/results-rpi.json"
run "the feature inventory is complete" bash -c "grep -q 'Total rows' scripts/parity/FEATURES.md"
run "the mechanical audit runs" bash -c "cd '$ROOT' && node scripts/parity/audit.mjs >/dev/null"
run "the exception sheet exists" bash -c "test -f scripts/parity/EXCEPTIONS.md"
run "the extension runtime exists" bash -c "test -f rpi/crates/rpi-js/js/extension-host.bundle.js"

printf '\n'
if [ "$fail" -eq 0 ]; then
	printf 'every check passed\n'
else
	printf 'some checks failed\n'
fi
exit "$fail"
