export const userState = $state({
	id: null as string | null,
	xp: 0,
	streak: 0,
	hearts: 5,
	maxHearts: 5,
	coins: 0,
	name: 'Student',
	rank: 'Bronze Learner',
	completedToday: false,
	// Flips to true after the first syncState() completes (success or failure).
	// The toast watcher in +layout.svelte uses this as a gate so hydration
	// writes don't trigger spurious toasts.
	statsReady: false
});

export function initializeState(data: any) {
	if (typeof window === 'undefined') return;
	if (data && data.user) {
		userState.id = data.user.id;
		userState.name = data.user.name || data.user.username;
		userState.xp = data.user.xp !== undefined ? data.user.xp : 0;
		userState.streak = data.user.streak || 0;
		userState.hearts = data.user.hearts !== undefined ? data.user.hearts : 5;
		userState.coins = data.user.coins || 0;
		userState.rank = data.user.rank || userState.rank;
	}
}

export async function syncState() {
	if (typeof window === 'undefined') return;
	try {
		const res = await fetch('/api/user/sync', {
			method: 'POST'
		});
		if (res.ok) {
			const data = await res.json();
			if (data.user) {
				userState.xp = data.user.xp;
				userState.streak = data.user.streak;
				userState.hearts = data.user.hearts;
				userState.coins = data.user.coins;
				userState.name = data.user.name;
			}
		}
	} catch (e) {
		console.error('Sync failed', e);
	} finally {
		// Always mark ready so the toast watcher activates regardless of
		// whether the network request succeeded.
		userState.statsReady = true;
	}
}
