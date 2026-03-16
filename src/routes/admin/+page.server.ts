import { db } from '$lib/server/db';
import { learningPaths, lessonChunks, lessons, userProgress, users } from '$lib/server/db/schema';
import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { processVideoAndEmbed } from '$lib/server/ai/vectorProcessor';
import { deleteFromBucket, uploadToBucket } from '$lib/server/s3';
import type { Actions, PageServerLoad } from './$types';
import { eq, inArray } from 'drizzle-orm';
import {
	createPath,
	ensureLearningPathTables,
	getPathSummaries,
	setActivePath,
	setPathLessons
} from '$lib/server/learningPaths';
import {
	getUnsupportedExternalVideoUrlMessage,
	isSupportedExternalVideoUrl
} from '$lib/video/providers';

function parseNonNegativeInteger(raw: string): number | null {
	if (!/^\d+$/.test(raw.trim())) {
		return null;
	}

	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) {
		return null;
	}

	return value;
}

function normalizeOptionalVideoUrl(raw: FormDataEntryValue | null): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (!isSupportedExternalVideoUrl(trimmed)) {
		throw new Error(getUnsupportedExternalVideoUrlMessage());
	}
	return trimmed;
}

export const load: PageServerLoad = async () => {
	await ensureLearningPathTables();
	const allLessons = await db.select().from(lessons);
	const paths = await getPathSummaries();
	const students = await db
		.select({
			id: users.id,
			username: users.username,
			name: users.name,
			role: users.role,
			xp: users.xp,
			streak: users.streak,
			hearts: users.hearts,
			coins: users.coins
		})
		.from(users)
		.where(eq(users.role, 'student'));

	return {
		lessons: allLessons,
		paths,
		students
	};
};

export const actions = {
	createLesson: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const title = data.get('title');
		const type = data.get('type');
		const videoUrl = data.get('videoUrl');
		const contentData = data.get('contentData');
		const mediaFile = data.get('mediaFile') as File | null;

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!title || !type || !contentData) {
			return fail(400, { error: 'Missing required fields.' });
		}

		let normalizedVideoUrl: string | null;
		try {
			normalizedVideoUrl = normalizeOptionalVideoUrl(videoUrl);
		} catch (error) {
			return fail(400, {
				error: error instanceof Error ? error.message : 'Unsupported external video URL provided.'
			});
		}

		try {
			const inserted = await db
				.insert(lessons)
				.values({
					title: title.toString(),
					type: type.toString() as 'standard' | 'test' | 'ai-remedial',
					contentData: contentData.toString(),
					videoUrl: normalizedVideoUrl
				})
				.returning({ id: lessons.id });

			const newLessonId = inserted[0].id;
			let s3Key: string | null = null;

			try {
				if (mediaFile && mediaFile.size > 0) {
					// Generate a clean S3 Key
					const cleanName = mediaFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
					s3Key = `lessons/${newLessonId}/${cleanName}`;

					// Upload native file directly to Railway S3 Bucket
					await uploadToBucket(s3Key, mediaFile, mediaFile.type);

					// Update SQLite with the new bucket key
					await db.update(lessons).set({ s3Key }).where(eq(lessons.id, newLessonId));
				}

				if (normalizedVideoUrl || (mediaFile && mediaFile.size > 0)) {
					const urlString = normalizedVideoUrl ?? '';
					await processVideoAndEmbed(
						newLessonId,
						urlString,
						mediaFile && mediaFile.size > 0 ? mediaFile : undefined
					);
				}
			} catch (embedError: any) {
				// If vectorization fails, cleanup the lesson and any partially-inserted chunks.
				await db.transaction(async (tx) => {
					await tx.delete(lessonChunks).where(eq(lessonChunks.lessonId, newLessonId));
					await tx.delete(lessons).where(eq(lessons.id, newLessonId));
				});
				// Also remove the S3 object if one was uploaded during this failed creation
				if (s3Key) {
					try {
						await deleteFromBucket(s3Key);
					} catch (s3Err) {
						console.warn('Failed to remove S3 object during lesson rollback:', s3Err);
					}
				}
				console.error('Vector processing failed:', embedError);
				return fail(500, { error: `Failed to process media: ${embedError.message}` });
			}

			return { success: 'Lesson created successfully.' };
		} catch (err: any) {
			console.error('Admin create lesson failed:', err);
			return fail(500, { error: err.message || 'Internal server error.' });
		}
	},

	deleteLesson: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const lessonId = data.get('lessonId');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!lessonId || lessonId.toString().trim() === '') {
			return fail(400, { error: 'Missing lesson ID.' });
		}

		const id = lessonId.toString();

		try {
			const existing = await db
				.select({ s3Key: lessons.s3Key })
				.from(lessons)
				.where(eq(lessons.id, id))
				.limit(1);

			const existingLesson = existing[0];
			if (!existingLesson) {
				return fail(404, { error: 'Lesson not found or already deleted.' });
			}

			const deletedRows = await db.transaction(async (tx) => {
				// Cleanup dependents first since schema references do not specify cascade deletes.
				await tx.delete(lessonChunks).where(eq(lessonChunks.lessonId, id));
				await tx.delete(userProgress).where(eq(userProgress.lessonId, id));

				return tx.delete(lessons).where(eq(lessons.id, id)).returning({ id: lessons.id });
			});

			if (deletedRows.length === 0) {
				return fail(404, { error: 'Lesson not found or already deleted.' });
			}

			if (existingLesson.s3Key) {
				try {
					await deleteFromBucket(existingLesson.s3Key);
				} catch (storageError) {
					console.warn('Lesson deleted but failed to remove S3 object:', storageError);
					return {
						success: 'Lesson deleted, but media cleanup failed. Remove the S3 object manually.'
					};
				}
			}

			return { success: 'Lesson deleted successfully.' };
		} catch (err: any) {
			console.error('Admin delete lesson failed:', err);
			return fail(500, { error: err.message || 'Internal server error.' });
		}
	},

	updateLesson: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const lessonId = data.get('lessonId');
		const title = data.get('title');
		const type = data.get('type');
		const videoUrl = data.get('videoUrl');
		const contentData = data.get('contentData');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!lessonId || !title || !type || !contentData) {
			return fail(400, { error: 'Missing required fields for lesson update.' });
		}

		const id = lessonId.toString();
		const lessonType = type.toString();
		if (lessonType !== 'standard' && lessonType !== 'test' && lessonType !== 'ai-remedial') {
			return fail(400, { error: 'Invalid lesson type.' });
		}

		const contentDataString = contentData.toString();
		try {
			JSON.parse(contentDataString);
		} catch {
			return fail(400, { error: 'Invalid content JSON.' });
		}

		let normalizedVideoUrl: string | null;
		try {
			normalizedVideoUrl = normalizeOptionalVideoUrl(videoUrl);
		} catch (error) {
			return fail(400, {
				error: error instanceof Error ? error.message : 'Unsupported external video URL provided.'
			});
		}

		try {
			const existingRows = await db
				.select({ id: lessons.id })
				.from(lessons)
				.where(eq(lessons.id, id))
				.limit(1);

			if (!existingRows[0]) {
				return fail(404, { error: 'Lesson not found.' });
			}

			const updatedRows = await db
				.update(lessons)
				.set({
					title: title.toString(),
					type: lessonType as 'standard' | 'test' | 'ai-remedial',
					videoUrl: normalizedVideoUrl,
					contentData: contentDataString
				})
				.where(eq(lessons.id, id))
				.returning({ id: lessons.id });

			if (updatedRows.length === 0) {
				return fail(404, { error: 'Lesson not found.' });
			}

			// Remove stale vector chunks so future semantic search reflects the updated content.
			await db.delete(lessonChunks).where(eq(lessonChunks.lessonId, id));

			return { success: 'Lesson updated successfully.' };
		} catch (err: any) {
			console.error('Admin update lesson failed:', err);
			return fail(500, { error: err.message || 'Internal server error.' });
		}
	},

	createPath: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const name = data.get('name');
		const description = data.get('description');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!name || name.toString().trim() === '') {
			return fail(400, { error: 'Path name is required.' });
		}

		const id = await createPath(name.toString().trim(), description?.toString().trim() ?? '');
		if (!id) {
			return fail(500, { error: 'Failed to create learning path.' });
		}

		return { success: 'Learning path created successfully.' };
	},

	updatePathLessons: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const pathId = data.get('pathId');
		const lessonIdsRaw = data.getAll('lessonIds');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!pathId || pathId.toString().trim() === '') {
			return fail(400, { error: 'Path ID is required.' });
		}

		const targetPathId = pathId.toString();

		const pathRows = await db
			.select({ id: learningPaths.id })
			.from(learningPaths)
			.where(eq(learningPaths.id, targetPathId))
			.limit(1);

		if (!pathRows[0]) {
			return fail(404, { error: 'Learning path not found.' });
		}

		const lessonIds = lessonIdsRaw
			.map((value) => (typeof value === 'string' ? value.trim() : ''))
			.filter((value) => value !== '');

		if (lessonIds.length > 0) {
			const existingLessons = await db
				.select({ id: lessons.id })
				.from(lessons)
				.where(inArray(lessons.id, lessonIds));

			if (existingLessons.length !== lessonIds.length) {
				return fail(400, { error: 'One or more selected lessons no longer exist.' });
			}
		}

		await setPathLessons(targetPathId, lessonIds);
		return { success: 'Learning path lessons updated.' };
	},

	setActivePath: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const pathId = data.get('pathId');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (!pathId || pathId.toString().trim() === '') {
			return fail(400, { error: 'Path ID is required.' });
		}

		const existing = await db
			.select({ id: learningPaths.id })
			.from(learningPaths)
			.where(eq(learningPaths.id, pathId.toString()))
			.limit(1);

		if (!existing[0]) {
			return fail(404, { error: 'Learning path not found.' });
		}

		await setActivePath(pathId.toString());
		return { success: 'Active learning path updated.' };
	},

	updateStudentRewards: async ({ request }) => {
		const data = await request.formData();
		const secret = data.get('secret');
		const studentId = data.get('studentId');
		const xpRaw = data.get('xp');
		const streakRaw = data.get('streak');
		const heartsRaw = data.get('hearts');
		const coinsRaw = data.get('coins');

		if (secret !== env.ADMIN_SECRET) {
			return fail(403, { error: 'Invalid admin secret.' });
		}

		if (
			typeof studentId !== 'string' ||
			typeof xpRaw !== 'string' ||
			typeof streakRaw !== 'string' ||
			typeof heartsRaw !== 'string' ||
			typeof coinsRaw !== 'string'
		) {
			return fail(400, { error: 'Missing required student reward fields.' });
		}

		const xp = parseNonNegativeInteger(xpRaw);
		const streak = parseNonNegativeInteger(streakRaw);
		const hearts = parseNonNegativeInteger(heartsRaw);
		const coins = parseNonNegativeInteger(coinsRaw);

		if (xp === null || streak === null || hearts === null || coins === null) {
			return fail(400, { error: 'All reward values must be non-negative whole numbers.' });
		}

		if (hearts > 5) {
			return fail(400, { error: 'Hearts cannot exceed 5.' });
		}

		const targetRows = await db
			.select({ id: users.id, role: users.role, name: users.name, username: users.username })
			.from(users)
			.where(eq(users.id, studentId))
			.limit(1);

		const target = targetRows[0];
		if (!target || target.role !== 'student') {
			return fail(404, { error: 'Student not found.' });
		}

		await db
			.update(users)
			.set({
				xp,
				streak,
				hearts,
				coins
			})
			.where(eq(users.id, studentId));

		return {
			success: `Updated rewards for ${target.name || target.username}.`
		};
	}
} satisfies Actions;
