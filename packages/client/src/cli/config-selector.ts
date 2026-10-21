/**
 * TUI config selector for `pi config` command
 */

import type { SettingsManager } from "@earendil-works/pi-coding-agent/core/settings-manager";
import { initTheme, stopThemeWatcher } from "@earendil-works/pi-coding-agent/core/theme/theme";
import { ProcessTerminal, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { ConfigSelectorComponent, type ScopedResolvedPaths } from "../components/config-selector.ts";

export interface ConfigSelectorOptions {
	resolvedPaths: ScopedResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
	writeScope: "global" | "project";
	projectModeAvailable: boolean;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	// Initialize theme before showing TUI
	initTheme(options.settingsManager.getTheme(), true);

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
					stopThemeWatcher();
					resolve();
				}
			},
			() => {
				ui.stop();
				stopThemeWatcher();
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
