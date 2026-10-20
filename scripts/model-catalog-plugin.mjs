import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * The generated model catalog is a single file that holds every provider. A bundle that
 * only needs some of them should not carry the rest, so each provider shard receives
 * just its own slice of the catalog.
 *
 * @param catalogDataDir the directory that holds the generated `models.json`
 */
export function modelCatalogSlicePlugin(catalogDataDir) {
	const dataDir = resolve(catalogDataDir);
	return {
		name: "model-catalog-slice",
		setup(build) {
			build.onResolve({ filter: /^\.\/data\/models\.json$/ }, (args) => {
				if (!/\.models\.(ts|js)$/.test(args.importer)) return null;
				const path = resolve(dirname(args.importer), args.path);
				if (dirname(path) !== dataDir || !existsSync(path)) return null;
				const providerId = basename(args.importer).replace(/\.models\.(ts|js)$/, "");
				return { path, namespace: "model-catalog-slice", pluginData: { providerId } };
			});
			build.onLoad({ filter: /.*/, namespace: "model-catalog-slice" }, (args) => {
				const catalog = JSON.parse(readFileSync(args.path, "utf8"));
				const providers = catalog?.providers ?? {};
				const slice = { providers: { [args.pluginData.providerId]: providers[args.pluginData.providerId] } };
				return { contents: JSON.stringify(slice), loader: "json" };
			});
		},
	};
}
