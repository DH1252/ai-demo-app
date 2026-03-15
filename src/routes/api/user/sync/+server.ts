import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const updatedUserList = await db
		.select({
			id: users.id,
			username: users.username,
			name: users.name,
			xp: users.xp,
			streak: users.streak,
			hearts: users.hearts,
			coins: users.coins,
			role: users.role,
			lastActiveDate: users.lastActiveDate
		})
		.from(users)
		.where(eq(users.id, locals.user.id));
	const updatedUser = updatedUserList[0];

	return json({ success: true, user: updatedUser });
};
