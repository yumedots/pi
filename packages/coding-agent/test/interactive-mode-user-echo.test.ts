import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Spacer } from "../../tui/src/components/spacer.ts";
import { Container } from "../../tui/src/tui.ts";
import type { MarkdownTransformer } from "../src/core/extensions/types.ts";
import type { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

type UserMessage = Extract<AgentMessage, { role: "user" }>;

interface FakeInteractiveMode {
	chatContainer: Container;
	ui: { requestRender: () => void };
	outputPad: number;
	workingVisible: boolean;
	pendingUserMessageEchoes: Array<{ text: string; component: UserMessageComponent; spacer?: Spacer }>;
	showWorkingStatusIndicator: () => void;
	clearStatusIndicator: (kind?: string) => void;
	addMessageToChat: (message: AgentMessage) => void;
	removeUserMessageEcho: (echo: FakeInteractiveMode["pendingUserMessageEchoes"][number]) => void;
	getMarkdownThemeWithSettings: () => MarkdownTheme;
	getMarkdownTransformers: () => readonly MarkdownTransformer[];
	getUserMessageText: (message: Message) => string;
}

/** The echo helpers are private, so the prototype is reached through a structural type. */
interface EchoApi {
	echoUserMessage(this: FakeInteractiveMode, text: string): void;
	renderUserMessage(this: FakeInteractiveMode, message: UserMessage): void;
	discardUserMessageEcho(this: FakeInteractiveMode, text: string): void;
	removeUserMessageEcho(
		this: FakeInteractiveMode,
		echo: FakeInteractiveMode["pendingUserMessageEchoes"][number],
	): void;
	getUserMessageText(this: FakeInteractiveMode, message: Message): string;
}

const echoApi = InteractiveMode.prototype as unknown as EchoApi;

function createFakeThis(): FakeInteractiveMode {
	const fakeThis: FakeInteractiveMode = {
		chatContainer: new Container(),
		ui: { requestRender: vi.fn() },
		outputPad: 1,
		workingVisible: true,
		pendingUserMessageEchoes: [],
		showWorkingStatusIndicator: vi.fn(),
		clearStatusIndicator: vi.fn(),
		addMessageToChat: vi.fn(),
		getMarkdownThemeWithSettings: () => getMarkdownTheme(),
		getMarkdownTransformers: () => [],
		getUserMessageText: (message) => echoApi.getUserMessageText.call(fakeThis, message),
		removeUserMessageEcho: (echo) => echoApi.removeUserMessageEcho.call(fakeThis, echo),
	};
	return fakeThis;
}

function userMessage(text: string, extra: Array<TextContent | ImageContent> = []): UserMessage {
	return {
		role: "user",
		content: [{ type: "text", text }, ...extra],
		timestamp: 0,
	};
}

describe("InteractiveMode user message echo", () => {
	beforeAll(() => initTheme("dark"));

	test("shows the submitted message right away", () => {
		const fakeThis = createFakeThis();
		echoApi.echoUserMessage.call(fakeThis, "hello");

		expect(fakeThis.chatContainer.children).toHaveLength(1);
		expect(fakeThis.pendingUserMessageEchoes).toHaveLength(1);
		expect(fakeThis.showWorkingStatusIndicator).toHaveBeenCalled();
	});

	test("keeps the echoed message when the run sends the same text", () => {
		const fakeThis = createFakeThis();
		echoApi.echoUserMessage.call(fakeThis, "hello");
		echoApi.renderUserMessage.call(fakeThis, userMessage("hello"));

		expect(fakeThis.chatContainer.children).toHaveLength(1);
		expect(fakeThis.pendingUserMessageEchoes).toHaveLength(0);
		expect(fakeThis.addMessageToChat).not.toHaveBeenCalled();
	});

	test("replaces the echoed message when the run sends different text", () => {
		const fakeThis = createFakeThis();
		echoApi.echoUserMessage.call(fakeThis, "/skill:foo");
		echoApi.renderUserMessage.call(fakeThis, userMessage("<skill>foo</skill>"));

		expect(fakeThis.chatContainer.children).toHaveLength(0);
		expect(fakeThis.pendingUserMessageEchoes).toHaveLength(0);
		expect(fakeThis.addMessageToChat).toHaveBeenCalledTimes(1);
	});

	test("renders the run message when it carries attachments", () => {
		const fakeThis = createFakeThis();
		echoApi.echoUserMessage.call(fakeThis, "hello");
		echoApi.renderUserMessage.call(
			fakeThis,
			userMessage("hello", [{ type: "image", data: "AAAA", mimeType: "image/png" }]),
		);

		expect(fakeThis.addMessageToChat).toHaveBeenCalledTimes(1);
	});

	test("drops the echo when the prompt never reaches the model", () => {
		const fakeThis = createFakeThis();
		echoApi.echoUserMessage.call(fakeThis, "hello");
		echoApi.discardUserMessageEcho.call(fakeThis, "hello");

		expect(fakeThis.chatContainer.children).toHaveLength(0);
		expect(fakeThis.pendingUserMessageEchoes).toHaveLength(0);
		expect(fakeThis.clearStatusIndicator).toHaveBeenCalledWith("working");
	});
});
