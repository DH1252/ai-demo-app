import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasOnboardingProfileMemory } from '$lib/server/learningPaths';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(302, '/auth');
    }

    const onboardingAlreadyComplete = await hasOnboardingProfileMemory(locals.user.id);
    
    return {
        user: locals.user,
        onboardingAlreadyComplete
    };
};