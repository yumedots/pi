import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import * as os from "node:os";
import {
	type Component,
	Container,
	getKeybindings,
	Input,
	SelectList,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { SessionInfo, SessionListProgress } from "../../../core/session-manager.ts";
import { canonicalizePath as _canonicalizePath } from "../../../utils/paths.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";
import { DEFAULT_MAX_VISIBLE, MenuComponent, type MenuItem } from "./menu.ts";
import { filterAndSortSessions, hasSessionName, type NameFilter, type SortMode } from "./session-selector-search.ts";
import { ThemedText } from "./themed-text.ts";

type SessionScope = "current" | "all";

interface SessionTreeNode {
	session: SessionInfo;
	children: SessionTreeNode[];
	latestActivity: number;
}

interface FlatSessionNode {
	session: SessionInfo;
	depth: number;
	isLast: boolean;
	ancestorContinues: boolean[];
}

function shortenPath(path: string): string {
	const home = os.homedir();
	if (!path) return path;
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

function formatSessionDate(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "now";
	if (diffMins < 60) return `${diffMins}m`;
	if (diffHours < 24) return `${diffHours}h`;
	if (diffDays < 7) return `${diffDays}d`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
	return `${Math.floor(diffDays / 365)}y`;
}

function canonicalizePath(path: string | undefined): string | undefined {
	if (!path) return path;
	return _canonicalizePath(path);
}

/** Build a tree structure from sessions based on parentSessionPath. */
function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
	const byPath = new Map<string, SessionTreeNode>();

	for (const session of sessions) {
		const sessionPath = canonicalizePath(session.path) ?? session.path;
		byPath.set(sessionPath, { session, children: [], latestActivity: session.modified.getTime() });
	}

	const roots: SessionTreeNode[] = [];

	for (const session of sessions) {
		const sessionPath = canonicalizePath(session.path) ?? session.path;
		const node = byPath.get(sessionPath)!;
		const parentPath = canonicalizePath(session.parentSessionPath);

		if (parentPath && byPath.has(parentPath)) {
			byPath.get(parentPath)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const updateLatestActivity = (node: SessionTreeNode): number => {
		let latestActivity = node.session.modified.getTime();
		for (const child of node.children) {
			latestActivity = Math.max(latestActivity, updateLatestActivity(child));
		}
		node.latestActivity = latestActivity;
		return latestActivity;
	};

	for (const root of roots) {
		updateLatestActivity(root);
	}

	const sortNodes = (nodes: SessionTreeNode[]): void => {
		nodes.sort((a, b) => b.latestActivity - a.latestActivity);
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);

	return roots;
}

/** Flatten tree into display list with tree structure info. */
function flattenSessionTree(roots: SessionTreeNode[]): FlatSessionNode[] {
	const result: FlatSessionNode[] = [];

	const walk = (node: SessionTreeNode, depth: number, ancestorContinues: boolean[], isLast: boolean): void => {
		result.push({ session: node.session, depth, isLast, ancestorContinues });

		for (let i = 0; i < node.children.length; i++) {
			const childIsLast = i === node.children.length - 1;
			const continues = depth > 0 ? !isLast : false;
			walk(node.children[i]!, depth + 1, [...ancestorContinues, continues], childIsLast);
		}
	};

	for (let i = 0; i < roots.length; i++) {
		walk(roots[i]!, 0, [], i === roots.length - 1);
	}

	return result;
}

function treePrefix(node: FlatSessionNode): string {
	if (node.depth === 0) return "";
	const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
	const branch = node.isLast ? "└─ " : "├─ ";
	return parts.join("") + branch;
}

/** Delete a session file, trying the `trash` CLI first, then falling back to unlink. */
async function deleteSessionFile(
	sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

	const getTrashErrorHint = (): string | null => {
		const parts: string[] = [];
		if (trashResult.error) {
			parts.push(trashResult.error.message);
		}
		const stderr = trashResult.stderr?.trim();
		if (stderr) {
			parts.push(stderr.split("\n")[0] ?? stderr);
		}
		if (parts.length === 0) return null;
		return `trash: ${parts.join(" · ").slice(0, 200)}`;
	};

	if (trashResult.status === 0 || !existsSync(sessionPath)) {
		return { ok: true, method: "trash" };
	}

	try {
		await unlink(sessionPath);
		return { ok: true, method: "unlink" };
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint();
		const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
		return { ok: false, method: "unlink", error };
	}
}

export interface SessionMenuOptions {
	/** Loads sessions for the current project folder. */
	currentLoad: (onProgress?: SessionListProgress, signal?: AbortSignal) => Promise<SessionInfo[]>;
	/** Loads sessions across all project folders. */
	allLoad: (onProgress?: SessionListProgress, signal?: AbortSignal) => Promise<SessionInfo[]>;
	onSelect: (session: SessionInfo) => void;
	onCancel: () => void;
	onRequestRender?: () => void;
	/** Renames a session. Omit to disable renaming. */
	renameSession?: (sessionPath: string, nextName: string | undefined) => Promise<void>;
	/** Path of the currently active session, which cannot be deleted. */
	currentSessionPath?: string;
	/** Floats the menu above its box, so it does not move the chat. */
	floating?: boolean;
}

/** Session picker. Sessions load asynchronously. */
export class SessionMenuComponent extends MenuComponent<SessionInfo> {
	private abortController = new AbortController();
	private scope: SessionScope = "current";
	private sortMode: SortMode = "threaded";
	private nameFilter: NameFilter = "all";
	private showPath = false;
	private currentSessions: SessionInfo[] | null = null;
	private allSessions: SessionInfo[] | null = null;
	private confirmingDeletePath: string | null = null;
	private mode: "list" | "rename" = "list";
	private renameInput = new Input();
	private renameTargetPath: string | null = null;
	private readonly sessionOptions: SessionMenuOptions;

	constructor(options: SessionMenuOptions) {
		super(
			{ title: "Sessions", loadingText: "Loading sessions...", floating: options.floating },
			options.onSelect,
			options.onCancel,
		);
		this.sessionOptions = options;
		void this.loadScope("current");
	}

	protected override createList(): SelectList {
		return new SelectList([], DEFAULT_MAX_VISIBLE, getSelectListTheme(), {
			renderItem: (row, selected, width) => this.drawRow(this.itemOf(row), selected, width),
		});
	}

	/** Draws a session row: the tree prefix and the title on the left, the metadata on the right. */
	private drawRow(item: MenuItem<SessionInfo>, selected: boolean, width: number): string {
		const session = item.value;
		const isCurrent = session.path === this.sessionOptions.currentSessionPath;
		const prefix = item.description ?? "";
		const displayText = (session.name ?? session.firstMessage).replace(/[\x00-\x1f\x7f]/g, " ").trim();

		const age = formatSessionDate(session.modified);
		let rightPart = `${session.messageCount} ${age}`;
		if (this.showPath && session.path) {
			rightPart = `${shortenPath(session.path)} ${rightPart}`;
		} else if (this.scope === "all" && session.cwd) {
			rightPart = `${shortenPath(session.cwd)} ${rightPart}`;
		}

		const cursor = selected ? theme.fg("accent", "→ ") : "  ";
		const rightWidth = visibleWidth(rightPart);
		// Reserve room for the tree prefix, the cursor, the gap and the right-aligned metadata.
		const available = Math.max(10, width - visibleWidth(prefix) - rightWidth - 4);

		const truncated = truncateToWidth(displayText || session.id, available, "…");
		let styled = isCurrent
			? theme.fg("accent", truncated)
			: hasSessionName(session)
				? theme.fg("warning", truncated)
				: theme.fg("text", truncated);
		if (selected) {
			styled = theme.bold(styled);
		}

		const leftPart = `${cursor}${theme.fg("dim", prefix)}${styled}`;
		const spacing = Math.max(1, width - visibleWidth(leftPart) - rightWidth);
		return `${leftPart}${" ".repeat(spacing)}${theme.fg("dim", rightPart)}`;
	}

	protected override buildContent(): Component {
		if (this.mode === "rename") {
			return this.buildRenameContent();
		}
		return super.buildContent();
	}

	private buildRenameContent(): Component {
		const content = new Container();
		content.addChild(new ThemedText(() => theme.bold(theme.fg("text", "  Rename Session")), 0, 0));
		content.addChild(new Text("", 0, 0));
		content.addChild(this.renameInput);
		content.addChild(new Text("", 0, 0));
		content.addChild(
			new ThemedText(
				() =>
					theme.fg(
						"dim",
						`  ${keyHint("tui.select.confirm", "save")} · ${keyHint("tui.select.cancel", "cancel")}`,
					),
				0,
				0,
			),
		);
		return content;
	}

	override handleInput(keyData: string): void {
		if (this.mode === "rename") {
			const kb = getKeybindings();
			if (kb.matches(keyData, "tui.select.cancel")) {
				this.exitRenameMode();
				return;
			}
			if (kb.matches(keyData, "tui.select.confirm")) {
				const path = this.renameTargetPath;
				const nextName = this.renameInput.getValue();
				this.exitRenameMode();
				if (path && this.sessionOptions.renameSession) {
					void this.sessionOptions.renameSession(path, nextName);
				}
				return;
			}
			this.renameInput.handleInput(keyData);
			return;
		}
		super.handleInput(keyData);
	}

	protected override hintLine(): string {
		if (this.confirmingDeletePath) {
			return theme.fg(
				"error",
				`  Delete session? ${keyHint("tui.select.confirm", "confirm")} · ${keyHint("tui.select.cancel", "cancel")}`,
			);
		}
		const sep = theme.fg("muted", " · ");
		const pathState = this.showPath ? "(on)" : "(off)";
		const scopeLabel = this.scope === "current" ? "current" : "all";
		const hint1 =
			keyHint("tui.input.tab", `scope: ${scopeLabel}`) +
			sep +
			theme.fg("muted", 're:<pattern> regex · "phrase" exact');
		const hint2Parts = [
			keyHint("app.session.toggleSort", "sort"),
			keyHint("app.session.toggleNamedFilter", "named"),
			keyHint("app.session.delete", "delete"),
			keyHint("app.session.togglePath", `path ${pathState}`),
		];
		if (this.sessionOptions.renameSession) {
			hint2Parts.push(keyHint("app.session.rename", "rename"));
		}
		return `${theme.fg("dim", `  ${hint1}`)}\n${theme.fg("dim", `  ${hint2Parts.join(sep)}`)}`;
	}

	protected override handleExtraKey(keyData: string): boolean {
		const kb = getKeybindings();

		// Delete confirmation captures all keys until confirmed or cancelled.
		if (this.confirmingDeletePath) {
			if (kb.matches(keyData, "tui.select.confirm")) {
				const pathToDelete = this.confirmingDeletePath;
				this.confirmingDeletePath = null;
				void this.deleteSession(pathToDelete);
				return true;
			}
			if (kb.matches(keyData, "tui.select.cancel")) {
				this.confirmingDeletePath = null;
				this.renderContent();
				return true;
			}
			return true;
		}

		if (kb.matches(keyData, "tui.input.tab")) {
			void this.loadScope(this.scope === "current" ? "all" : "current");
			this.sessionOptions.onRequestRender?.();
			return true;
		}

		if (kb.matches(keyData, "app.session.toggleSort")) {
			this.sortMode =
				this.sortMode === "threaded" ? "recent" : this.sortMode === "recent" ? "relevance" : "threaded";
			this.refreshItems();
			return true;
		}

		if (kb.matches(keyData, "app.session.toggleNamedFilter")) {
			this.nameFilter = this.nameFilter === "all" ? "named" : "all";
			this.refreshItems();
			return true;
		}

		if (kb.matches(keyData, "app.session.togglePath")) {
			this.showPath = !this.showPath;
			this.renderContent();
			return true;
		}

		if (kb.matches(keyData, "app.session.rename")) {
			const selected = this.getSelectedValue();
			if (selected && this.sessionOptions.renameSession) {
				this.enterRenameMode(selected.path, selected.name);
			}
			return true;
		}

		if (kb.matches(keyData, "app.session.delete")) {
			this.startDeleteConfirmation();
			return true;
		}

		if (kb.matches(keyData, "app.session.deleteNoninvasive")) {
			if (this.searchInput.getValue().length > 0) {
				return false;
			}
			this.startDeleteConfirmation();
			return true;
		}

		return false;
	}

	private enterRenameMode(sessionPath: string, currentName: string | undefined): void {
		this.mode = "rename";
		this.renameTargetPath = sessionPath;
		this.renameInput.setValue(currentName ?? "");
		this.renameInput.focused = true;
		this.renderContent();
		this.sessionOptions.onRequestRender?.();
	}

	private exitRenameMode(): void {
		this.mode = "list";
		this.renameTargetPath = null;
		this.renderContent();
		this.sessionOptions.onRequestRender?.();
	}

	private startDeleteConfirmation(): void {
		const selected = this.getSelectedValue();
		if (!selected) return;
		if (selected.path === this.sessionOptions.currentSessionPath) {
			this.setFooterText("Cannot delete the currently active session");
			return;
		}
		this.confirmingDeletePath = selected.path;
		this.renderContent();
	}

	private async deleteSession(sessionPath: string): Promise<void> {
		const result = await deleteSessionFile(sessionPath);
		if (result.ok) {
			this.currentSessions = this.currentSessions?.filter((s) => s.path !== sessionPath) ?? null;
			this.allSessions = this.allSessions?.filter((s) => s.path !== sessionPath) ?? null;
			this.refreshItems();
			this.setFooterText(result.method === "trash" ? "Session moved to trash" : "Session deleted");
		} else {
			this.setFooterText(`Failed to delete: ${result.error ?? "Unknown error"}`);
		}
		this.sessionOptions.onRequestRender?.();
	}

	private async loadScope(scope: SessionScope): Promise<void> {
		this.scope = scope;
		this.setLoading(true);
		this.sessionOptions.onRequestRender?.();
		const loader = scope === "current" ? this.sessionOptions.currentLoad : this.sessionOptions.allLoad;
		const store = (sessions: SessionInfo[]): void => {
			if (scope === "current") {
				this.currentSessions = sessions;
			} else {
				this.allSessions = sessions;
			}
		};
		try {
			const sessions = await loader((loaded, total, partial) => {
				if (this.abortController.signal.aborted || !partial) return;
				store([...partial]);
				this.refreshItems();
				this.setFooterText(`loaded ${loaded} of ${total}`);
				this.sessionOptions.onRequestRender?.();
			}, this.abortController.signal);
			if (this.abortController.signal.aborted) return;
			store(sessions);
			this.refreshItems();
			this.setFooterText(undefined);
		} catch {
			if (this.abortController.signal.aborted) return;
			this.setItems([]);
		}
		this.sessionOptions.onRequestRender?.();
	}

	private refreshItems(): void {
		const sessions = this.scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
		const query = this.searchInput.getValue();
		const nameFiltered = this.nameFilter === "all" ? sessions : sessions.filter((session) => hasSessionName(session));

		let entries: MenuItem<SessionInfo>[];
		if (this.sortMode === "threaded" && !query.trim()) {
			const roots = buildSessionTree(nameFiltered);
			entries = flattenSessionTree(roots).map((node) => ({
				title: node.session.name ?? node.session.firstMessage,
				description: treePrefix(node),
				value: node.session,
			}));
		} else {
			const filtered = filterAndSortSessions(nameFiltered, query, this.sortMode, "all");
			entries = filtered.map((session) => ({
				title: session.name ?? session.firstMessage,
				value: session,
			}));
		}
		this.setItems(entries);
	}

	protected override applyFilter(_query: string): void {
		// Matches the full session text and supports re:<pattern> regex and "phrase" exact matching.
		this.refreshItems();
	}

	dispose(): void {
		this.abortController.abort();
	}
}
