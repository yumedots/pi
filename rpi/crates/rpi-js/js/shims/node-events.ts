/**
 * The `node:events` module the extensions import.
 *
 * The embedded host has no event loop, so this is the small part of Node's
 * `EventEmitter` that pi's own code uses: subscribe, unsubscribe, emit and
 * clear.
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
	private readonly listeners = new Map<string, Listener[]>();

	on(event: string, listener: Listener): this {
		const existing = this.listeners.get(event) ?? [];
		existing.push(listener);
		this.listeners.set(event, existing);
		return this;
	}

	addListener(event: string, listener: Listener): this {
		return this.on(event, listener);
	}

	once(event: string, listener: Listener): this {
		const wrapper: Listener = (...args) => {
			this.off(event, wrapper);
			listener(...args);
		};
		return this.on(event, wrapper);
	}

	off(event: string, listener: Listener): this {
		const existing = this.listeners.get(event);
		if (!existing) return this;
		const index = existing.indexOf(listener);
		if (index >= 0) existing.splice(index, 1);
		if (existing.length === 0) this.listeners.delete(event);
		return this;
	}

	removeListener(event: string, listener: Listener): this {
		return this.off(event, listener);
	}

	removeAllListeners(event?: string): this {
		if (event === undefined) this.listeners.clear();
		else this.listeners.delete(event);
		return this;
	}

	listeners(event: string): Listener[] {
		return [...(this.listeners.get(event) ?? [])];
	}

	emit(event: string, ...args: unknown[]): boolean {
		const existing = this.listeners.get(event);
		if (!existing || existing.length === 0) return false;
		for (const listener of [...existing]) {
			listener(...args);
		}
		return true;
	}
}

export default { EventEmitter };
