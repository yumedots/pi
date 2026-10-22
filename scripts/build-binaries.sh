#!/usr/bin/env bash
#
# Build pi binaries for all platforms locally.
# Mirrors .github/workflows/build-binaries.yml
#
# The release ships two binaries: `pi`, the client that draws the terminal interface,
# and `pi-server`, the runtime the client talks to. Both are compiled from the built
# packages, the same way `pi self-install` builds them.
#
# Usage:
#   ./scripts/build-binaries.sh [--skip-install] [--skip-build] [--offline-model-data] [--platform <platform>] [--out <dir>]
#
# Options:
#   --skip-install       Skip the bun install
#   --skip-build         Skip the package build
#   --offline-model-data Build with bundled model data instead of refreshing it
#   --platform <name>    Build only for specified platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64)
#   --out <dir>          Output directory (default: packages/coding-agent/binaries)
#
# Output:
#   packages/coding-agent/binaries/
#     pi-darwin-arm64.tar.gz
#     pi-darwin-x64.tar.gz
#     pi-linux-x64.tar.gz
#     pi-linux-arm64.tar.gz
#     pi-windows-x64.zip
#     pi-windows-arm64.zip

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

SKIP_INSTALL=false
SKIP_BUILD=false
OFFLINE_MODEL_DATA=false
PLATFORM=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --offline-model-data)
            OFFLINE_MODEL_DATA=true
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --out)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate platform if specified
if [[ -n "$PLATFORM" ]]; then
    case "$PLATFORM" in
        darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64|windows-arm64)
            ;;
        *)
            echo "Invalid platform: $PLATFORM"
            echo "Valid platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64"
            exit 1
            ;;
    esac
fi

if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="packages/coding-agent/binaries"
fi
if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi

if [[ "$SKIP_INSTALL" == "false" ]]; then
    echo "==> Installing dependencies..."
    bun install --frozen-lockfile --ignore-scripts
else
    echo "==> Skipping bun install (--skip-install)"
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
    if [[ "$OFFLINE_MODEL_DATA" == "true" ]]; then
        echo "==> Building all packages with bundled model data..."
        bun run build:offline
    else
        echo "==> Building all packages..."
        bun run build
    fi
else
    echo "==> Skipping package build (--skip-build)"
fi

echo "==> Building binaries..."

CODING_AGENT_DIR="$REPO_ROOT/packages/coding-agent"
CLIENT_DIR="$REPO_ROOT/packages/client"
SERVER_DIR="$REPO_ROOT/packages/server"

# The generated entry points live next to the compiled runtime of the coding agent.
# Bun embeds the extra entry points of a binary relative to their common directory, so
# the entry points have to sit inside the coding agent package for the worker scripts
# to keep the paths the runtime spawns them by.
ENTRY_DIR="$CODING_AGENT_DIR/dist/bun"
CLIENT_ENTRY="$ENTRY_DIR/pi-release-client-entry.mjs"
SERVER_ENTRY="$ENTRY_DIR/pi-release-server-entry.mjs"

for build_output in \
    "$CODING_AGENT_DIR/dist/bun/runtime-setup.js" \
    "$CODING_AGENT_DIR/dist/bun/sandbox-env-setup.js" \
    "$CLIENT_DIR/dist/cli.js" \
    "$SERVER_DIR/dist/cli.js"; do
    if [[ ! -f "$build_output" ]]; then
        echo "Missing build output: $build_output" >&2
        echo "Build the workspace first (bun run build)." >&2
        exit 1
    fi
done

mkdir -p "$ENTRY_DIR"

# The client entry starts the terminal interface. It loads the runtime setup of the
# coding agent first, because that is what registers the Bun specific providers.
#
# A compiled binary reports the same module url for every bundled module, so the
# client module would take itself for the process entry and start the client a
# second time. The marker tells the module that a generated entry starts it, and
# the argument of the process points at the executable. The import has to be
# dynamic: imports are evaluated before the body of this file runs.
cat > "$CLIENT_ENTRY" <<'CLIENT_ENTRY'
import "./sandbox-env-setup.js";
import "./runtime-setup.js";

process.env.PI_CLIENT_EMBEDDED = "1";
process.argv[1] = process.execPath;

const { runClient, setupClient } = await import("../../../client/dist/cli.js");

setupClient();
await runClient(process.argv.slice(2));
CLIENT_ENTRY

# The server entry starts the headless runtime the client drives. It guards itself
# the same way the client module does.
cat > "$SERVER_ENTRY" <<'SERVER_ENTRY'
import "./sandbox-env-setup.js";
import "./runtime-setup.js";

process.env.PI_CLIENT_EMBEDDED = "1";
process.argv[1] = process.execPath;

const { runCli } = await import("../../../server/dist/cli.js");

await runCli(process.argv.slice(2));
SERVER_ENTRY

# Clean previous builds
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"/{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64,windows-arm64}

# Determine which platforms to build
if [[ -n "$PLATFORM" ]]; then
    PLATFORMS=("$PLATFORM")
else
    PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 windows-arm64)
fi

cd "$CODING_AGENT_DIR"

for platform in "${PLATFORMS[@]}"; do
    echo "Building for $platform..."
    bun_target="bun-$platform"
    if [[ "$platform" == *-x64 ]]; then
        bun_target="${bun_target}-baseline"
    fi

    if [[ "$platform" == windows-* ]]; then
        client_binary="$OUTPUT_DIR/$platform/pi.exe"
        server_binary="$OUTPUT_DIR/$platform/pi-server.exe"
    else
        client_binary="$OUTPUT_DIR/$platform/pi"
        server_binary="$OUTPUT_DIR/$platform/pi-server"
    fi

    # Bun compiled executables only embed worker scripts when they are passed as
    # explicit build entrypoints. Bun places them at their path relative to the
    # common directory of all entrypoints, so the entry points stay in dist/bun/
    # and the workers keep the src/ paths the runtime spawns them by.
    #
    # Disable cwd bunfig.toml autoload so project preload scripts cannot crash the
    # standalone binary before pi starts (see #7684). Disable cwd .env autoload so
    # project env files do not leak into pi's environment (see #10473).
    bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv --target="$bun_target" \
        ./dist/bun/pi-release-client-entry.mjs ./src/utils/image-resize-worker.ts ./src/extensions/codemode/worker.ts \
        --outfile "$client_binary"

    bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv --target="$bun_target" \
        ./dist/bun/pi-release-server-entry.mjs ./src/utils/image-resize-worker.ts ./src/extensions/codemode/worker.ts \
        --outfile "$server_binary"
done

rm -f "$CLIENT_ENTRY" "$SERVER_ENTRY"

echo "==> Copying runtime assets..."

# Copy shared files to each platform directory
for platform in "${PLATFORMS[@]}"; do
    target="$OUTPUT_DIR/$platform"

    # The binary is the client, so the manifest of the client sits next to it.
    cp "$CLIENT_DIR/package.json" "$target/"
    cp "$CODING_AGENT_DIR/README.md" "$target/"
    cp "$CODING_AGENT_DIR/CHANGELOG.md" "$target/"
    cp "$REPO_ROOT/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" "$target/"

    # The themes and the HTML export templates the runtime reads.
    mkdir -p "$target/theme"
    cp "$CODING_AGENT_DIR"/dist/core/theme/*.json "$target/theme/"
    cp -r "$CODING_AGENT_DIR/dist/core/export-html" "$target/"

    # The images the terminal interface draws.
    mkdir -p "$target/assets"
    client_assets=("$CLIENT_DIR"/src/assets/*.png)
    if [[ -e "${client_assets[0]}" ]]; then
        cp "${client_assets[@]}" "$target/assets/"
    fi

    # The documentation of the runtime.
    cp -r "$CODING_AGENT_DIR/docs" "$target/"
    cp -r "$CODING_AGENT_DIR/examples" "$target/"

    # Copy the selected architecture's native platform helpers next to the executable.
    native_platform="${platform/windows-/win32-}"
    native_path="native/${native_platform%-*}/prebuilds"
    mkdir -p "$target/$native_path"
    cp -R "$REPO_ROOT/packages/tui/$native_path/$native_platform" "$target/$native_path/"
done

echo "==> Creating release archives..."

# Create archives
cd "$OUTPUT_DIR"

for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        # Windows (zip)
        echo "Creating pi-$platform.zip..."
        (cd "$platform" && zip -r ../pi-$platform.zip .)
    else
        # Unix platforms (tar.gz) - use wrapper directory for mise compatibility
        echo "Creating pi-$platform.tar.gz..."
        mv "$platform" pi && tar -czf pi-$platform.tar.gz pi && mv pi "$platform"
    fi
done

# Extract archives for easy local testing
echo "==> Extracting archives for testing..."
for platform in "${PLATFORMS[@]}"; do
    rm -rf "$platform"
    if [[ "$platform" == windows-* ]]; then
        mkdir -p "$platform" && (cd "$platform" && unzip -q ../pi-$platform.zip)
    else
        tar -xzf pi-$platform.tar.gz && mv pi "$platform"
    fi
done

echo ""
echo "==> Build complete!"
echo "Archives available in $OUTPUT_DIR/"
ls -lh *.tar.gz *.zip 2>/dev/null || true
echo ""
echo "Extracted directories for testing:"
for platform in "${PLATFORMS[@]}"; do
    if [[ "$platform" == windows-* ]]; then
        echo "  $OUTPUT_DIR/$platform/pi.exe"
        echo "  $OUTPUT_DIR/$platform/pi-server.exe"
    else
        echo "  $OUTPUT_DIR/$platform/pi"
        echo "  $OUTPUT_DIR/$platform/pi-server"
    fi
done
