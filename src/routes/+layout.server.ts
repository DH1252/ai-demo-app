import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { rankFromXp } from '$lib/server/utils';
import { computeRegenHearts } from '$lib/server/rewardUtils';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { user: null };
	}

	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			name: users.name,
			role: users.role,
			xp: users.xp,
			streak: users.streak,
			hearts: users.hearts,
			coins: users.coins,
			heartsLastUpdated: users.heartsLastUpdated
		})
		.from(users)
		.where(eq(users.id, locals.user.id))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return { user: null };
	}

	// Apply passive heart regen and flush to DB if anything changed.
	const regen = computeRegenHearts(row.hearts, row.heartsLastUpdated);
	if (regen.changed) {
		await db
			.update(users)
			.set({ hearts: regen.hearts, heartsLastUpdated: regen.heartsLastUpdated })
			.where(eq(users.id, locals.user.id));
	}

	return {
		user: {
			id: row.id,
			username: row.username,
			name: row.name,
			role: row.role,
			xp: row.xp,
			streak: row.streak,
			hearts: regen.hearts,
			coins: row.coins,
			rank: rankFromXp(row.xp)
		}
	};
};
