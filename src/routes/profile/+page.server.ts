import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { userProgress, users } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { rankFromXp } from '$lib/server/utils';
import { getOrderedLessonsForUser } from '$lib/server/learningPaths';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth');
	}

	const meRows = await db
		.select({
			id: users.id,
			name: users.name,
			username: users.username,
			xp: users.xp,
			streak: users.streak,
			hearts: users.hearts,
			coins: users.coins
		})
		.from(users)
		.where(eq(users.id, locals.user.id))
		.limit(1);

	const me = meRows[0];
	if (!me) {
		throw redirect(302, '/auth');
	}

	const topRows = await db
		.select({
			id: users.id,
			name: users.name,
			username: users.username,
			xp: users.xp
		})
		.from(users)
		.orderBy(desc(users.xp))
		.limit(10);

	const myRankRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(users)
		.where(sql`${users.xp} > ${me.xp}`);

	const totalUsersRows = await db.select({ count: sql<number>`count(*)` }).from(users);

	const completedRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(userProgress)
		.where(
			sql`${userProgress.userId} = ${locals.user.id} and ${userProgress.status} = 'completed'`
		);

	const pathLessons = await getOrderedLessonsForUser(locals.user.id);

	const leaderboard = topRows.map((row, index) => ({
		rank: index + 1,
		name: row.name || row.username,
		xp: row.xp,
		isMe: row.id === locals.user?.id
	}));

	if (!leaderboard.some((item) => item.isMe)) {
		const rank = (myRankRows[0]?.count ?? 0) + 1;
		leaderboard.push({
			rank,
			name: me.name || me.username,
			xp: me.xp,
			isMe: true
		});
	}

	return {
		profile: {
			name: me.name || me.username,
			xp: me.xp,
			streak: me.streak,
			hearts: me.hearts,
			coins: me.coins,
			rankLabel: rankFromXp(me.xp),
			rank: (myRankRows[0]?.count ?? 0) + 1,
			totalUsers: totalUsersRows[0]?.count ?? 1,
			completedLessons: completedRows[0]?.count ?? 0,
			totalLessons: pathLessons.length,
			leaderboard
		}
	};
};
