import { validateSessionToken } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { hasOnboardingProfileMemory } from '$lib/server/learningPaths';

// ---------------------------------------------------------------------------
// In-memory rate limiter for /api/ai/* endpoints.
// Limits each authenticated user to AI_RATE_LIMIT requests per 60-second window.
// Uses a sliding window: timestamps older than 60 s are evicted on each check.
// ---------------------------------------------------------------------------
const AI_RATE_LIMIT = 20; // max requests per window
const AI_RATE_WINDOW_MS = 60_000; // 60 seconds

const aiRequestLog = new Map<string, number[]>();

function isAiRateLimited(userId: string): boolean {
	const now = Date.now();
	const windowStart = now - AI_RATE_WINDOW_MS;
	const timestamps = (aiRequestLog.get(userId) ?? []).filter((t) => t > windowStart);
	if (timestamps.length >= AI_RATE_LIMIT) return true;
	timestamps.push(now);
	aiRequestLog.set(userId, timestamps);
	return false;
}

export const handle: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get('session');

	if (!sessionToken) {
		event.locals.user = null;
	} else {
		const { session, user } = await validateSessionToken(sessionToken);
		if (session && user) {
			// Set session cookie cleanly
			const expiresAt = new Date(session.expiresAt * 1000);
			event.cookies.set('session', session.id, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				expires: expiresAt,
				secure: process.env.NODE_ENV === 'production'
			});
			event.locals.user = {
				id: user.id,
				username: user.username,
				name: user.name,
				role: user.role
			};
		} else {
			event.locals.user = null;
			event.cookies.delete('session', { path: '/' });
			event.cookies.delete('onboarding_done', { path: '/' });
		}
	}

	const path = event.url.pathname;

	const isPublicPath =
		path.startsWith('/auth') ||
		path.startsWith('/api') ||
		path.startsWith('/admin') ||
		path.startsWith('/_app') ||
		path === '/favicon.ico' ||
		path === '/robots.txt';

	if (!event.locals.user && !isPublicPath) {
		const nextPath = `${event.url.pathname}${event.url.search}`;
		throw redirect(302, `/auth?next=${encodeURIComponent(nextPath)}`);
	}

	if (event.locals.user?.role === 'student') {
		const onboardingAllowed =
			path.startsWith('/onboarding') ||
			path.startsWith('/api/') ||
			path.startsWith('/auth') ||
			path.startsWith('/_app') ||
			path === '/favicon.ico' ||
			path === '/robots.txt';

		if (!onboardingAllowed) {
			// Fast path: trust the onboarding_done cookie to avoid a DB query on
			// every authenticated page load. The cookie is set (below) the first
			// time the DB confirms the profile exists, and cleared on logout.
			const onboardingDoneCookie = event.cookies.get('onboarding_done');
			let hasProfile = onboardingDoneCookie === '1';

			if (!hasProfile) {
				hasProfile = await hasOnboardingProfileMemory(event.locals.user.id);
				if (hasProfile) {
					// Cache the result so future requests skip the DB entirely.
					// 7-day TTL so that if an admin resets a student's onboarding
					// profile the cookie expires within a week rather than a year.
					event.cookies.set('onboarding_done', '1', {
						path: '/',
						httpOnly: true,
						sameSite: 'lax',
						maxAge: 60 * 60 * 24 * 7, // 7 days
						secure: process.env.NODE_ENV === 'production'
					});
				}
			}

			if (!hasProfile) {
				throw redirect(302, '/onboarding');
			}
		}
	}

	if (event.locals.user && path.startsWith('/auth')) {
		throw redirect(302, '/learn');
	}

	// Rate-limit AI endpoints per authenticated user.
	if (path.startsWith('/api/ai/') && event.locals.user) {
		if (isAiRateLimited(event.locals.user.id)) {
			return new Response('Too Many Requests', { status: 429 });
		}
	}

	const response = await resolve(event);

	// Security headers — applied to every response.
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

	return response;
};
