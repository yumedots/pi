/**
 * The trust of a project directory.
 *
 * The trust decision belongs to the server: it stores it and it refuses to open a
 * session in a directory the user did not trust. The client asks the server about
 * the trust state and hands the decision over.
 *
 * What the client still does itself is the question "does this directory hold
 * resources that need trust": that is a look at the filesystem, and it is what tells
 * the client whether it has to warn about the directory at all.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalizePath, resolvePath } from "./paths.ts";

/** The name of the configuration directory of a project. */
const CONFIG_DIR_NAME = ".pi";

/** The resources of a project that need the trust of the user. */
const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = [
	"settings.json",
	"mcp.json",
	"extensions",
	"skills",
	"prompts",
	"themes",
	"SYSTEM.md",
	"APPEND_SYSTEM.md",
];

/**
 * Whether a directory holds resources that need the trust of the user.
 *
 * A directory with extensions, skills or its own settings runs code, so the user has
 * to trust it first. The parents count too: a directory inside a trusted one is
 * trusted as well.
 */
export function hasTrustRequiringProjectResources(cwd: string): boolean {
	const homeDir = canonicalizePath(resolvePath(process.env.HOME || homedir()));
	const userAgentsSkillsDir = join(homeDir, ".agents", "skills");
	let currentDir = canonicalizePath(resolvePath(cwd));

	const configDir = join(currentDir, CONFIG_DIR_NAME);
	if (TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.some((entry) => existsSync(join(configDir, entry)))) {
		return true;
	}

	while (true) {
		const agentsSkillsDir = join(currentDir, ".agents", "skills");
		if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) {
			return true;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			return false;
		}
		currentDir = parentDir;
	}
}

/** The directory a path resolves to, the way the trust store writes it. */
export function trustKeyFor(cwd: string): string {
	return resolve(cwd);
}
