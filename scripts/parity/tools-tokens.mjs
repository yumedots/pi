#!/usr/bin/env node
/**
 * Compares the port's tool declarations with the original's, tool by tool,
 * and counts what each side's declarations cost in tokens.
 *
 * The declarations are the biggest fixed cost in every request: the model
 * reads the name, the description and the parameter schema of every tool on
 * every turn. A wording change or a schema change is a behaviour change, so
 * the comparison is field by field and the verdict is per field.
 *
 * The token count comes from the tokenizer of the model itself (the
 * llama.cpp `/tokenize` endpoint, the same one `bench/tokens/` uses). With no
 * server running the script falls back to a chars/4 estimate and says so.
 *
 * Usage:
 *   node scripts/parity/tools-tokens.mjs [--json <path>] [--markdown <path>]
 *
 * Environment:
 *   PI_PARITY_TS_ROOT   the original's checkout (default /Users/gabriel/pi)
 *   PI_LLAMA_URL        the llama.cpp server (default http://127.0.0.1:8081)
 *   RPI_TOOL_DECLARATIONS  a JSON file with the port's declarations, instead
 *                          of building them
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const TS = process.env.PI_PARITY_TS_ROOT ?? "/Users/gabriel/pi";
const UPSTREAM = process.env.PI_LLAMA_URL ?? "http://127.0.0.1:8081";

const options = { json: undefined, markdown: undefined };
for (let index = 2; index < process.argv.length; index++) {
	const flag = process.argv[index];
	const value = process.argv[++index];
	if (flag === "--json") options.json = value;
	else if (flag === "--markdown") options.markdown = value;
	else throw new Error(`unknown flag: ${flag}`);
}

/** The loadout a normal session starts with: `read`, `bash`, `edit`, `write`. */
const DEFAULT_LOADOUT = ["read", "bash", "edit", "write"];
/** The working directory the prompts are built for. */
const CWD = "/tmp/work";

/** The original's system prompt, section by section, for the default loadout. */
function loadOriginalPrompt() {
	const source = join(TS, "packages/coding-agent/src/core/system-prompt.ts");
	const script = `
		const tools = await import(${JSON.stringify(join(TS, "packages/coding-agent/src/core/tools/index.ts"))});
		const prompt = await import(${JSON.stringify(source)});
		const defs = tools.createAllToolDefinitions(process.cwd(), {});
		const snippets = {};
		const guidelines = {};
		for (const [name, def] of Object.entries(defs)) {
			if (def.promptSnippet) snippets[name] = def.promptSnippet;
			if (def.promptGuidelines) guidelines[name] = def.promptGuidelines;
		}
		const sections = prompt.buildSystemPromptSections({
			selectedTools: ${JSON.stringify(DEFAULT_LOADOUT)},
			toolSnippets: snippets,
			toolGuidelines: guidelines,
			cwd: ${JSON.stringify(CWD)},
		});
		process.stdout.write(JSON.stringify(sections));
	`;
	return JSON.parse(execFileSync("bun", ["-e", script], { cwd: TS, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

/**
 * The port's system prompt, rebuilt from `rpi/crates/rpi-cli/src/session.rs`
 * (`default_system_prompt`) with the default loadout. The tool list and the
 * per-tool rules come from the port's own tool declarations.
 */
function buildPortPrompt(declarations) {
	const active = DEFAULT_LOADOUT.map((name) => declarations[name]).filter(Boolean);
	const toolBlock = active.map((tool) => `- ${tool.name}: ${tool.promptSnippet}`).join("\n");
	const guidelines = [];
	for (const tool of active) {
		for (const guideline of tool.promptGuidelines ?? []) {
			if (!guidelines.includes(guideline)) guidelines.push(guideline);
		}
	}
	guidelines.push("Use bash for file operations like ls, rg, find");
	guidelines.push(
		"The bash tool runs Bash, even on Windows. Use POSIX pipelines; do not pass PowerShell\n  cmdlets such as Get-ChildItem, Select-Object, or Select-String. If a powershell tool is\n  available, use it for PowerShell commands.",
	);
	const guidelineLines = guidelines.map((rule) => `- ${rule}`).join("\n");
	return [
		"You are an expert coding assistant operating inside rpi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
		"",
		"Available tools:",
		toolBlock,
		"",
		"In addition to the tools above, you may have access to other custom tools depending on the project.",
		"",
		"Guidelines:",
		"- Reply in the SAME language the user is writing in. Detect the language of the user's",
		"  latest message (and, when it is too short to be sure, the working language of the",
		"  conversation so far) and use it for your prose replies. Mirror it unless the user",
		"  explicitly asks for a different language; only fall back to English when the",
		"  user's language cannot be determined.",
		guidelineLines,
		"- Be concise in your responses",
		"- Show file paths clearly when working with files",
		"- Prefer the smallest change that solves the problem",
		"- Keep your working state in your VISIBLE replies, not only in reasoning. Reasoning is not",
		"  carried into your next turn: only the text you write and the tool output you produce come",
		"  back. Before each batch of tool calls, write one short line naming the task you are on and",
		"  what remains. When you finish a step, say which one is done. If you keep the plan only in",
		"  your head you will re-derive it from scratch every turn.",
		"- Track multi-step work with a short list in your replies instead of re-listing the plan in prose:",
		"  add the steps once, then mark them done as you go. Re-stating the same plan without acting on it",
		"  is a bug, not progress.",
		"- Read only what you need. If a file or search result was already shown earlier in this",
		"  conversation, use it instead of fetching it again.",
		"- When unsure about rpi commands, extensions, Pi package compatibility, or .rpi configuration, consult the project documentation before guessing",
		"",
		`Current working directory: ${CWD}`,
	].join("\n");
}

/** The strict JSON-schema transform pi's providers apply to a tool schema. */
function makeStrictSchema(schema) {
	return strictNode(schema);
}

function strictNode(node) {
	if (Array.isArray(node.anyOf)) {
		return { ...node, anyOf: node.anyOf.map((variant) => strictNode(variant)) };
	}
	if (node.items && !Array.isArray(node.items)) {
		return { ...node, items: strictNode(node.items) };
	}
	if (node.type !== "object" || !node.properties) {
		return node;
	}
	const required = node.required ?? [];
	const properties = {};
	for (const [name, property] of Object.entries(node.properties)) {
		const value = required.includes(name) || allowsNull(property) ? property : { anyOf: [property, { type: "null" }] };
		properties[name] = strictNode(value);
	}
	return { ...node, properties, required: Object.keys(node.properties), additionalProperties: false };
}

function allowsNull(property) {
	const type = property?.type;
	if (type === "null") return true;
	if (Array.isArray(type) && type.includes("null")) return true;
	if (property?.const === null) return true;
	if (Array.isArray(property?.enum) && property.enum.includes(null)) return true;
	return false;
}

/** The original's tool definitions, straight from its source. */
function loadOriginal() {
	const source = join(TS, "packages/coding-agent/src/core/tools/index.ts");
	if (!existsSync(source)) throw new Error(`the original's tools are not at ${source}`);
	const script = `
		const tools = await import(${JSON.stringify(source)});
		const strict = await import(${JSON.stringify(join(TS, "packages/ai/src/api/constrained-sampling.ts"))});
		const defs = tools.createAllToolDefinitions(process.cwd(), {});
		const out = {};
		for (const [name, def] of Object.entries(defs)) {
			const tool = {
				name: def.name,
				description: def.description,
				parameters: def.parameters,
				constrainedSampling: def.constrainedSampling,
			};
			// The wire payload of the openai-completions path: the strict
			// transform when the provider supports strict mode, the plain
			// schema otherwise.
			const isStrict = strict.resolveJsonSchemaStrictSampling(tool, true) === true;
			const wire = {
				type: "function",
				function: {
					name: tool.name,
					description: tool.description,
					parameters: strict.getJsonSchemaToolParameters(tool, isStrict ? true : undefined),
					strict: isStrict,
				},
			};
			out[name] = {
				name: def.name,
				label: def.label,
				description: def.description,
				parameters: def.parameters,
				promptSnippet: def.promptSnippet,
				promptGuidelines: def.promptGuidelines ?? null,
				wire,
			};
		}
		process.stdout.write(JSON.stringify(out));
	`;
	return JSON.parse(execFileSync("bun", ["-e", script], { cwd: TS, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

/** The port's tool definitions, from its own build. */
function loadPort() {
	const declarations = process.env.RPI_TOOL_DECLARATIONS
		? JSON.parse(readFileSync(process.env.RPI_TOOL_DECLARATIONS, "utf8"))
		: JSON.parse(
				execFileSync("cargo", ["run", "--quiet", "--example", "tool_declarations", "-p", "rpi-tools"], {
					cwd: join(ROOT, "rpi"),
					encoding: "utf8",
					maxBuffer: 64 * 1024 * 1024,
					env: {
						...process.env,
						CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(ROOT, "rpi/target"),
					},
				}),
			);
	for (const declaration of Object.values(declarations)) {
		// The wire payload of the openai-completions path: the strict
		// transform when the tool opted into it, the plain schema otherwise.
		// The port's provider applies the same transform (`rpi-ai`'s
		// `strict_schema::strict_tool_parameters`, pinned by its test).
		const strict = declaration.constrainedSampling ? makeStrictSchema(declaration.parameters) : null;
		declaration.wire = {
			type: "function",
			function: {
				name: declaration.name,
				description: declaration.description,
				parameters: strict ?? declaration.parameters,
				strict: strict !== null,
			},
		};
	}
	return declarations;
}

/** Count the tokens of a text with the tokenizer of the model. */
let tokenizerOnline = true;
async function countTokens(text) {
	try {
		const response = await fetch(`${UPSTREAM}/tokenize`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: text }),
		});
		const result = await response.json();
		tokenizerOnline = true;
		return result.tokens?.length ?? 0;
	} catch {
		tokenizerOnline = false;
		return Math.ceil(text.length / 4);
	}
}

/** The deep difference between two JSON values, as a list of paths. */
function differences(left, right, path = "") {
	if (left === right) return [];
	if (typeof left !== typeof right || left === null || right === null) {
		return [{ path, left, right }];
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return [{ path, left, right }];
		if (left.length !== right.length) return [{ path: `${path}.length`, left: left.length, right: right.length }];
		return left.flatMap((item, index) => differences(item, right[index], `${path}[${index}]`));
	}
	if (typeof left === "object") {
		const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
		return keys.flatMap((key) => differences(left[key], right[key], path ? `${path}.${key}` : key));
	}
	return [{ path, left, right }];
}

const original = loadOriginal();
const port = loadPort();
const names = [...new Set([...Object.keys(original), ...Object.keys(port)])].sort();

const rows = [];
for (const name of names) {
	const mine = port[name];
	const theirs = original[name];
	if (!mine || !theirs) {
		rows.push({
			name,
			present: { original: Boolean(theirs), port: Boolean(mine) },
			verdict: mine && theirs ? "identical" : mine ? "only in the port" : "only in the original",
			declaring: { original: 0, port: 0 },
			wire: { original: 0, port: 0 },
			differences: [],
		});
		continue;
	}
	const fields = ["name", "label", "description", "parameters", "promptSnippet"];
	const diffs = fields.flatMap((field) => differences(mine[field], theirs[field], field));
	// The guidelines are a list on one side and nothing on the other: both
	// mean "no rule", so they are compared as lists.
	const guidelines = differences(mine.promptGuidelines ?? [], theirs.promptGuidelines ?? [], "promptGuidelines");
	diffs.push(...guidelines);
	const declaringOriginal = await countTokens(
		JSON.stringify({ name: theirs.name, description: theirs.description, parameters: theirs.parameters }),
	);
	const declaringPort = await countTokens(
		JSON.stringify({ name: mine.name, description: mine.description, parameters: mine.parameters }),
	);
	const wireOriginal = await countTokens(JSON.stringify(theirs.wire));
	const wirePort = await countTokens(JSON.stringify(mine.wire));
	rows.push({
		name,
		present: { original: true, port: true },
		verdict: diffs.length === 0 ? "identical" : `${diffs.length} difference(s)`,
		description: { original: theirs.description, port: mine.description },
		declaring: { original: declaringOriginal, port: declaringPort },
		wire: { original: wireOriginal, port: wirePort },
		differences: diffs,
	});
}

const totals = {
	declaring: {
		original: rows.reduce((sum, row) => sum + row.declaring.original, 0),
		port: rows.reduce((sum, row) => sum + row.declaring.port, 0),
	},
	wire: {
		original: rows.reduce((sum, row) => sum + row.wire.original, 0),
		port: rows.reduce((sum, row) => sum + row.wire.port, 0),
	},
};
const identical = rows.filter((row) => row.verdict === "identical").length;

const loadout = {
	declaring: {
		original: rows
			.filter((row) => DEFAULT_LOADOUT.includes(row.name))
			.reduce((sum, row) => sum + row.declaring.original, 0),
		port: rows
			.filter((row) => DEFAULT_LOADOUT.includes(row.name))
			.reduce((sum, row) => sum + row.declaring.port, 0),
	},
	wire: {
		original: rows
			.filter((row) => DEFAULT_LOADOUT.includes(row.name))
			.reduce((sum, row) => sum + row.wire.original, 0),
		port: rows
			.filter((row) => DEFAULT_LOADOUT.includes(row.name))
			.reduce((sum, row) => sum + row.wire.port, 0),
	},
};

console.log(`tokenizer: ${tokenizerOnline ? `${UPSTREAM} (the model's own)` : `chars/4 estimate (${UPSTREAM} is not answering)`}`);
console.log("");
console.log("| tool | verdict | description tokens (original / port) | wire tokens (original / port) |");
console.log("|---|---|---|---|");
for (const row of rows) {
	console.log(
		`| \`${row.name}\` | ${row.verdict} | ${row.declaring.original} / ${row.declaring.port} | ${row.wire.original} / ${row.wire.port} |`,
	);
}
console.log("");
console.log(`identical: ${identical}/${rows.length}`);
console.log(
	`declaration tokens (all eight): original ${totals.declaring.original}, port ${totals.declaring.port} (${totals.declaring.port - totals.declaring.original >= 0 ? "+" : ""}${totals.declaring.port - totals.declaring.original})`,
);
console.log(
	`declaration tokens (the default loadout ${DEFAULT_LOADOUT.join(", ")}): original ${loadout.declaring.original}, port ${loadout.declaring.port} (${loadout.declaring.port - loadout.declaring.original >= 0 ? "+" : ""}${loadout.declaring.port - loadout.declaring.original})`,
);
console.log(
	`wire tokens (all eight): original ${totals.wire.original}, port ${totals.wire.port} (${totals.wire.port - totals.wire.original >= 0 ? "+" : ""}${totals.wire.port - totals.wire.original})`,
);
console.log(
	`wire tokens (the default loadout): original ${loadout.wire.original}, port ${loadout.wire.port} (${loadout.wire.port - loadout.wire.original >= 0 ? "+" : ""}${loadout.wire.port - loadout.wire.original})`,
);

for (const row of rows) {
	if (row.differences.length === 0) continue;
	console.log("");
	console.log(`${row.name}:`);
	for (const diff of row.differences) {
		console.log(`  ${diff.path}: port ${JSON.stringify(diff.left)} / original ${JSON.stringify(diff.right)}`);
	}
}

const originalSections = loadOriginalPrompt();
const portPrompt = buildPortPrompt(port);
const prompt = { sections: [], totals: { original: 0, port: 0 } };
for (const [name, text] of Object.entries(originalSections)) {
	prompt.sections.push({ name, original: await countTokens(text), port: null });
	prompt.totals.original += await countTokens(text);
}
prompt.totals.port = await countTokens(portPrompt);
const originalPromptTotal = await countTokens(
	Object.values(originalSections).join("\n\n"),
);
prompt.totals.original = originalPromptTotal;

console.log("");
console.log("## the system prompt");
console.log("");
console.log("| part | original tokens | port tokens |");
console.log("|---|---|---|");
for (const section of prompt.sections) {
	console.log(`| \`${section.name}\` | ${section.original} | — |`);
}
console.log(`| **the whole prompt** | **${prompt.totals.original}** | **${prompt.totals.port}** |`);
console.log(
	`| the tool declarations on top | ${loadout.wire.original} | ${loadout.wire.port} |`,
);
console.log(
	`| **the request's fixed cost** | **${prompt.totals.original + loadout.wire.original}** | **${prompt.totals.port + loadout.wire.port}** |`,
);

if (options.json) {
	mkdirSync(dirname(resolve(options.json)), { recursive: true });
	writeFileSync(
		resolve(options.json),
		`${JSON.stringify({ tokenizer: tokenizerOnline ? UPSTREAM : "chars/4", totals, rows }, null, 2)}\n`,
	);
}

if (options.markdown) {
	const lines = [];
	lines.push("| tool | verdict | declaration tokens (original / port) | wire tokens (original / port) |");
	lines.push("|---|---|---|---|");
	for (const row of rows) {
		lines.push(
			`| \`${row.name}\` | ${row.verdict} | ${row.declaring.original} / ${row.declaring.port} | ${row.wire.original} / ${row.wire.port} |`,
		);
	}
	lines.push(`| **total** | ${identical}/${rows.length} identical | **${totals.declaring.original} / ${totals.declaring.port}** | **${totals.wire.original} / ${totals.wire.port}** |`);
	mkdirSync(dirname(resolve(options.markdown)), { recursive: true });
	writeFileSync(resolve(options.markdown), `${lines.join("\n")}\n`);
}
