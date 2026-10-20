/**
 * The `node:punycode` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const toASCII = (domain: string): string => domain;
export const toUnicode = (domain: string): string => domain;
export default { toASCII, toUnicode };
