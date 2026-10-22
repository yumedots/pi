import type { Component, TUI } from "@earendil-works/pi-tui";
import { theme } from "../client-theme.ts";

/** Expected duration of a run until the session has measured one. */
const DEFAULT_ESTIMATE_MS = 15_000;
/** How many finished runs the estimate is based on. */
const ESTIMATE_SAMPLES = 5;
/** The bar stops short of the end while the run is still going. */
const RUNNING_MAX_FRACTION = 0.95;
/** How long the finished bar stays on the screen. */
const DONE_HOLD_MS = 800;
/** How often the bar updates while a run is going. */
const TICK_MS = 100;
/**
 * How many cells the bar may grow per tick. Without this the bar jumps a whole
 * cell at a time and looks choppy when the run is over faster than the
 * estimate.
 */
const MAX_CELLS_PER_TICK = 1;

/**
 * A progress bar for the agent run.
 *
 * In fullscreen mode it is the top row of the screen. Regular mode scrolls its
 * content, so it sits above the input box there.
 *
 * The bar fills with the time the run has taken, against an estimate from the
 * runs of this session. The estimate is a guess, so the bar never claims to be
 * done before the run ends: it stops at 95% and creeps towards the end.
 */
export class AgentProgressBar implements Component {
	private readonly ui: TUI;
	private enabled = false;
	private running = false;
	private done = false;
	private startedAt = 0;
	private finishedAt = 0;
	private durations: number[] = [];
	/** The cells the bar covers on the screen. */
	private cells = 0;
	/** The width of the last render, needed to turn the fraction into cells. */
	private width = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(ui: TUI) {
		this.ui = ui;
	}

	setEnabled(enabled: boolean): void {
		if (enabled === this.enabled) return;
		const wasVisible = this.running || this.done;
		this.enabled = enabled;
		if (!enabled) this.reset();
		if (wasVisible || this.running || this.done) this.ui.requestRender();
	}

	/** Start a run. A run that is already going keeps its progress. */
	start(): void {
		if (!this.enabled || this.running) return;
		this.running = true;
		this.done = false;
		this.cells = 0;
		this.startedAt = Date.now();
		this.ensureTimer();
		this.ui.requestRender();
	}

	/** Finish the run and show the full bar for a moment. */
	complete(): void {
		if (!this.enabled || !this.running) return;
		this.running = false;
		this.done = true;
		this.finishedAt = Date.now();
		this.cells = this.width;
		this.durations.push(this.finishedAt - this.startedAt);
		if (this.durations.length > ESTIMATE_SAMPLES) this.durations.shift();
		this.ui.requestRender();
	}

	dispose(): void {
		this.reset();
	}

	render(width: number): string[] {
		if (!this.enabled || (!this.running && !this.done)) return [];
		this.width = width;
		const filled = Math.max(0, Math.min(width, this.cells));
		if (filled === 0) return [""];
		// A hairline along the top of the row, like the progress bar of a window.
		return [theme.fg("accent", "\u2594".repeat(filled))];
	}

	invalidate(): void {
		// No cached state to invalidate.
	}

	private fraction(): number {
		const elapsed = Date.now() - this.startedAt;
		const estimate = this.estimate();
		if (elapsed <= estimate) return (elapsed / estimate) * RUNNING_MAX_FRACTION;
		// Past the estimate the bar creeps towards the end instead of standing still.
		const over = (elapsed - estimate) / estimate;
		return RUNNING_MAX_FRACTION + (1 - RUNNING_MAX_FRACTION) * (1 - Math.exp(-over));
	}

	/** The median duration of the runs of this session. */
	private estimate(): number {
		if (this.durations.length === 0) return DEFAULT_ESTIMATE_MS;
		const sorted = [...this.durations].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)] ?? DEFAULT_ESTIMATE_MS;
	}

	private ensureTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			if (this.done && Date.now() - this.finishedAt >= DONE_HOLD_MS) {
				this.reset();
			}
			this.advance();
			this.ui.requestRender();
		}, TICK_MS);
		// The timer must not keep the process alive.
		this.timer.unref();
	}

	/** Move the bar towards the real progress without jumping. */
	private advance(): void {
		if (!this.running) return;
		const target = Math.round(this.fraction() * this.width);
		if (target > this.cells) {
			this.cells = Math.min(target, this.cells + MAX_CELLS_PER_TICK);
		}
	}

	private reset(): void {
		this.running = false;
		this.done = false;
		this.cells = 0;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}
}
