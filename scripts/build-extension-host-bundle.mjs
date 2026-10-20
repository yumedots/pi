#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const crateDir = join(repoRoot, "rpi", "crates", "rpi-js");
const entry = join(crateDir, "js", "extension-host.ts");
const output = join(crateDir, "js", "extension-host.bundle.js");
const piVirtualModules = join(
	repoRoot,
	"packages",
	"coding-agent",
	"src",
	"core",
	"extensions",
	"virtual-modules.ts",
);

const typeboxEntries = {
	typebox: require.resolve("typebox"),
	"typebox/compile": require.resolve("typebox/compile"),
	"typebox/value": require.resolve("typebox/value"),
};

const shimDir = join(crateDir, "js", "shims");

const nodeShims = {
	"node:path": join(shimDir, "node-path.ts"),
	"node:os": join(shimDir, "node-os.ts"),
	"node:url": join(shimDir, "node-url.ts"),
	"node:perf_hooks": join(shimDir, "node-perf-hooks.ts"),
	"node:child_process": join(shimDir, "node-child-process.ts"),
	"node:fs": join(shimDir, "node-fs.ts"),
	"node:fs/promises": join(shimDir, "node-fs-promises.ts"),
	"node:events": join(shimDir, "node-events.ts"),
	"node:worker_threads": join(shimDir, "node-worker-threads.ts"),
	"node:module": join(shimDir, "node-module.ts"),
	"node:timers/promises": join(shimDir, "timers-promises.ts"),
	"node:crypto": join(shimDir, "node-crypto.ts"),
	"node:util": join(shimDir, "node-util.ts"),
	"node:util/types": join(shimDir, "node-util.ts"),
	"node:readline": join(shimDir, "node-readline.ts"),
	"node:stream": join(shimDir, "node-stream.ts"),
	"node:zlib": join(shimDir, "node-zlib.ts"),
	"node:http": join(shimDir, "node-http.ts"),
	"node:string_decoder": join(shimDir, "node-string-decoder.ts"),
	"node:stream/promises": join(shimDir, "node-stream-promises.ts"),
	"node:stream/web": join(shimDir, "node-stream-web.ts"),
	"node:process": join(shimDir, "node-process.ts"),
	"node:assert": join(shimDir, "node-assert.ts"),
	"node:readline/promises": join(shimDir, "node-readline-promises.ts"),
	constants: join(shimDir, "node-os.ts"),
	"node:tty": join(shimDir, "node-tty.ts"),
	"node:async_hooks": join(shimDir, "node-async-hooks.ts"),
	"node:v8": join(shimDir, "node-v8.ts"),
	"node:sqlite": join(shimDir, "node-sqlite.ts"),
	"node:vm": join(shimDir, "node-vm.ts"),
	"node:net": join(shimDir, "node-net.ts"),
	"node:tls": join(shimDir, "node-tls.ts"),
	"node:diagnostics_channel": join(shimDir, "node-diagnostics-channel.ts"),
	"node:buffer": join(shimDir, "node-buffer.ts"),
	"node:console": join(shimDir, "node-console.ts"),
	"node:timers": join(shimDir, "node-timers.ts"),
	"node:querystring": join(shimDir, "node-querystring.ts"),
	"node:dns": join(shimDir, "node-dns.ts"),
	"node:http2": join(shimDir, "node-http2.ts"),
	"node:inspector": join(shimDir, "node-inspector.ts"),
	"node:cluster": join(shimDir, "node-cluster.ts"),
	"node:dgram": join(shimDir, "node-dgram.ts"),
	"node:punycode": join(shimDir, "node-punycode.ts"),
	"node:sys": join(shimDir, "node-sys.ts"),
	"node:trace-events": join(shimDir, "node-trace-events.ts"),
};

const virtualModulePlugin = {
	name: "pi-virtual-modules",
	setup(context) {
		context.onResolve({ filter: /^typebox(\/compile|\/value)?$/ }, (args) => {
			const resolved = typeboxEntries[args.path];
			if (!resolved) throw new Error(`unknown typebox entry: ${args.path}`);
			return { path: resolved };
		});
		context.onResolve(
			{
				filter:
					/^(node:)?(path|os|url|perf_hooks|child_process|fs(\/promises)?|events|worker_threads|module|timers\/promises|crypto|util(\/types)?|readline(\/promises)?|stream(\/promises|\/web)?|zlib|http|string_decoder|process|assert|constants|tty|async_hooks|v8|sqlite|vm|net|tls|diagnostics_channel|buffer|console|timers|querystring|dns|http2|inspector|cluster|dgram|punycode|sys|trace-events)$/
			},
			(args) => {
				const name = args.path.replace(/^node:/, "");
				const resolved = nodeShims[`node:${name}`] ?? nodeShims[name] ?? nodeShims[`node:timers/${name}`] ?? nodeShims[`node:stream/${name}`] ?? nodeShims[`node:readline/${name}`];
				if (!resolved) throw new Error(`no shim for the node builtin: ${args.path}`);
				return { path: resolved };
			},
		);
	},
};

const nodeBuiltins = new Set([
	"assert",
	"buffer",
	"child_process",
	"crypto",
	"events",
	"fs",
	"http",
	"https",
	"module",
	"net",
	"os",
	"path",
	"process",
	"stream",
	"string_decoder",
	"timers",
	"tty",
	"url",
	"util",
	"vm",
	"worker_threads",
	"zlib",
]);

const mapKeys = (source, declaration) => {
	const start = source.indexOf(declaration);
	if (start < 0) throw new Error(`could not find ${declaration}`);
	const open = source.indexOf("{", start);
	let depth = 0;
	let end = open;
	for (let index = open; index < source.length; index++) {
		if (source[index] === "{") depth++;
		else if (source[index] === "}") {
			depth--;
			if (depth === 0) {
				end = index;
				break;
			}
		}
	}
	const keys = new Set();
	const body = source
		.slice(open + 1, end)
		.replace(/\/\/[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const match of body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z0-9_$]+))\s*:/gm)) {
		keys.add(match[1] ?? match[2]);
	}
	return keys;
};

const entrySource = readFileSync(entry, "utf8");
const ours = mapKeys(entrySource, "const VIRTUAL_MODULES");
const theirs = mapKeys(readFileSync(piVirtualModules, "utf8"), "export const VIRTUAL_MODULES");
for (const key of ours) {
	if (!theirs.has(key)) {
		throw new Error(`"${key}" is not a virtual module of pi's extension host`);
	}
}

const result = await build({
	entryPoints: [entry],
	bundle: true,
	format: "iife",
	platform: "neutral",
	// The neutral platform empties `mainFields`, so a package that only has a
	// `main` field (most of them) never resolves. The vendored pi packages
	// pull those in.
	mainFields: ["module", "main"],
	target: "es2022",
	write: false,
	plugins: [virtualModulePlugin],
	// The vendored pi packages carry their own dependencies; the port's
	// workspace has them at the root, so the resolution has to look there.
	nodePaths: [join(repoRoot, "node_modules"), join(repoRoot, "..", "pi", "node_modules")],
	metafile: true,
	logLevel: "warning",
	// esbuild writes the resolved path of every input into the bundle as a
	// comment, so the output would depend on where node_modules happens to
	// live. The bundle has to be byte-reproducible, because CI rebuilds it and
	// fails when it differs.
	legalComments: "none",
});

const builtins = new Set();
for (const [file, meta] of Object.entries(result.metafile.inputs)) {
	for (const imported of meta.imports ?? []) {
		if (imported.external && (imported.path.startsWith("node:") || imported.path in nodeBuiltins)) {
			builtins.add(imported.path);
		}
	}
}
if (builtins.size > 0) {
	throw new Error(`the bundle needs node built-ins the host does not provide: ${[...builtins].join(", ")}`);
}

const bundle = result.outputFiles[0].text.replace(
	/^[ \t]*\/\/[ \t]+[\w@.~/-]*[\w@~-]\.(?:mjs|cjs|jsx|js|ts|tsx|json)[ \t]*$/gm,
	"",
);
writeFileSync(output, bundle);
console.log(`built ${output} (${(bundle.length / 1024).toFixed(1)} KiB)`);
