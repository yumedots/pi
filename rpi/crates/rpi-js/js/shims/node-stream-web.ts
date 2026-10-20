/**
 * The `node:stream/web` module the extensions import.
 *
 * The web streams are a standard: the names exist so that a module that
 * imports them loads, and the classes carry just enough for a caller that
 * only reads from them.
 */

export class ReadableStream<T = unknown> {
	constructor(_source?: unknown, _strategy?: unknown) {}
	getReader(): { read: () => Promise<{ done: boolean; value?: T }> } {
		return { read: async () => ({ done: true }) };
	}
	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: async () => ({ done: true, value: undefined }),
		};
	}
}

export class WritableStream<T = unknown> {
	constructor(_sink?: unknown, _strategy?: unknown) {}
	getWriter(): { write: (chunk: T) => Promise<void>; close: () => Promise<void> } {
		return { write: async () => undefined, close: async () => undefined };
	}
}

export class TransformStream<T = unknown> {
	constructor(_transformer?: unknown, _writableStrategy?: unknown, _readableStrategy?: unknown) {}
	readonly readable = new ReadableStream<T>();
	readonly writable = new WritableStream<T>();
}

export class ByteLengthQueuingStrategy {
	constructor(_options?: { highWaterMark?: number }) {}
}

export class CountQueuingStrategy {
	constructor(_options?: { highWaterMark?: number }) {}
}

export default {
	ReadableStream,
	WritableStream,
	TransformStream,
	ByteLengthQueuingStrategy,
	CountQueuingStrategy,
};
