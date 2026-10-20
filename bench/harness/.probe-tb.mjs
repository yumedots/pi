import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const files = [];
registerHooks({
	load(url, context, nextLoad) {
		if (url.includes("node_modules/typebox")) files.push(url.replace(/^.*typebox\/build\//, ""));
		return nextLoad(url, context);
	},
});
await import(pathToFileURL(process.argv[2]).href);
process.stderr.write(`typebox modules: ${files.length}\n`);
const groups = new Map();
for (const f of files) { const k = f.split("/").slice(0, 2).join("/"); groups.set(k, (groups.get(k) ?? 0) + 1); }
for (const [k, v] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) process.stderr.write(`  ${k}: ${v}\n`);
