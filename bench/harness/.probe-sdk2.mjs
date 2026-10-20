import { registerHooks } from "node:module";
const files = [];
registerHooks({
	load(url, context, nextLoad) {
		if (url.includes("node_modules/")) {
			const match = url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
			if (match) files.push(match[1]);
		}
		return nextLoad(url, context);
	},
});
await import("/Users/gabriel/pi/packages/ai/dist/providers/all.js");
const groups = new Map();
for (const f of files) groups.set(f, (groups.get(f) ?? 0) + 1);
process.stderr.write(`packages: ${groups.size}\n`);
for (const [k, v] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) process.stderr.write(`  ${k}: ${v} files\n`);
