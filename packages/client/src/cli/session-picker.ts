/**
 * TUI session selector for --resume flag
 */

import { KeybindingsManager } from "@earendil-works/pi-coding-agent/core/keybindings";
import {
	type SessionInfo,
	type SessionListProgress,
	SessionManager,
} from "@earendil-works/pi-coding-agent/core/session-manager";
import type { SettingsManager } from "@earendil-works/pi-coding-agent/core/settings-manager";
import { setKeybindings } from "@earendil-works/pi-tui";
import { SessionMenuComponent } from "../components/session-menu.ts";
import { createStartupTui, startStartupTui } from "./startup-ui.ts";

type SessionsLoader = (onProgress?: SessionListProgress, signal?: AbortSignal) => Promise<SessionInfo[]>;

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(
	currentSessionsLoader: SessionsLoader,
	allSessionsLoader: SessionsLoader,
	settingsManager: SettingsManager,
): Promise<string | null> {
	const ui = await createStartupTui(settingsManager);
	return new Promise((resolve) => {
		const keybindings = KeybindingsManager.create();
		setKeybindings(keybindings);
		let resolved = false;

		const selector = new SessionMenuComponent({
			currentLoad: currentSessionsLoader,
			allLoad: allSessionsLoader,
			renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
				const next = (nextName ?? "").trim();
				if (!next) return;
				SessionManager.open(sessionFilePath).appendSessionInfo(next);
			},
			onSelect: (session) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(session.path);
				}
			},
			onCancel: () => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
			// The sessions load in the background, so the screen has to be repainted when they arrive.
			onRequestRender: () => ui.requestRender(),
		});

		ui.addChild(selector);
		ui.setFocus(selector);
		startStartupTui(ui, settingsManager);
	});
}
