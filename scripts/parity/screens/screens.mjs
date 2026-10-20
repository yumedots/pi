import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The TypeScript original's own example extensions, used for the overlay screens. */
export const TS_EXAMPLES = "/Users/gabriel/pi/packages/coding-agent/examples/extensions";

const LONG_REPLY = [
	"# A long answer",
	"",
	"This paragraph is deliberately long so the transcript scrolls and the viewport has to drop the top of the answer.",
	"",
	"- one",
	"- two",
	"- three",
	"- four",
	"- five",
	"- six",
	"- seven",
	"- eight",
	"- nine",
	"- ten",
	"",
	"```rust",
	"fn main() {",
	'\tprintln!("hello");',
	"}",
	"```",
	"",
	"Closing paragraph with more text so the answer keeps going past the bottom of the pane and the view must scroll.",
	"",
	"Even more text. The point of this answer is to be taller than the thirty row pane.",
].join("\n");

export const MOCKS = {
	plain: { turns: [{ type: "text", text: "Hello from the parity mock." }] },
	tool: {
		turns: [
			{ type: "toolCall", name: "read", arguments: { path: "tool-input.txt" } },
			{ type: "text", text: "The fixture file says hello." },
		],
	},
	thinking: {
		turns: [
			{
				type: "thinking",
				thinking: "The parity mock thinks before it answers.",
				text: "Hello from the parity mock.",
			},
		],
	},
	long: { turns: [{ type: "text", text: LONG_REPLY }] },
};

function trustProject({ workDir }) {
	mkdirSync(join(workDir, ".pi"), { recursive: true });
	writeFileSync(join(workDir, ".pi", "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 1)}\n`);
}

function fixture({ workDir }) {
	writeFileSync(join(workDir, "tool-input.txt"), "hello from the fixture\n");
}

const BOOT = 9000;

/** A screen: how to launch it and which keystrokes lead to the captured pane. */
export const SCREENS = [
	{
		name: "startup",
		note: "Empty session, threeDEmptySession off.",
		steps: [{ name: "capture", keys: [], settle: 2500 }],
	},
	{
		name: "startup-3d",
		note: "Empty session, threeDEmptySession on.",
		settings: { threeDEmptySession: true },
		steps: [{ name: "capture", keys: [], settle: 2500 }],
	},
	{
		name: "first-run",
		note: "First run: the theme picker (PI_EXPERIMENTAL=1, no agent dir override, no settings.json).",
		noAgentDir: true,
		env: { PI_EXPERIMENTAL: "1" },
		steps: [{ name: "capture", keys: [], settle: 3000 }],
	},
	{
		name: "trust-prompt",
		note: "Project trust prompt at startup, in a folder with .pi/settings.json.",
		setup: trustProject,
		steps: [{ name: "capture", keys: [], settle: 3000 }],
	},
	{
		name: "trust-selector",
		note: "The /trust selector inside the interactive session.",
		steps: [{ name: "capture", keys: ["/trust", "Enter"], settle: 2500 }],
	},
	{
		name: "login-methods",
		note: "/login: the authentication method selector.",
		steps: [{ name: "capture", keys: ["/login", "Enter"], settle: 2500 }],
	},
	{
		name: "login-providers-oauth",
		note: "/login: the OAuth provider list (Sign in with an account).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Enter"], settle: 2500 }],
	},
	{
		name: "login-providers-api-key",
		note: "/login: the API key provider list (Sign in with an API key).",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Down", "Enter"], settle: 2500 }],
		stepsBySide: {
			rust: [{ name: "capture", keys: ["/login", "Enter"], settle: 2500 }],
		},
	},
	{
		name: "login-api-key-entry",
		note: "/login: the API key entry field (Anthropic).",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Down", "Enter", "Down", "Down", "Enter"], settle: 2500 }],
		stepsBySide: {
			rust: [{ name: "capture", keys: ["/login", "Enter", "Down", "Enter"], settle: 2500 }],
		},
	},
	{
		name: "login-oauth-methods",
		note: "/login: the Anthropic login method (browser login / copy code login).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Enter", "Enter"], settle: 2500 }],
	},
	{
		name: "login-oauth-browser",
		note: "/login: the OAuth browser step, the sign-in URL is shown (Radius).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		nonDeterministic: "the URL carries a fresh PKCE challenge and state on every run",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Down", "Down", "Enter", "Enter"], settle: 4000 }],
	},
	{
		name: "login-oauth-code",
		note: "/login: the OAuth device code step, the code is entered here (Radius).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		nonDeterministic: "the pairing code is fresh on every run",
		steps: [
			{ name: "capture", keys: ["/login", "Enter", "Down", "Down", "Enter", "Down", "Enter"], settle: 4000 },
		],
	},
	{
		name: "login-oauth-code-entry",
		note: "/login: the OAuth paste-the-code field (Anthropic copy code login).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		nonDeterministic: "the URL carries a fresh PKCE challenge and state on every run",
		steps: [{ name: "capture", keys: ["/login", "Enter", "Enter", "Enter", "Down", "Enter"], settle: 4000 }],
	},
	{
		name: "login-oauth-failure",
		note: "/login: the OAuth failure, a wrong code is pasted (Anthropic copy code login).",
		rustUnreachable: "The port has no OAuth providers: its /login lists every provider with its API key, and the OAuth providers come from extension manifests (none is installed).",
		nonDeterministic: "the URL carries a fresh PKCE challenge and state on every run",
		steps: [
			{
				name: "capture",
				keys: ["/login", "Enter", "Enter", "Enter", "Down", "Enter", "not-a-real-code", "Enter"],
				settle: 6000,
			},
		],
	},
	{
		name: "login-oauth-success",
		note: "/login: the OAuth success.",
		unreachable:
			"the token exchange needs the provider's token endpoint (claude.ai, radius.earendil.com), so offline the flow always ends in the failure screen",
		steps: [{ name: "capture", keys: [], settle: 0 }],
	},
	{
		name: "model-selector",
		note: "/model: the model selector.",
		steps: [{ name: "capture", keys: ["/model", "Enter"], settle: 3000 }],
	},
	{
		name: "model-search",
		note: "/model mock: the model selector with a search term.",
		steps: [{ name: "capture", keys: ["/model mock", "Enter"], settle: 3000 }],
	},
	{
		name: "model-no-match",
		note: "/model gpt: the model selector with a search term that matches nothing.",
		steps: [{ name: "capture", keys: ["/model gpt", "Enter"], settle: 3000 }],
	},
	{
		name: "model-no-models",
		note: "No models available at all: the original refuses to start and prints this.",
		noModels: true,
		direct: true,
		steps: [{ name: "capture", keys: [], settle: 0 }],
	},
	{
		name: "scoped-models",
		note: "/scoped-models: the scoped model selector.",
		steps: [{ name: "capture", keys: ["/scoped-models", "Enter"], settle: 3000 }],
	},
	{
		name: "settings-list",
		note: "/settings: the settings list.",
		steps: [{ name: "capture", keys: ["/settings", "Enter"], settle: 3000 }],
	},
	{
		name: "settings-search",
		note: "/settings: the settings list with a search term.",
		steps: [{ name: "capture", keys: ["/settings", "Enter", "theme"], settle: 2500 }],
	},
	{
		name: "settings-submenu-theme",
		note: "/settings: the Theme submenu.",
		steps: [{ name: "capture", keys: ["/settings", "Enter", "theme", "Enter"], settle: 2500 }],
	},
	{
		name: "settings-submenu-warnings",
		note: "/settings: the Warnings submenu.",
		steps: [{ name: "capture", keys: ["/settings", "Enter", "warning", "Enter"], settle: 2500 }],
	},
	{
		name: "settings-submenu-thinking",
		note: "/settings: the Default thinking level per model submenu.",
		steps: [{ name: "capture", keys: ["/settings", "Enter", "thinking", "Enter"], settle: 2500 }],
	},
	{
		name: "settings-submenu-theme-automatic",
		note: "/settings: the Theme submenu, the automatic mode with the light and dark theme submenus.",
		steps: [{ name: "capture", keys: ["/settings", "Enter", "theme", "Enter", "Down", "Enter"], settle: 2500 }],
	},
	{
		name: "settings-submenu-theme-light",
		note: "/settings: the Light theme submenu.",
		steps: [
			{ name: "capture", keys: ["/settings", "Enter", "theme", "Enter", "Down", "Enter", "Enter"], settle: 2500 },
		],
	},
	{
		name: "session-menu",
		note: "/resume: the session menu, with one session in it.",
		session: true,
		mock: "plain",
		steps: [
			{ name: "sent", keys: ["hello world", "Enter"], settle: 6000 },
			{ name: "capture", keys: ["/resume", "Enter"], settle: 3000 },
		],
		capture: "capture",
	},
	{
		name: "session-search",
		note: "/resume: the session menu with a search term typed.",
		session: true,
		mock: "plain",
		steps: [
			{ name: "sent", keys: ["hello world", "Enter"], settle: 6000 },
			{ name: "opened", keys: ["/resume", "Enter"], settle: 2000 },
			{ name: "capture", keys: ["hello"], settle: 2500 },
		],
		capture: "capture",
	},
	{
		name: "session-tree",
		note: "/tree: the session tree, with one entry in it.",
		session: true,
		mock: "plain",
		steps: [
			{ name: "sent", keys: ["hello world", "Enter"], settle: 6000 },
			{ name: "capture", keys: ["/tree", "Enter"], settle: 3000 },
		],
		capture: "capture",
	},
	{
		name: "help-startup",
		note: "Ctrl+O: the expanded startup help.",
		steps: [{ name: "capture", keys: ["C-o"], settle: 2500 }],
	},
	{
		name: "hotkeys",
		note: "/hotkeys: the keyboard shortcut list.",
		steps: [{ name: "capture", keys: ["/hotkeys", "Enter"], settle: 3000 }],
	},
	{
		name: "changelog",
		note: "/changelog: the changelog entries.",
		steps: [{ name: "capture", keys: ["/changelog", "Enter"], settle: 3000 }],
	},
	{
		name: "version",
		note: "/version.",
		unreachable:
			"the original has no /version command; the version is printed in the startup header (see the startup screen) and `pi --version` exits before the TUI opens",
		steps: [{ name: "capture", keys: [], settle: 0 }],
	},
	{
		name: "quit-confirm",
		note: "Ctrl+C: the quit confirmation banner.",
		steps: [{ name: "capture", keys: ["C-c"], settle: 2000 }],
	},
	{
		name: "export-dialog",
		note: "/export: the export dialog.",
		session: true,
		mock: "plain",
		steps: [
			{ name: "sent", keys: ["hello world", "Enter"], settle: 6000 },
			{ name: "capture", keys: ["/export", "Enter"], settle: 4000 },
		],
		capture: "capture",
	},
	{
		name: "transcript-plain",
		note: "A plain answer in the transcript.",
		mock: "plain",
		steps: [{ name: "capture", keys: ["hello world", "Enter"], settle: 7000 }],
	},
	{
		name: "transcript-tool",
		note: "A tool call with its output in the transcript.",
		mock: "tool",
		setup: fixture,
		steps: [{ name: "capture", keys: ["read the fixture", "Enter"], settle: 9000 }],
	},
	{
		name: "transcript-thinking",
		note: "A thinking block in the transcript.",
		mock: "thinking",
		steps: [{ name: "capture", keys: ["hello world", "Enter"], settle: 7000 }],
	},
	{
		name: "transcript-long",
		note: "A long answer that scrolls the transcript.",
		mock: "long",
		steps: [{ name: "capture", keys: ["show me a long answer", "Enter"], settle: 9000 }],
	},
	{
		name: "transcript-error",
		note: "An error in the transcript (the provider endpoint is not listening).",
		deadProvider: true,
		steps: [{ name: "capture", keys: ["hello world", "Enter"], settle: 9000 }],
	},
	{
		name: "input-empty",
		note: "The input box, empty.",
		steps: [{ name: "capture", keys: [], settle: 2500 }],
	},
	{
		name: "input-text",
		note: "The input box with text.",
		steps: [{ name: "capture", keys: ["hello world"], settle: 2000 }],
	},
	{
		name: "input-autocomplete",
		note: "The input box with the autocomplete open.",
		steps: [{ name: "capture", keys: ["/"], settle: 2000 }],
	},
	{
		name: "input-history",
		note: "The input box with the prompt history open.",
		mock: "plain",
		steps: [
			{ name: "sent", keys: ["hello world", "Enter"], settle: 7000 },
			{ name: "capture", keys: ["Up"], settle: 2000 },
		],
		capture: "capture",
	},
	{
		name: "overlay-animation",
		note: "An example extension that paints an overlay (/overlay-animation).",
		args: [`--extension`, `${TS_EXAMPLES}/overlay-qa-tests.ts`],
		steps: [{ name: "capture", keys: ["/overlay-animation", "Enter"], settle: 6000 }],
	},
	{
		name: "overlay-doom",
		note: "The doom overlay example extension (/doom-overlay).",
		args: [`--extension`, `${TS_EXAMPLES}/doom-overlay`],
		steps: [{ name: "capture", keys: ["/doom-overlay", "Enter"], settle: 20000 }],
	},
];
