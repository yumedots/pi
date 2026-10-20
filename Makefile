SHELL := /bin/bash
.DEFAULT_GOAL := help

# Toolchain: Bun drives the whole dev, build, test and release pipeline.
# Node stays in the tree for the published npm packages and for the parts of
# the toolchain that still need it (see MIGRATION.md).
BUN ?= bun

PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin
LIB_DIR ?= $(PREFIX)/lib/pi
DIST := packages/coding-agent/dist
BINARY := $(DIST)/pi
ARGS ?=
FILE ?=

LOCKFILE := bun.lock
NODE_MODULES := node_modules

.PHONY: help install install-ci hydrate build build-offline build-binary check \
        test test-one bench bench-compare clean dev release-local run app \
        install-app require-bun require-install

help:
	@printf '%s\n' \
	  'Pi development targets (toolchain: Bun)' \
	  '' \
	  '  make install        Install workspace dependencies (bun install)' \
	  '  make install-ci     Install dependencies from a frozen lockfile (CI)' \
	  '  make hydrate        Refresh the bundled model data from models.dev' \
	  '  make build          Build every workspace package into dist/' \
	  '  make build-offline  Build every workspace package with the bundled model data' \
	  '  make build-binary   Compile the standalone binary to $(BINARY)' \
	  '  make check          Run biome, the lockfile checks, tsc --noEmit and the smoke checks' \
	  '  make test           Run the full test suite in an isolated home' \
	  '  make test-one FILE=<path>   Run a single test file' \
	  '  make bench          Run the full benchmark and write bench/*.md' \
	  '  make bench-compare  Write bench/compare.md from the stored results' \
	  '  make dev            Run the fork from TypeScript sources (./pi-test.sh)' \
	  '  make release-local  Build, pack and smoke-test the published packages' \
	  '  make app            Alias for build-binary' \
	  '  make install-app    Install the compiled binary to $(BIN_DIR)/pi' \
	  '  make clean          Remove build output' \
	  '' \
	  '  make help           Show this message'

# Fail with a clear message instead of a confusing "command not found".
require-bun:
	@command -v $(BUN) >/dev/null 2>&1 || { \
	  printf 'error: Bun is required but was not found on PATH.\n' >&2; \
	  printf '       Install it with: curl -fsSL https://bun.sh/install | bash\n' >&2; \
	  printf '       Or point at it explicitly: make BUN=/path/to/bun <target>\n' >&2; \
	  exit 1; \
	}
	@printf '==> %s\n' "$(BUN) --version"

# Run `install` only when node_modules is missing or older than the lockfile.
require-install:
	@if [ ! -d $(NODE_MODULES) ] || [ $(LOCKFILE) -nt $(NODE_MODULES) ]; then \
	  printf '==> node_modules is missing or stale; installing dependencies\n'; \
	  $(MAKE) --no-print-directory install; \
	fi

install: require-bun
	@printf '==> bun install\n'
	@$(BUN) install

install-ci: require-bun
	@printf '==> bun install --frozen-lockfile --ignore-scripts\n'
	@$(BUN) install --frozen-lockfile --ignore-scripts

hydrate: require-bun
	@printf '==> refreshing the bundled model data from models.dev\n'
	@$(BUN) run hydrate:model-data

build: require-bun require-install
	@printf '==> bun run build\n'
	@$(BUN) run build

build-offline: require-bun require-install
	@printf '==> bun run build:offline\n'
	@$(BUN) run build:offline

build-binary: require-bun require-install
	@printf '==> bun run build:binary (packages/coding-agent)\n'
	@cd packages/coding-agent && $(BUN) run build:binary

check: require-bun require-install
	@printf '==> bun run check\n'
	@$(BUN) run check

test: require-bun require-install
	@printf '==> ./test.sh\n'
	@./test.sh

test-one: require-bun require-install
	@if [ -z "$(FILE)" ]; then \
	  printf 'error: test-one needs a file, for example: make test-one FILE=packages/agent/test/agent.test.ts\n' >&2; \
	  exit 1; \
	fi
	@pkg="$$(echo "$(FILE)" | cut -d/ -f1-2)"; \
	 rel="$$(echo "$(FILE)" | sed "s|^$$pkg/||")"; \
	 if [ -f "$$pkg/vitest.config.ts" ]; then \
	   printf '==> vitest --run %s (in %s)\n' "$$rel" "$$pkg"; \
	   cd "$$pkg" && ../../node_modules/.bin/vitest --run "$$rel"; \
	 else \
	   printf '==> node --test %s (in %s)\n' "$$rel" "$$pkg"; \
	   cd "$$pkg" && node --test "$$rel"; \
	 fi

bench: require-bun require-install
	@printf '==> running the npm baseline benchmark\n'
	@$(BUN) bench/bench.mjs --profile npm --out npm-current
	@printf '==> running the Bun benchmark\n'
	@$(BUN) bench/bench.mjs --profile bun
	@$(BUN) bench/render.mjs

bench-compare:
	@printf '==> rendering bench/compare.md\n'
	@$(BUN) bench/render.mjs --compare

clean:
	@printf '==> cleaning build output\n'
	@$(BUN) run clean

dev:
	@if [ -t 1 ]; then exec ./pi-test.sh $(ARGS); else set -o pipefail; ./pi-test.sh $(ARGS); fi

release-local: require-bun require-install
	@printf '==> bun run release:local\n'
	@$(BUN) run release:local

run: dev

app: build-binary

# Install the compiled binary into $(BIN_DIR) and the shared assets into $(LIB_DIR).
install-app: build-binary
	rm -rf $(LIB_DIR)
	install -d $(LIB_DIR)
	install -m755 $(BINARY) $(LIB_DIR)/pi
	cp $(DIST)/package.json $(DIST)/README.md $(DIST)/CHANGELOG.md $(DIST)/photon_rs_bg.wasm $(LIB_DIR)/
	cp -r $(DIST)/theme $(DIST)/assets $(DIST)/export-html $(DIST)/docs $(DIST)/examples $(LIB_DIR)/
	ln -sfn ../lib/pi/pi $(BIN_DIR)/pi
	@printf 'installed %s -> %s (%s)\n' "$(BIN_DIR)/pi" "$(LIB_DIR)/pi" "$$($(BIN_DIR)/pi --version)"
	@found="$$(command -v pi || true)"; \
	if [ -n "$$found" ] && [ "$$found" != "$(BIN_DIR)/pi" ]; then \
	  printf 'warning: %s takes precedence on PATH, so `pi` still runs that one.\n' "$$found"; \
	  printf '         run the fork with %s, or put %s first on your PATH.\n' "$(BIN_DIR)/pi" "$(BIN_DIR)"; \
	fi
