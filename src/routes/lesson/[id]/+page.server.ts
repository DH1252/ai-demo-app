import { db } from '$lib/server/db';
import { lessons, lessonChunks, userProgress, users } from '$lib/server/db/schema';
import { and, eq, max, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getS3PresignedUrl } from '$lib/server/s3';
import { error, fail, redirect } from '@sveltejs/kit';
import { withDerivedLessonStatus } from '$lib/server/lessonProgress';
import { getOrderedLessonsForUser } from '$lib/server/learningPaths';
import { computeRegenHearts, computeStreak, msUntilNextHeart } from '$lib/server/rewardUtils';

type LessonQuestion = {
	id: string;
	text: string;
	options: Array<{ id: string; text: string }>;
	correctOptionId: string;
	explanation: string;
};

function parseQuestions(contentData: string): LessonQuestion[] {
	try {
		const parsed = JSON.parse(contentData) as { questions?: LessonQuestion[] };
		const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
		return questions.filter(
			(q) =>
				typeof q?.id === 'string' &&
				typeof q?.text === 'string' &&
				Array.isArray(q?.options) &&
				q.options.every((o) => typeof o?.id === 'string' && typeof o?.text === 'string') &&
				typeof q?.correctOptionId === 'string' &&
				typeof q?.explanation === 'string'
		);
	} catch {
		return [];
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		throw redirect(302, `/auth?next=/lesson/${params.id}`);
	}

	const result = await db.select().from(lessons).where(eq(lessons.id, params.id)).limit(1);
	const lesson = result[0];

	if (!lesson) {
		throw error(404, 'Lesson not found');
	}

	const nowIso = new Date().toISOString();

	if (locals.user.role !== 'admin') {
		// Upsert an active progress row, recording startedAt on first insert only.
		// onConflictDoNothing preserves the original startedAt for returning students.
		await db
			.insert(userProgress)
			.values({ userId: locals.user.id, lessonId: lesson.id, status: 'active', startedAt: nowIso })
			.onConflictDoNothing();
	}

	// Compute next lesson in the learning path for smart navigation.
	const allLessonsOrdered = await getOrderedLessonsForUser(locals.user.id);
	const currentIdx = allLessonsOrdered.findIndex((l) => l.id === params.id);
	const nextLessonId =
		currentIdx >= 0 && currentIdx < allLessonsOrdered.length - 1
			? (allLessonsOrdered[currentIdx + 1]?.id ?? null)
			: null;

	// Apply passive heart regen and compute gate state.
	const userRows = await db
		.select({ hearts: users.hearts, heartsLastUpdated: users.heartsLastUpdated })
		.from(users)
		.where(eq(users.id, locals.user.id))
		.limit(1);

	let currentHearts = userRows[0]?.hearts ?? 5;
	let heartsLastUpdated = userRows[0]?.heartsLastUpdated ?? null;

	const regen = computeRegenHearts(currentHearts, heartsLastUpdated);
	if (regen.changed) {
		await db
			.update(users)
			.set({ hearts: regen.hearts, heartsLastUpdated: regen.heartsLastUpdated })
			.where(eq(users.id, locals.user.id));
		currentHearts = regen.hearts;
		heartsLastUpdated = regen.heartsLastUpdated;
	}

	const nowMs = Date.now();
	const heartsGated = currentHearts === 0 && locals.user.role !== 'admin';
	const nextHeartInSeconds = heartsGated
		? Math.ceil(msUntilNextHeart(currentHearts, heartsLastUpdated, nowMs) / 1000)
		: null;

	// Generate presigned URL if s3Key exists.
	let s3VideoUrl = null;
	let s3VideoUrlExpiresAt: number | null = null;
	if (lesson.s3Key) {
		try {
			const chunkResult = await db
				.select({ maxEndTime: max(lessonChunks.endTime) })
				.from(lessonChunks)
				.where(eq(lessonChunks.lessonId, lesson.id))
				.limit(1);
			const videoLength = chunkResult[0]?.maxEndTime || 0;
			const tokenDuration = Math.max(videoLength > 0 ? Math.ceil(videoLength) + 300 : 3600, 3600);

			s3VideoUrl = await getS3PresignedUrl(lesson.s3Key, tokenDuration);
			s3VideoUrlExpiresAt = Date.now() + tokenDuration * 1000;
		} catch (e) {
			console.error('Failed to generate presigned URL', e);
		}
	}

	return {
		lesson: { ...lesson, s3VideoUrl, s3VideoUrlExpiresAt },
		nextLessonId,
		heartsGated,
		nextHeartInSeconds,
		currentHearts
	};
};

export const actions = {
	submitLesson: async ({ request, params, locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}
		const userId = locals.user.id;

		const formData = await request.formData();
		const selectedAnswersRaw = formData.get('selectedAnswers');
		const usedTutorRaw = formData.get('usedTutor');
		const usedTutor = usedTutorRaw === '1';

		if (typeof selectedAnswersRaw !== 'string' || selectedAnswersRaw.trim() === '') {
			return fail(400, { error: 'Please answer the lesson questions.' });
		}

		const lessonRows = await db
			.select({ id: lessons.id, contentData: lessons.contentData })
			.from(lessons)
			.where(eq(lessons.id, params.id))
			.limit(1);

		const lesson = lessonRows[0];
		if (!lesson) {
			return fail(404, { error: 'Lesson not found.' });
		}

		// Fan out the three independent reads in parallel — none depend on each other.
		const [allLessons, progressRows, heartAndProgressRows] = await Promise.all([
			getOrderedLessonsForUser(userId),
			db
				.select({ lessonId: userProgress.lessonId, status: userProgress.status })
				.from(userProgress)
				.where(eq(userProgress.userId, userId)),
			// Heart check + existing progress fetched together as they're also independent.
			Promise.all([
				locals.user.role !== 'admin'
					? db
							.select({ hearts: users.hearts, heartsLastUpdated: users.heartsLastUpdated })
							.from(users)
							.where(eq(users.id, userId))
							.limit(1)
					: Promise.resolve([] as { hearts: number; heartsLastUpdated: string | null }[]),
				db
					.select({ status: userProgress.status, startedAt: userProgress.startedAt })
					.from(userProgress)
					.where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, lesson.id)))
					.limit(1)
			])
		]);

		const [heartRows, existingProgressRows] = heartAndProgressRows;
		const lessonsWithStatus = withDerivedLessonStatus(allLessons, progressRows);
		const lessonStatus = lessonsWithStatus.find((l) => l.id === lesson.id)?.status;
		if (lessonStatus === 'locked') {
			return fail(403, { error: 'This lesson is locked. Complete earlier lessons first.' });
		}

		// Gate: check hearts (admins bypass).
		if (locals.user.role !== 'admin') {
			const storedHearts = heartRows[0]?.hearts ?? 5;
			const storedLastUpdated = heartRows[0]?.heartsLastUpdated ?? null;
			const regen = computeRegenHearts(storedHearts, storedLastUpdated);
			const effectiveHearts = regen.hearts;

			if (effectiveHearts === 0) {
				return fail(403, { error: 'No hearts remaining. Wait for your hearts to regenerate.' });
			}
		}

		const questions = parseQuestions(lesson.contentData);
		if (questions.length === 0) {
			return fail(400, { error: 'This lesson has no valid questions.' });
		}

		let selectedAnswers: unknown;
		try {
			selectedAnswers = JSON.parse(selectedAnswersRaw);
		} catch {
			return fail(400, { error: 'Invalid answers payload.' });
		}

		if (!Array.isArray(selectedAnswers)) {
			return fail(400, { error: 'Invalid answers format.' });
		}

		const normalizedAnswers = selectedAnswers.map((value) =>
			typeof value === 'string' ? value : ''
		);
		if (normalizedAnswers.length !== questions.length) {
			return fail(400, { error: 'Please answer every question.' });
		}

		const missingAnswer = normalizedAnswers.some((value) => value.trim() === '');
		if (missingAnswer) {
			return fail(400, { error: 'Please answer every question.' });
		}

		const questionResults = questions.map((question, index) => {
			const selectedOptionId = normalizedAnswers[index] ?? '';
			const selectedOptionExists = question.options.some(
				(option) => option.id === selectedOptionId
			);
			if (!selectedOptionExists) {
				return { selectedOptionId, isCorrect: false, explanation: question.explanation };
			}
			return {
				selectedOptionId,
				isCorrect: selectedOptionId === question.correctOptionId,
				explanation: question.explanation
			};
		});

		const incorrectCount = questionResults.filter((result) => !result.isCorrect).length;
		const correctCount = questionResults.filter((result) => result.isCorrect).length;
		const isPerfect = incorrectCount === 0;
		const nowIso = new Date().toISOString();
		const todayIso = nowIso.slice(0, 10); // YYYY-MM-DD

		const alreadyCompleted = existingProgressRows[0]?.status === 'completed';
		const startedAtIso = existingProgressRows[0]?.startedAt ?? null;

		// Server-side elapsed seconds (capped at 1 hour).
		const elapsedSeconds = startedAtIso
			? Math.min(
					3600,
					Math.max(0, Math.round((Date.now() - new Date(startedAtIso).getTime()) / 1000))
				)
			: 3600; // fallback to max (no speed bonus) if no startedAt

		// --- Compute reward formula ---
		let speedBonus = 0;
		let independenceBonus = 0;
		let coinsAwarded = 0;
		let xpAwarded = 0;
		let isRetryBonus = false;

		if (isPerfect) {
			if (elapsedSeconds < 90) speedBonus = 15;
			else if (elapsedSeconds < 180) speedBonus = 10;
			else if (elapsedSeconds < 420) speedBonus = 5;

			independenceBonus = usedTutor ? 0 : 5;

			if (!alreadyCompleted) {
				// First perfect completion — full reward.
				coinsAwarded = correctCount;
				xpAwarded = correctCount * 5 + 10 + speedBonus + independenceBonus;
			} else {
				// Repeat perfect completion — half XP, no coins.
				isRetryBonus = true;
				xpAwarded = Math.floor((correctCount * 5 + 10 + speedBonus + independenceBonus) / 2);
			}
		}

		// --- Streak update (first perfect completion only) ---
		let streakGained = false;
		let newStreak = 0;

		await db.transaction(async (tx) => {
			// Fetch current user state inside the transaction for a consistent read.
			const userStateRows = await tx
				.select({
					xp: users.xp,
					streak: users.streak,
					hearts: users.hearts,
					coins: users.coins,
					lastActiveDate: users.lastActiveDate,
					heartsLastUpdated: users.heartsLastUpdated
				})
				.from(users)
				.where(eq(users.id, userId))
				.limit(1);

			const u = userStateRows[0];
			if (!u) return;

			newStreak = u.streak;

			// Award XP + coins.
			if (isPerfect && xpAwarded > 0) {
				// Compute streak update (only on first perfect completion).
				if (!alreadyCompleted) {
					const streakResult = computeStreak(u.streak, u.lastActiveDate, todayIso);
					newStreak = streakResult.newStreak;
					streakGained = streakResult.gained;
				}

				await tx
					.update(users)
					.set({
						xp: sql`${users.xp} + ${xpAwarded}`,
						coins: sql`${users.coins} + ${coinsAwarded}`,
						streak: newStreak,
						lastActiveDate: todayIso,
						heartsLastUpdated: u.heartsLastUpdated ?? nowIso
					})
					.where(eq(users.id, userId));

				if (!alreadyCompleted) {
					await tx
						.insert(userProgress)
						.values({ userId, lessonId: lesson.id, status: 'completed', startedAt: startedAtIso })
						.onConflictDoUpdate({
							target: [userProgress.userId, userProgress.lessonId],
							set: { status: 'completed' }
						});
				}
			}

			// Deduct 1 heart on wrong submission (fresh or repeat attempt, not first-perfect).
			if (incorrectCount > 0 && locals.user?.role !== 'admin') {
				// Apply any pending regen first so we don't deduct from an already-zero count.
				const regen = computeRegenHearts(u.hearts, u.heartsLastUpdated);
				const heartsBeforeDeduct = regen.hearts;
				const heartsAfterDeduct = Math.max(0, heartsBeforeDeduct - 1);

				await tx
					.update(users)
					.set({
						hearts: heartsAfterDeduct,
						heartsLastUpdated: regen.heartsLastUpdated
					})
					.where(eq(users.id, userId));
			}
		});

		// Read final user state to return to the client.
		const updatedUserRows = await db
			.select({
				xp: users.xp,
				streak: users.streak,
				hearts: users.hearts,
				coins: users.coins,
				name: users.name,
				heartsLastUpdated: users.heartsLastUpdated
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		const updatedUser = updatedUserRows[0];
		const nowMs2 = Date.now();
		const nextHeartInSeconds =
			updatedUser && updatedUser.hearts < 5
				? Math.ceil(
						msUntilNextHeart(updatedUser.hearts, updatedUser.heartsLastUpdated, nowMs2) / 1000
					)
				: null;

		return {
			user: updatedUser
				? {
						xp: updatedUser.xp,
						streak: updatedUser.streak,
						hearts: updatedUser.hearts,
						coins: updatedUser.coins,
						name: updatedUser.name
					}
				: null,
			result: {
				isPerfect,
				questionResults,
				xpAwarded,
				alreadyCompleted,
				speedBonus,
				independenceBonus,
				coinsAwarded,
				isRetryBonus,
				// Heart punishment
				heartLost: incorrectCount > 0 && locals.user.role !== 'admin',
				heartsAfter: updatedUser?.hearts ?? 5,
				nextHeartInSeconds,
				// Streak
				streakGained,
				newStreak
			}
		};
	},

	buyHeart: async ({ locals }) => {
		if (!locals.user) {
			return fail(401, { error: 'Unauthorized' });
		}
		const userId = locals.user.id;

		const userRows = await db
			.select({
				hearts: users.hearts,
				coins: users.coins,
				heartsLastUpdated: users.heartsLastUpdated
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		const u = userRows[0];
		if (!u) return fail(404, { error: 'User not found.' });

		// Apply regen before checking to get the true current hearts.
		const regen = computeRegenHearts(u.hearts, u.heartsLastUpdated);
		const currentHearts = regen.hearts;

		if (currentHearts >= 5) {
			return fail(400, { error: 'Hearts are already full.' });
		}
		if (u.coins < 5) {
			return fail(400, { error: 'Not enough coins. You need 5 coins to restore a heart.' });
		}

		const nowIso = new Date().toISOString();
		await db
			.update(users)
			.set({
				hearts: currentHearts + 1,
				coins: sql`${users.coins} - 5`,
				heartsLastUpdated: nowIso
			})
			.where(eq(users.id, userId));

		const updatedRows = await db
			.select({
				xp: users.xp,
				streak: users.streak,
				hearts: users.hearts,
				coins: users.coins,
				name: users.name
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		return { user: updatedRows[0] ?? null };
	}
} satisfies Actions;
