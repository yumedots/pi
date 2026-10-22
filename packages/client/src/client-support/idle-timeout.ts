/**
 * The idle timeout of the server, as the user reads it.
 *
 * The timeout belongs to the server, the label belongs to the client.
 */

/** The choices the server offers for the idle timeout. */
const SERVER_IDLE_TIMEOUT_CHOICES = [
	{ label: "5m", timeoutMs: 300_000 },
	{ label: "10m", timeoutMs: 600_000 },
	{ label: "30m", timeoutMs: 1_800_000 },
	{ label: "1h", timeoutMs: 3_600_000 },
	{ label: "never", timeoutMs: 0 },
] as const;

/**
 * The label of an idle timeout.
 */
export function formatServerIdleTimeout(timeoutMs: number): string {
	const choice = SERVER_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs);
	if (choice) return choice.label;
	return `${Math.round(timeoutMs / 1000)}s`;
}
