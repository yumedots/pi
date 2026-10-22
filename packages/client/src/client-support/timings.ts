/**
 * The timings of the startup.
 *
 * The client starts a server, opens a session and draws the first frame, and the whole
 * boot is what the user waits for. The timings say where the time goes.
 *
 * Enable with `PI_TIMING=1`.
 */

const ENABLED = process.env.PI_TIMING === "1";

/** One step of the startup. */
interface Timing {
	label: string;
	ms: number;
}

const timings: Timing[] = [];
let lastTime = Date.now();

/** Forget the timings of an earlier start. */
export function resetTimings(): void {
	timings.length = 0;
	lastTime = Date.now();
}

/** Record the time since the step before. */
export function time(label: string): void {
	if (!ENABLED) return;
	const now = Date.now();
	timings.push({ label, ms: now - lastTime });
	lastTime = now;
}

/** Print the timings, when the user asked for them. */
export function printTimings(): void {
	if (!ENABLED || timings.length === 0) return;
	console.error(`\n--- Startup timings ---`);
	for (const timing of timings) {
		console.error(`  ${timing.label}: ${timing.ms}ms`);
	}
	console.error(`  TOTAL: ${timings.reduce((total, timing) => total + timing.ms, 0)}ms`);
	console.error(`${"-".repeat(24)}\n`);
}
