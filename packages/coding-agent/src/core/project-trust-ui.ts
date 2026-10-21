import chalk from "chalk";
import type { ProjectTrustContext } from "./extensions/types.ts";
import type { AppMode } from "./project-trust.ts";
import type { SettingsManager } from "./settings-manager.ts";

/** The UI primitives a project trust prompt needs. */
export type ProjectTrustUi = ProjectTrustContext["ui"];

export interface CreateProjectTrustContextOptions {
	/** The directory whose trust is being resolved. */
	cwd: string;
	/** The mode pi runs in. Only the interactive mode may prompt. */
	mode: AppMode;
	/**
	 * The settings manager of the caller. The assembler itself does not read it; it is part of the options
	 * so a caller can hand over everything the context is built from in one object.
	 */
	settingsManager?: SettingsManager;
	/** Whether the process can show a dialog at all. */
	hasUI: boolean;
	/** The dialogs the prompt uses. Injected so the core stays free of any terminal dependency. */
	ui: ProjectTrustUi;
}

/**
 * Build the project trust context from an injected UI implementation.
 *
 * The policy lives here, the widgets do not: without a UI, or outside the interactive mode, every prompt
 * is declined and notifications go to stderr. A terminal-backed implementation lives in
 * `cli/project-trust-tui.ts`.
 */
export function createProjectTrustContext(options: CreateProjectTrustContextOptions): ProjectTrustContext {
	const interactive = options.hasUI && options.mode === "interactive";
	return {
		cwd: options.cwd,
		mode: options.mode === "interactive" ? "tui" : options.mode,
		hasUI: options.hasUI,
		ui: {
			select: async (title, selectOptions) => {
				if (!interactive) {
					return undefined;
				}
				return options.ui.select(title, selectOptions);
			},
			confirm: async (title, message) => {
				if (!interactive) {
					return false;
				}
				return options.ui.confirm(title, message);
			},
			input: async (title, placeholder) => {
				if (!interactive) {
					return undefined;
				}
				return options.ui.input(title, placeholder);
			},
			notify: (message, type = "info") => {
				if (options.mode === "interactive") {
					options.ui.notify(message, type);
					return;
				}
				const color = type === "error" ? chalk.red : type === "warning" ? chalk.yellow : chalk.cyan;
				console.error(color(message));
			},
		},
	};
}
