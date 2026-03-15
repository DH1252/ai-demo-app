import type { RequestHandler } from './$types';
import { hasOnboardingProfileMemory } from '$lib/server/learningPaths';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return new Response('Unauthorized', { status: 401 });
    }

    const completed = await hasOnboardingProfileMemory(locals.user.id);
    return Response.json({ completed });
};
