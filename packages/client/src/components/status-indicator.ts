import type { WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent/core/extensions/index";
import { type Component, Loader, type TUI } from "@earendil-works/pi-tui";
import { keyText } from "../client-support/keybinding-hints.ts";
import { theme } from "../client-theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	/**
	 * The status row, shown on its own line above the input box.
	 *
	 * The loader keeps a blank row for the border it can be drawn in; on its
	 * own line that row is just empty space, so it is dropped.
	 */
	override render(width: number): string[] {
		return super.render(width).slice(1);
	}

	dispose(): void {
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, message: string, indicator?: WorkingIndicatorOptions) {
		super(
			"working",
			ui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("muted", text),
			message,
			indicator,
		);
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		return [" ".repeat(width)];
	}
}
