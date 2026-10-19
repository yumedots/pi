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

/** Separator between the cwd group and the stats group on the footer line. */
const GROUP_SEPARATOR = " • ";
/** Minimum spaces between the left group and the right-aligned model info. */
const MIN_PADDING = 2;

/**
 * Shorten a path from the left so the tail (the project folder) stays visible.
 */
function truncateCwd(cwd: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(cwd) <= maxWidth) return cwd;
	const segments = cwd.split(/[/\\]/).filter((segment) => segment.length > 0);
	for (let i = 1; i < segments.length; i++) {
		const candidate = `…/${segments.slice(i).join("/")}`;
		if (visibleWidth(candidate) <= maxWidth) return candidate;
	}
	return truncateToWidth(cwd, maxWidth, "…");
}

interface FooterFit {
	left: string;
	right: string;
}

/**
 * Fit the footer parts on one line.
 *
 * Shrink order: drop the detail stats (token counts, cache, cost) one by one, then shorten the
 * cwd from the left so its tail stays visible, then drop the cwd, then shorten the model info.
 * The context percentage keeps its content as long as possible.
 */
function fitFooterLine(
	cwd: string,
	cwdSuffixes: string[],
	detailParts: string[],
	coreParts: string[],
	rightCandidates: string[],
	width: number,
): FooterFit {
	let best: FooterFit = { left: "", right: "" };
	for (const right of rightCandidates) {
		const fit = fitFooterLineWithRight(cwd, cwdSuffixes, detailParts, coreParts, right, width);
		best = fit;
		// The model info was cut, try the shorter candidate before giving up on it.
		if (!fit.truncated) break;
	}
	return best;
}

function fitFooterLineWithRight(
	cwd: string,
	cwdSuffixes: string[],
	detailParts: string[],
	coreParts: string[],
	right: string,
	width: number,
): FooterFit & { truncated: boolean } {
	const core = coreParts.join(" ");
	const rightWidth = visibleWidth(right);
	const details = [...detailParts];
	const suffixes = [...cwdSuffixes];

	const buildLeft = (path: string): string => {
		const cwdGroup = [path, ...suffixes].filter((part) => part.length > 0).join(" ");
		const stats = [...details, core].filter((part) => part.length > 0).join(" ");
		if (!cwdGroup) return stats;
		return stats ? `${cwdGroup}${GROUP_SEPARATOR}${stats}` : cwdGroup;
	};

	const fits = (left: string): boolean => visibleWidth(left) + MIN_PADDING + rightWidth <= width;

	let path = cwd;
	let left = buildLeft(path);

	// Drop the detail stats until the line fits.
	while (details.length > 0 && !fits(left)) {
		details.shift();
		left = buildLeft(path);
	}

	// Shorten the cwd from the left so the project folder stays visible.
	if (!fits(left)) {
		const stats = [...details, core].filter((part) => part.length > 0).join(" ");
		const statsWidth = stats ? visibleWidth(GROUP_SEPARATOR) + visibleWidth(stats) : 0;
		const suffixWidth = visibleWidth(suffixes.join(" "));
		path = truncateCwd(cwd, width - MIN_PADDING - rightWidth - statsWidth - suffixWidth - 1);
		left = buildLeft(path);
	}

	// Drop the cwd, then the branch and session name, before cutting the model info.
	if (!fits(left)) {
		path = "";
		left = buildLeft(path);
	}
	if (!fits(left)) {
		suffixes.length = 0;
		left = buildLeft(path);
	}

	// Shorten the model info.
	let fittedRight = right;
	let truncated = false;
	if (!fits(left)) {
		truncated = true;
		const available = width - visibleWidth(left) - MIN_PADDING;
		fittedRight = available > 0 ? truncateToWidth(right, available, "") : "";
	}

	// The stats alone do not fit either.
	if (visibleWidth(left) > width) {
		left = truncateToWidth(left, width, "…");
	}

	return { left, right: fittedRight, truncated };
}

interface SessionStats {
	session: AgentSession;
	sessionId: string;
	leafId: string | null;
	entryCount: number;
	limitsModel: unknown;
	usageTotals: UsageTotals;
	latestCacheHitRate: number | undefined;
	contextUsage: ContextUsage | undefined;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
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

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
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
		let latestCacheHitRate: number | undefined;

		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "usage") {
				addUsageToTotals(usageTotals, entry.usage);
			} else if (entry.type === "message" && entry.message.role === "assistant") {
				addUsageToTotals(usageTotals, entry.message.usage);

				const latestPromptTokens =
					entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
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
			latestCacheHitRate,
			contextUsage,
		};
		return this.sessionStats;
	}

	render(width: number): string[] {
		const state = this.session.state;
		const { usageTotals, latestCacheHitRate, contextUsage } = this.getSessionStats();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		// Git branch and session name stay visible when the path has to be shortened.
		const cwdSuffixes: string[] = [];
		const branch = this.footerData.getGitBranch();
		if (branch) {
			cwdSuffixes.push(`(${branch})`);
		}
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			cwdSuffixes.push(`• ${sessionName}`);
		}

		// Detail stats, dropped from the front when the line does not fit.
		const detailParts: string[] = [];
		if (usageTotals.input) detailParts.push(`↑${formatTokens(usageTotals.input)}`);
		if (usageTotals.output) detailParts.push(`↓${formatTokens(usageTotals.output)}`);
		if (usageTotals.cacheRead) detailParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
		if (usageTotals.cacheWrite) detailParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
		if ((usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
			detailParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
		}

		// Kimi Coding is subscription-backed despite using API-key authentication.
		const usingSubscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
			: false;
		if (usageTotals.cost || usingSubscription) {
			const costStr = `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			detailParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		const coreParts = [contextPercentStr];
		if (areExperimentalFeaturesEnabled()) {
			coreParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		// A virtual model routes each request; show where the latest response went.
		const routed = this.session.routedModel;
		if (routed) {
			const level = routed.thinkingLevel ? ` • ${routed.thinkingLevel}` : "";
			rightSideWithoutProvider += ` → ${routed.model.id}${level}`;
		}

		// The provider is only shown when several providers are available. The plain model name is
		// the fallback when the provider prefix does not fit.
		const rightCandidates =
			this.footerData.getAvailableProviderCount() > 1 && state.model
				? [`(${state.model.provider}) ${rightSideWithoutProvider}`, rightSideWithoutProvider]
				: [rightSideWithoutProvider];

		const { left, right } = fitFooterLine(cwd, cwdSuffixes, detailParts, coreParts, rightCandidates, width);

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
