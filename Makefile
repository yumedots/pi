SHELL := /bin/bash
.PHONY: help build run app install clean

PREFIX ?= $(HOME)/.local
BIN_DIR ?= $(PREFIX)/bin
BINARY := packages/coding-agent/dist/pi
ARGS ?=

help:
	@printf '%s\n' \
	  'make build    Build every workspace package into dist/' \
	  'make run      Run the fork from TypeScript sources (./pi-test.sh)' \
	  'make app      Compile the standalone fork binary to $(BINARY)' \
	  'make install  Build the binary and install it to $(BIN_DIR)/pi' \
	  'make clean    Remove build output'

build:
	npm run build

run:
	./pi-test.sh $(ARGS)

app:
	npm --prefix packages/coding-agent run build:binary

install: build app
	install -Dm755 $(BINARY) $(BIN_DIR)/pi
	@printf 'installed %s\n' "$(BIN_DIR)/pi"
	@found="$$(command -v pi || true)"; \
	if [ -n "$$found" ] && [ "$$found" != "$(BIN_DIR)/pi" ]; then \
	  printf 'warning: %s takes precedence on PATH\n' "$$found"; \
	fi

clean:
	npm run clean
