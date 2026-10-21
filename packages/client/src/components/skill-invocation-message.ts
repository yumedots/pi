import type { ParsedSkillMessage } from "@earendil-works/pi-coding-agent/core/agent-session";
import type { MarkdownTransformer } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { getMarkdownTheme, theme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import {
	Box,
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	MouseRegion,
	Spacer,
	Text,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { createMarkdownTransform } from "./markdown-transform.ts";

/** Clicks closer together than this belong to one burst (e.g. a double click). */
const CLICK_BURST_INTERVAL_MS = 500;

/**
 * Renders the skill mention and the request that came with it on the same line.
 * The request is rendered in the width left over by the mention, so its first line
 * continues the mention and the remaining lines keep a hanging indent.
 */
class SkillRequestComponent implements Component {
	private mention: string;
	private request: Markdown;

	constructor(
		mention: string,
		requestText: string,
		markdownTheme: MarkdownTheme,
		markdownTransformers: readonly MarkdownTransformer[],
	) {
		this.mention = mention;
		this.request = new Markdown(
			requestText,
			0,
			0,
			markdownTheme,
			{
				color: (text: string) => theme.fg("userMessageText", text),
			},
			{
				preserveOrderedListMarkers: true,
				preserveBackslashEscapes: true,
				transform: createMarkdownTransform("user", false, markdownTransformers),
			},
		);
	}

	render(width: number): string[] {
		const mentionWidth = visibleWidth(this.mention);
		const requestLines = this.request.render(Math.max(1, width - mentionWidth - 1));
		if (requestLines.length === 0) return [this.mention];

		const [first, ...rest] = requestLines;
		const indent = " ".repeat(mentionWidth + 1);
		return [`${this.mention} ${first}`, ...rest.map((line) => indent + line)];
	}

	invalidate(): void {
		this.request.invalidate?.();
	}
}

/**
 * Component that renders a skill invocation message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 * The mention and the request that came with it are rendered on the same line, so the
 * skill and the request read as one message.
 */
export class SkillInvocationMessageComponent extends Box {
	private expanded = false;
	private skillMessage: ParsedSkillMessage;
	private markdownTheme: MarkdownTheme;
	private markdownTransformers: readonly MarkdownTransformer[];
	private onBeforeToggle: (() => void) | undefined;
	private lastClickAt = 0;

	constructor(
		skillMessage: ParsedSkillMessage,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		onBeforeToggle?: () => void,
	) {
		// The vertical padding lives inside the click target, so the empty space around the
		// mention belongs to the card.
		super(outputPad, 0, (t) => theme.bg("customMessageBg", t));
		this.skillMessage = skillMessage;
		this.markdownTheme = markdownTheme;
		this.markdownTransformers = markdownTransformers;
		this.onBeforeToggle = onBeforeToggle;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.setPaddingX(outputPad);
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const mention = theme.fg(
			"customMessageLabel",
			this.skillMessage.blocks.map((block) => `@${block.name}`).join(" "),
		);
		const line = new Container();
		if (this.skillMessage.userMessage) {
			line.addChild(
				new SkillRequestComponent(
					mention,
					this.skillMessage.userMessage,
					this.markdownTheme,
					this.markdownTransformers,
				),
			);
		} else {
			line.addChild(new Text(mention, 0, 0));
		}

		// The whole card is the click target, including the empty space around the mention.
		const card = new Container();
		card.addChild(new Spacer(1));
		card.addChild(line);
		if (this.expanded) {
			for (const block of this.skillMessage.blocks) {
				card.addChild(new Spacer(1));
				card.addChild(
					new Markdown(block.content, 0, 0, this.markdownTheme, {
						color: (text: string) => theme.fg("customMessageText", text),
					}),
				);
			}
		}
		card.addChild(new Spacer(1));

		this.addChild(
			new MouseRegion(card, (event) => {
				if (event.button !== "left") return undefined;
				// Claim the press, so the transcript does not start a text selection on the card
				// and a second click does not select the line.
				if (event.type === "press") return { handled: true };
				if (event.type !== "click") return undefined;
				const now = Date.now();
				// A click toggles the skill body. A double click arrives as two clicks, so the
				// following clicks of one burst are ignored instead of toggling twice.
				if (now - this.lastClickAt > CLICK_BURST_INTERVAL_MS) {
					// The card grows or shrinks, so let the transcript keep its position.
					this.onBeforeToggle?.();
					this.setExpanded(!this.expanded);
				}
				this.lastClickAt = now;
				return { handled: true };
			}),
		);
	}
}
