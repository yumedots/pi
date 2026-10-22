/**
 * The session entries of the client.
 *
 * The session tree belongs to the server: it writes the entries and it keeps them.
 * The client draws them, so it needs their shape, and it needs the path of the
 * entries that make up the context of the session.
 *
 * The types are type-only imports: they are erased before the runtime sees them,
 * so the client never loads the module that declares them.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "./messages.ts";

export type { SessionStats } from "@earendil-works/pi-coding-agent/core/agent-session";
export type {
	CompactionEntry,
	ContextEditEntry,
	CustomEntry,
	CustomMessageEntry,
	FileEntry,
	LabelEntry,
	ModelChangeEntry,
	SessionEntry,
	SessionEntryBase,
	SessionInfo,
	SessionInfoEntry,
	SessionMessageEntry,
	SessionTreeNode,
	ThinkingLevelChangeEntry,
	UsageEntry,
} from "@earendil-works/pi-coding-agent/core/session-manager";

/**
 * The messages of a session entry.
 *
 * The client draws the entries of the session, and it draws them as the messages
 * they are: an entry of a message is that message, an entry of a summary is the
 * message of the summary.
 */
export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "system" && message.content == null) return [{ ...message, content: "" }];
		if (
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
			message.content == null
		) {
			return [{ ...message, content: [] }];
		}
		return [message];
	}
	if (entry.type === "custom_message") {
		return [
			createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
		];
	}
	if (entry.type === "branch_summary" && entry.summary) {
		return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
	}
	if (entry.type === "compaction") {
		const summary = createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
		return entry.systemMessage ? [entry.systemMessage, summary] : [summary];
	}
	return [];
}

/**
 * The entries of the session on the path from the root to the leaf.
 */
function buildSessionPath(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const index = byId ?? new Map(entries.map((entry) => [entry.id, entry]));
	let leaf: SessionEntry | undefined;
	if (leafId === null) {
		return [];
	}
	if (leafId) {
		leaf = index.get(leafId);
	}
	leaf ??= entries[entries.length - 1];
	if (!leaf) {
		return [];
	}

	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.push(current);
		current = current.parentId ? index.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}

/**
 * The entries that make up the context of the session.
 *
 * A compaction keeps the summary and the entries that came after it, so the
 * context is the path from the root to the leaf with the entries before the
 * compaction dropped.
 */
export function buildContextEntries(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const path = buildSessionPath(entries, leafId, byId);
	let compaction: SessionEntry | undefined;

	for (const entry of path) {
		if (entry.type === "compaction") {
			compaction = entry;
		}
	}

	if (!compaction) {
		return path;
	}
	const compactionIdx = path.findIndex((entry) => entry.id === compaction?.id);
	if (compactionIdx < 0) {
		return path;
	}

	const contextEntries: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIdx; i++) {
		const entry = path[i];
		if (entry.id === (compaction as { firstKeptEntryId?: string }).firstKeptEntryId) {
			foundFirstKept = true;
		}
		if (foundFirstKept && !(entry.type === "message" && entry.message.role === "system")) {
			contextEntries.push(entry);
		}
	}
	contextEntries.push(...path.slice(compactionIdx + 1));
	return contextEntries;
}
