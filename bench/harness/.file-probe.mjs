import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const files = [];
registerHooks({
	load(url, context, nextLoad) {
		if (url.startsWith("file:")) {
			try {
				files.push({ path: fileURLToPath(url), size: statSync(fileURLToPath(url)).size });
			} catch {}
		}
		return nextLoad(url, context);
	},
});
await import(pathToFileURL(process.argv[2]).href);
const filter = process.argv[3] ?? "packages/tui";
const rows = files.filter((f) => f.path.includes(filter)).sort((a, b) => b.size - a.size);
let total = 0;
for (const row of rows) total += row.size;
process.stderr.write(`files: ${rows.length}, source: ${(total / 1024).toFixed(0)}KB\n`);
for (const row of rows.slice(0, 12)) {
	process.stderr.write(`${(row.size / 1024).toFixed(0).padStart(6)}KB ${row.path.replace(/^.*\/(packages|node_modules)\//, "$1/")}\n`);
}
