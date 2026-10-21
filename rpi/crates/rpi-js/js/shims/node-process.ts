/**
 * The `node:process` module the extensions import.
 *
 * The runtime already publishes the process globals; this module points at
 * them so that a module that imports `node:process` gets the same object.
 */

const globals = globalThis as unknown as {
	process: Record<string, unknown>;
	__piProcess?: Record<string, unknown>;
};

// The host's own object, kept under a name the bundle does not know: a
// CommonJS package in pi's dependency tree replaces the global `process`
// while the bundle loads, and the replacement's `env` is null.
//
// The name is written out in full and the local is not called `process`:
// the bundler defines `process` as `__piProcess`, which would turn a local
// of that name into a shadow of the global it is meant to read.
const hostProcess = globals.__piProcess ?? globals.process;

export const env = hostProcess.env as Record<string, string | undefined>;
export const argv = hostProcess.argv as string[];
export const platform = hostProcess.platform as string;
export const pid = hostProcess.pid as number;
export const version = hostProcess.version as string;
export const versions = hostProcess.versions as Record<string, string>;
export const cwd = hostProcess.cwd as () => string;
export const exit = hostProcess.exit as (code?: number) => void;
export const stdout = hostProcess.stdout as Record<string, unknown>;
export const stderr = hostProcess.stderr as Record<string, unknown>;

export default hostProcess;
