/**
 * The `node:zlib` module the extensions import.
 *
 * The embedded host does not compress: the names exist so that a module that
 * imports them loads, and using them throws.
 */

const unavailable = (name: string) => (): never => {
	throw new Error(`${name} is not available in the embedded extension host`);
};

export const crc32 = unavailable("crc32");
export const deflateRawSync = unavailable("deflateRawSync");
export const inflateRawSync = unavailable("inflateRawSync");
export const gzipSync = unavailable("gzipSync");
export const gunzipSync = unavailable("gunzipSync");

export default { crc32, deflateRawSync, inflateRawSync, gzipSync, gunzipSync };
