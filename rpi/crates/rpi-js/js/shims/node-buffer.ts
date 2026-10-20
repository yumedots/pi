/**
 * The `node:buffer` module the extensions import.
 *
 * The embedded host has no byte buffers of its own: the names exist so that
 * a module that imports them loads.
 */

export class Buffer extends Uint8Array {
	static from(value: unknown, encoding?: string): Buffer {
		if (value instanceof Uint8Array) return Buffer.from(value);
		const text = String(value);
		if (encoding === "base64") {
			const binary = atob(text);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
			return new Buffer(bytes);
		}
		return new Buffer(new TextEncoder().encode(text));
	}

	static alloc(size: number): Buffer {
		return new Buffer(new Uint8Array(size));
	}

	static isBuffer(value: unknown): boolean {
		return value instanceof Uint8Array;
	}

	static concat(list: Uint8Array[]): Buffer {
		const total = list.reduce((sum, chunk) => sum + chunk.length, 0);
		const out = new Uint8Array(total);
		let offset = 0;
		for (const chunk of list) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return new Buffer(out);
	}

	toString(encoding?: string): string {
		if (encoding === "base64") {
			let binary = "";
			for (const byte of this) binary += String.fromCharCode(byte);
			return btoa(binary);
		}
		return new TextDecoder().decode(this);
	}

	toString(encoding: string, start: number, end: number): string {
		return this.toString(encoding);
	}
}

export default { Buffer };
