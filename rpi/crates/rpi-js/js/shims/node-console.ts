/**
 * The `node:console` module the extensions import.
 *
 * The runtime already publishes a console; this module points at it so that
 * a module that imports `node:console` gets the same object.
 */

const console = (globalThis as unknown as { console: Record<string, unknown> }).console;

export const log = console.log as (...args: unknown[]) => void;
export const info = console.info as (...args: unknown[]) => void;
export const warn = console.warn as (...args: unknown[]) => void;
export const error = console.error as (...args: unknown[]) => void;
export const debug = console.debug as (...args: unknown[]) => void;
export const trace = console.debug as (...args: unknown[]) => void;
export const dir = console.log as (...args: unknown[]) => void;
export const table = console.log as (...args: unknown[]) => void;
export const time = console.log as (...args: unknown[]) => void;
export const timeEnd = console.log as (...args: unknown[]) => void;
export const assert = console.log as (...args: unknown[]) => void;
export const group = console.log as (...args: unknown[]) => void;
export const groupEnd = console.log as (...args: unknown[]) => void;

export default console;
