/**
 * The `node:querystring` module the extensions import.
 *
 * The embedded host has no such facility: the names exist so that a
 * module that imports them loads.
 */

export const stringify = (value: Record<string, unknown>): string => {
	const parts = Object.entries(value).map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
	return parts.join("&");
};
export const parse = (text: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const pair of text.split("&")) {
		if (!pair) continue;
		const [key, value = ""] = pair.split("=");
		out[decodeURIComponent(key)] = decodeURIComponent(value);
	}
	return out;
};
export const escape = (value: string): string => encodeURIComponent(value);
export const unescape = (value: string): string => decodeURIComponent(value);
export default { stringify, parse, escape, unescape };
