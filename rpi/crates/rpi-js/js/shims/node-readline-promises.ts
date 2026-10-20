/**
 * The `node:readline/promises` module the extensions import.
 *
 * The embedded host has no terminal input of its own, so the interface
 * exists but cannot read a line.
 */

export interface ReadlineInterface {
	question: (query: string) => Promise<string>;
	close: () => void;
}

export const createInterface = (options?: {
	input?: unknown;
	output?: unknown;
	terminal?: boolean;
}): ReadlineInterface => ({
	question: async () => {
		throw new Error("readline is not available in the embedded extension host");
	},
	close: () => undefined,
});

export default { createInterface };
