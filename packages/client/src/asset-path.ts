import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the path of a bundled client asset (the images shipped with the TUI).
 *
 * The assets live in `src/assets` in the source tree and in `dist/assets` in a built package.
 * The lookup walks up from this module so it works for the unbundled build, the esbuild
 * bundle (whose chunks live in `dist/bundle`) and a compiled binary (whose assets sit next
 * to the executable).
 */
export function getBundledClientAssetPath(name: string): string | undefined {
	const candidates: string[] = [];
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 5; depth++) {
		candidates.push(join(dir, "assets", name), join(dir, "src", "assets", name), join(dir, "dist", "assets", name));
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	if (process.execPath) {
		candidates.push(join(dirname(process.execPath), "assets", name));
	}
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}
