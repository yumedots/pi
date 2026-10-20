/**
 * The `node:process` module the extensions import.
 *
 * The runtime already publishes the process globals; this module points at
 * them so that a module that imports `node:process` gets the same object.
 */

const process = (globalThis as unknown as { process: Record<string, unknown> }).process;

export const env = process.env as Record<string, string | undefined>;
export const argv = process.argv as string[];
export const platform = process.platform as string;
export const pid = process.pid as number;
export const version = process.version as string;
export const versions = process.versions as Record<string, string>;
export const cwd = process.cwd as () => string;
export const exit = process.exit as (code?: number) => void;
export const stdout = process.stdout as Record<string, unknown>;
export const stderr = process.stderr as Record<string, unknown>;

export default process;
