import { Container, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { initTheme } from "../../../../coding-agent/src/core/theme/theme.ts";
import { stripAnsi } from "../../../../coding-agent/src/utils/ansi.ts";
import { ToolExecutionComponent } from "../../../src/components/tool-execution.ts";
import { InteractiveMode } from "../../../src/interactive-mode.ts";
import { createInteractiveContext } from "../../interactive-mode-context.ts";

type UpdateThinkingBlockVisibility = (this: { chatContainer: Container; ui: TUI }) => void;

type ToggleThinkingBlockVisibility = (this: {
	hideThinkingBlock: boolean;
	facade: { settingsManager: { setHideThinkingBlock(hidden: boolean): void } };
	updateThinkingBlockVisibility(): void;
	showStatus(message: string): void;
}) => void;

function renderChat(container: Container): string {
	return stripAnsi(container.render(120).join("\n"));
}

describe("thinking visibility while a bash tool is running (#8611)", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("preserves partial bash output", () => {
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const chatContainer = new Container();
		const component = new ToolExecutionComponent(
			"bash",
			"tool-8611",
			{ command: "echo first; sleep 10" },
			{ showImages: false },
			undefined,
			ui,
			process.cwd(),
		);
		component.markExecutionStarted();
		component.updateResult({ content: [{ type: "text", text: "first" }], isError: false }, true);
		chatContainer.addChild(component);

		const updateThinkingBlockVisibility = Reflect.get(
			InteractiveMode.prototype,
			"updateThinkingBlockVisibility",
		) as UpdateThinkingBlockVisibility;
		const toggleThinkingBlockVisibility = Reflect.get(
			InteractiveMode.prototype,
			"toggleThinkingBlockVisibility",
		) as ToggleThinkingBlockVisibility;
		const fakeThis = createInteractiveContext({
			hideThinkingBlock: false,
			facade: { settingsManager: { setHideThinkingBlock: vi.fn() } },
			chatContainer,
			ui,
			updateThinkingBlockVisibility() {
				updateThinkingBlockVisibility.call(this);
			},
			showStatus: vi.fn(),
		});

		expect(renderChat(chatContainer)).toContain("first");
		toggleThinkingBlockVisibility.call(fakeThis);

		expect(fakeThis.facade.settingsManager.setHideThinkingBlock).toHaveBeenCalledWith(true);
		expect(chatContainer.children).toContain(component);
		expect(renderChat(chatContainer)).toContain("first");
	});
});
