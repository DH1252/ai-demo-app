export function rankFromXp(xp: number): string {
	if (xp >= 3000) return 'Diamond Learner';
	if (xp >= 2000) return 'Platinum Learner';
	if (xp >= 1200) return 'Gold Learner';
	if (xp >= 600) return 'Silver Learner';
	return 'Bronze Learner';
}
