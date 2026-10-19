#!/usr/bin/env bash
# Compare the `bun build --compile` variants: size, build time and startup.
#
# Startup is measured twice: the first run reads the binary from a cold page
# cache, the rest are warm. Both numbers matter, because a user downloads
# the binary once and then runs it many times.
set -uo pipefail

cd "$(dirname "$0")/../packages/coding-agent"

ENTRIES=(./dist/bun/cli.js ./src/utils/image-resize-worker.ts ./src/extensions/codemode/worker.ts)
COMMON=(--no-compile-autoload-bunfig --no-compile-autoload-dotenv)

run_variant() {
	local name="$1"
	shift
	local out="/tmp/pi-variant-$name"
	rm -f "$out"
	local start end
	start=$(date +%s%N)
	if ! bun build --compile "${COMMON[@]}" "$@" "${ENTRIES[@]}" --outfile "$out" >/dev/null 2>&1; then
		printf '%-28s BUILD FAILED\n' "$name"
		return
	fi
	end=$(date +%s%N)
	local size
	size=$(stat -f%z "$out" 2>/dev/null || stat -c%s "$out")

	local cold warm s e
	s=$(date +%s%N); "$out" --version >/dev/null 2>&1; e=$(date +%s%N); cold=$(((e - s) / 1000000))
	warm=0
	for _ in 1 2 3 4 5; do
		s=$(date +%s%N); "$out" --version >/dev/null 2>&1; e=$(date +%s%N)
		warm=$((warm + (e - s) / 1000000))
	done
	warm=$((warm / 5))

	# A functional smoke test: the version, the model list and a failing
	# command must all behave.
	local version models bad
	version="$("$out" --version 2>&1)"
	models="$("$out" --list-models 2>&1 | wc -l | tr -d ' ')"
	"$out" definitely-not-a-command >/dev/null 2>&1
	bad=$?

	printf '%-28s build %4d ms | %6.1f MiB | cold %4d ms | warm %4d ms | models %4s lines | exit %s\n' \
		"$name" "$(((end - start) / 1000000))" "$(echo "scale=2; $size / 1048576" | bc)" \
		"$cold" "$warm" "$models" "$bad"
}

run_variant current
run_variant minify --minify
run_variant bytecode --bytecode
run_variant sourcemap --sourcemap=external
run_variant minify-bytecode --minify --bytecode
run_variant target-modern --target=bun-darwin-arm64-modern
run_variant target-baseline --target=bun-darwin-arm64-baseline
