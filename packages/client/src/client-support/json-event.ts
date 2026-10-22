/**
 * The events of a session, in the shape the json protocols use.
 *
 * The client draws the session and hands the events on as they are. The json and the
 * rpc protocols of the coding agent put them in a shape of their own, so the client
 * maps them the same way.
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";

type WithoutPartial<T> = T extends { partial: unknown } ? Omit<T, "partial"> : T;

type ToJsonAssistantMessageEvent<T> = T extends { type: "toolcall_start"; partial: unknown }
	? WithoutPartial<T> & { id: string; toolName: string }
	: WithoutPartial<T>;

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;

type JsonMessageUpdateEvent = {
	type: "message_update";
	usage: unknown;
	assistantMessageEvent: ToJsonAssistantMessageEvent<MessageUpdateEvent["assistantMessageEvent"]>;
};

/** The event of a session, in the shape the json protocols use. */
export type JsonAgentSessionEvent = Exclude<AgentSessionEvent, { type: "message_update" }> | JsonMessageUpdateEvent;

/**
 * The assistant message event of an update, in the shape the json protocols use.
 */
function toJsonAssistantMessageEvent(
	event: MessageUpdateEvent["assistantMessageEvent"],
): JsonMessageUpdateEvent["assistantMessageEvent"] {
	if (event.type === "toolcall_start") {
		const toolCall = event.partial.content[event.contentIndex];
		if (toolCall?.type !== "toolCall") {
			throw new Error(`toolcall_start content at index ${event.contentIndex} is not a tool call`);
		}
		const { partial: _partial, ...deltaEvent } = event;
		return { ...deltaEvent, id: toolCall.id, toolName: toolCall.name };
	}

	if (!("partial" in event)) {
		return event;
	}

	const { partial: _partial, ...deltaEvent } = event;
	return deltaEvent;
}

/**
 * The event of a session, in the shape the json protocols use.
 */
export function toJsonEvent(event: AgentSessionEvent): JsonAgentSessionEvent {
	if (event.type !== "message_update") {
		return event;
	}
	if (event.message.role !== "assistant") {
		throw new Error("message_update message is not an assistant message");
	}

	return {
		type: "message_update",
		usage: event.message.usage,
		assistantMessageEvent: toJsonAssistantMessageEvent(event.assistantMessageEvent),
	};
}
