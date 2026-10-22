/**
 * The opencode wire shapes.
 *
 * The opencode clients expect specific field names and envelopes. These mappers are pure
 * functions, so the parity test can compare the produced keys against the opencode schema
 * without starting a server.
 */

import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";

/** The opencode session info. */
export interface OpencodeSessionInfo {
	id: string;
	parentID?: string;
	projectID: string;
	agent: string;
	model: { id: string; providerID: string };
	cost: number;
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cache: { read: number; write: number };
	};
	outcome: "succeeded" | "failed" | "interrupted";
	time: { created: number; updated: number };
	title: string;
	location: { directory: string };
}

/** The session as the server knows it. */
export interface SessionSummary {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	busy: boolean;
}

/** The agent the server exposes. */
export const OPENCODE_AGENT_ID = "build";

/**
 * The project id of a session: the name of the directory that holds the session file.
 */
export function toProjectID(sessionPath: string): string {
	return basename(dirname(sessionPath));
}

/**
 * The model of the last model change of a session.
 */
export function lastModel(entries: readonly SessionEntry[]): { id: string; providerID: string } {
	let model = { id: "", providerID: "" };
	for (const entry of entries) {
		if (entry.type !== "model_change") continue;
		model = { id: entry.modelId, providerID: entry.provider };
	}
	return model;
}

/**
 * The cost and the token usage of a session, summed over its usage entries.
 */
export function usageTotals(entries: readonly SessionEntry[]): {
	cost: number;
	tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
} {
	const totals = { input: 0, output: 0, reasoning: 0, read: 0, write: 0 };
	let cost = 0;
	for (const entry of entries) {
		if (entry.type !== "usage") continue;
		totals.input += entry.usage.input ?? 0;
		totals.output += entry.usage.output ?? 0;
		totals.reasoning += entry.usage.reasoning ?? 0;
		totals.read += entry.usage.cacheRead ?? 0;
		totals.write += entry.usage.cacheWrite ?? 0;
		cost += entry.usage.cost?.total ?? 0;
	}
	return {
		cost,
		tokens: {
			input: totals.input,
			output: totals.output,
			reasoning: totals.reasoning,
			cache: { read: totals.read, write: totals.write },
		},
	};
}

/**
 * Map a session to the opencode session info.
 *
 * The `id` is pi's own session id, exposed verbatim. opencode prefixes its session ids
 * with `ses_`, but the opencode clients treat session ids as opaque strings, so the
 * prefix would buy nothing. This is a deliberate divergence from the opencode schema,
 * which documents the `ses_` pattern but does not require it.
 */
export function toSessionInfo(session: SessionSummary, entries: readonly SessionEntry[] = []): OpencodeSessionInfo {
	const usage = usageTotals(entries);
	const title = session.name && session.name.length > 0 ? session.name : session.firstMessage;
	return {
		id: session.id,
		projectID: toProjectID(session.path),
		agent: OPENCODE_AGENT_ID,
		model: lastModel(entries),
		cost: usage.cost,
		tokens: usage.tokens,
		outcome: session.busy ? "interrupted" : "succeeded",
		time: { created: session.created, updated: session.modified },
		title,
		location: { directory: session.cwd },
	};
}

/** The content of an assistant message, in the opencode shape. */
export interface OpencodeMessageContent {
	type: "text" | "reasoning" | "tool";
	text?: string;
	id?: string;
	name?: string;
	state?: unknown;
}

/** The finish reasons opencode knows. */
export type OpencodeFinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";

/** An opencode message. */
export interface OpencodeMessageInfo {
	id: string;
	time: { created: number; completed?: number };
	type: "user" | "assistant" | "system";
	text?: string;
	agent?: string;
	model?: { id: string; providerID: string };
	content?: OpencodeMessageContent[];
	finish?: OpencodeFinishReason;
	cost?: number;
	tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

/**
 * Map a pi message to the opencode message shape.
 */
export function toMessageInfo(message: AgentMessage, id: string, created: number): OpencodeMessageInfo {
	if (message.role === "user") {
		return {
			id,
			time: { created },
			type: "user",
			text: textOf(message.content),
		};
	}
	if (message.role === "assistant") {
		const content: OpencodeMessageContent[] = [];
		for (const part of message.content) {
			if (part.type === "text") {
				content.push({ type: "text", text: part.text });
				continue;
			}
			if (part.type === "thinking") {
				content.push({ type: "reasoning", text: part.thinking });
				continue;
			}
			if (part.type === "toolCall") {
				content.push({ type: "tool", id: part.id, name: part.name, state: { status: "completed" } });
			}
		}
		const usage = message.usage;
		return {
			id,
			time: { created },
			type: "assistant",
			agent: OPENCODE_AGENT_ID,
			model: { id: message.model, providerID: message.provider },
			content,
			finish: toFinishReason(message.stopReason),
			cost: usage?.cost?.total ?? 0,
			tokens: {
				input: usage?.input ?? 0,
				output: usage?.output ?? 0,
				reasoning: usage?.reasoning ?? 0,
				cache: { read: usage?.cacheRead ?? 0, write: usage?.cacheWrite ?? 0 },
			},
		};
	}
	return {
		id,
		time: { created },
		type: "system",
		text: textOf("content" in message ? message.content : ""),
	};
}

/**
 * The opencode finish reason of a pi stop reason.
 *
 * opencode knows `stop`, `length`, `tool-calls`, `content-filter`, `error` and `unknown`.
 * The pi stop reasons that opencode has no word for become `unknown`.
 */
export function toFinishReason(stopReason: string | undefined): OpencodeFinishReason {
	switch (stopReason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "toolUse":
			return "tool-calls";
		case "error":
			return "error";
		default:
			return "unknown";
	}
}

/**
 * The text of a message content, which is either a string or a list of parts.
 */
export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
			return "";
		})
		.join("");
}

/** An opencode event. */
export interface OpencodeEvent {
	id: string;
	type: string;
	created: number;
	data: unknown;
}

/**
 * Map a pi session event to the opencode event types.
 */
export function toOpencodeEvent(event: AgentSessionEvent, now: number = Date.now()): OpencodeEvent {
	const data = event as unknown as Record<string, unknown>;
	return {
		id: `evt_${randomUUID()}`,
		type: opencodeEventType(event.type, data),
		created: now,
		data: { ...data, sessionID: data.sessionID ?? data.sessionId },
	};
}

/**
 * The opencode event type of a pi event type.
 *
 * @param event The pi event, for the events whose opencode name depends on it.
 */
export function opencodeEventType(piType: string, event?: Record<string, unknown>): string {
	switch (piType) {
		case "turn_start":
		case "agent_start":
			return "session.execution.started";
		case "turn_end":
		case "agent_end":
			return "session.execution.succeeded";
		case "agent_settled":
			return "session.idle";
		case "message_start":
			return "session.text.started";
		case "message_update":
			return "session.text.delta";
		case "message_end":
			return "session.text.ended";
		case "tool_execution_start":
		case "tool_start":
			return "session.tool.input.started";
		case "tool_execution_update":
			return "session.tool.input.delta";
		case "tool_execution_end":
			return event?.isError === true ? "session.tool.failed" : "session.tool.success";
		case "tool_end":
			return "session.tool.input.ended";
		case "tool_call":
			return "session.tool.called";
		case "tool_result":
			return "session.tool.success";
		case "tool_error":
			return "session.tool.failed";
		case "compaction_start":
			return "session.compaction.started";
		case "compaction_end":
			return "session.compaction.ended";
		case "session_info_changed":
			return "session.renamed";
		default:
			return `session.${piType}`;
	}
}

/** An opencode model. */
export interface OpencodeModelInfo {
	id: string;
	modelID: string;
	providerID: string;
	name: string;
	cost: Array<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;
	limit: { context: number; output: number };
	capabilities: { reasoning: boolean; toolCall: boolean; temperature: boolean; attachment: boolean };
}

/**
 * Map a pi model to the opencode model shape.
 */
export function toModelInfo(model: Model<any>): OpencodeModelInfo {
	return {
		id: `${model.provider}/${model.id}`,
		modelID: model.id,
		providerID: model.provider,
		name: model.name,
		cost: [
			{
				input: model.cost?.input ?? 0,
				output: model.cost?.output ?? 0,
				cacheRead: model.cost?.cacheRead ?? 0,
				cacheWrite: model.cost?.cacheWrite ?? 0,
			},
		],
		limit: {
			context: model.contextWindow ?? 0,
			output: model.maxTokens ?? 0,
		},
		capabilities: {
			reasoning: model.reasoning !== false,
			toolCall: true,
			temperature: model.samplingParams?.temperature !== undefined,
			attachment: true,
		},
	};
}

/** An opencode provider. */
export interface OpencodeProviderInfo {
	id: string;
	name: string;
	activation: "auto" | "enabled" | "disabled";
}

/**
 * Map a pi provider to the opencode provider shape.
 */
export function toProviderInfo(provider: { id: string; name: string }): OpencodeProviderInfo {
	return { id: provider.id, name: provider.name, activation: "enabled" };
}

/** An opencode agent. */
export interface OpencodeAgentInfo {
	id: string;
	name: string;
	mode: "subagent" | "primary" | "all";
	description: string;
}

/**
 * The single agent the server exposes.
 */
export function toAgentInfo(): OpencodeAgentInfo {
	return {
		id: OPENCODE_AGENT_ID,
		name: OPENCODE_AGENT_ID,
		mode: "all",
		description: "The default coding agent",
	};
}

/** An opencode command. */
export interface OpencodeCommandInfo {
	name: string;
	description?: string;
}

/**
 * Map a pi command to the opencode command shape.
 */
export function toCommandInfo(command: { name: string; description?: string }): OpencodeCommandInfo {
	return { name: command.name, description: command.description };
}
