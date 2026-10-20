/**
 * The `node:readline` module the extensions import.
 *
 * The embedded host has no terminal input of its own, so the interface
 * exists but cannot read a line.
 */

export interface ReadlineInterface {
	prompt: (text?: string) => void;
	close: () => void;
	on: (event: string, listener: (...args: unknown[]) => void) => ReadlineInterface;
}

export const createInterface = (options?: {
	input?: unknown;
	output?: unknown;
	terminal?: boolean;
}): ReadlineInterface => {
	const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
	return {
		prompt: () => undefined,
		close: () => undefined,
		on: (event: string, listener: (...args: unknown[]) => void) => {
			const existing = listeners.get(event) ?? [];
			existing.push(listener);
			listeners.set(event, existing);
			return this;
		},
	};
};

export default { createInterface };
