import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAiDebugEnabled, setAiDebugEnabled } from '$lib/server/ai/debugState';
import type { RequestHandler } from './$types';

/** Returns the current debug mode state (no auth required — it's just a boolean). */
export const GET: RequestHandler = async () => {
	return json({ enabled: isAiDebugEnabled() });
};

/**
 * Sets the debug mode state.
 * Body: { secret: string, enabled: boolean }
 * Requires the ADMIN_SECRET env var to match.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		typeof (body as Record<string, unknown>).secret !== 'string'
	) {
		return new Response('Missing secret', { status: 400 });
	}

	const { secret, enabled } = body as Record<string, unknown>;

	if (secret !== env.ADMIN_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	}

	setAiDebugEnabled(Boolean(enabled));

	return json({ enabled: isAiDebugEnabled() });
};
