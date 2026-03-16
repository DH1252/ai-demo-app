const RANK_TIERS: { threshold: number; label: string }[] = [
	{ threshold: 3000, label: 'Diamond Learner' },
	{ threshold: 2000, label: 'Platinum Learner' },
	{ threshold: 1200, label: 'Gold Learner' },
	{ threshold: 600, label: 'Silver Learner' },
	{ threshold: 0, label: 'Bronze Learner' }
];

export function rankFromXp(xp: number): string {
	return RANK_TIERS.find((t) => xp >= t.threshold)?.label ?? 'Bronze Learner';
}
