/**
 * The idle watchdog.
 *
 * The server shuts itself down when nothing is connected and nothing is working. The
 * watchdog accumulates the idle time and fires once the timeout is reached.
 */

/** The options of an {@link IdleWatchdog}. */
export interface IdleWatchdogOptions {
	/** The idle time after which the server shuts down. `0` disables the watchdog. */
	idleTimeoutMs: number;
	/** The clock. Defaults to `Date.now`. */
	now?: () => number;
	/** How often the idle state is checked. Defaults to 15 seconds. */
	intervalMs?: number;
	/** Whether the server is idle right now. */
	isIdle(): boolean;
	/** Called once the server has been idle long enough. */
	onIdle(): void;
}

/** The default check interval. */
export const DEFAULT_IDLE_CHECK_INTERVAL_MS = 15_000;

/**
 * Watches the idle state of the server.
 */
export class IdleWatchdog {
	private readonly options: IdleWatchdogOptions;
	private timer: NodeJS.Timeout | undefined;
	private idleSince: number | undefined;

	constructor(options: IdleWatchdogOptions) {
		this.options = options;
	}

	/**
	 * Start watching.
	 */
	start(): void {
		if (this.options.idleTimeoutMs <= 0) return;
		if (this.timer) return;
		this.idleSince = this.options.isIdle() ? this.now() : undefined;
		this.timer = setInterval(() => this.check(), this.interval());
		this.timer.unref?.();
	}

	/**
	 * Stop watching.
	 */
	stop(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.idleSince = undefined;
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private interval(): number {
		return this.options.intervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS;
	}

	/**
	 * Check the idle state now.
	 */
	check(): void {
		if (!this.options.isIdle()) {
			this.idleSince = undefined;
			return;
		}
		if (this.idleSince === undefined) {
			this.idleSince = this.now();
			return;
		}
		if (this.now() - this.idleSince < this.options.idleTimeoutMs) return;
		this.stop();
		this.options.onIdle();
	}
}
