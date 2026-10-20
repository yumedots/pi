import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "/Users/gabriel/pi/packages/ai/src/providers/data";
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const files = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== ".manifest.json");

console.log("start", rss(), "MB");

// Shape A: the per-provider files, one at a time.
const providers = new Map();
for (const file of files) {
	providers.set(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, file), "utf8")));
}
console.log("after parsing all", files.length, "provider files", rss(), "MB");

// Shape B: one file with the same content.
const merged = { generatedAt: "now", providers: Object.fromEntries(providers) };
const mergedJson = JSON.stringify(merged);
console.log("the merged file is", (mergedJson.length / 1024).toFixed(0), "KB");
const parsed = JSON.parse(mergedJson);
console.log("after parsing the merged file", rss(), "MB");
console.log("one provider slice:", Object.keys(parsed.providers.anthropic).length, "apis");
