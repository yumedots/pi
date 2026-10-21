/**
 * The event probe: an extension that records every event it is handed.
 *
 * Every category pi publishes is subscribed to, and each event is appended to
 * the file named by `PI_PROBE_LOG` as one JSON line: the event's category and
 * the keys its payload carries. The line is the evidence the parity check
 * compares: the categories that fire, their order, and their payload shape.
 *
 * The category list is pi's own (`core/extensions/types.ts`, the `on()`
 * overloads): 41 categories.
 */

import { appendFileSync } from "node:fs";

const CATEGORIES = [
	"project_trust",
	"resources_discover",
	"session_start",
	"session_info_changed",
	"session_before_switch",
	"session_before_fork",
	"session_before_compact",
	"session_compact",
	"session_compact_failed",
	"session_shutdown",
	"mcp_servers_change",
	"session_before_tree",
	"session_tree",
	"context",
	"context_with_system",
	"cache_warming_decision",
	"before_provider_request",
	"before_provider_headers",
	"after_provider_response",
	"provider_stream_event",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"agent_before_settle",
	"agent_settled",
	"ui_prompt_start",
	"ui_prompt_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"model_select",
	"thinking_level_select",
	"tool_call",
	"tool_result",
	"user_bash",
	"input",
];

export default function probe(pi: { on: (event: string, handler: (event: unknown) => void) => void }) {
	const log = process.env.PI_PROBE_LOG;
	if (!log) throw new Error("PI_PROBE_LOG is not set");
	for (const category of CATEGORIES) {
		pi.on(category, (event: unknown) => {
			const keys =
				event && typeof event === "object" ? Object.keys(event as object).sort() : [];
			appendFileSync(log, `${JSON.stringify({ category, keys })}\n`);
		});
	}
}
