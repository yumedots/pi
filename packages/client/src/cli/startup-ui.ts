/**
 * The startup screens of the client.
 *
 * The screens the client shows before a session runs: the session picker and the first
 * time setup. They draw with the theme of the client and with the settings the client
 * mirrors.
 */

import {
	ProcessTerminal,
	setCapabilityOverrides,
	setKeybindings,
	type TUI,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import type { ClientSettings } from "../client-settings.ts";
import { getAgentDir } from "../client-support/config.ts";
import { KeybindingsManager } from "../client-support/keybindings.ts";
import { requestTerminalColors } from "../client-support/theme-controller.ts";
import {
	getThemeByName,
	getThemeInstance,
	setTerminalColors,
	setThemeFromJson,
	setThemeInstance,
	THEME_TOKENS,
} from "../client-theme.ts";
import { ExtensionInputComponent } from "../components/extension-input.ts";
import { ExtensionSelectorComponent } from "../components/extension-selector.ts";
import { FirstTimeSetupComponent, type FirstTimeSetupResult } from "../components/first-time-setup.ts";

/**
 * The theme the client draws with before the server sends its own.
 *
 * Every token uses the default colour of the terminal, so the client can draw before the
 * manifest of the server arrives.
 */
function defaultThemeJson(): { colors: Record<string, string> } {
	const colors: Record<string, string> = {};
	for (const token of Object.keys(THEME_TOKENS)) colors[token] = "";
	return { colors };
}

/**
 * Install the theme the client draws with.
 *
 * The theme of the server wins, then the theme the settings name, and the default theme
 * is the fallback, so the client can draw before the manifest of the server arrives.
 */
export function installTheme(settings?: ClientSettings, json?: unknown): void {
	if (json !== undefined) {
		setThemeFromJson(json);
		return;
	}
	const named = settings?.getThemeSetting();
	const instance = named === undefined ? undefined : getThemeByName(named);
	if (instance) {
		setThemeInstance(instance);
		return;
	}
	if (!getThemeInstance()) setThemeFromJson(defaultThemeJson());
}

/** Build the terminal UI of a startup screen. */
export async function createStartupTui(settings: ClientSettings): Promise<TUI> {
	installTheme(settings);
	setCapabilityOverrides(settings.getTerminalCapabilityOverrides());
	setKeybindings(new KeybindingsManager());
	const ui: TUI = new TuiMainScreen(new ProcessTerminal(), settings.getShowHardwareCursor(), getAgentDir());
	ui.setClearOnShrink(settings.getClearOnShrink());
	return ui;
}

/** Show a startup screen. */
export function startStartupTui(ui: TUI, settings: ClientSettings, themeJson?: unknown): void {
	installTheme(settings, themeJson);
	ui.start();
	queryStartupTerminalColors(ui, settings, themeJson, () => {
		ui.invalidate();
		ui.requestRender();
	});
}

/**
 * Query the terminal's colors without waiting for them. When they arrive, including after the timeout,
 * record them for the "" (terminal default) tokens and the light/dark detection, run `onColors`, and
 * re-render.
 */
function queryStartupTerminalColors(ui: TUI, settings: ClientSettings, themeJson: unknown, onColors: () => void): void {
	void requestTerminalColors(ui, (colors) => {
		setTerminalColors(colors);
		installTheme(settings, themeJson);
		onColors();
		ui.invalidate();
		ui.requestRender();
	});
}

async function clearStartupTui(ui: TUI): Promise<void> {
	ui.clear();
	ui.requestRender();
	await new Promise((resolve) => setTimeout(resolve, 25));
}

/** Show a selector with the options of a startup screen. */
export async function showStartupSelector<T>(
	settings: ClientSettings,
	title: string,
	options: Array<{ label: string; value: T }>,
): Promise<T | undefined> {
	const ui = await createStartupTui(settings);
	return new Promise((resolve) => {
		let settled = false;
		const finish = async (result: T | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			await clearStartupTui(ui);
			ui.stop();
			resolve(result);
		};

		const selector = new ExtensionSelectorComponent(
			title,
			options.map((option) => option.label),
			(option) => void finish(options.find((entry) => entry.label === option)?.value),
			() => void finish(undefined),
			{ tui: ui },
		);
		ui.addChild(selector);
		ui.setFocus(selector);
		startStartupTui(ui, settings);
	});
}

/** Show the first-time setup dialog and persist the result */
export async function showFirstTimeSetup(settings: ClientSettings): Promise<void> {
	const ui = await createStartupTui(settings);
	return new Promise((resolve) => {
		let settled = false;
		const finish = async (result: FirstTimeSetupResult | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			if (result) {
				settings.setTheme(result.theme);
				await settings.flush();
			}
			await clearStartupTui(ui);
			ui.stop();
			resolve();
		};

		ui.start();
		const component = new FirstTimeSetupComponent({
			onThemePreview: () => {
				installTheme(settings);
				ui.requestRender();
			},
			onSubmit: (result) => void finish(result),
			onCancel: () => void finish(undefined),
		});
		ui.addChild(component);
		ui.setFocus(component);
		ui.requestRender();
		queryStartupTerminalColors(ui, settings, undefined, () => ui.requestRender());
	});
}

/** Show an input of a startup screen. */
export async function showStartupInput(
	settings: ClientSettings,
	title: string,
	placeholder?: string,
): Promise<string | undefined> {
	const ui = await createStartupTui(settings);
	return new Promise((resolve) => {
		let settled = false;
		const finish = async (result: string | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			input.dispose();
			await clearStartupTui(ui);
			ui.stop();
			resolve(result);
		};

		const input = new ExtensionInputComponent(
			title,
			placeholder,
			(value) => void finish(value),
			() => void finish(undefined),
			{
				tui: ui,
			},
		);
		ui.addChild(input);
		ui.setFocus(input);
		startStartupTui(ui, settings);
	});
}
