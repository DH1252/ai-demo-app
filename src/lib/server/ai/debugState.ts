/**
 * In-memory AI debug mode flag.
 *
 * When enabled, every tutor request logs the full system prompt, per-step
 * text/reasoning/tool-call summaries, and final token usage to the server
 * console (stdout).
 *
 * The flag is intentionally NOT persisted — it resets to false on server
 * restart, which is the right behaviour for a dev/diagnostic toggle.
 */
let enabled = false;

export function isAiDebugEnabled(): boolean {
	return enabled;
}

export function setAiDebugEnabled(value: boolean): void {
	enabled = value;
}
