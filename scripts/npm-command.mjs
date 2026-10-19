import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Run npm. Publishing and the lockfile the published installer uses stay on
 * npm, so this is still the tool for `npm pack`, `npm publish` and `npm view`.
 */
export function execNpmSync(args, options = {}) {
	if (process.platform !== "win32") return execFileSync("npm", args, options);
	const npmCli = process.env.npm_execpath;
	if (!npmCli) throw new Error("Cannot locate npm on Windows. Run this command through its npm script.");
	if (!existsSync(npmCli)) throw new Error(`Cannot locate the npm CLI: ${npmCli}`);
	return execFileSync(process.execPath, [npmCli, ...args], options);
}

/**
 * Run Bun. On Windows the `bun` executable is `bun.exe` on PATH, so the
 * non-Windows `.cmd` shim npm needs does not apply here.
 */
export function execBunSync(args, options = {}) {
	return execFileSync("bun", args, options);
}
