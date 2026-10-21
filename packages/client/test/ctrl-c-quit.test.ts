import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { CustomEditor } from "../src/components/custom-editor.ts";
import { InteractiveMode } from "../src/interactive-mode.ts";

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

describe("ctrl+c quits without clearing the editor", () => {
	it("routes ctrl+c to the quit action and leaves the editor content alone", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		let quits = 0;
		editor.onAction("app.quit", () => {
			quits++;
		});
		editor.setText("draft");

		editor.handleInput("\x03"); // Ctrl+C
		expect(editor.getText()).toBe("draft");
		expect(quits).toBe(1);

		editor.handleInput("\x1bc"); // Alt+C: no longer bound to anything
		expect(editor.getText()).toBe("draft");
		expect(quits).toBe(1);
	});

	it("exits on a double press", () => {
		setKeybindings(new KeybindingsManager());
		const handleQuit = Reflect.get(InteractiveMode.prototype, "handleQuit") as (this: FakeMode) => void;
		const state = { shutdowns: 0, banners: [] as string[] };
		const fake: FakeMode = {
			lastSigintTime: 0,
			shutdown: () => {
				state.shutdowns++;
			},
			showWarningBanner: (message: string) => {
				state.banners.push(message);
			},
		};

		handleQuit.call(fake);
		expect(state.shutdowns).toBe(0);
		expect(state.banners[0]).toContain("Ctrl+C");

		handleQuit.call(fake);
		expect(state.shutdowns).toBe(1);
	});
});

interface FakeMode {
	lastSigintTime: number;
	shutdown(): void;
	showWarningBanner(message: string): void;
}
