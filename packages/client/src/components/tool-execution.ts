import type {
	ToolDefinition,
	ToolRenderContext,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { Theme as ToolTheme } from "@earendil-works/pi-coding-agent/core/theme/theme";
import {
	Box,
	type Component,
	Container,
	getCapabilities,
	Image,
	MouseRegion,
	Spacer,
	Text,
	type TUI,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";

/** What this component needs from a tool: how to draw it, without executing it. */
export type { ToolRenderers };

import {
	formatToolCallWithArgs,
	getTextOutput as getRenderedTextOutput,
} from "@earendil-works/pi-support/render-utils";
import { ensurePngTranscoder } from "../client-support/image-convert.ts";
import { keyHint } from "../client-support/keybinding-hints.ts";
import { createAllToolRenderers } from "../client-support/tool-renderers/index.ts";
import { theme } from "../client-theme.ts";
import { getServerRenderProvider, type RenderRequest, type RenderToolResult } from "../session-facade.ts";
import { SignedRow } from "./spinner-sign.ts";

const FALLBACK_PREVIEW_LINES = 10;

/**
 * The theme of the client, as the renderers of the tools expect it.
 *
 * The renderers of the extension API take the theme of the agent. The client draws with its
 * own theme, which has the same shape.
 */
const rendererTheme = theme as unknown as ToolTheme;

/**
 * The sources of the built-in renderer functions.
 *
 * The client resolves the renderers of a tool itself: the client-side extensions first,
 * the built-in ones as the fallback. The component cannot tell the two apart by identity,
 * because the built-in renderers are created per call, so it compares the source of the
 * functions instead.
 */
const BUILT_IN_RENDERER_SOURCES = new Set(
	Object.values(createAllToolRenderers()).flatMap((renderers) =>
		[renderers.renderCall?.toString(), renderers.renderResult?.toString()].filter(
			(source): source is string => source !== undefined,
		),
	),
);

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
	outputPad?: number;
}

export class ToolExecutionComponent extends Container {
	private contentBox: Box;
	private contentText: Text;
	private contentTextRegion: MouseRegion;
	private selfRenderContainer: Container;
	private selfRenderHeight = 0;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	/** Inputs of imageComponents, so updateDisplay can reuse images and keep their converted PNG data. */
	private imageSources: Array<{ data: string; mimeType: string; widthCells: number }> = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private outputPad: number;
	private isPartial = true;
	private toolDefinition?: ToolRenderers;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
		durationMs?: number;
	};
	private hideComponent = false;
	/** The lines the server rendered for this tool call. */
	private serverLines?: string[];
	/** The key the cached server lines belong to. */
	private serverLinesKey?: string;
	/** The key of the last request the component sent to the server. */
	private serverRequestKey?: string;
	/** How often the arguments changed, so a changed call is asked for again. */
	private argsVersion = 0;
	/** How often the result changed, so a changed result is asked for again. */
	private resultVersion = 0;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.outputPad = options.outputPad ?? 1;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		// Always create all shell variants. contentBox is used for default renderer-based composition.
		// selfRenderContainer is used when the tool renders its own framing.
		// contentText is reserved for generic fallback rendering when no tool definition exists.
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentTextRegion = this.createResultRegion(this.contentText);
		this.selfRenderContainer = new Container();

		if (this.hasRendererDefinition()) {
			this.addChild(this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox);
		} else {
			this.addChild(this.contentTextRegion);
		}

		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		return this.toolDefinition?.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		return this.toolDefinition?.renderResult;
	}

	private hasRendererDefinition(): boolean {
		return this.toolDefinition !== undefined;
	}

	private getRenderShell(): "default" | "self" {
		return this.toolDefinition?.renderShell ?? "default";
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
			durationMs: this.isPartial ? undefined : this.result?.durationMs,
			outputPad: this.outputPad,
		};
	}

	private createCallFallback(): Component {
		return new Text(formatToolCallWithArgs(this.toolName, this.args, theme, this.expanded), 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}

		const lines = output.split("\n");
		const displayLines = this.expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
		const remaining = lines.length - displayLines.length;
		let text = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
		return new Text(text, 0, 0);
	}

	private createResultRegion(component: Component): MouseRegion {
		return new MouseRegion(component, (event) => {
			if (!this.result || event.type !== "click" || event.button !== "left") return undefined;
			this.setExpanded(!this.expanded);
			return { handled: true };
		});
	}

	/**
	 * The call row, with a spinning sign in front of it while the tool runs. The sign is drawn
	 * from the clock, so it advances on every redraw without rewriting the call text.
	 */
	private createCallRegion(component: Component): Component {
		if (this.result !== undefined && !this.isPartial) {
			return this.createResultRegion(component);
		}
		return this.createResultRegion(new SignedRow(component));
	}

	updateArgs(args: any): void {
		this.args = args;
		this.argsVersion++;
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
			/** Execution time of a final result. */
			durationMs?: number;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.resultVersion++;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}

		if (this.hasRendererDefinition() && this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			this.selfRenderHeight = contentLines.length;
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			const lines: string[] = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
			return lines;
		}

		return super.render(width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (!this.hasRendererDefinition() || this.getRenderShell() !== "self") return super.handleMouse(event);
		if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
		return this.selfRenderContainer.handleMouse({
			...event,
			y: event.y - 1,
			height: this.selfRenderHeight,
		});
	}

	private updateDisplay(): void {
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		let hasContent = false;
		this.hideComponent = false;
		const serverLines = this.serverRenderedLines();
		if (serverLines) {
			// The server drew the row: its renderer knows what the client cannot know.
			this.renderServerLines(serverLines, bgFn);
			hasContent = true;
		} else if (this.hasRendererDefinition()) {
			const renderContainer = this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox;
			if (renderContainer instanceof Box) {
				renderContainer.setBgFn(bgFn);
				renderContainer.setPaddingX(this.outputPad);
			}
			renderContainer.clear();

			const callRenderer = this.getCallRenderer();
			if (!callRenderer) {
				renderContainer.addChild(this.createCallRegion(this.createCallFallback()));
				hasContent = true;
			} else {
				try {
					const component = callRenderer(
						this.args,
						rendererTheme,
						this.getRenderContext(this.callRendererComponent),
					);
					this.callRendererComponent = component;
					renderContainer.addChild(this.createCallRegion(component));
					hasContent = true;
				} catch {
					this.callRendererComponent = undefined;
					renderContainer.addChild(this.createCallRegion(this.createCallFallback()));
					hasContent = true;
				}
			}

			if (this.result) {
				const resultRenderer = this.getResultRenderer();
				if (!resultRenderer) {
					const component = this.createResultFallback();
					if (component) {
						renderContainer.addChild(this.createResultRegion(component));
						hasContent = true;
					}
				} else {
					try {
						const component = resultRenderer(
							{ content: this.result.content as any, details: this.result.details },
							{ expanded: this.expanded, isPartial: this.isPartial },
							rendererTheme,
							this.getRenderContext(this.resultRendererComponent),
						);
						this.resultRendererComponent = component;
						renderContainer.addChild(this.createResultRegion(component));
						hasContent = true;
					} catch {
						this.resultRendererComponent = undefined;
						const component = this.createResultFallback();
						if (component) {
							renderContainer.addChild(this.createResultRegion(component));
							hasContent = true;
						}
					}
				}
			}
		} else {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setPaddingX(this.outputPad);
			this.contentText.setText(this.formatToolExecution());
			hasContent = true;
		}

		const previousImages = this.imageComponents;
		const previousSources = this.imageSources;
		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		this.imageSources = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content.filter((c) => c.type === "image");
			const caps = getCapabilities();
			for (const img of imageBlocks) {
				if (caps.images && this.showImages && img.data && img.mimeType) {
					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const source = { data: img.data, mimeType: img.mimeType, widthCells: this.imageWidthCells };
					const index = this.imageComponents.length;
					const previous = previousSources[index];
					const imageComponent =
						previous?.data === source.data &&
						previous.mimeType === source.mimeType &&
						previous.widthCells === source.widthCells
							? previousImages[index]
							: new Image(
									source.data,
									source.mimeType,
									{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
									{ maxWidthCells: source.widthCells },
								);
					if (source.mimeType !== "image/png") {
						ensurePngTranscoder(() => {
							this.invalidate();
							this.ui.requestRender();
						});
					}
					this.imageComponents.push(imageComponent);
					this.imageSources.push(source);
					this.addChild(imageComponent);
				}
			}
		}

		if (this.hasRendererDefinition() && !hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}

	/**
	 * Whether the client draws this tool itself.
	 *
	 * The client resolves the renderers of a tool itself: the client-side extensions
	 * first, the built-in ones as the fallback. A renderer that is not a built-in one
	 * comes from a client-side extension, and that one wins over the server's.
	 */
	private hasClientRenderer(): boolean {
		const renderCall = this.getCallRenderer();
		if (!renderCall) return false;
		return !BUILT_IN_RENDERER_SOURCES.has(renderCall.toString());
	}

	/** The phase the row is in: the call alone, a streaming result or the final result. */
	private renderPhase(): "call" | "partial" | "result" {
		if (!this.result) return "call";
		return this.isPartial ? "partial" : "result";
	}

	/**
	 * The key the server rendering of this row belongs to.
	 *
	 * The key covers everything the server draws differently: the tool call, the expansion
	 * state and the result. A changed key means the cached lines are stale.
	 */
	private serverRenderKey(): string {
		const expansion = this.expanded ? "expanded" : "collapsed";
		return `${this.toolCallId}|${expansion}|${this.renderPhase()}|${this.argsVersion}|${this.resultVersion}`;
	}

	/**
	 * The lines the server rendered for this row, when it rendered them.
	 *
	 * The request runs in the background: the row shows the client's own rendering until
	 * the answer arrives, so the transcript never waits for the network.
	 */
	private serverRenderedLines(): string[] | undefined {
		this.requestServerRender();
		if (this.serverLinesKey !== this.serverRenderKey()) return undefined;
		return this.serverLines;
	}

	/**
	 * Ask the server to draw the row.
	 *
	 * The answer is cached per tool call, expansion state and result, so a redraw does not
	 * ask again.
	 */
	private requestServerRender(): void {
		if (this.hasClientRenderer()) return;
		const provider = getServerRenderProvider();
		if (!provider) return;
		const phase = this.renderPhase();
		if (phase === "partial") return;
		const key = this.serverRenderKey();
		if (key === this.serverRequestKey) return;
		this.serverRequestKey = key;
		const request: RenderRequest = {
			kind: "tool",
			toolName: this.toolName,
			args: this.args,
			toolCallId: this.toolCallId,
			result: this.serverResult(),
			isPartial: this.isPartial,
			expanded: this.expanded,
		};
		void provider
			.render(request)
			.then((response) => {
				if (response.lines.length === 0) return;
				this.serverLines = response.lines;
				this.serverLinesKey = key;
				this.invalidate();
				this.ui.requestRender();
			})
			.catch(() => {
				// The server cannot draw the row: the client keeps drawing it itself.
			});
	}

	/**
	 * The result the server draws.
	 *
	 * The images of a result are the client's own business: the client draws them as
	 * images, so the server gets the text of the result only.
	 */
	private serverResult(): RenderToolResult | undefined {
		if (!this.result) return undefined;
		return {
			content: this.result.content.filter((block) => block.type === "text"),
			details: this.result.details,
			isError: this.result.isError,
			durationMs: this.result.durationMs,
		};
	}

	/** Draw the lines the server produced, in the shell the tool uses. */
	private renderServerLines(lines: string[], bgFn: (text: string) => string): void {
		const text = lines.join("\n");
		if (!this.hasRendererDefinition()) {
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setPaddingX(this.outputPad);
			this.contentText.setText(text);
			return;
		}
		if (this.getRenderShell() === "self") {
			this.selfRenderContainer.clear();
			this.selfRenderContainer.addChild(this.createCallRegion(new Text(text, 0, 0)));
			return;
		}
		this.contentBox.setBgFn(bgFn);
		this.contentBox.setPaddingX(this.outputPad);
		this.contentBox.clear();
		this.contentBox.addChild(this.createCallRegion(new Text(text, 0, 0)));
	}

	private formatToolExecution(): string {
		let text = theme.fg("toolTitle", theme.bold(this.toolName));
		const content = JSON.stringify(this.args, null, 2);
		if (content) {
			text += `\n\n${content}`;
		}
		const output = this.getTextOutput();
		if (output) {
			text += `\n${output}`;
		}
		return text;
	}
}
