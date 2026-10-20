# The embedded extension host

How pi's TypeScript extensions run inside the Rust port.

## The shape

```
rpi (Rust host, 12 MB)
  └── rpi-js: an embedded V8, created the first time an extension needs it
        └── the bundled TypeScript extension host
              ├── the virtual modules the extensions import: typebox, typebox/compile,
              │   typebox/value, @earendil-works/pi-tui, @earendil-works/pi-ai (the compat
              │   entry), @earendil-works/pi-agent-core, @earendil-works/pi-coding-agent
              └── the extension's own code
```

The extension host is pi's own code, bundled, running in V8. There is no
translation layer, so the *types* cannot drift from the TypeScript original.

**The API is not 1:1 yet.** An audit of the contract
(`packages/coding-agent/src/core/extensions/types.ts` against the port's
`rpi/crates/rpi-js/js/extension-host.ts` and its two host implementations)
found that the port answers 23 of the 46 host operations the bundled host
requests; 31 throw `unknown host operation` into the extension. 21 of the 36
`pi.*` methods exist but throw when called, and 35 of the 41 event categories
never fire. The types are pi's; the host behind them is not pi's yet.

The host and the extension host exchange JSON over a function boundary:
the host calls into V8 for an event, the extension host calls back into the
host through a small set of native functions (the file system, the environment,
the clock, the terminal).

## What the host provides

The extension host is written for Node, so the bundle needs a few Node
surfaces. The host supplies them:

| Node surface | what the host gives it |
| --- | --- |
| `node:fs` | the host's own file operations, scoped to what the extension is allowed to touch |
| `process.env`, `process.cwd`, `process.argv` | the host's environment |
| `performance.now` | the host's clock, so the parity harness can freeze it |
| `console` | the host's log, at the host's level |

## What an extension may draw

An extension returns a TUI `Component`, which is TypeScript and cannot run in
Rust. The extension host renders it to text lines in V8 and hands the lines to
the Rust host, which places them. So a component is 1:1, and an extension that
replaces the editor or owns raw keys gets the keyboard through the same
channel.

## The cost

The engine is created on demand, so a session with no JavaScript extension
never pays for it. When an extension does load, the cost is V8's isolate plus
the extension host's own objects (the typebox builder and the pi packages the
extension touches).

## The build

The extension host is bundled with esbuild into a single script that is
embedded in the binary. The bundling is a build step in the Rust build, not a
runtime download, so the binary stays self-contained.
