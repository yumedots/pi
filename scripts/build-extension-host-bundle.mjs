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
			{ filter: /^(node:)?(path|os|url|perf_hooks|child_process|fs(\/promises)?)$/ },
			(args) => {
				const resolved = nodeShims[`node:${args.path.replace(/^node:/, "")}`];
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
	target: "es2022",
	write: false,
	plugins: [virtualModulePlugin],
	metafile: true,
	logLevel: "warning",
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

writeFileSync(output, result.outputFiles[0].text);
console.log(`built ${output} (${(result.outputFiles[0].text.length / 1024).toFixed(1)} KiB)`);
