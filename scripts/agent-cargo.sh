#!/bin/bash
# Build the port with one compiler process, in one target directory.
#
# Why this wrapper exists: this machine panics its kernel when the CPU is
# pinned. Cargo's default is one rustc per core, and the machine has 11 cores,
# so an uncapped build runs 11 compiler processes at once, macOS's watchdog
# stops checking in, and the kernel panics:
#
#   panic(cpu 0 caller 0xfffffe003ca63250): watchdog timeout:
#   no checkins from watchdogd in 94 seconds
#
# Two rules make that impossible:
#
#   1. One target directory. Cargo takes an exclusive lock on it, so a second
#      build waits for the lock instead of starting its own compilers. Every
#      build on this machine, whether it comes from an agent or from a
#      developer at the prompt, goes through rpi/target, so at most one build
#      runs at a time and that build uses one compiler process.
#
#   2. One job. CARGO_BUILD_JOBS is set here so that an environment variable
#      in the shell cannot raise the count above what rpi/.cargo/config.toml
#      allows. The config file's jobs = 1 covers the plain `cargo build`
#      path; this covers the environment.
#
# Usage: scripts/agent-cargo.sh build --workspace
#        scripts/agent-cargo.sh test -p rpi-tui --lib
#
# The parity harness picks the binary up from PI_PARITY_RUST_BIN:
#
#   export PI_PARITY_RUST_BIN=/Users/gabriel/pi-native/rpi/target/debug/rpi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="$ROOT/rpi/target"
export CARGO_BUILD_JOBS=1
mkdir -p "$CARGO_TARGET_DIR"

# The guard holds the build back while the machine is in trouble, so a build
# never starts on a machine that is already short of memory or running more
# than one compiler. The wait is bounded: the build goes ahead after half an
# hour so that a stuck guard cannot block the work forever.
GUARD="$ROOT/scripts/machine-guard.sh"
if [ -x "$GUARD" ]; then
	waited=0
	while true; do
		if reason=$("$GUARD" check 2>/dev/null); then
			break
		fi
		echo "machine-guard: $reason" >&2
		if [ "$waited" -ge 30 ]; then
			echo "machine-guard: starting the build anyway" >&2
			break
		fi
		waited=$((waited + 1))
		sleep 60
	done
fi

cd "$ROOT/rpi"

# The build runs on the nightly cargo, because the stable cargo has no cache
# garbage collection and the target directory on this machine is close to full.
# The nightly cargo's artifacts are not interchangeable with the stable cargo's,
# so the stable cargo must not be used on this tree: it would invalidate the
# whole cache and force the from-scratch rebuild that stalls the machine.
CARGO_BIN=$(rustup which --toolchain nightly cargo 2>/dev/null || true)
if [ -z "$CARGO_BIN" ]; then
	CARGO_BIN=$(rustup which --toolchain stable cargo 2>/dev/null || true)
fi
if [ -z "$CARGO_BIN" ]; then
	CARGO_BIN=cargo
	exec "$CARGO_BIN" "$@"
fi

exec "$CARGO_BIN" -Zgc "$@"
