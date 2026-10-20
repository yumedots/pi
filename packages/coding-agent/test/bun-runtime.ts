// Test helper: run a test as if the process were not running on Bun.
//
// The coding agent reports the runtime it runs on before it looks at the
// install path, so on Bun it answers "bun" for an install path that names no
// package manager, and it refuses to self-update an npm installation. Those
// are correct answers on Bun, but the tests that cover the path-based
// detection want the path to decide.
//
// The runtime is read at call time (see isBunRuntime in src/config.ts), so
// hiding it for the duration of a test is enough. It has to be restored
// afterwards: Bun's own internals read process.versions.bun.

const bunVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, "bun");

/** Hide the Bun runtime for the duration of the returned restore function. */
export function hideBunRuntime(): () => void {
	if (bunVersionDescriptor) {
		Object.defineProperty(process.versions, "bun", { ...bunVersionDescriptor, value: undefined });
	}
	return () => {
		if (bunVersionDescriptor) {
			Object.defineProperty(process.versions, "bun", bunVersionDescriptor);
		}
	};
}
