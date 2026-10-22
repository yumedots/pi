/**
 * TUI config selector for `pi config` command
 */

import { ProcessTerminal, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import type { ClientSettings } from "../client-settings.ts";
import { ConfigSelectorComponent, type ScopedResolvedPaths } from "../components/config-selector.ts";
import { installTheme } from "./startup-ui.ts";

export interface ConfigSelectorOptions {
	resolvedPaths: ScopedResolvedPaths;
	settingsManager: ClientSettings;
	cwd: string;
	agentDir: string;
	writeScope: "global" | "project";
	projectModeAvailable: boolean;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	// Initialize theme before showing TUI
	installTheme(options.settingsManager);

	return new Promise((resolve) => {
		const ui: TUI = new TuiMainScreen(
			new ProcessTerminal(),
			options.settingsManager.getShowHardwareCursor(),
			options.agentDir,
		);
		ui.setClearOnShrink(options.settingsManager.getClearOnShrink());
		let resolved = false;

		const selector = new ConfigSelectorComponent(
			options.resolvedPaths,
			options.settingsManager,
			options.cwd,
			options.agentDir,
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve();
				}
			},
			() => {
				ui.stop();
				process.exit(0);
			},
			() => ui.requestRender(),
			ui.terminal.rows,
			options.writeScope,
			options.projectModeAvailable,
		);

		ui.addChild(selector);
		ui.setFocus(selector.getResourceList());
		ui.start();
	});
}
