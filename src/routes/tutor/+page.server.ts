import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOrderedLessonsForUser, getPathIdForUser, getPathSummaries } from '$lib/server/learningPaths';

const MAX_SUGGESTIONS = 6;

function deduplicateSuggestions(values: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const value of values) {
        const normalized = value.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(value.trim());
    }

    return unique;
}

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(302, '/auth');
    }

    const selectedPathId = await getPathIdForUser(locals.user.id);
    const pathSummaries = await getPathSummaries();
    const selectedPath = pathSummaries.find((path) => path.id === selectedPathId) ?? null;

    const lessons = await getOrderedLessonsForUser(locals.user.id);
    const promptSuggestions = deduplicateSuggestions(
        lessons.map((lesson) => `Help me with ${lesson.title}`)
    ).slice(0, MAX_SUGGESTIONS);

    return {
        selectedPathName: selectedPath?.name ?? null,
        promptSuggestions
    };
};
