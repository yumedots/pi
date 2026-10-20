import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface TpsEntry {
	text: string;
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
	if (!message || typeof message !== "object") return false;
	const role = (message as { role?: unknown }).role;
	return role === "assistant";
}

/** Duration as `4.2s` below a minute, then `16m 9s` and `2h 3m 4s`. */
function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

export default function (pi: ExtensionAPI) {
	let agentStartMs: number | null = null;

	// The line is a transcript entry, not a status line. Status lines are replaced by the next
	// status message, so the summary of a turn would vanish on the next one.
	pi.registerEntryRenderer<TpsEntry>("tps", (entry, options, theme) => {
		const text = entry.data?.text;
		if (!text) return undefined;
		return new Text(theme.fg("dim", text), 1, 0);
	});

	pi.on("agent_start", () => {
		agentStartMs = Date.now();
	});

	pi.on("agent_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (agentStartMs === null) return;

		const elapsedMs = Date.now() - agentStartMs;
		agentStartMs = null;
		if (elapsedMs <= 0) return;

		let output = 0;
		for (const message of event.messages) {
			if (!isAssistantMessage(message)) continue;
			output += message.usage.output || 0;
		}
		if (output <= 0) return;

		const elapsedSeconds = elapsedMs / 1000;
		const tokensPerSecond = output / elapsedSeconds;
		const modelName = ctx.model?.name || ctx.model?.id || "model";
		const speed = `${tokensPerSecond.toFixed(1)} tok/s`;
		pi.appendEntry<TpsEntry>("tps", {
			text: `${modelName}  ${speed}  ${formatDuration(elapsedMs)}`,
		});
	});
}
