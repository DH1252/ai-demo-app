import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lessons, lessonChunks, userProgress } from '$lib/server/db/schema';
import { and, eq, max } from 'drizzle-orm';
import { getS3PresignedUrl } from '$lib/server/s3';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const result = await db.select().from(lessons).where(eq(lessons.id, params.id)).limit(1);
		const lesson = result[0];

		if (!lesson || !lesson.s3Key) {
			return json({ error: 'Not found' }, { status: 404 });
		}

		// Verify the student has active or completed progress for this lesson.
		// Admins bypass this check.
		if (locals.user.role !== 'admin') {
			const progressRows = await db
				.select({ status: userProgress.status })
				.from(userProgress)
				.where(and(eq(userProgress.userId, locals.user.id), eq(userProgress.lessonId, lesson.id)))
				.limit(1);
			const progress = progressRows[0];
			if (!progress || (progress.status !== 'active' && progress.status !== 'completed')) {
				return json({ error: 'Forbidden' }, { status: 403 });
			}
		}

		const maxChunk = await db
			.select({ maxEndTime: max(lessonChunks.endTime) })
			.from(lessonChunks)
			.where(eq(lessonChunks.lessonId, lesson.id))
			.limit(1);
		const videoLength = maxChunk[0]?.maxEndTime || 0;
		// Match the floor used in the load function: minimum 1 hour so that a
		// presign refresh never issues a shorter-lived token than the initial one.
		const tokenDuration = Math.max(videoLength > 0 ? Math.ceil(videoLength) + 300 : 3600, 3600);

		const s3VideoUrl = await getS3PresignedUrl(lesson.s3Key, tokenDuration);
		const expiresAt = Date.now() + tokenDuration * 1000;
		return json({ s3VideoUrl, expiresAt });
	} catch (e) {
		return json({ error: 'Error generating url' }, { status: 500 });
	}
};
