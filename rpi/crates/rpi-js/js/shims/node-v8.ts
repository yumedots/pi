/**
 * The `node:v8` module the extensions import.
 *
 * The embedded host has no serialisation format to share: the names exist
 * so that a module that imports them loads.
 */

export const serialize = (value: unknown): string => JSON.stringify(value) ?? "null";
export const deserialize = (value: string): unknown => JSON.parse(value);
export const setFlagsFromString = (_flags: string): void => undefined;

export default { serialize, deserialize, setFlagsFromString };
