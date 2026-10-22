/**
 * The client's theme.
 *
 * The theme is the client's own presentation code: the tokens become ANSI escape
 * sequences here, on the machine that draws them. The tokens themselves are the
 * server's business: the server sends the theme it uses in its manifest, and this module
 * turns that JSON into the theme the components draw with.
 *
 * The client never loads a theme file itself. The theme of the server is the theme of the
 * client, and it arrives with the manifest.
 */

import type {
	EditorTheme,
	MarkdownTheme,
	RgbColor,
	SelectListTheme,
	SettingsListTheme,
	TerminalColors,
} from "@earendil-works/pi-tui";
import {
	backgroundAnsi,
	type Color,
	colorToOklch,
	foregroundAnsi,
	mixColors,
	parseColor,
	rgbColor,
	styleTextWithAnsi,
	type TerminalColorMode,
	type TextAttributes,
} from "@earendil-works/pi-tui/colors";
import { getTerminalColorMode } from "@earendil-works/pi-tui/terminal-capabilities";

// ============================================================================
// Tokens
// ============================================================================

/** The slot a token belongs to. */
export interface ThemeTokenDescriptor {
	slot: "foreground" | "background";
	description: string;
	fallback?: string;
}

/** The theme token metadata, in the order the theme files use. */
export const THEME_TOKENS = {
	accent: { slot: "foreground", description: "Primary accent color" },
	border: { slot: "foreground", description: "Normal borders" },
	borderAccent: { slot: "foreground", description: "Highlighted borders" },
	borderMuted: { slot: "foreground", description: "Subtle borders" },
	success: { slot: "foreground", description: "Success states" },
	error: { slot: "foreground", description: "Error states" },
	warning: { slot: "foreground", description: "Warning states" },
	muted: { slot: "foreground", description: "Secondary/dimmed text" },
	dim: { slot: "foreground", description: "Very dimmed text" },
	text: { slot: "foreground", description: "Default text color" },
	thinkingText: { slot: "foreground", description: "Thinking block text color" },
	scrollbarTrack: { slot: "foreground", description: "Scrollbar track foreground", fallback: "muted" },
	scrollbarThumb: { slot: "foreground", description: "Scrollbar thumb foreground", fallback: "text" },
	selectedBg: { slot: "background", description: "Selected item background" },
	panelBg: { slot: "background", description: "Panel background", fallback: "selectedBg" },
	menuSelectedBg: { slot: "background", description: "Selected row in menus", fallback: "selectedBg" },
	searchMatchBg: { slot: "background", description: "Search match background", fallback: "selectedBg" },
	searchMatchText: { slot: "foreground", description: "Search match text", fallback: "text" },
	userMessageBg: { slot: "background", description: "User message background" },
	userMessageText: { slot: "foreground", description: "User message text" },
	customMessageBg: { slot: "background", description: "Custom message background" },
	customMessageText: { slot: "foreground", description: "Custom message text" },
	customMessageLabel: { slot: "foreground", description: "Custom message label" },
	toolPendingBg: { slot: "background", description: "Tool box (pending)" },
	toolSuccessBg: { slot: "background", description: "Tool box (success)" },
	toolErrorBg: { slot: "background", description: "Tool box (error)" },
	toolTitle: { slot: "foreground", description: "Tool box title" },
	toolOutput: { slot: "foreground", description: "Tool box output" },
	mdHeading: { slot: "foreground", description: "Markdown heading" },
	mdLink: { slot: "foreground", description: "Markdown link" },
	mdLinkUrl: { slot: "foreground", description: "Markdown link url" },
	mdCode: { slot: "foreground", description: "Markdown inline code" },
	mdCodeBlock: { slot: "foreground", description: "Markdown code block" },
	mdCodeBlockBorder: { slot: "foreground", description: "Markdown code block fence" },
	mdQuote: { slot: "foreground", description: "Markdown quote" },
	mdQuoteBorder: { slot: "foreground", description: "Markdown quote border" },
	mdHr: { slot: "foreground", description: "Markdown horizontal rule" },
	mdListBullet: { slot: "foreground", description: "Markdown list bullet" },
	toolDiffAdded: { slot: "foreground", description: "Added diff lines" },
	toolDiffRemoved: { slot: "foreground", description: "Removed diff lines" },
	toolDiffContext: { slot: "foreground", description: "Context diff lines" },
	syntaxComment: { slot: "foreground", description: "Syntax: comments" },
	syntaxKeyword: { slot: "foreground", description: "Syntax: keywords" },
	syntaxFunction: { slot: "foreground", description: "Syntax: functions" },
	syntaxVariable: { slot: "foreground", description: "Syntax: variables" },
	syntaxString: { slot: "foreground", description: "Syntax: strings" },
	syntaxNumber: { slot: "foreground", description: "Syntax: numbers" },
	syntaxType: { slot: "foreground", description: "Syntax: types" },
	syntaxOperator: { slot: "foreground", description: "Syntax: operators" },
	syntaxPunctuation: { slot: "foreground", description: "Syntax: punctuation" },
	thinkingOff: { slot: "foreground", description: "Thinking border: off" },
	thinkingMinimal: { slot: "foreground", description: "Thinking border: minimal" },
	thinkingLow: { slot: "foreground", description: "Thinking border: low" },
	thinkingMedium: { slot: "foreground", description: "Thinking border: medium" },
	thinkingHigh: { slot: "foreground", description: "Thinking border: high" },
	thinkingXhigh: { slot: "foreground", description: "Thinking border: xhigh" },
	thinkingMax: { slot: "foreground", description: "Thinking border: max", fallback: "thinkingXhigh" },
	bashMode: { slot: "foreground", description: "Editor border in bash mode" },
} as const satisfies Record<string, ThemeTokenDescriptor>;

/** The name of a theme token. */
export type ThemeToken = keyof typeof THEME_TOKENS;

/** The tokens that are drawn in the foreground. */
export type ThemeColor = {
	[K in ThemeToken]: (typeof THEME_TOKENS)[K]["slot"] extends "foreground" ? K : never;
}[ThemeToken];

/** The tokens that are drawn in the background. */
export type ThemeBg = Exclude<ThemeToken, ThemeColor>;

/** The background a theme is designed for. */
export type ThemeAppearance = "dark" | "light";

/** The light or dark appearance of the terminal. */
export type TerminalTheme = ThemeAppearance;

/** The color of a theme, before it is resolved. */
export type ThemeColorValue = string | number;

/** The shape of a theme document. */
export interface ThemeJson {
	name?: string;
	appearance?: ThemeAppearance;
	vars?: Record<string, ThemeColorValue>;
	colors?: Record<string, ThemeColorValue>;
	dim?: string[];
}

/** The style of a piece of text. */
export interface ThemeStyle extends TextAttributes {
	fg?: ThemeColor | Color;
	bg?: ThemeBg | Color;
}

// ============================================================================
// Colors
// ============================================================================

/** The terminal's reported colors. */
let terminalColors: TerminalColors = {};

/**
 * Record the terminal's reported colors.
 *
 * A token set to "" has no color of its own: it uses the terminal's default.
 */
export function setTerminalColors(colors: TerminalColors): void {
	terminalColors = { ...colors };
}

/** The assumed terminal defaults when the terminal reports none. */
const GUESSED_DEFAULT_COLORS: Record<ThemeAppearance, { foreground: Color; background: Color }> = {
	dark: { foreground: parseColor("#e5e5e7"), background: parseColor("#000000") },
	light: { foreground: parseColor("#000000"), background: parseColor("#ffffff") },
};

function averageLightness(colors: Color[]): number | undefined {
	const fixed = colors.filter((color) => color.kind !== "indexed" || color.index >= 16);
	if (fixed.length === 0) return undefined;
	return fixed.reduce((sum, color) => sum + colorToOklch(color).l, 0) / fixed.length;
}

/** Detect the background a theme is designed for from the lightness of its own colors. */
function detectAppearance(foregrounds: Color[], backgrounds: Color[]): ThemeAppearance | undefined {
	const fg = averageLightness(foregrounds);
	const bg = averageLightness(backgrounds);
	if (fg !== undefined && bg !== undefined) return bg < fg ? "dark" : "light";
	if (bg !== undefined) return bg < 0.5 ? "dark" : "light";
	if (fg !== undefined) return fg > 0.5 ? "dark" : "light";
	return undefined;
}

function resolveVarRefs(
	value: ThemeColorValue,
	vars: Record<string, ThemeColorValue>,
	visited = new Set<string>(),
): string | number {
	if (typeof value === "number" || value === "" || value.startsWith("#") || /^ok(lch|hsl)\(/i.test(value)) {
		return value;
	}
	if (visited.has(value)) throw new Error(`Circular variable reference detected: ${value}`);
	if (!(value in vars)) throw new Error(`Variable reference not found: ${value}`);
	visited.add(value);
	return resolveVarRefs(vars[value], vars, visited);
}

/** Resolve the variables of a theme document. */
export function resolveThemeColors(
	colors: Record<string, ThemeColorValue>,
	vars: Record<string, ThemeColorValue> = {},
): Record<string, string | number> {
	const resolved: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(colors)) {
		resolved[key] = resolveVarRefs(value, vars);
	}
	return resolved;
}

/** Fill the tokens that have a fallback with the color of their fallback token. */
export function withThemeTokenFallbacks(values: Record<string, string | number>): Record<string, string | number> {
	const resolved = { ...values };
	for (const [rawName, descriptor] of Object.entries(THEME_TOKENS)) {
		if (!("fallback" in descriptor)) continue;
		const fallback = descriptor.fallback as string;
		if (resolved[rawName] !== undefined) continue;
		const fallbackValue = resolved[fallback];
		if (fallbackValue === undefined) {
			throw new Error(`Theme token ${rawName} has unresolved fallback ${fallback}`);
		}
		resolved[rawName] = fallbackValue;
	}
	return resolved;
}

/** Split the resolved colors into the foreground and the background tokens. */
export function splitThemeColors(colors: Record<string, string | number>): {
	fgColors: Record<string, string | number>;
	bgColors: Record<string, string | number>;
} {
	const fgColors: Record<string, string | number> = {};
	const bgColors: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(colors)) {
		const descriptor = THEME_TOKENS[key as ThemeToken];
		if (!descriptor) continue;
		if (descriptor.slot === "background") bgColors[key] = value;
		else fgColors[key] = value;
	}
	return { fgColors, bgColors };
}

// ============================================================================
// The theme
// ============================================================================

/**
 * A theme of the client.
 *
 * The theme turns the tokens into ANSI escape sequences. The tokens come from the
 * server's manifest; the escape sequences are the client's own.
 */
export class Theme {
	readonly name?: string;
	private mode: TerminalColorMode;
	private readonly fgAnsi = new Map<string, string>();
	private readonly bgAnsi = new Map<string, string>();
	private readonly concreteColors: Partial<Record<ThemeToken, Color>> = {};
	private readonly defaultForegroundTokens: string[] = [];
	private readonly defaultBackgroundTokens: string[] = [];
	private readonly dimTokens: ReadonlySet<string>;
	private readonly ownAppearance: ThemeAppearance | undefined;
	private resolvedColors: { terminal: TerminalColors; colors: Readonly<Record<string, Color>> } | undefined;

	constructor(
		fgColors: Record<string, string | number>,
		bgColors: Record<string, string | number>,
		mode: TerminalColorMode,
		options: {
			name?: string;
			appearance?: ThemeAppearance;
			dim?: readonly string[];
		} = {},
	) {
		this.name = options.name;
		this.mode = mode;
		this.dimTokens = new Set(options.dim ?? []);
		const { fgColors: foregrounds, bgColors: backgrounds } = splitThemeColors(
			withThemeTokenFallbacks({ ...fgColors, ...bgColors }),
		);
		const concreteForegrounds: Color[] = [];
		const concreteBackgrounds: Color[] = [];
		const addToken = (token: string, value: string | number, isBackground: boolean): string => {
			if (value === "") {
				(isBackground ? this.defaultBackgroundTokens : this.defaultForegroundTokens).push(token);
				return isBackground ? "\x1b[49m" : "\x1b[39m";
			}
			const color = parseColor(value);
			this.concreteColors[token as ThemeToken] = color;
			(isBackground ? concreteBackgrounds : concreteForegrounds).push(color);
			return isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
		};
		for (const [token, value] of Object.entries(foregrounds)) {
			this.fgAnsi.set(token, addToken(token, value, false));
		}
		for (const [token, value] of Object.entries(backgrounds)) {
			this.bgAnsi.set(token, addToken(token, value, true));
		}
		this.ownAppearance = options.appearance ?? detectAppearance(concreteForegrounds, concreteBackgrounds);
	}

	/** The background the theme is designed for. */
	get appearance(): ThemeAppearance {
		return this.ownAppearance ?? "dark";
	}

	/** The concrete color of every token. */
	get colors(): Readonly<Record<string, Color>> {
		const terminal = terminalColors;
		if (this.resolvedColors?.terminal !== terminal) {
			const guess = GUESSED_DEFAULT_COLORS[this.appearance];
			const toColor = (rgb: RgbColor | undefined, fallback: Color) =>
				rgb ? rgbColor(rgb.r, rgb.g, rgb.b) : fallback;
			const foreground = toColor(terminal.foreground, guess.foreground);
			const background = toColor(terminal.background, guess.background);
			const colors: Record<string, Color> = { ...this.concreteColors };
			for (const token of this.defaultForegroundTokens) colors[token] = foreground;
			for (const token of this.defaultBackgroundTokens) colors[token] = background;
			for (const token of this.dimTokens) {
				const color = colors[token];
				if (color) colors[token] = mixColors(color, background, 0.4);
			}
			this.resolvedColors = { terminal, colors: Object.freeze(colors) };
		}
		return this.resolvedColors.colors;
	}

	/** The color of a token, as the terminal understands it. */
	getColor(token: ThemeToken): Color | undefined {
		return this.colors[token];
	}

	style(text: string, options: ThemeStyle): string {
		const { fg, bg } = options;
		const dimmed = typeof fg === "string" && this.dimTokens.has(fg) ? { ...options, dim: true } : options;
		return styleTextWithAnsi(
			text,
			fg === undefined
				? undefined
				: typeof fg === "string"
					? this.tokenAnsi(this.fgAnsi, fg)
					: foregroundAnsi(fg, this.mode),
			bg === undefined
				? undefined
				: typeof bg === "string"
					? this.tokenAnsi(this.bgAnsi, bg)
					: backgroundAnsi(bg, this.mode),
			dimmed,
		);
	}

	fg(color: string, text: string): string {
		const ansi = this.tokenAnsi(this.fgAnsi, color);
		if (this.dimTokens.has(color)) return `${ansi}\x1b[2m${text}\x1b[22;39m`;
		return `${ansi}${text}\x1b[39m`;
	}

	bg(color: string, text: string): string {
		const ansi = this.tokenAnsi(this.bgAnsi, color);
		return `${ansi}${text}\x1b[49m`;
	}

	/** The escape sequence that starts a background color. */
	bgStart(color: string): string {
		return this.tokenAnsi(this.bgAnsi, color);
	}

	/** The escape sequence that starts a foreground token. */
	getFgAnsi(color: string): string {
		const ansi = this.tokenAnsi(this.fgAnsi, color);
		return this.dimTokens.has(color) ? `${ansi}\x1b[2m` : ansi;
	}

	/** The escape sequence that starts a background token. */
	getBgAnsi(color: string): string {
		return this.tokenAnsi(this.bgAnsi, color);
	}

	bold(text: string): string {
		return `\x1b[1m${text}\x1b[22m`;
	}

	italic(text: string): string {
		return `\x1b[3m${text}\x1b[23m`;
	}

	underline(text: string): string {
		return `\x1b[4m${text}\x1b[24m`;
	}

	inverse(text: string): string {
		return `\x1b[7m${text}\x1b[27m`;
	}

	strikethrough(text: string): string {
		return `\x1b[9m${text}\x1b[29m`;
	}

	/** The color of the border of a thinking level. */
	getThinkingBorderColor(level: string): (str: string) => string {
		switch (level) {
			case "minimal":
				return (str: string) => this.fg("thinkingMinimal", str);
			case "low":
				return (str: string) => this.fg("thinkingLow", str);
			case "medium":
				return (str: string) => this.fg("thinkingMedium", str);
			case "high":
				return (str: string) => this.fg("thinkingHigh", str);
			case "xhigh":
				return (str: string) => this.fg("thinkingXhigh", str);
			case "max":
				return (str: string) => this.fg("thinkingMax", str);
			default:
				return (str: string) => this.fg("thinkingOff", str);
		}
	}

	/** The color of the border of the editor in bash mode. */
	getBashModeBorderColor(): (str: string) => string {
		return (str: string) => this.fg("bashMode", str);
	}

	/** The terminal color mode the theme renders with. */
	getColorMode(): TerminalColorMode {
		return this.mode;
	}

	private tokenAnsi(ansi: Map<string, string>, token: string): string {
		const value = ansi.get(token);
		if (value === undefined) throw new Error(`Unknown theme color: ${token}`);
		return value;
	}
}

/**
 * The part of a theme a component needs.
 *
 * The client draws with the theme of the server, and the extensions of the coding agent
 * draw with the theme of the coding agent. The building blocks the extensions use take
 * this shape, so both themes fit.
 */
export interface ThemeLike {
	/** The text in the color of a token. */
	fg(color: string, text: string): string;
}

/**
 * Build a theme from the theme document of the server's manifest.
 */
export function createThemeFromJson(json: unknown, mode?: TerminalColorMode): Theme {
	const document = (json ?? {}) as ThemeJson;
	const resolved = withThemeTokenFallbacks(resolveThemeColors(document.colors ?? {}, document.vars ?? {}));
	const { fgColors, bgColors } = splitThemeColors(resolved);
	return new Theme(fgColors, bgColors, mode ?? getTerminalColorMode(), {
		name: document.name,
		appearance: document.appearance,
		dim: document.dim,
	});
}

// ============================================================================
// The themes of the server
// ============================================================================

/** The name of the system theme: the theme that follows the light or dark mode of the terminal. */
export const SYSTEM_THEME_NAME = "system";

/** A theme the server offers. */
export interface ThemeInfo {
	name: string;
	path: string | undefined;
}

/** The themes the server offers, with the file each one comes from. */
let availableThemes: ThemeInfo[] = [];

/** The documents of the themes the client can draw, by theme name. */
const themeDocuments = new Map<string, unknown>();

/** The callback that is told when the theme changes. */
let onThemeChangeCallback: (() => void) | undefined;

/**
 * Install the themes the server offers.
 *
 * The themes belong to the server: it knows the themes of its own installation. The client
 * draws them, so it needs their names and the documents of the ones it can draw. The
 * documents of the themes the client already knows stay known.
 */
export function setAvailableThemes(themes: ThemeInfo[], documents: Record<string, unknown> = {}): void {
	availableThemes = [...themes];
	for (const [name, document] of Object.entries(documents)) {
		themeDocuments.set(name, document);
	}
}

/** The names of the themes the server offers. */
export function getAvailableThemes(): string[] {
	return availableThemes.map(({ name }) => name);
}

/** The themes the server offers, with the file each one comes from. */
export function getAvailableThemesWithPaths(): ThemeInfo[] {
	return [...availableThemes];
}

/** The theme of a name, when the client has the document of it. */
export function getThemeByName(name: string): Theme | undefined {
	const document = themeDocuments.get(name);
	if (document === undefined) return undefined;
	try {
		return createThemeFromJson(document);
	} catch {
		return undefined;
	}
}

/** Be told when the theme of the client changes. */
export function onThemeChange(callback: () => void): void {
	onThemeChangeCallback = callback;
}

/**
 * Stop the notifications about the theme.
 *
 * The client watches no theme file: the server owns the themes and tells the client when the
 * theme changed. The call ends the notifications, so the code that shuts the terminal UI down
 * does not have to know that.
 */
export function stopThemeWatcher(): void {
	onThemeChangeCallback = undefined;
}

/** Tell the listener that the theme changed. */
function notifyThemeChange(): void {
	onThemeChangeCallback?.();
}

/**
 * The light and the dark theme of an automatic theme setting, such as "light/dark".
 */
export function parseAutoThemeSetting(
	themeSetting: string | undefined,
): { lightTheme: string; darkTheme: string } | undefined {
	if (!themeSetting) return undefined;
	const slashIndex = themeSetting.indexOf("/");
	if (slashIndex === -1 || themeSetting.indexOf("/", slashIndex + 1) !== -1) {
		return undefined;
	}

	const lightTheme = themeSetting.slice(0, slashIndex).trim();
	const darkTheme = themeSetting.slice(slashIndex + 1).trim();
	if (!lightTheme || !darkTheme) {
		return undefined;
	}
	return { lightTheme, darkTheme };
}

// ============================================================================
// The global theme
// ============================================================================

// The theme is shared through globalThis, so the modules that load it lazily see the
// same one.
const THEME_KEY = Symbol.for("@earendil-works/pi-client:theme");

/**
 * The theme of the client before the server named one.
 *
 * Every token is the default color of the terminal, so the screens that draw before the
 * manifest arrives are readable.
 */
let fallbackTheme: Theme | undefined;

function defaultTheme(): Theme {
	if (fallbackTheme) return fallbackTheme;
	const colors: Record<string, string | number> = {};
	for (const token of Object.keys(THEME_TOKENS)) colors[token] = "";
	const { fgColors, bgColors } = splitThemeColors(colors);
	fallbackTheme = new Theme(fgColors, bgColors, getTerminalColorMode(), { name: "default" });
	return fallbackTheme;
}

/** The theme the components draw with. */
export const theme: Theme = new Proxy({} as Theme, {
	get(_target, prop) {
		const current = (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY] ?? defaultTheme();
		return (current as unknown as Record<string | symbol, unknown>)[prop];
	},
});

/** Install a theme as the theme of the client. */
export function setThemeInstance(instance: Theme): void {
	(globalThis as Record<symbol, Theme | undefined>)[THEME_KEY] = instance;
	notifyThemeChange();
}

/** The theme of the client, or nothing when it was not initialized yet. */
export function getThemeInstance(): Theme | undefined {
	return (globalThis as Record<symbol, Theme | undefined>)[THEME_KEY];
}

/**
 * Install the theme of the server's manifest.
 */
export function setThemeFromJson(json: unknown, mode?: TerminalColorMode): Theme {
	const document = (json ?? {}) as ThemeJson;
	if (typeof document.name === "string") themeDocuments.set(document.name, json);
	const instance = createThemeFromJson(json, mode);
	setThemeInstance(instance);
	return instance;
}

/** The markdown theme of the client. */
export function getMarkdownTheme(): MarkdownTheme {
	return {
		heading: (text: string) => theme.fg("mdHeading", text),
		link: (text: string) => theme.fg("mdLink", text),
		linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
		code: (text: string) => theme.fg("mdCode", text),
		codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
		quote: (text: string) => theme.fg("mdQuote", text),
		quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
		hr: (text: string) => theme.fg("mdHr", text),
		listBullet: (text: string) => theme.fg("mdListBullet", text),
		bold: (text: string) => theme.bold(text),
		italic: (text: string) => theme.italic(text),
		underline: (text: string) => theme.underline(text),
		strikethrough: (text: string) => theme.strikethrough(text),
		// The client does not carry a syntax highlighter: a code block is drawn in the
		// color of the code blocks. The server draws the highlighted code of the pieces
		// that only it can render.
		highlightCode: (code: string) => code.split("\n").map((line) => theme.fg("mdCodeBlock", line)),
	};
}

/** The select list theme of the client. */
export function getSelectListTheme(): SelectListTheme {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("muted", text),
		noMatch: (text: string) => theme.fg("muted", text),
	};
}

/** The editor theme of the client. */
export function getEditorTheme(): EditorTheme {
	return {
		borderColor: (text: string) => theme.fg("borderMuted", text),
		selectList: getSelectListTheme(),
		backgroundColor: (text: string) => theme.bg("userMessageBg", text),
		promptColor: (text: string) => theme.fg("accent", text),
	};
}

/** The settings list theme of the client. */
export function getSettingsListTheme(): SettingsListTheme {
	return {
		label: (text: string, selected: boolean) => (selected ? theme.fg("accent", text) : text),
		value: (text: string, selected: boolean) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
		description: (text: string) => theme.fg("dim", text),
		cursor: theme.fg("accent", "→ "),
		hint: (text: string) => theme.fg("dim", text),
	};
}
