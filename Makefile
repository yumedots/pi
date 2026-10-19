SHELL := /bin/bash
.PHONY: help build run app install clean

PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin
LIB_DIR ?= $(PREFIX)/lib/pi
DIST := packages/coding-agent/dist
BINARY := $(DIST)/pi
ARGS ?=

help:
	@printf '%s\n' \
	  'make build    Build every workspace package into dist/' \
	  'make run      Run the fork from TypeScript sources (./pi-test.sh)' \
	  'make app      Compile the standalone fork binary to $(BINARY)' \
	  'make install  Build the binary and install it to $(BIN_DIR)/pi' \
	  'make clean    Remove build output'

# npm prints a blank line before its run-script banner; drop it so the output
# starts with the command instead of an empty gap.
STRIP_LEADING_BLANK = sed -e '1{/^$$/d;}'

build:
	@set -o pipefail; npm run build | $(STRIP_LEADING_BLANK)

run:
	@if [ -t 1 ]; then exec ./pi-test.sh $(ARGS); else set -o pipefail; ./pi-test.sh $(ARGS) | $(STRIP_LEADING_BLANK); fi

app:
	npm --prefix packages/coding-agent run build:binary

install: build app
	rm -rf $(LIB_DIR)
	install -d $(LIB_DIR)
	install -m755 $(BINARY) $(LIB_DIR)/pi
	cp $(DIST)/package.json $(DIST)/README.md $(DIST)/CHANGELOG.md $(DIST)/photon_rs_bg.wasm $(LIB_DIR)/
	cp -r $(DIST)/theme $(DIST)/assets $(DIST)/export-html $(DIST)/docs $(DIST)/examples $(LIB_DIR)/
	ln -sfn ../lib/pi/pi $(BIN_DIR)/pi
	@printf 'installed %s -> %s (%s)\n' "$(BIN_DIR)/pi" "$(LIB_DIR)/pi" "$$($(BIN_DIR)/pi --version)"
	@found="$$(command -v pi || true)"; \
	if [ -n "$$found" ] && [ "$$found" != "$(BIN_DIR)/pi" ]; then \
	  printf 'warning: %s takes precedence on PATH\n' "$$found"; \
	fi

clean:
	npm run clean
