#!/bin/bash
# Prune cargo target directories.
#
# Every cargo workspace under the repo accumulates build artifacts: the
# default `target`, the release profile's copy inside it, and the incremental
# compilation caches. A debug build of one workspace is ~2 GB, so a few
# checkouts fill a disk.
#
# What it does, in order of how safe it is:
#   1. `cargo clean --release` in every workspace it finds — the release
#      artifacts are the biggest and the least used day to day.
#   2. removes the incremental compilation caches, which are pure cache:
#      deleting them costs a rebuild, not correctness.
#   3. reports what is left.
#
# Usage:
#   scripts/prune-targets.sh            # the safe passes
#   scripts/prune-targets.sh --dry-run  # print what would go
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY=1 ;;
		-h | --help)
		sed -n '2,18p' "$0"
		exit 0
		;;
	esac
done

run() {
	echo "> $*"
	[ "$DRY" = "1" ] || "$@"
}

# Every cargo workspace under the repo, with its target directories.
workspaces() {
	find "$ROOT" -name Cargo.toml -not -path "*/node_modules/*" -not -path "*/target/*" -not -path "*/target-*/*" \
		-exec dirname {} \; 2>/dev/null | sort -u
}

size_of() {
	[ -e "$1" ] || return 0
	du -sh "$1" 2>/dev/null | cut -f1
}

echo "== before =="
for ws in $(workspaces); do
	for dir in "$ws/target" "$ws"/target-*; do
		[ -d "$dir" ] || continue
		echo "  $(size_of "$dir")  $dir"
	done
done

for ws in $(workspaces); do
	# The release artifacts are large and rarely needed.
	run cargo clean --release --manifest-path "$ws/Cargo.toml"
done

# The incremental compilation caches are the largest part of a cargo target
# directory and are pure cache: deleting them costs a rebuild, not correctness.
for ws in $(workspaces); do
	for dir in "$ws/target" "$ws"/target-*; do
		[ -d "$dir" ] || continue
		for inc in "$dir"/*/incremental; do
			[ -d "$inc" ] || continue
			echo "removing the incremental cache: $inc ($(size_of "$inc"))"
			[ "$DRY" = "1" ] || rm -rf "$inc"
		done
	done
done

echo "== after =="
for ws in $(workspaces); do
	for dir in "$ws/target" "$ws"/target-*; do
		[ -d "$dir" ] || continue
		echo "  $(size_of "$dir")  $dir"
	done
done
