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
const adminVideoRequestLog = new Map<string, number[]>();
let activeAdminVideoJobs = 0;

const ADMIN_VIDEO_RATE_LIMIT = 3;
const ADMIN_VIDEO_RATE_WINDOW_MS = 10 * 60_000;
const MAX_CONCURRENT_ADMIN_VIDEO_JOBS = 1;

export function isAiDebugEnabled(): boolean {
	return enabled;
}

export function setAiDebugEnabled(value: boolean): void {
	enabled = value;
}

export function isAdminVideoRateLimited(clientKey: string): boolean {
	const now = Date.now();
	const windowStart = now - ADMIN_VIDEO_RATE_WINDOW_MS;
	const timestamps = (adminVideoRequestLog.get(clientKey) ?? []).filter(
		(value) => value > windowStart
	);

	if (timestamps.length >= ADMIN_VIDEO_RATE_LIMIT) {
		adminVideoRequestLog.set(clientKey, timestamps);
		return true;
	}

	timestamps.push(now);
	adminVideoRequestLog.set(clientKey, timestamps);
	return false;
}

export function tryStartAdminVideoJob(): boolean {
	if (activeAdminVideoJobs >= MAX_CONCURRENT_ADMIN_VIDEO_JOBS) {
		return false;
	}

	activeAdminVideoJobs += 1;
	return true;
}

export function finishAdminVideoJob(): void {
	activeAdminVideoJobs = Math.max(0, activeAdminVideoJobs - 1);
}
