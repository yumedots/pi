/**
 * The `node:sys` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const cpus = (): unknown[] => [];
export const endianness = (): string => "LE";
export const platform = (): string => "linux";
export const arch = (): string => "x64";
export const totalmem = (): number => 0;
export const freemem = (): number => 0;
export default { cpus, endianness, platform, arch, totalmem, freemem };
