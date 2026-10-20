#!/usr/bin/env bun
/**
 * The settings value cross-check.
 *
 * The key audit (`audit.mjs settings`) compares the *names* of the settings.
 * This compares the *values*: the file the port writes must satisfy the
 * original's published JSON schema, and the effective value of every setting
 * (the file's value, or the original's default) must be the same in the port
 * and in the original.
 *
 * The port's side is written by the port's own test:
 *   cargo test -p rpi-cli --lib settings::scoped_tests::parity_fixture_is_written_for_the_cross_check
 * The original's side is the original's own source: the schema in
 * `packages/coding-agent/schemas/settings.schema.json` and the defaults in
 * `packages/coding-agent/src/core/settings-defaults.ts`.
 *
 * Usage: bun scripts/parity/settings-values.mjs [fixture-dir]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { SETTINGS_DEFAULTS } from "../../packages/coding-agent/src/core/settings-defaults.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIR = process.argv[2] ?? "/tmp/rpi-settings-parity";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

const schema = read(join(ROOT, "packages/coding-agent/schemas/settings.schema.json"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

/**
 * The effective value of every setting that has a default, computed the way
 * the original's getters do (`this.settings.X ?? SETTINGS_DEFAULTS.X`, with
 * the enumerated settings falling back to the default for an unknown value).
 */
function effective(file) {
	const d = SETTINGS_DEFAULTS;
	const terminal = file.terminal ?? {};
	const compaction = file.compaction ?? {};
	const branch = file.branchSummary ?? {};
	const retry = file.retry ?? {};
	const provider = retry.provider ?? {};
	const images = file.images ?? {};
	const markdown = file.markdown ?? {};
	const warnings = file.warnings ?? {};
	const codemode = file.codemode ?? {};
	const wheel = file.fullscreenWheelScrollLines;
	return {
		transport: file.transport ?? d.transport,
		sessionShareDestination:
			file.sessionShareDestination === "gist" || file.sessionShareDestination === "radius"
				? file.sessionShareDestination
				: d.sessionShareDestination,
		steeringMode: file.steeringMode ?? d.steeringMode,
		followUpMode: file.followUpMode ?? d.followUpMode,
		compaction: {
			enabled: compaction.enabled ?? d.compaction.enabled,
			reserveTokens: compaction.reserveTokens ?? d.compaction.reserveTokens,
			keepRecentTokens: compaction.keepRecentTokens ?? d.compaction.keepRecentTokens,
		},
		branchSummary: {
			reserveTokens: branch.reserveTokens ?? d.branchSummary.reserveTokens,
			skipPrompt: branch.skipPrompt ?? d.branchSummary.skipPrompt,
		},
		retry: {
			enabled: retry.enabled ?? d.retry.enabled,
			maxRetries: retry.maxRetries ?? d.retry.maxRetries,
			baseDelayMs: retry.baseDelayMs ?? d.retry.baseDelayMs,
			maxAgentDelayMs: retry.maxAgentDelayMs ?? d.retry.maxAgentDelayMs,
			provider: {
				maxRetryDelayMs: provider.maxRetryDelayMs ?? d.retry.provider.maxRetryDelayMs,
			},
		},
		hideThinkingBlock: file.hideThinkingBlock ?? d.hideThinkingBlock,
		projectContextMaxChars: file.projectContextMaxChars ?? d.projectContextMaxChars,
		showCacheMissNotices: file.showCacheMissNotices ?? d.showCacheMissNotices,
		quietStartup:
			file.quietStartup === true || file.quietStartup === "header"
				? file.quietStartup
				: d.quietStartup,
		defaultProjectTrust:
			file.defaultProjectTrust === "always" || file.defaultProjectTrust === "never"
				? file.defaultProjectTrust
				: d.defaultProjectTrust,
		collapseChangelog: file.collapseChangelog ?? d.collapseChangelog,
		enableSkillCommands: file.enableSkillCommands ?? d.enableSkillCommands,
		terminal: {
			showImages: terminal.showImages ?? d.terminal.showImages,
			imageWidthCells: terminal.imageWidthCells ?? d.terminal.imageWidthCells,
			clearOnShrink: terminal.clearOnShrink ?? d.terminal.clearOnShrink,
			showTerminalProgress: terminal.showTerminalProgress ?? d.terminal.showTerminalProgress,
		},
		images: {
			autoResize: images.autoResize ?? d.images.autoResize,
			blockImages: images.blockImages ?? d.images.blockImages,
		},
		doubleEscapeAction: file.doubleEscapeAction ?? d.doubleEscapeAction,
		treeFilterMode: ["default", "no-tools", "user-only", "labeled-only", "all"].includes(
			file.treeFilterMode,
		)
			? file.treeFilterMode
			: d.treeFilterMode,
		editorPaddingX: file.editorPaddingX ?? d.editorPaddingX,
		outputPad: file.outputPad === 0 ? 0 : d.outputPad,
		nerdFonts: file.nerdFonts ?? d.nerdFonts,
		threeDEmptySession: file.threeDEmptySession ?? d.threeDEmptySession,
		autocompleteMaxVisible: file.autocompleteMaxVisible ?? d.autocompleteMaxVisible,
		autocompletePosition: file.autocompletePosition === "below" ? "below" : d.autocompletePosition,
		markdown: {
			codeBlockIndent: markdown.codeBlockIndent ?? d.markdown.codeBlockIndent,
			mermaid:
				markdown.mermaid === "off" || markdown.mermaid === "final"
					? markdown.mermaid
					: d.markdown.mermaid,
		},
		warnings: {
			anthropicExtraUsage: warnings.anthropicExtraUsage ?? d.warnings.anthropicExtraUsage,
		},
		codemode: {
			mode: codemode.mode ?? d.codemode.mode,
			inlineBudget: codemode.inlineBudget ?? d.codemode.inlineBudget,
		},
		cacheWarming: ["off", "streaming", "idle"].includes(file.cacheWarming)
			? file.cacheWarming
			: d.cacheWarming,
		tuiMode: file.tuiMode === "regular" ? "regular" : d.tuiMode,
		fullscreenExitOutput:
			file.fullscreenExitOutput === "transcript" ? "transcript" : d.fullscreenExitOutput,
		fullscreenScrollbar:
			file.fullscreenScrollbar === "always" || file.fullscreenScrollbar === "hidden"
				? file.fullscreenScrollbar
				: d.fullscreenScrollbar,
		fullscreenCopyOnSelect: file.fullscreenCopyOnSelect ?? d.fullscreenCopyOnSelect,
		fullscreenWheelScrollLines:
			typeof wheel === "number" && Number.isFinite(wheel)
				? Math.max(1, Math.min(100, Math.floor(wheel)))
				: d.fullscreenWheelScrollLines,
	};
}

/** The settings the port knows but the original does not. */
function extensions(file) {
	return Object.keys(file).filter(
		(key) => !schema.properties[key] && key !== "$schema",
	);
}

let failures = 0;

function report(label, ok, detail) {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}

for (const name of ["pi", "port"]) {
	const filePath = join(DIR, `${name}-settings.json`);
	if (!existsSync(filePath)) {
		console.log(`missing ${filePath} — run the port's parity fixture test first`);
		process.exit(1);
	}
	const file = read(filePath);
	const valid = validate(file);
	report(
		`the ${name} file satisfies the original's schema`,
		valid,
		valid ? "" : ajv.errorsText(validate.errors),
	);

	const expected = effective(file);
	const portView = read(join(DIR, `${name}-effective.json`));
	const same = deepEqual(expected, portView);
	report(
		`the ${name} file has the same effective values in the port and in the original`,
		same,
		same ? "" : diff(expected, portView),
	);

	const extra = extensions(file);
	report(
		`the ${name} file has no key the original does not know`,
		extra.length === 0,
		extra.join(", "),
	);
}

/** Compare two JSON values, ignoring the order of the object keys. */
function deepEqual(left, right) {
	if (left === right) return true;
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		if (left.length !== right.length) return false;
		return left.every((item, index) => deepEqual(item, right[index]));
	}
	if (typeof left === "object") {
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		if (leftKeys.length !== rightKeys.length) return false;
		if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
		return leftKeys.every((key) => deepEqual(left[key], right[key]));
	}
	return false;
}

function diff(expected, actual) {
	const left = JSON.stringify(expected, null, 2).split("\n");
	const right = JSON.stringify(actual, null, 2).split("\n");
	const lines = [];
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		if (left[i] !== right[i]) lines.push(`  original: ${left[i]} / port: ${right[i]}`);
	}
	return lines.join("; ");
}

if (failures > 0) {
	console.log(`\n${failures} difference(s)`);
	process.exit(1);
}
console.log("\nidentical: the schema, the values and the defaults");
