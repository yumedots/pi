import { setKeybindings, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

describe("ctrl+c quits without clearing the editor", () => {
	it("routes ctrl+c to the quit action and alt+c to the clear action", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		let clears = 0;
		let quits = 0;
		editor.onAction("app.clear", () => {
			clears++;
		});
		editor.onAction("app.quit", () => {
			quits++;
		});
		editor.setText("draft");

		editor.handleInput("\x03"); // Ctrl+C
		expect(editor.getText()).toBe("draft");
		expect(quits).toBe(1);
		expect(clears).toBe(0);

		editor.handleInput("\x1bc"); // Alt+C
		expect(clears).toBe(1);
		expect(quits).toBe(1);
	});

	it("exits on a double press and leaves the editor content alone", () => {
		setKeybindings(new KeybindingsManager());
		const handleQuit = Reflect.get(InteractiveMode.prototype, "handleQuit") as (this: FakeMode) => void;
		const state = { text: "draft", shutdowns: 0, banners: [] as string[] };
		const fake: FakeMode = {
			lastSigintTime: 0,
			shutdown: () => {
				state.shutdowns++;
			},
			showWarningBanner: (message: string) => {
				state.banners.push(message);
			},
			clearEditor: () => {
				state.text = "";
			},
		};

		handleQuit.call(fake);
		expect(state.text).toBe("draft");
		expect(state.shutdowns).toBe(0);
		expect(state.banners[0]).toContain("Ctrl+C");

		handleQuit.call(fake);
		expect(state.shutdowns).toBe(1);
		expect(state.text).toBe("draft");
	});
});

interface FakeMode {
	lastSigintTime: number;
	shutdown(): void;
	showWarningBanner(message: string): void;
	clearEditor(): void;
}
