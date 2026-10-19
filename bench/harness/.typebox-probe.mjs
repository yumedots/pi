import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const files = [];
registerHooks({
	load(url, context, nextLoad) {
		if (url.startsWith("file:")) {
			try {
				const path = fileURLToPath(url);
				files.push({ path, size: statSync(path).size });
			} catch {}
		}
		return nextLoad(url, context);
	},
});

const rss = () => Math.round(process.memoryUsage().rss / 1048576);
console.log("start", rss(), "MB");
await import("typebox");
console.log("after typebox", rss(), "MB");
const typebox = files.filter((f) => f.path.includes("node_modules/typebox"));
let total = 0;
for (const row of typebox) total += row.size;
console.log(`typebox files: ${typebox.length}, source: ${(total / 1024).toFixed(0)}KB`);
const groups = new Map();
for (const row of typebox) {
	const key = row.path.replace(/^.*typebox\/build\//, "").split("/").slice(0, 2).join("/");
	groups.set(key, (groups.get(key) ?? 0) + row.size);
}
for (const [key, size] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
	console.log(`  ${key.padEnd(30)} ${(size / 1024).toFixed(0)}KB`);
}
