#!/usr/bin/env node

// Builds the `pi` binary of the client package.
//
// The client bundle is the same shape as the coding-agent bundle: one launcher plus the
// chunks esbuild emits, with the workspace's source-oriented path aliases disabled so the
// release build resolves the same package entries as an installed npm package.

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const clientDir = join(repoRoot, "packages", "client");
const clientDistDir = join(clientDir, "dist");
const bundleDir = join(clientDistDir, "bundle");

const allowedExternalPackages = new Set([
	"@silvia-odwyer/photon-node",
	// The runtime stays a real dependency: its asset paths (themes, export templates)
	// are resolved relative to the package that owns them.
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-coding-agent/*",
	"@earendil-works/pi-server",
	"@earendil-works/pi-server/*",
	"jiti",
	"bufferutil",
	"utf-8-validate",
	"kerberos",
	"supports-color",
]);

const lazyJitiPlugin = {
	name: "lazy-jiti-transform",
	setup(build) {
		build.onResolve({ filter: /^jiti\/static$/ }, () => ({
			namespace: "lazy-jiti",
			path: "jiti/static",
		}));
		build.onLoad({ filter: /.*/, namespace: "lazy-jiti" }, () => ({
			contents: `
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let createJitiImpl;

export function createJiti(...args) {
	createJitiImpl ??= require("jiti").createJiti;
	return createJitiImpl(...args);
}
`,
			loader: "js",
		}));
	},
};

const cliEntry = join(clientDistDir, "cli.js");
if (!existsSync(cliEntry)) {
	throw new Error(`Bundle input is missing: ${relative(repoRoot, cliEntry)}. Build the workspace packages first.`);
}

rmSync(bundleDir, { force: true, recursive: true });
mkdirSync(bundleDir, { recursive: true });

const result = await build({
	absWorkingDir: repoRoot,
	banner: { js: 'import { createRequire as __piCreateRequire } from "node:module"; const require = __piCreateRequire(import.meta.url);' },
	bundle: true,
	define: { PI_BUNDLED_NODE: "true" },
	external: [
		"@silvia-odwyer/photon-node",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-coding-agent/*",
		"@earendil-works/pi-server",
		"@earendil-works/pi-server/*",
	],
	format: "esm",
	legalComments: "none",
	logLevel: "warning",
	metafile: true,
	minifySyntax: true,
	minifyWhitespace: true,
	platform: "node",
	plugins: [lazyJitiPlugin],
	sourcemap: false,
	target: "node22.19",
	tsconfigRaw: { compilerOptions: {} },
	entryNames: "[name]",
	entryPoints: { "cli-runtime": cliEntry },
	outdir: bundleDir,
	chunkNames: "chunks/[name]-[hash]",
	splitting: true,
});

function isAllowedExternal(specifier) {
	if (allowedExternalPackages.has(specifier)) return true;
	return [...allowedExternalPackages].some((allowed) => allowed.endsWith("*") && specifier.startsWith(allowed.slice(0, -1)));
}

const unexpected = new Set();
for (const input of Object.values(result.metafile.inputs)) {
	for (const imported of input.imports) {
		if (!imported.external || isBuiltin(imported.path) || isAllowedExternal(imported.path)) continue;
		unexpected.add(imported.path);
	}
}
if (unexpected.size > 0) {
	throw new Error(`Bundle left unexpected external imports: ${Array.from(unexpected).sort().join(", ")}`);
}

const cliLauncher = `#!/usr/bin/env node
import { createRequire, enableCompileCache } from "node:module";

enableCompileCache();
createRequire(import.meta.url)("./cli-runtime.js");
`;
writeFileSync(join(bundleDir, "cli.js"), cliLauncher);
chmodSync(join(bundleDir, "cli.js"), 0o755);

const files = new Set(Object.keys(result.metafile.outputs)).size + 1;
const bytes = Object.values(result.metafile.outputs).reduce((total, output) => total + output.bytes, 0);
console.log(`Built ${relative(repoRoot, bundleDir)} (${files} files, ${(bytes / (1024 * 1024)).toFixed(1)} MiB)`);
