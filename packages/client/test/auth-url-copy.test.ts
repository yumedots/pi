import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import { theme } from "../../coding-agent/src/core/theme/theme.ts";
import { McpManagerView } from "../../coding-agent/src/extensions/mcp/ui.ts";
import { stripAnsi } from "../../coding-agent/src/utils/ansi.ts";
import { LoginDialogComponent } from "../src/components/login-dialog.ts";
import { initDarkTheme } from "./theme-fixture.ts";

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn(async (_text: string) => {}) }));

vi.mock("@earendil-works/pi-support/clipboard", () => ({ copyToClipboard }));
vi.mock("@earendil-works/pi-coding-agent/utils/clipboard", () => ({ copyToClipboard }));
vi.mock("@earendil-works/pi-support/open-browser", () => ({ openBrowser: vi.fn() }));

const URL = `https://auth.example.invalid/authorize?${"x".repeat(300)}`;
const CTRL_X = "\x18";

const tui = { requestRender: vi.fn() } as unknown as TUI;

function rendered(component: { render(width: number): string[] }): string {
	return stripAnsi(component.render(80).join("\n"));
}

describe("sign-in URL copy key", () => {
	beforeAll(() => {
		initDarkTheme();
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
		copyToClipboard.mockClear();
	});

	test("login dialog copies the auth URL instead of typing into the code input", async () => {
		const dialog = new LoginDialogComponent(tui, "test", () => {});
		dialog.showAuth(URL);
		void dialog.showManualInput("Paste the code:");
		expect(rendered(dialog)).toContain("ctrl+x to copy");

		dialog.handleInput(CTRL_X);
		await vi.waitFor(() => expect(rendered(dialog)).toContain("Copied URL to clipboard"));
		expect(copyToClipboard).toHaveBeenCalledWith(URL);
	});

	test("login dialog ignores the copy key without an auth URL", () => {
		const dialog = new LoginDialogComponent(tui, "test", () => {});
		dialog.showDeviceCode({ userCode: "ABCD", verificationUri: "https://example.invalid/device" });
		dialog.handleInput(CTRL_X);
		expect(copyToClipboard).not.toHaveBeenCalled();
	});

	test("MCP sign-in screen copies the authorization URL", async () => {
		const view = new McpManagerView(tui, theme, new KeybindingsManager());
		void view.redirectUrl("Sign in to issues", URL, new AbortController().signal);
		expect(rendered(view)).toContain("ctrl+x to copy");

		view.handleInput(CTRL_X);
		await vi.waitFor(() => expect(rendered(view)).toContain("Copied URL to clipboard"));
		expect(copyToClipboard).toHaveBeenCalledWith(URL);
	});
});
