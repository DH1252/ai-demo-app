import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, generateSessionToken } from '$lib/server/auth';
import { fail, redirect } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Actions } from './$types';

function getSafeNextPath(next: FormDataEntryValue | null, fallback: string) {
	if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
		return next;
	}
	return fallback;
}

export const actions = {
	register: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = data.get('username');
		const password = data.get('password');
		const name = data.get('name');
		const next = data.get('next');

		if (!username || !password || !name) {
			return fail(400, { error: 'Missing required fields' });
		}

		const existingUser = await db
			.select()
			.from(users)
			.where(eq(users.username, username.toString().toLowerCase()))
			.limit(1);

		if (existingUser.length > 0) {
			return fail(400, { error: 'Username already taken' });
		}

		const passwordHash = await bcrypt.hash(password.toString(), 10);

		const [newUser] = await db
			.insert(users)
			.values({
				username: username.toString().toLowerCase(),
				passwordHash,
				name: name.toString()
			})
			.returning();

		const token = generateSessionToken();
		const session = await createSession(token, newUser.id);

		cookies.set('session', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			expires:
				session.expiresAt instanceof Date
					? session.expiresAt
					: new Date((session.expiresAt as number) * 1000),
			secure: process.env.NODE_ENV === 'production'
		});

		// New students must always complete onboarding first, regardless of next param.
		throw redirect(302, '/onboarding');
	},

	login: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = data.get('username');
		const password = data.get('password');
		const next = data.get('next');

		if (!username || !password) {
			return fail(400, { error: 'Missing credentials' });
		}

		const matchedUsers = await db
			.select()
			.from(users)
			.where(eq(users.username, username.toString().toLowerCase()))
			.limit(1);
		if (matchedUsers.length === 0) {
			return fail(400, { error: 'Invalid username or password' });
		}

		const user = matchedUsers[0];
		const valid = await bcrypt.compare(password.toString(), user.passwordHash);

		if (!valid) {
			return fail(400, { error: 'Invalid username or password' });
		}

		const token = generateSessionToken();
		const session = await createSession(token, user.id);

		cookies.set('session', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			expires:
				session.expiresAt instanceof Date
					? session.expiresAt
					: new Date((session.expiresAt as number) * 1000),
			secure: process.env.NODE_ENV === 'production'
		});

		throw redirect(302, getSafeNextPath(next, '/learn'));
	}
} satisfies Actions;
