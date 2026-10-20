import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "../../../core/usage-totals.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Format a token count exactly, with thousand separators, for example 198,234. */
function formatExactTokens(count: number): string {
	return count.toLocaleString("en-US");
}

/** Width of the context bar in cells. */
export const CONTEXT_BAR_WIDTH = 10;
/** The eighth blocks, from empty to full, for the partly filled cell of the bar. */
const BLOCK_PARTIALS = ["\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589"];

/**
 * A filling bar for the context usage: full blocks for the used part, an empty shade for the rest.
 *
 * The partly filled cell uses an eighth block, so the bar shows fractions of a cell.
 */
export function formatContextBar(percent: number, width: number = CONTEXT_BAR_WIDTH): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const exact = (clamped / 100) * width;
	const full = Math.floor(exact);
	const fraction = exact - full;
	const partial =
		fraction > 0
			? BLOCK_PARTIALS[Math.min(BLOCK_PARTIALS.length - 1, Math.floor(fraction * BLOCK_PARTIALS.length))]
			: "";
	const empty = Math.max(0, width - full - (partial ? 1 : 0));
	return "\u2588".repeat(full) + partial + "\u2591".repeat(empty);
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/** Separator between the groups on the left of the footer line. */
const GROUP_SEPARATOR = " / ";
/** Separator between the cwd and the git branch. */
const PATH_SEPARATOR = ":";
/** Separator between the path and the session name. */
const SESSION_SEPARATOR = " • ";
/** Minimum spaces between the left groups and the right-aligned path. */
const MIN_PADDING = 2;

/**
 * Nerd Font glyphs for the footer groups. They need a patched font, so they are only used when
 * the `nerdFonts` setting is on.
 */
const NERD_FONT_ICONS = {
	model: "\uF2DB", // nf-fa-microchip
	thinking: "\uF0E7", // nf-fa-bolt
	stats: "\uF201", // nf-fa-line_chart
	context: "\uF200", // nf-fa-chart_pie
	path: "\uF07C", // nf-fa-folder_open
	branch: "\uF126", // nf-fa-code_fork
	cost: "\uF155", // nf-fa-dollar
} as const;

/** Icons for the footer groups. Empty when Nerd Fonts are off. */
interface FooterIcons {
	model?: string;
	thinking?: string;
	stats?: string;
	context?: string;
	path?: string;
	branch?: string;
	cost?: string;
}

/** One group of the footer line, with an optional icon in front of it. */
interface FooterGroup {
	text: string;
	icon?: string;
}

/** Separators and icons for one footer line. */
interface FooterStyle {
	/** Separator between the groups on the left. */
	separator: string;
	/** Separator between the path and the git branch. */
	pathSeparator: string;
	icons: FooterIcons;
}

const PLAIN_STYLE: FooterStyle = { separator: GROUP_SEPARATOR, pathSeparator: PATH_SEPARATOR, icons: {} };
/** The icons separate the groups, so the gap between them is wider than in the plain style. */
const NERD_FONT_STYLE: FooterStyle = {
	separator: "  ",
	pathSeparator: "  ",
	icons: { ...NERD_FONT_ICONS },
};

/** Prefix a group with its icon. An empty group stays empty. */
function withIcon(text: string | undefined, icon: string | undefined): string {
	if (!text) return "";
	return icon ? `${icon} ${text}` : text;
}

/**
 * Shorten a path from the left so the tail (the project folder) stays visible.
 * Returns an empty string when the path cannot be shortened to something readable.
 */
function truncateCwd(cwd: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(cwd) <= maxWidth) return cwd;
	const segments = cwd.split(/[/\\]/).filter((segment) => segment.length > 0);
	for (let i = 1; i < segments.length; i++) {
		const candidate = `…/${segments.slice(i).join("/")}`;
		if (visibleWidth(candidate) <= maxWidth) return candidate;
	}
	const clipped = truncateToWidth(cwd, maxWidth, "…");
	// A stub like "~…" tells the user nothing, so the path is dropped instead.
	return visibleWidth(clipped) >= 4 ? clipped : "";
}

interface FooterFit {
	left: string;
	right: string;
}

/**
 * Fit the footer parts on one line.
 *
 * Shrink order: shorten the path from the left so its tail stays visible, then drop the session
 * name, the branch, and the path, then the thinking level, then the model name. The context meter
 * keeps its content as long as possible.
 */
function fitFooterLine(
	modelCandidates: string[],
	thinkingGroup: string | undefined,
	contextGroup: FooterGroup,
	extraGroups: FooterGroup[],
	cwd: string,
	branch: string | undefined,
	sessionName: string | undefined,
	costGroup: FooterGroup | undefined,
	style: FooterStyle,
	width: number,
): FooterFit {
	let best: FooterFit = { left: "", right: "" };
	for (const model of modelCandidates) {
		const fit = fitFooterLineWithModel(
			model,
			thinkingGroup,
			contextGroup,
			extraGroups,
			cwd,
			branch,
			sessionName,
			costGroup,
			style,
			width,
		);
		best = fit;
		// The model info was cut, try the shorter candidate before giving up on it.
		if (!fit.truncated) break;
	}
	return best;
}

function fitFooterLineWithModel(
	model: string,
	thinkingGroup: string | undefined,
	contextGroup: FooterGroup,
	extraGroups: FooterGroup[],
	cwd: string,
	branch: string | undefined,
	sessionName: string | undefined,
	costGroup: FooterGroup | undefined,
	style: FooterStyle,
	width: number,
): FooterFit & { truncated: boolean } {
	let modelGroup = model;
	let thinking = thinkingGroup;
	let path = cwd;
	let pathBranch = branch;
	let pathSession = sessionName;

	const buildLeft = (): string =>
		[
			withIcon(modelGroup, style.icons.model),
			withIcon(thinking, style.icons.thinking),
			withIcon(contextGroup.text, contextGroup.icon),
			...extraGroups.map((group) => withIcon(group.text, group.icon)),
		]
			.filter((part): part is string => !!part && part.length > 0)
			.join(style.separator);

	const buildRight = (): string => {
		const pathGroup = [withIcon(path, style.icons.path), withIcon(pathBranch, style.icons.branch)]
			.filter((part): part is string => !!part && part.length > 0)
			.join(style.pathSeparator);
		return [pathGroup, pathSession, costGroup ? withIcon(costGroup.text, costGroup.icon) : undefined]
			.filter((part): part is string => !!part && part.length > 0)
			.join(SESSION_SEPARATOR);
	};

	const fits = (left: string, right: string): boolean =>
		visibleWidth(left) + (right ? MIN_PADDING + visibleWidth(right) : 0) <= width;

	let left = buildLeft();
	let right = buildRight();

	// Drop the session name before it pushes the path out of the line.
	if (!fits(left, right)) {
		pathSession = undefined;
		right = buildRight();
	}

	// Shorten the path from the left so the project folder stays visible.
	if (!fits(left, right)) {
		const fixedWidth =
			visibleWidth(left) +
			(pathBranch ? style.pathSeparator.length + visibleWidth(pathBranch) : 0) +
			(pathSession ? SESSION_SEPARATOR.length + visibleWidth(pathSession) : 0) +
			(costGroup ? SESSION_SEPARATOR.length + visibleWidth(costGroup.text) : 0);
		path = truncateCwd(cwd, width - MIN_PADDING - fixedWidth);
		right = buildRight();
	}

	// Drop the branch, then the path.
	if (!fits(left, right)) {
		pathBranch = undefined;
		right = buildRight();
	}
	if (!fits(left, right)) {
		path = "";
		right = buildRight();
	}

	// Drop the thinking level, then shorten the model name.
	let truncated = false;
	if (!fits(left, right)) {
		thinking = undefined;
		left = buildLeft();
	}
	if (!fits(left, right)) {
		truncated = true;
		const rest = [
			withIcon(contextGroup.text, contextGroup.icon),
			...extraGroups.map((group) => withIcon(group.text, group.icon)),
		]
			.filter((part): part is string => !!part && part.length > 0)
			.join(style.separator);
		const restWidth = visibleWidth(rest);
		// The model icon sits in front of the model name and takes part of the room.
		const iconWidth = style.icons.model ? visibleWidth(style.icons.model) + 1 : 0;
		const available =
			width -
			visibleWidth(right) -
			(right ? MIN_PADDING : 0) -
			restWidth -
			(restWidth ? style.separator.length : 0) -
			iconWidth;
		modelGroup = available > 0 ? truncateToWidth(modelGroup, available, "") : "";
		left = buildLeft();
	}

	// The groups alone do not fit either.
	if (visibleWidth(left) > width) {
		left = truncateToWidth(left, width, "…");
	}

	return { left, right, truncated };
}

interface SessionStats {
	session: AgentSession;
	sessionId: string;
	leafId: string | null;
	entryCount: number;
	limitsModel: unknown;
	usageTotals: UsageTotals;
	contextUsage: ContextUsage | undefined;
}

/**
 * Footer component that shows pwd, the session cost, and the context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private nerdFonts = false;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private sessionStats?: SessionStats;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	/** Show Nerd Font glyphs in front of the footer groups. */
	setNerdFonts(enabled: boolean): void {
		this.nerdFonts = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	/**
	 * Usage totals and context usage scan the whole session, and the footer renders on every frame.
	 * Entries are append-only and every append moves the leaf, so the results only change with the
	 * session, leaf, entry count, or the model whose context window applies.
	 */
	private getSessionStats(): SessionStats {
		const sessionManager = this.session.sessionManager;
		const entryCount = sessionManager.getEntryCount();
		const sessionId = sessionManager.getSessionId();
		const leafId = sessionManager.getLeafId();
		const limitsModel = this.session.routedModel?.model ?? this.session.model;
		const cached = this.sessionStats;
		if (
			cached &&
			cached.session === this.session &&
			cached.sessionId === sessionId &&
			cached.leafId === leafId &&
			cached.entryCount === entryCount &&
			cached.limitsModel === limitsModel
		) {
			return cached;
		}

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		const usageTotals = createUsageTotals();

		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "usage") {
				addUsageToTotals(usageTotals, entry.usage);
			} else if (entry.type === "message" && entry.message.role === "assistant") {
				addUsageToTotals(usageTotals, entry.message.usage);
			} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
				addUsageToTotals(usageTotals, entry.message.usage);
			} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
				addUsageToTotals(usageTotals, entry.usage);
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		this.sessionStats = {
			session: this.session,
			sessionId,
			leafId,
			entryCount,
			limitsModel,
			usageTotals,
			contextUsage,
		};
		return this.sessionStats;
	}

	render(width: number): string[] {
		const state = this.session.state;
		const { usageTotals, contextUsage } = this.getSessionStats();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
		const contextTokens = contextUsage?.tokens ?? null;

		// Replace home directory with ~
		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		// Git branch and session name stay visible when the path has to be shortened.
		const branch = this.footerData.getGitBranch() ?? undefined;
		const sessionName = this.session.sessionManager.getSessionName();

		// The cumulative cost of the session, shown on the right side of the line.
		// Kimi Coding is subscription-backed despite using API-key authentication.
		const usingSubscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
			: false;
		let costGroup: FooterGroup | undefined;
		if (usageTotals.cost || usingSubscription) {
			costGroup = { text: `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}` };
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const contextBar = formatContextBar(contextPercentValue);
		const contextPercentDisplay =
			contextTokens !== null && contextPercent !== "?"
				? `${contextBar} ${contextPercent}% ${formatExactTokens(contextTokens)} tokens`
				: `${contextBar} ?/${formatExactTokens(contextWindow)} tokens`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		// The context meter and the experimental marker close the line.
		const style = this.nerdFonts ? NERD_FONT_STYLE : PLAIN_STYLE;
		const contextGroup: FooterGroup = { text: contextPercentStr, icon: style.icons.context };
		const extraGroups: FooterGroup[] = [];
		if (areExperimentalFeaturesEnabled()) {
			extraGroups.push({ text: theme.bold(theme.fg("warning", "xp")) });
		}
		if (costGroup && style.icons.cost) {
			costGroup.icon = style.icons.cost;
		}

		// The model name starts the line, followed by the thinking level and the stats.
		const modelName = state.model?.id || "no-model";
		const thinkingLevel = state.thinkingLevel || "off";
		let thinkingGroup: string | undefined;
		if (state.model?.reasoning) {
			thinkingGroup = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
		}
		// A virtual model routes each request; show where the latest response went.
		const routed = this.session.routedModel;
		const routedSuffix = routed ? ` → ${routed.model.id}` : "";
		if (routed?.thinkingLevel && routed.thinkingLevel !== thinkingLevel) {
			thinkingGroup = thinkingGroup ? `${thinkingGroup} → ${routed.thinkingLevel}` : routed.thinkingLevel;
		}

		// The provider comes in front of the model name. The plain model name is the fallback when
		// the provider does not fit.
		const provider = state.model?.provider;
		const modelCandidates = provider
			? [`${provider}/${modelName}${routedSuffix}`, `${modelName}${routedSuffix}`]
			: [`${modelName}${routedSuffix}`];

		const { left, right } = fitFooterLine(
			modelCandidates,
			thinkingGroup,
			contextGroup,
			extraGroups,
			cwd,
			branch,
			sessionName,
			costGroup,
			style,
			width,
		);

		// Dim the groups separately. The left group may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper.
		const gap = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
		const footerLine = right
			? `${theme.fg("dim", left)}${" ".repeat(gap)}${theme.fg("dim", right)}`
			: theme.fg("dim", left);
		const lines = [footerLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
