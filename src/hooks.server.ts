import { validateSessionToken } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { hasOnboardingProfileMemory } from '$lib/server/learningPaths';

const VIDEO_FRAME_SOURCES = [
	'https://www.youtube-nocookie.com',
	'https://www.youtube.com',
	'https://player.vimeo.com',
	'https://fast.wistia.net',
	'https://share.vidyard.com',
	'https://www.loom.com',
	'https://www.dailymotion.com'
];

function mergeUniqueSources(...sourceGroups: string[][]): string[] {
	return [...new Set(sourceGroups.flat())];
}

function buildContentSecurityPolicy(): string {
	const directives = {
		'default-src': ["'self'"],
		'script-src': ["'self'", "'unsafe-inline'"],
		'style-src': ["'self'", "'unsafe-inline'"],
		'img-src': ["'self'", 'data:', 'blob:'],
		'connect-src': ["'self'"],
		'font-src': ["'self'", 'data:'],
		'frame-src': mergeUniqueSources(VIDEO_FRAME_SOURCES)
	};

	return Object.entries(directives)
		.map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
		.join('; ');
}

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
	if (timestamps.length >= AI_RATE_LIMIT) {
		// Persist the pruned list so it doesn't grow with stale entries.
		aiRequestLog.set(userId, timestamps);
		return true;
	}
	timestamps.push(now);
	// Only retain the entry while it has timestamps within the window.
	// Once all timestamps age out the entry is evicted to prevent memory growth
	// in long-running processes with many unique users.
	if (timestamps.length > 0) {
		aiRequestLog.set(userId, timestamps);
	} else {
		aiRequestLog.delete(userId);
	}
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
	// CSP: unsafe-inline required for SvelteKit hydration scripts and KaTeX inline styles.
	// frame-src is built from a deduplicated provider list so new video hosts can
	// be added safely without duplicating existing sources.
	response.headers.set('Content-Security-Policy', buildContentSecurityPolicy());

	return response;
};
