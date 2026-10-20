#!/usr/bin/env node
/**
 * The mechanical parity audit.
 *
 * It extracts the things a user can touch from both trees and diffs them:
 * the keybindings and their default keys, the slash commands, the settings
 * keys, the interactive components, and the strings the screens are built
 * from. Reading the code misses things; extracting does not.
 *
 * Usage: node scripts/parity/audit.mjs [section ...]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TS = "/Users/gabriel/pi";
const RUST = join(ROOT, "rpi");

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// ---------------------------------------------------------------- keybindings

/** Modifier order used on both sides so `ctrl+shift+x` and `shift+ctrl+x` compare equal. */
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "super"];

/** Normalise one key id: order the modifiers, keep the base key as written. */
function normalizeKeyId(key) {
	const parts = key.split("+");
	if (parts.length === 1) return key;
	const base = parts.pop();
	const mods = MODIFIER_ORDER.filter((m) => parts.includes(m));
	// The page keys are camel case on both sides (`pageUp`), unlike every other base key.
	const spelled = base === "pageup" ? "pageUp" : base === "pagedown" ? "pageDown" : base;
	return [...mods, spelled].join("+");
}

// The host platform the audit resolves for: macOS, not Windows.
const HOST = { platform: "darwin", windowsKeybindings: false };

/** Index of `char` in `text` outside of brackets, quotes and template literals. */
function indexAtTopLevel(text, char, from = 0) {
	let depth = 0;
	let quote = null;
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\") i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			continue;
		}
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") depth--;
		else if (c === char && depth === 0) return i;
	}
	return -1;
}

/** Evaluate a TypeScript platform condition for the host. */
function tsConditionHolds(condition) {
	const cond = condition.trim();
	if (/^!\s*windowsKeybindings$/.test(cond)) return !HOST.windowsKeybindings;
	if (/^windowsKeybindings$/.test(cond)) return HOST.windowsKeybindings;
	const platform = cond.match(/process\.platform\s*===\s*"([^"]+)"/);
	if (platform) return platform[1] === HOST.platform;
	return false;
}

/** Resolve a TypeScript `cond ? a : b` expression for the host. */
function resolveTsExpression(expr) {
	const text = expr.trim();
	const question = indexAtTopLevel(text, "?");
	if (question === -1) return text;
	const rest = text.slice(question + 1);
	const colon = indexAtTopLevel(rest, ":");
	if (colon === -1) return text;
	const condition = text.slice(0, question);
	const whenTrue = rest.slice(0, colon);
	const whenFalse = rest.slice(colon + 1);
	return resolveTsExpression(tsConditionHolds(condition) ? whenTrue : whenFalse);
}

/** Read a `{ … }` block; returns its body and the index after the closing brace. */
function readBlock(text, braceIndex) {
	let depth = 0;
	for (let i = braceIndex; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}") {
			depth--;
			if (depth === 0) return { body: text.slice(braceIndex + 1, i), end: i + 1 };
		}
	}
	return { body: text.slice(braceIndex + 1), end: text.length };
}

/** Evaluate a Rust `cfg!` condition for the host. */
function rustConditionHolds(condition) {
	const cond = condition.trim();
	const negated = cond.match(/^not\s*\(\s*cfg!\(([^)]*)\)\s*\)$/);
	const inner = negated ? negated[1] : cond.match(/^cfg!\(([^)]*)\)$/)?.[1];
	if (inner === undefined) return false;
	const check = (predicate) => {
		const windows = /^windows$/.test(predicate);
		const targetOs = predicate.match(/^target_os\s*=\s*"([^"]+)"$/);
		if (windows) return HOST.platform === "win32";
		if (targetOs) return targetOs[1] === HOST.platform;
		return false;
	};
	const value = check(inner.trim());
	return negated ? !value : value;
}

/** The key combos of a Rust expression, with the platform conditionals resolved. */
function rustKeysIn(expr) {
	const keys = [];
	let i = 0;
	while (i < expr.length) {
		const callIndex = expr.indexOf("KeyCombo::new(", i);
		const ifIndex = expr.indexOf("if ", i);
		if (callIndex !== -1 && (ifIndex === -1 || callIndex < ifIndex)) {
			const argsStart = callIndex + "KeyCombo::new(".length;
			let parens = 1;
			let j = argsStart;
			while (j < expr.length && parens > 0) {
				if (expr[j] === "(") parens++;
				else if (expr[j] === ")") parens--;
				j++;
			}
			keys.push(rustKey(expr.slice(argsStart, j - 1)));
			i = j;
			continue;
		}
		if (ifIndex === -1) break;
		const braceIndex = expr.indexOf("{", ifIndex);
		if (braceIndex === -1) break;
		const condition = expr.slice(ifIndex + 3, braceIndex);
		const thenBlock = readBlock(expr, braceIndex);
		const afterThen = thenBlock.end;
		const elseIndex = expr.indexOf("else", afterThen);
		let chosen = thenBlock.body;
		let next = thenBlock.end;
		if (elseIndex !== -1 && !/[\w]/.test(expr[elseIndex - 1] ?? "")) {
			const elseRest = expr.slice(elseIndex + 4).trimStart();
			if (elseRest.startsWith("if ")) {
				// `else if …`: resolve the nested condition as its own expression.
				const nested = resolveRustConditional(expr, elseIndex + 4);
				chosen = nested;
				next = nested.end;
			} else {
				const elseBrace = expr.indexOf("{", elseIndex);
				if (elseBrace !== -1) {
					const elseBlock = readBlock(expr, elseBrace);
					chosen = elseBlock.body;
					next = elseBlock.end;
				}
			}
		}
		if (!rustConditionHolds(condition)) {
			// The other branch wins: resolve it from the same expression text.
			const elseBranch = expr.indexOf("else", afterThen);
			if (elseBranch !== -1) {
				const elseRest = expr.slice(elseBranch + 4).trimStart();
				if (elseRest.startsWith("if ")) {
					const nested = resolveRustConditional(expr, elseBranch + 4);
					chosen = nested.body;
					next = nested.end;
				} else {
					const elseBrace = expr.indexOf("{", elseBranch);
					if (elseBrace !== -1) {
						const elseBlock = readBlock(expr, elseBrace);
						chosen = elseBlock.body;
						next = elseBlock.end;
					}
				}
			}
		}
		keys.push(...rustKeysIn(chosen));
		i = next;
	}
	return keys;
}

/** Resolve one Rust `if cond { … } else { … }` starting at `ifIndex`. */
function resolveRustConditional(expr, ifIndex) {
	const braceIndex = expr.indexOf("{", ifIndex);
	const condition = expr.slice(ifIndex + 3, braceIndex);
	const thenBlock = readBlock(expr, braceIndex);
	const elseIndex = expr.indexOf("else", thenBlock.end);
	let body = thenBlock.body;
	let end = thenBlock.end;
	if (elseIndex !== -1) {
		const elseRest = expr.slice(elseIndex + 4).trimStart();
		if (elseRest.startsWith("if ")) {
			const nested = resolveRustConditional(expr, elseIndex + 4);
			body = nested.body;
			end = nested.end;
		} else {
			const elseBrace = expr.indexOf("{", elseIndex);
			const elseBlock = readBlock(expr, elseBrace);
			body = elseBlock.body;
			end = elseBlock.end;
		}
	}
	if (!rustConditionHolds(condition)) {
		// Re-resolve with the other branch.
		const elseIndex2 = expr.indexOf("else", thenBlock.end);
		if (elseIndex2 !== -1) {
			const elseRest = expr.slice(elseIndex2 + 4).trimStart();
			if (elseRest.startsWith("if ")) {
				const nested = resolveRustConditional(expr, elseIndex2 + 4);
				body = nested.body;
				end = nested.end;
			} else {
				const elseBrace = expr.indexOf("{", elseIndex2);
				const elseBlock = readBlock(expr, elseBrace);
				body = elseBlock.body;
				end = elseBlock.end;
			}
		}
	}
	return { body, end };
}

function tsKeybindings() {
	const out = new Map();
	const files = [
		join(TS, "packages/tui/src/keybindings.ts"),
		join(TS, "packages/coding-agent/src/core/keybindings.ts"),
	];
	for (const file of files) {
		const source = read(file);
		const lines = source.split("\n");
		for (let i = 0; i < lines.length; i++) {
			// The definition may be written on one line (`"id": { defaultKeys: … },`) or span
			// several lines. Collect until the body holds both `defaultKeys` and its closing brace.
			const head = lines[i].match(/^\t*"([a-zA-Z][\w.]*)":\s*\{/);
			if (!head) continue;
			let body = "";
			let j = i;
			while (j < lines.length) {
				body += (j === i ? "" : "\n") + lines[j];
				if (/defaultKeys:[\s\S]*?\}/.test(body)) break;
				j++;
			}
			// The value may be a conditional (`process.platform === "win32" ? … : …`); take the
			// whole expression and resolve it for the host platform.
			const value = body.match(/defaultKeys:\s*([^\n]*)/);
			i = j;
			if (!value) continue;
			// Cut the expression at the first comma outside brackets and quotes, so a
			// single-line definition does not drag its `description` along.
			const comma = indexAtTopLevel(value[1], ",");
			const expression = (comma === -1 ? value[1] : value[1].slice(0, comma)).trim();
			const resolved = resolveTsExpression(expression);
			const values = resolved.startsWith("[")
				? [...resolved.matchAll(/"([^"]+)"/g)].map((m) => m[1])
				: resolved.startsWith('"')
					? [resolved.slice(1, -1)]
					: [];
			out.set(head[1], values.map(normalizeKeyId).sort().join(" "));
		}
	}
	return out;
}

function rustKeybindings() {
	const out = new Map();
	const source = read(join(RUST, "crates/rpi-tui/src/keybindings.rs"));
	for (const match of source.matchAll(/map\.insert\(\s*"([\w.]+)",\s*KeybindingDefinition\s*\{/g)) {
		const [, id] = match;
		// Bound the scan to the definition block: the braces of the `KeybindingDefinition { … }`.
		const bodyStart = match.index + match[0].length;
		let depth = 1;
		let end = bodyStart;
		while (end < source.length && depth > 0) {
			if (source[end] === "{") depth++;
			else if (source[end] === "}") depth--;
			end++;
		}
		const body = source.slice(bodyStart, end);
		const keys = rustKeysIn(body);
		out.set(id, keys.map(normalizeKeyId).sort().join(" "));
	}
	return out;
}

function rustKey(args) {
	const parts = args.split(",").map((part) => part.trim());
	const key = parts[0] ?? "";
	const modifiers = parts.slice(1).join(",");
	let base = key;
	if (key.startsWith("Char(")) base = key.slice(5, -1).replace(/^['"]|['"]$/g, "");
	else if (key === "Esc") base = "escape";
	else if (key === "Enter") base = "enter";
	else if (key === "Tab") base = "tab";
	else if (key === "Backspace") base = "backspace";
	else if (key === "Space") base = "space";
	else if (key === "Delete") base = "delete";
	else if (key === "Insert") base = "insert";
	else if (key === "Home") base = "home";
	else if (key === "End") base = "end";
	else if (key === "PageUp") base = "pageUp";
	else if (key === "PageDown") base = "pageDown";
	else if (/^(Up|Down|Left|Right)$/.test(key)) base = key.toLowerCase();
	else if (/^F\(\d+\)$/.test(key)) base = `f${key.slice(2, -1)}`;
	const mods = [];
	if (modifiers.includes("M::CONTROL")) mods.push("ctrl");
	if (modifiers.includes("M::ALT")) mods.push("alt");
	if (modifiers.includes("M::SHIFT")) mods.push("shift");
	return [...mods, base].join("+");
}

// ------------------------------------------------------------- slash commands

/**
 * The original's invocable slash-command names: every builtin's canonical name
 * plus its aliases (`resume` also answers to `history` and `sessions`). The
 * names are compared as the user types them, with the leading slash.
 */
function tsCommands() {
	const source = read(join(TS, "packages/coding-agent/src/core/slash-commands.ts"));
	const names = new Set();
	for (const match of source.matchAll(/\{\s*name:\s*"([\w-]+)"/g)) names.add(`/${match[1]}`);
	for (const match of source.matchAll(/aliases:\s*\[([^\]]*)\]/g)) {
		for (const alias of match[1].matchAll(/"([\w-]+)"/g)) names.add(`/${alias[1]}`);
	}
	return names;
}

/**
 * The port's invocable slash-command names: the `name()` of every
 * `SlashCommand` impl plus its `aliases()`.
 *
 * The extraction is anchored on those two trait methods on purpose. Scanning
 * every quoted string in commands.rs also picks up unrelated literals — export
 * formats, boolean values, provider ids — and reported them as commands.
 */
function rustCommands() {
	const source = read(join(RUST, "crates/rpi-cli/src/interactive_tui/commands.rs"));
	const names = new Set();
	for (const match of source.matchAll(/fn name\(&self\)\s*->\s*&'static str\s*\{\s*"([^"]+)"/g)) {
		names.add(match[1]);
	}
	for (const match of source.matchAll(
		/fn aliases\(&self\)\s*->\s*&'static \[&'static str\]\s*\{\s*&\[([^\]]*)\]/g,
	)) {
		for (const alias of match[1].matchAll(/"([^"]+)"/g)) names.add(alias[1]);
	}
	return names;
}

// -------------------------------------------------------------- settings keys

/**
 * The original's top-level settings keys: the members of the `SettingsSchema`
 * object. The nested schemas (`CompactionSettingsSchema` and friends) sit one
 * indent deeper and are not top-level keys.
 */
function tsSettings() {
	const source = read(join(TS, "packages/coding-agent/src/core/settings-schema.ts"));
	const start = source.indexOf("export const SettingsSchema");
	if (start === -1) return new Set();
	const block = source.slice(start, source.indexOf("\n);", start));
	return new Set([...block.matchAll(/^\t\t(\$?[a-zA-Z][\w$]*):/gm)].map((m) => m[1]));
}

/** serde's `rename_all = "camelCase"` spelling of a snake_case field name. */
function camelCase(name) {
	return name
		.split("_")
		.map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
		.join("");
}

/**
 * The port's top-level settings keys: the serde name of every field of the
 * `Settings` struct, which is the name the port reads and writes. A field
 * carrying `skip_serializing` is a legacy spelling the port reads but never
 * writes, and a field marked `port extension:` is rpi's own key.
 */
function rustSettings() {
	const source = read(join(RUST, "crates/rpi-cli/src/settings.rs"));
	const keys = new Set();
	const extensions = new Set();
	const structStart = source.search(/pub struct Settings\b/);
	if (structStart === -1) return { keys, extensions };
	const camel = /rename_all = "camelCase"/.test(source.slice(Math.max(0, structStart - 400), structStart));

	let depth = 0;
	let i = source.indexOf("{", structStart);
	const start = i;
	for (; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) break;
		}
	}
	const body = source.slice(start, i);
	let pending = [];
	for (const line of body.split("\n")) {
		const match = line.match(/^\s*pub ([a-zA-Z_][\w]*)\s*:/);
		if (!match) {
			if (line.trim() !== "") pending.push(line);
			continue;
		}
		const field = [...pending, line].join("\n");
		pending = [];
		const name = match[1];
		const rename = field.match(/rename = "([^"]+)"/);
		const key = rename ? rename[1] : camel ? camelCase(name) : name;
		if (/skip_serializing(?!_if)/.test(field)) continue;
		if (/port extension:/.test(field)) {
			extensions.add(key);
			continue;
		}
		keys.add(key);
	}
	return { keys, extensions };
}

// ---------------------------------------------------------------- components

function tsComponents() {
	const dir = join(TS, "packages/coding-agent/src/modes/interactive/components");
	return new Set(readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")));
}

function rustComponents() {
	const names = new Set();
	for (const dir of [
		join(RUST, "crates/rpi-tui/src"),
		join(RUST, "crates/rpi-cli/src/interactive_tui"),
	]) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".rs")) continue;
			names.add(file.replace(/\.rs$/, "").replace(/_/g, "-"));
		}
	}
	return names;
}

// -------------------------------------------------------------------- report

function diffSet(label, mine, theirs) {
	const missing = [...theirs].filter((item) => !mine.has(item)).sort();
	const extra = [...mine].filter((item) => !theirs.has(item)).sort();
	console.log(`\n## ${label}`);
	console.log(`the original: ${theirs.size}, the port: ${mine.size}`);
	if (missing.length === 0 && extra.length === 0) {
		console.log("identical");
		return { missing, extra };
	}
	if (missing.length > 0) console.log(`missing on the port (${missing.length}): ${missing.join(", ")}`);
	if (extra.length > 0) console.log(`only on the port (${extra.length}): ${extra.join(", ")}`);
	return { missing, extra };
}

/** Settings keys are camel case in the original and snake case in the port. */
function settingKey(key) {
	return key.replace(/_/g, "").toLowerCase();
}

function diffSettings() {
	const ts = tsSettings();
	const { keys: rust, extensions } = rustSettings();
	const rustByKey = new Map([...rust].map((key) => [settingKey(key), key]));
	const tsByKey = new Map([...ts].map((key) => [settingKey(key), key]));
	const missing = [...tsByKey.entries()].filter(([key]) => !rustByKey.has(key)).map(([, name]) => name).sort();
	const extra = [...rustByKey.entries()].filter(([key]) => !tsByKey.has(key)).map(([, name]) => name).sort();
	console.log(`\n## settings keys`);
	console.log(`the original: ${ts.size}, the port: ${rust.size}`);
	if (missing.length === 0 && extra.length === 0) {
		console.log("identical");
	} else {
		if (missing.length > 0) console.log(`missing on the port (${missing.length}): ${missing.join(", ")}`);
		if (extra.length > 0) console.log(`only on the port (${extra.length}): ${extra.join(", ")}`);
	}
	if (extensions.size > 0) {
		console.log(`port extensions, not in the original (${extensions.size}): ${[...extensions].sort().join(", ")}`);
	}
}

function diffKeys() {
	const ts = tsKeybindings();
	const rust = rustKeybindings();
	console.log(`\n## keybindings`);
	console.log(`the original: ${ts.size}, the port: ${rust.size}`);
	const missing = [...ts.keys()].filter((id) => !rust.has(id)).sort();
	const extra = [...rust.keys()].filter((id) => !ts.has(id)).sort();
	const different = [...ts.keys()].filter((id) => rust.has(id) && rust.get(id) !== ts.get(id)).sort();
	if (missing.length === 0 && extra.length === 0 && different.length === 0) {
		console.log("identical: every id, every default key");
		return;
	}
	if (missing.length > 0) console.log(`missing on the port (${missing.length}): ${missing.join(", ")}`);
	if (extra.length > 0) console.log(`only on the port (${extra.length}): ${extra.join(", ")}`);
	if (different.length > 0) {
		console.log(`different default keys (${different.length}):`);
		for (const id of different) console.log(`  ${id}: the original "${ts.get(id)}" vs the port "${rust.get(id)}"`);
	}
}

const sections = process.argv.slice(2);
const want = (name) => sections.length === 0 || sections.includes(name);

if (want("keys")) diffKeys();
if (want("commands")) diffSet("slash commands", rustCommands(), tsCommands());
if (want("settings")) diffSettings();
if (want("components")) diffSet("components", rustComponents(), tsComponents());
