/**
 * The commands that the package manager handles.
 *
 * The check lives in a module of its own: the package commands draw a terminal
 * interface, and the agent only needs to know whether it has to load them.
 */

export const PACKAGE_COMMANDS = ["install", "remove", "uninstall", "update", "list"] as const;

/** Whether the arguments ask for a package command. */
export function isPackageCommand(args: string[]): boolean {
	const command = args[0];
	return PACKAGE_COMMANDS.some((candidate) => candidate === command);
}

/** Whether the arguments ask for the config command. */
export function isConfigCommand(args: string[]): boolean {
	return args[0] === "config";
}
