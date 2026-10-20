#!/bin/bash
# Build the port in a target directory of its own, so a developer running
# `cargo run` in the same tree is never blocked by an agent's build.
#
# Cargo takes an exclusive lock on the target directory, so two builds in one
# target directory serialise: the second waits with
# "Blocking waiting for file lock on build directory". Giving the agents their
# own target directory removes the contention entirely — the developer's
# `cargo run` uses the default `rpi/target`, the agents use this one, and
# neither waits for the other.
#
# Usage: scripts/agent-cargo.sh build --workspace
#        scripts/agent-cargo.sh test -p rpi-tui --lib
#
# The parity harness picks the binary up from PI_PARITY_RUST_BIN, so export it
# to the agents' build:
#
#   export PI_PARITY_RUST_BIN=/Users/gabriel/pi-native/rpi/target-agents/debug/rpi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/rpi/target-agents}"
mkdir -p "$CARGO_TARGET_DIR"

cd "$ROOT/rpi"
exec cargo "$@"
