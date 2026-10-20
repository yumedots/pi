import { existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { modelCatalogSlicePlugin } from "./model-catalog-plugin.mjs";

const outputPath = join(tmpdir(), "pi-browser-smoke.js");
const durableOutputPath = join(tmpdir(), "pi-durable-browser-smoke.js");
const agentTreeshakeOutputPath = join(tmpdir(), "pi-agent-treeshake-smoke.js");
const errorLogPath = join(tmpdir(), "pi-browser-smoke-errors.log");
const generatedCatalogDataDir = join(process.cwd(), "packages/ai/src/providers/data");

// Fresh checkouts do not materialize provider JSON until model data is hydrated.
const generatedCatalogDataPlugin = {
	name: "generated-model-catalog",
	setup(build) {
		build.onResolve({ filter: /^\.\/data\/[^/]+\.json$/ }, (args) => {
			const path = resolve(dirname(args.importer), args.path);
			if (dirname(path) !== generatedCatalogDataDir || existsSync(path)) return;
			return { path, namespace: "empty-generated-model-catalog" };
		});
		build.onLoad({ filter: /.*/, namespace: "empty-generated-model-catalog" }, () => ({
			contents: '{ "providers": {} }',
			loader: "json",
		}));
	},
};

function normalizePath(path) {
	return path.replaceAll("\\", "/");
}

function findInput(inputs, suffix) {
	return Object.keys(inputs).find((input) => {
		const normalized = normalizePath(input);
		return normalized === suffix || normalized.endsWith(`/${suffix}`);
	});
}

function includesNodePackage(inputs, packageName) {
	const marker = `node_modules/${packageName}/`;
	return Object.keys(inputs).some((input) => normalizePath(input).includes(marker));
}

try {
	await build({
		entryPoints: ["scripts/browser-smoke-entry.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		logLevel: "silent",
		outfile: outputPath,
		plugins: [modelCatalogSlicePlugin(generatedCatalogDataDir), generatedCatalogDataPlugin],
	});

	const durableBuild = await build({
		entryPoints: ["scripts/durable-browser-smoke-entry.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		logLevel: "silent",
		metafile: true,
		outfile: durableOutputPath,
		write: false,
	});
	const durableInputs = durableBuild.metafile.inputs;
	for (const expectedInput of [
		"packages/durable/src/index.ts",
		"packages/durable/src/env/index.ts",
		"packages/durable/src/storage/jsonl/index.ts",
		"packages/durable/src/storage/jsonl/storage.ts",
		"packages/durable/src/storage/memory.ts",
		"packages/durable/src/storage/sqlite/index.ts",
		"packages/durable/src/storage/sqlite/storage.ts",
	]) {
		if (!findInput(durableInputs, expectedInput)) {
			throw new Error(`Durable browser bundle does not include ${expectedInput}`);
		}
	}
	for (const forbiddenInput of [
		"packages/durable/src/env/node.ts",
		"packages/durable/src/storage/jsonl/node.ts",
		"packages/durable/src/storage/sqlite/node.ts",
	]) {
		const nodeAdapter = findInput(durableInputs, forbiddenInput);
		if (nodeAdapter) throw new Error(`Durable browser bundle unexpectedly includes ${nodeAdapter}`);
	}

	const agentTreeshakeBuild = await build({
		entryPoints: ["scripts/agent-treeshake-smoke-entry.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		logLevel: "silent",
		metafile: true,
		outfile: agentTreeshakeOutputPath,
		plugins: [modelCatalogSlicePlugin(generatedCatalogDataDir), generatedCatalogDataPlugin],
		write: false,
	});
	const inputs = agentTreeshakeBuild.metafile.inputs;
	for (const forbiddenInput of [
		"packages/ai/src/compat.ts",
		"packages/ai/src/models.generated.ts",
		"packages/ai/src/providers/all.ts",
	]) {
		const includedInput = findInput(inputs, forbiddenInput);
		if (includedInput) {
			throw new Error(`Agent selective-provider bundle unexpectedly includes ${includedInput}`);
		}
	}

	const contributingInputs = new Set(
		Object.values(agentTreeshakeBuild.metafile.outputs).flatMap((output) =>
			Object.entries(output.inputs)
				.filter(([, contribution]) => contribution.bytesInOutput > 0)
				.map(([input]) => input),
		),
	);
	const catalogInputs = Array.from(contributingInputs).filter((input) =>
		normalizePath(input).includes("packages/ai/src/providers/data/"),
	);
	if (catalogInputs.length !== 1 || !normalizePath(catalogInputs[0]).endsWith("/models.json")) {
		throw new Error(
			`Agent selective-provider bundle catalogs: expected only models.json, found ${catalogInputs.join(", ") || "none"}`,
		);
	}
	// The bundle only needs one provider, so the catalog must be sliced down to it.
	const catalogInput = Array.from(contributingInputs).find((input) =>
		normalizePath(input).endsWith("/providers/data/models.json"),
	);
	const catalogOutputBytes = Object.values(agentTreeshakeBuild.metafile.outputs).reduce(
		(total, output) => total + (output.inputs[catalogInput ?? ""]?.bytesInOutput ?? 0),
		0,
	);
	const catalogFileBytes = statSync(join(generatedCatalogDataDir, "models.json")).size;
	if (catalogOutputBytes === 0 || catalogOutputBytes >= catalogFileBytes / 2) {
		throw new Error(
			`Agent selective-provider bundle carries the whole model catalog (${catalogOutputBytes} of ${catalogFileBytes} bytes)`,
		);
	}

	const aiSdkPackages = [
		"@anthropic-ai/sdk",
		"@aws-sdk/client-bedrock-runtime",
		"@google/genai",
		"@mistralai/mistralai",
		"openai",
	];
	const includedAiSdkPackages = aiSdkPackages.filter((packageName) => includesNodePackage(inputs, packageName));
	if (
		includedAiSdkPackages.length !== 1 ||
		includedAiSdkPackages[0] !== "@anthropic-ai/sdk"
	) {
		throw new Error(
			`Agent selective-provider bundle SDKs: expected only @anthropic-ai/sdk, found ${includedAiSdkPackages.join(", ") || "none"}`,
		);
	}

	process.exit(0);
} catch (error) {
	let detailedErrors = "";
	if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
		detailedErrors = error.errors
			.map((entry) => {
				const location = entry.location
					? `${entry.location.file}:${entry.location.line}:${entry.location.column}`
					: "";
				return [location, entry.text].filter(Boolean).join(" ");
			})
			.join("\n");
	}

	const baseError = error instanceof Error ? (error.stack ?? error.message) : String(error);
	writeFileSync(errorLogPath, [detailedErrors, baseError].filter(Boolean).join("\n\n"), "utf-8");
	console.error(`Browser smoke check failed. See ${errorLogPath}`);
	process.exit(1);
}
