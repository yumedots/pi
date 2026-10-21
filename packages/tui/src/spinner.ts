export const SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_FRAME_INTERVAL_MS = 80;
export function spinnerFrame(
	now: number,
	frames: readonly string[] = SPINNER_FRAMES,
	intervalMs: number = SPINNER_FRAME_INTERVAL_MS,
): string {
	if (frames.length === 0) return "";
	return frames[Math.floor(now / intervalMs) % frames.length]!;
}
