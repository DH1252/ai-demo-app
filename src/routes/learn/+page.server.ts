import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { userProgress } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { withDerivedLessonStatus } from '$lib/server/lessonProgress';
import {
	getOrderedLessonsForUser,
	getPathIdForUser,
	getPathSummaries,
	selectPathForUser
} from '$lib/server/learningPaths';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth');
	}

	const allLessons = await getOrderedLessonsForUser(locals.user.id);

	const progressRows = await db
		.select({
			lessonId: userProgress.lessonId,
			status: userProgress.status
		})
		.from(userProgress)
		.where(eq(userProgress.userId, locals.user.id));

	const lessonNodes = withDerivedLessonStatus(allLessons, progressRows);

	const learningPaths = await getPathSummaries();
	const selectedPathId = await getPathIdForUser(locals.user.id);

	const completedCount = lessonNodes.filter((lesson) => lesson.status === 'completed').length;
	const activeCount = lessonNodes.filter((lesson) => lesson.status === 'active').length;

	return {
		learningPaths,
		selectedPathId,
		lessonNodes,
		completedCount,
		activeCount,
		totalLessons: lessonNodes.length
	};
};

export const actions = {
	selectPath: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const pathId = formData.get('pathId');
		if (typeof pathId !== 'string' || !pathId.trim()) {
			return fail(400, { error: 'Invalid path selection.' });
		}

		const ok = await selectPathForUser(locals.user.id, pathId.trim());
		if (!ok) {
			return fail(404, { error: 'Learning path not found.' });
		}

		return { success: 'Learning path updated.' };
	}
} satisfies Actions;
