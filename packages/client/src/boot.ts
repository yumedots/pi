/**
 * The first thing the client does.
 *
 * The server takes a while to boot and the client takes a while to load its own modules.
 * This module starts the server first, so the two waits overlap and the terminal UI shows
 * up sooner.
 *
 * It is the first import of the entry point, so its body runs before the rest of the
 * client is loaded. A command that does not need a server never asks for one.
 */

import { getAgentDir } from "./client-support/config.ts";
import { prewarmServer } from "./server-launcher.ts";

/** The commands that do not open a session. */
const OTHER_COMMANDS = new Set(["serve", "pair", "service", "self-install", "config"]);

const args = process.argv.slice(2);
const first = args[0];
const opensSession =
	first === undefined || (first !== "--help" && first !== "-h" && first !== "--version" && !OTHER_COMMANDS.has(first));

if (opensSession) prewarmServer({ agentDir: getAgentDir() });
