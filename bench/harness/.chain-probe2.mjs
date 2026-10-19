import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const seen = new Set();
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.includes("modes/interactive/components/") && context.parentURL && !seen.has(context.parentURL)) {
			seen.add(context.parentURL);
			process.stderr.write(`${context.parentURL.replace(/^file:\/\/.*\/(packages|node_modules)\//, "$1/")}\n`);
		}
		return nextResolve(specifier, context);
	},
});

await import(pathToFileURL(process.argv[2]).href);
