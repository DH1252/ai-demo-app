import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { userProgress } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { withDerivedLessonStatus } from '$lib/server/lessonProgress';
import { getOrderedLessonsForUser } from '$lib/server/learningPaths';

export const load: PageServerLoad = async ({ locals }) => {
	const allLessons = await getOrderedLessonsForUser(locals.user?.id ?? null);

	const progressRows = locals.user
		? await db
				.select({
					lessonId: userProgress.lessonId,
					status: userProgress.status
				})
				.from(userProgress)
				.where(eq(userProgress.userId, locals.user.id))
		: [];

	const lessonsWithStatus = withDerivedLessonStatus(allLessons, progressRows);

	const completedCount = lessonsWithStatus.filter((lesson) => lesson.status === 'completed').length;
	const allComplete = completedCount === lessonsWithStatus.length && lessonsWithStatus.length > 0;
	const activeLesson = allComplete
		? null
		: (lessonsWithStatus.find((lesson) => lesson.status === 'active') ??
			lessonsWithStatus.find(
				(lesson) => lesson.status !== 'locked' && lesson.status !== 'completed'
			) ??
			lessonsWithStatus[0] ??
			null);

	return {
		home: {
			lessons: lessonsWithStatus,
			completedCount,
			activeLesson,
			totalLessons: lessonsWithStatus.length
		}
	};
};
