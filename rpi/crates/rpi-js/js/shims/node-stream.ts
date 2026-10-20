/**
 * The `node:stream` module the extensions import.
 *
 * The embedded host has no streams of its own; the names exist so that a
 * module that imports them loads.
 */

export class Readable {
	constructor(_options?: unknown) {}
	pipe<T>(destination: T): T {
		return destination;
	}
	on(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
	once(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
	removeListener(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
	push(_chunk: unknown): boolean {
		return true;
	}
	read(): undefined {
		return undefined;
	}
}

export class Writable {
	write(_chunk: unknown): boolean {
		return true;
	}
	end(_chunk?: unknown): this {
		return this;
	}
	on(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
}

export class Transform extends Readable {}

export class PassThrough extends Readable {}

export default { Readable, Writable, Transform, PassThrough };
