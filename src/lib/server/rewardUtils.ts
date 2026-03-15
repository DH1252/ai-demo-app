const MAX_HEARTS = 5;
const REGEN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes per heart

/**
 * Pure function — computes passive heart regeneration.
 * Adds 1 heart per 30-minute interval elapsed since `heartsLastUpdated`.
 * Returns the new hearts value, an updated timestamp, and whether anything changed.
 */
export function computeRegenHearts(
	hearts: number,
	heartsLastUpdated: string | null,
	nowMs: number = Date.now()
): { hearts: number; heartsLastUpdated: string; changed: boolean } {
	// Already full — nothing to regen.
	if (hearts >= MAX_HEARTS) {
		return {
			hearts: MAX_HEARTS,
			heartsLastUpdated: heartsLastUpdated ?? new Date(nowMs).toISOString(),
			changed: false
		};
	}

	// No timestamp recorded yet — treat as "just set" without adding hearts
	// (this is a fresh account or pre-migration row).
	if (!heartsLastUpdated) {
		return { hearts, heartsLastUpdated: new Date(nowMs).toISOString(), changed: false };
	}

	const lastMs = new Date(heartsLastUpdated).getTime();
	if (isNaN(lastMs)) {
		return { hearts, heartsLastUpdated: new Date(nowMs).toISOString(), changed: false };
	}

	const elapsed = nowMs - lastMs;
	const intervalsElapsed = Math.floor(elapsed / REGEN_INTERVAL_MS);

	if (intervalsElapsed <= 0) {
		return { hearts, heartsLastUpdated, changed: false };
	}

	const newHearts = Math.min(MAX_HEARTS, hearts + intervalsElapsed);
	// Advance the timestamp by the exact number of intervals consumed so
	// fractional time carries forward correctly.
	const newLastUpdated = new Date(lastMs + intervalsElapsed * REGEN_INTERVAL_MS).toISOString();

	return { hearts: newHearts, heartsLastUpdated: newLastUpdated, changed: true };
}

/**
 * Returns the number of milliseconds until the next heart regen tick.
 * Returns 0 if hearts are already full.
 */
export function msUntilNextHeart(
	hearts: number,
	heartsLastUpdated: string | null,
	nowMs: number = Date.now()
): number {
	if (hearts >= MAX_HEARTS) return 0;
	if (!heartsLastUpdated) return REGEN_INTERVAL_MS;

	const lastMs = new Date(heartsLastUpdated).getTime();
	if (isNaN(lastMs)) return REGEN_INTERVAL_MS;

	const elapsed = nowMs - lastMs;
	const remainder = REGEN_INTERVAL_MS - (elapsed % REGEN_INTERVAL_MS);
	return remainder > 0 ? remainder : REGEN_INTERVAL_MS;
}

/**
 * Pure function — computes whether completing a lesson today advances the streak.
 *
 * Rules:
 *   - No prior date            → streak = 1, gained = true
 *   - Same calendar day        → unchanged, gained = false
 *   - Yesterday (UTC)          → streak + 1, gained = true
 *   - Gap > 1 day              → streak reset to 1, gained = true
 */
export function computeStreak(
	currentStreak: number,
	lastActiveDateIso: string | null,
	todayIso: string // YYYY-MM-DD
): { newStreak: number; gained: boolean } {
	if (!lastActiveDateIso) {
		return { newStreak: 1, gained: true };
	}

	// Normalise: take just the date portion so time-of-day differences don't matter.
	const lastDate = lastActiveDateIso.slice(0, 10);

	if (lastDate === todayIso) {
		// Already completed something today — streak holds.
		return { newStreak: currentStreak, gained: false };
	}

	const lastMs = new Date(lastDate).getTime();
	const todayMs = new Date(todayIso).getTime();
	const daysDiff = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));

	if (daysDiff === 1) {
		// Consecutive day.
		return { newStreak: currentStreak + 1, gained: true };
	}

	// Gap — reset.
	return { newStreak: 1, gained: true };
}
