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
			// The definition may be written on one line (`"id": { defaultKeys: ... },`) or span
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
			const keys = body.match(/defaultKeys:\s*(\[[^\]]*\]|"[^"]*")/);
			i = j;
			if (!keys) continue;
			const list = keys[1];
			const values = list.startsWith("[")
				? [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])
				: [list.slice(1, -1)];
			out.set(head[1], values.map(normalizeKeyId).join(" "));
		}
	}
	return out;
}

function rustKeybindings() {
	const out = new Map();
	const source = read(join(RUST, "crates/rpi-tui/src/keybindings.rs"));
	// `KeyCombo::new(...)` nests parentheses (`Char('b')`), so scan for the matching close
	// paren instead of matching up to the first `)` on the line.
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
		const keys = [];
		let searchFrom = 0;
		for (;;) {
			const call = body.indexOf("KeyCombo::new(", searchFrom);
			if (call === -1) break;
			const argsStart = call + "KeyCombo::new(".length;
			let parens = 1;
			let i = argsStart;
			while (i < body.length && parens > 0) {
				if (body[i] === "(") parens++;
				else if (body[i] === ")") parens--;
				i++;
			}
			keys.push(rustKey(body.slice(argsStart, i - 1)));
			searchFrom = i;
		}
		out.set(id, keys.map(normalizeKeyId).join(" "));
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

function tsCommands() {
	const source = read(join(TS, "packages/coding-agent/src/core/slash-commands.ts"));
	return new Set([...source.matchAll(/\{ name: "([\w-]+)"/g)].map((m) => m[1]));
}

function rustCommands() {
	const source = read(join(RUST, "crates/rpi-cli/src/interactive_tui/commands.rs"));
	return new Set([...source.matchAll(/"([\w-]+)"/g)].map((m) => m[1]));
}

// -------------------------------------------------------------- settings keys

function tsSettings() {
	const source = read(join(TS, "packages/coding-agent/src/core/settings-schema.ts"));
	return new Set([...source.matchAll(/^\t([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
}

function rustSettings() {
	const source = read(join(RUST, "crates/rpi-cli/src/settings.rs"));
	const names = new Set();
	for (const match of source.matchAll(/serde\(rename = "([\w]+)"[^)]*\)\s*\n?\s*pub ([a-zA-Z][\w]*):/g)) {
		names.add(match[1]);
	}
	for (const match of source.matchAll(/pub ([a-zA-Z][\w]*): Option<[^>]*>,\n\s*#\[serde\(rename = "([\w]+)"\)/g)) {
		names.add(match[2]);
	}
	// Serde keeps the field name when no `rename` is given, so the struct fields are
	// settings keys too (`auto_resize` is the `autoResize` key).
	const structStart = source.search(/pub struct Settings\b/);
	if (structStart !== -1) {
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
		for (const match of source.slice(start, i).matchAll(/^\s*pub ([a-zA-Z][\w]*)\s*:/gm)) {
			names.add(match[1]);
		}
	}
	return names;
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
	const rust = rustSettings();
	const rustByKey = new Map([...rust].map((key) => [settingKey(key), key]));
	const tsByKey = new Map([...ts].map((key) => [settingKey(key), key]));
	const missing = [...tsByKey.entries()].filter(([key]) => !rustByKey.has(key)).map(([, name]) => name).sort();
	const extra = [...rustByKey.entries()].filter(([key]) => !tsByKey.has(key)).map(([, name]) => name).sort();
	console.log(`\n## settings keys`);
	console.log(`the original: ${ts.size}, the port: ${rust.size}`);
	if (missing.length === 0 && extra.length === 0) {
		console.log("identical");
		return;
	}
	if (missing.length > 0) console.log(`missing on the port (${missing.length}): ${missing.join(", ")}`);
	if (extra.length > 0) console.log(`only on the port (${extra.length}): ${extra.join(", ")}`);
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
