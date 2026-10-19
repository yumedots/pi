#!/usr/bin/env bash
# Portable peak-RSS measurement.
#
#   scripts/measure-memory.sh <command...>
#
# macOS `/usr/bin/time -l` prints "maximum resident set size" in bytes.
# Linux `/usr/bin/time -v` prints "Maximum resident set size (kbytes)" in KiB.
# This wrapper normalizes both to a single "max_rss_bytes=<n>" line on stdout.
set -uo pipefail

if [ "$(uname -s)" = "Darwin" ]; then
	out="$(/usr/bin/time -l "$@" 2>&1)"
	bytes="$(printf '%s\n' "$out" | awk '/maximum resident set size/ {print $1; exit}')"
else
	out="$(/usr/bin/time -v "$@" 2>&1)"
	bytes="$(printf '%s\n' "$out" | awk '/Maximum resident set size \(kbytes\)/ {print $NF * 1024; exit}')"
fi

printf 'max_rss_bytes=%s\n' "${bytes:-0}"
printf '%s\n' "$out" >&2
