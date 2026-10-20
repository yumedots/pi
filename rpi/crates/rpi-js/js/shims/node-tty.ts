/**
 * The `node:tty` module the extensions import.
 *
 * The embedded host owns the terminal, so the names exist with the behaviour
 * pi's code needs: `isatty` reports whether a stream is a terminal, and the
 * stream classes are inert.
 */

export const isatty = (stream: unknown): boolean => {
	const candidate = stream as { isTTY?: boolean } | null;
	return candidate?.isTTY === true;
};

export class ReadStream {
	constructor(_path?: string, _options?: unknown) {}
	isTTY = false;
	on(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
	setRawMode(_mode: boolean): this {
		return this;
	}
	resume(): this {
		return this;
	}
	pause(): this {
		return this;
	}
}

export class WriteStream {
	constructor(_fd?: number) {}
	isTTY = false;
	write(_chunk: unknown): boolean {
		return true;
	}
	on(_event: string, _listener: (...args: unknown[]) => void): this {
		return this;
	}
}

export default { isatty, ReadStream, WriteStream };
