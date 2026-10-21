import { Container } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { createChatViewport } from "../src/modes/interactive/chat-viewport.ts";

describe("chat viewport", () => {
	test("defaults the transcript scrollbar to auto and accepts overrides", () => {
		const automatic = createChatViewport({
			document: new Container(),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Container(),
			footer: new Container(),
		});
		const hidden = createChatViewport({
			document: new Container(),
			pendingMessages: new Container(),
			status: new Container(),
			editor: new Container(),
			footer: new Container(),
			scrollbar: "hidden",
		});

		expect(automatic.transcript.scrollbar).toBe("auto");
		expect(hidden.transcript.scrollbar).toBe("hidden");
	});

	test("puts the status on the line right above the input box", () => {
		const status = new Container();
		const editor = new Container();
		const widgetsAbove = new Container();
		status.addChild({ render: () => ["WORKING"], invalidate: () => {} });
		editor.addChild({ render: () => ["EDITOR"], invalidate: () => {} });
		// The widgets above the input box keep a blank row of breathing room.
		widgetsAbove.addChild({ render: () => [""], invalidate: () => {} });

		const viewport = createChatViewport({
			document: new Container(),
			pendingMessages: new Container(),
			status,
			widgetsAbove,
			editor,
			footer: new Container(),
		});

		const lines = viewport.root.render(20);
		const working = lines.indexOf("WORKING");
		expect(working).toBeGreaterThanOrEqual(0);
		expect(lines[working + 1]).toBe("EDITOR");
	});
});
