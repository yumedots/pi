/**
 * The `node:crypto` module the extensions import.
 *
 * The embedded host has no crypto library, so the names exist with the
 * behaviour pi's code needs: a random UUID, random bytes, and a hash whose
 * digest is stable for the same input. The hash is not a cryptographic one —
 * it is a cache key, not a signature.
 */

const HEX = "0123456789abcdef";

const randomByte = (): number => Math.floor(Math.random() * 256);

export const randomBytes = (size: number): Uint8Array => {
	const bytes = new Uint8Array(size);
	for (let index = 0; index < size; index++) bytes[index] = randomByte();
	return bytes;
};

export const randomUUID = (): string => {
	let uuid = "";
	for (let index = 0; index < 36; index++) {
		if (index === 8 || index === 13 || index === 18 || index === 23) {
			uuid += "-";
			continue;
		}
		if (index === 14) {
			uuid += "4";
			continue;
		}
		uuid += HEX[randomByte() & 0x0f];
	}
	return uuid;
};

export const getRandomValues = (array: Uint8Array): Uint8Array => {
	for (let index = 0; index < array.length; index++) array[index] = randomByte();
	return array;
};

/// A stable 64-bit digest, rendered as hex.
const digest = (input: string): string => {
	let low = 0x811c9dc5;
	let high = 0x01000193;
	for (let index = 0; index < input.length; index++) {
		low = Math.imul(low ^ input.charCodeAt(index), 0x01000193) >>> 0;
		high = Math.imul(high + input.charCodeAt(index) + index, 0x85ebca6b) >>> 0;
	}
	return low.toString(16).padStart(8, "0") + high.toString(16).padStart(8, "0");
};

export const createHash = (_algorithm: string) => {
	const chunks: string[] = [];
	return {
		update(chunk: string): typeof chunks {
			chunks.push(chunk);
			return chunks;
		},
		digest(encoding?: string): string {
			const hex = digest(chunks.join(""));
			if (encoding === "base64") {
				return btoa(hex);
			}
			return hex;
		},
	};
};

export const createHmac = (_algorithm: string, _key: string) => createHash("sha256");

export const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
	return difference === 0;
};

export default {
	randomBytes,
	randomUUID,
	getRandomValues,
	createHash,
	createHmac,
	timingSafeEqual,
};
