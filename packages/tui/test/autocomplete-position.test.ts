import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { Container, type TuiMouseEvent } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const WIDTH = 40;

function createEditor(position?: "above" | "below"): Editor {
	const editor = new Editor(new TuiMainScreen(new VirtualTerminal(WIDTH, 24)), defaultEditorTheme, {
		...(position === undefined ? {} : { autocompletePosition: position }),
	});
	const provider: AutocompleteProvider = {
		getSuggestions: async () => ({
			prefix: "/",
			items: [
				{ value: "/help", label: "/help", description: "show help" },
				{ value: "/theme", label: "/theme", description: "change theme" },
				{ value: "/model", label: "/model", description: "pick model" },
			],
		}),
		applyCompletion: (lines, line, col, item, prefix) => {
			const next = [...lines];
			next[line] = next[line]!.slice(0, col - prefix.length) + item.value + next[line]!.slice(col);
			return { lines: next, cursorLine: line, cursorCol: col - prefix.length + item.value.length };
		},
	};
	editor.setAutocompleteProvider(provider);
	return editor;
}

async function openSlashMenu(editor: Editor): Promise<void> {
	editor.handleInput("/");
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

function mouseEvent(y: number, type: TuiMouseEvent["type"] = "click"): TuiMouseEvent {
	return {
		type,
		button: "left",
		x: 2,
		y,
		screenX: 2,
		screenY: y,
		width: WIDTH,
		height: 24,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

describe("editor autocomplete position", () => {
	it("floats the list above the input by default", async () => {
		const editor = createEditor();
		await openSlashMenu(editor);

		const overlay = editor.renderOverlayAbove(WIDTH);
		assert.strictEqual(overlay.length, 3);
		assert.ok(overlay[0]!.includes("/help"));

		// The list is not part of the editor's own box, so the box keeps its height.
		const lines = editor.render(WIDTH);
		assert.strictEqual(lines.length, 3);
		assert.ok(!lines.some((line) => line.includes("/help")));
	});

	it("puts the list under the input when the position is below", async () => {
		const editor = createEditor("below");
		await openSlashMenu(editor);

		assert.deepStrictEqual(editor.renderOverlayAbove(WIDTH), []);

		const lines = editor.render(WIDTH);
		assert.strictEqual(lines.length, 6);
		assert.ok(lines[3]!.includes("/help"));
		assert.ok(lines[5]!.includes("/model"));
	});

	it("selects an item by clicking the list above the input", async () => {
		const editor = createEditor();
		await openSlashMenu(editor);
		editor.renderOverlayAbove(WIDTH);

		// The list is painted above the editor, so its rows have negative coordinates.
		editor.handleMouse(mouseEvent(-2));
		assert.strictEqual(editor.getText(), "/theme");
	});

	it("selects an item by clicking the list below the input", async () => {
		const editor = createEditor("below");
		await openSlashMenu(editor);
		editor.render(WIDTH);

		// The list starts right under the editor's box.
		editor.handleMouse(mouseEvent(3));
		assert.strictEqual(editor.getText(), "/help");

		const other = createEditor("below");
		await openSlashMenu(other);
		other.render(WIDTH);
		other.handleMouse(mouseEvent(5));
		assert.strictEqual(other.getText(), "/model");
	});

	it("switches the position at runtime", async () => {
		const editor = createEditor();
		assert.strictEqual(editor.getAutocompletePosition(), "above");
		await openSlashMenu(editor);

		editor.setAutocompletePosition("below");
		assert.strictEqual(editor.getAutocompletePosition(), "below");
		assert.deepStrictEqual(editor.renderOverlayAbove(WIDTH), []);
		assert.strictEqual(editor.render(WIDTH).length, 6);

		editor.setAutocompletePosition("above");
		assert.strictEqual(editor.renderOverlayAbove(WIDTH).length, 3);
		assert.strictEqual(editor.render(WIDTH).length, 3);
	});

	it("floats the list above the input when the editor sits in a container", async () => {
		const editor = createEditor();
		await openSlashMenu(editor);
		const container = new Container();
		container.addChild(editor);
		const root = new VStack([{ component: new Text("transcript", 0, 0) }, { component: container }]);

		const frame = renderLayoutFrame(root, WIDTH, 24, () => {});
		const editorBox = frame.root.children[1]!;
		// The list is painted over the transcript, right above the input box.
		const listRow = editorBox.rect.y - 1;
		assert.ok(frame.lines[listRow]?.includes("/model"), frame.lines[listRow]);
		assert.ok(frame.lines[editorBox.rect.y + 1]?.includes("/"), frame.lines[editorBox.rect.y + 1]);

		// A click on the list row reaches the editor through the container.
		const result = container.handleMouse(mouseEvent(-1));
		assert.strictEqual(result?.handled, true);
		assert.strictEqual(editor.getText(), "/model");
	});
});
