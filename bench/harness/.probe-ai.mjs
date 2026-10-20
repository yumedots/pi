import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const files = [];
registerHooks({
	load(url, context, nextLoad) {
		if (url.includes("packages/ai/dist")) files.push(url.replace(/^.*packages\/ai\/dist\//, ""));
		return nextLoad(url, context);
	},
});
await import(pathToFileURL(process.argv[2]).href);
const data = files.filter((f) => f.includes("data/"));
process.stderr.write(`ai modules: ${files.length}, model data files: ${data.length}\n`);
for (const f of data.slice(0, 8)) process.stderr.write(`  ${f}\n`);
