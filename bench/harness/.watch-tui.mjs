import { registerHooks } from "node:module";

const seen = new Set();
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-tui" && context.parentURL && !seen.has(context.parentURL)) {
			seen.add(context.parentURL);
			process.stderr.write(`BARREL <- ${context.parentURL.replace(/^file:\/\/.*\/(packages|node_modules)\//, "$1/")}\n`);
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.includes("modes/interactive/interactive-mode.js")) {
			process.stderr.write(`INTERACTIVE LOADED\n`);
		}
		return nextLoad(url, context);
	},
});
