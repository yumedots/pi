import { createInterface } from "node:readline";
import type { ProjectTrustContext } from "../core/extensions/types.ts";
import type { AppMode } from "../core/project-trust.ts";
import { createProjectTrustContext } from "../core/project-trust-ui.ts";
import type { SettingsManager } from "../core/settings-manager.ts";

/**
 * The project trust context of the coding agent.
 *
 * The full-screen terminal UI lives in the client package, which asks for the project
 * trust itself before it connects to a server. What is left here is the console
 * fallback the headless commands use: a plain question that needs no terminal UI.
 */
export function createTuiProjectTrustContext(options: {
	cwd: string;
	mode: AppMode;
	settingsManager: SettingsManager;
	hasUI: boolean;
}): ProjectTrustContext {
	return createProjectTrustContext({
		cwd: options.cwd,
		mode: options.mode,
		settingsManager: options.settingsManager,
		hasUI: options.hasUI,
		ui: {
			select: async (title, selectOptions) => askOnConsole(title, selectOptions),
			confirm: async (title, message) => (await askOnConsole(`${title}\n${message}`, ["Yes", "No"])) === "Yes",
			input: async (title, placeholder) => askOnConsole(title, [], placeholder),
			notify: () => {},
		},
	});
}

/**
 * Ask a question on the console.
 *
 * With options the answer is the entered text or the name of one of the options; without
 * them it is the entered line.
 */
async function askOnConsole(
	title: string,
	options: readonly string[],
	placeholder?: string,
): Promise<string | undefined> {
	const prompt =
		options.length > 0 ? `${title} (${options.join("/")})` : `${title}${placeholder ? ` [${placeholder}]` : ""}`;
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		const { promise, resolve } = Promise.withResolvers<string>();
		rl.question(`${prompt}: `, resolve);
		const answer = await promise;
		const trimmed = answer.trim();
		if (trimmed.length === 0) return placeholder;
		return trimmed;
	} finally {
		rl.close();
	}
}
