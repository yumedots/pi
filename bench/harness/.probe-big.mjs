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
const rows = files.sort((a, b) => b.size - a.size).slice(0, 15);
let total = 0;
for (const f of files) total += f.size;
process.stderr.write(`files: ${files.length}, source: ${(total / 1024).toFixed(0)}KB\n`);
for (const row of rows) process.stderr.write(`${(row.size / 1024).toFixed(0).padStart(7)}KB ${row.path.replace(/^.*\/(packages|node_modules)\//, "$1/")}\n`);
