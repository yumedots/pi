import { InteractiveMode } from "../src/interactive-mode.ts";

/**
 * Build a fake `this` for the interactive mode.
 *
 * The fake inherits from the class prototype, so the delegating getters of the
 * class (`sessionManager`, `settingsManager`, `agent`) resolve through the facade
 * the fake carries. The properties are the collaborators the method under test
 * reads.
 */
export function createInteractiveContext<T extends object>(properties: T): T {
	return Object.assign(Object.create(InteractiveMode.prototype) as object, properties) as T;
}
