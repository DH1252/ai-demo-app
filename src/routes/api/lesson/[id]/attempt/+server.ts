import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { lessons, userProgress } from '$lib/server/db/schema';
import {
	canResetLessonAttempt,
	getLessonAttemptLifecycle,
	normalizeLessonAttemptState,
	serializeLessonAttemptState,
	type LessonAttemptState
} from '$lib/server/lessonProgress';
import type { RequestHandler } from './$types';

const saveAttemptSchema = z.object({
	action: z.literal('save'),
	selectedAnswers: z.array(z.string()),
	checkedQuestions: z.array(z.boolean())
});

const resetAttemptSchema = z.object({
	action: z.literal('reset')
});

const requestSchema = z.union([saveAttemptSchema, resetAttemptSchema]);

function buildAttemptState(
	selectedAnswers: string[],
	checkedQuestions: boolean[]
): LessonAttemptState {
	return {
		selectedAnswers,
		checkedQuestions,
		updatedAt: new Date().toISOString()
	};
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const parsed = requestSchema.safeParse(await request.json());
	if (!parsed.success) {
		return json({ error: 'Invalid payload' }, { status: 400 });
	}

	const lessonRows = await db
		.select({ id: lessons.id, contentData: lessons.contentData })
		.from(lessons)
		.where(eq(lessons.id, params.id))
		.limit(1);
	const lesson = lessonRows[0];
	if (!lesson) {
		return json({ error: 'Lesson not found' }, { status: 404 });
	}

	const progressRows = await db
		.select({
			status: userProgress.status,
			attemptState: userProgress.attemptState,
			startedAt: userProgress.startedAt
		})
		.from(userProgress)
		.where(and(eq(userProgress.userId, locals.user.id), eq(userProgress.lessonId, lesson.id)))
		.limit(1);
	const lifecycle = getLessonAttemptLifecycle(progressRows[0]);

	if (parsed.data.action === 'reset') {
		if (!canResetLessonAttempt(lifecycle)) {
			return json({ error: 'You can only reset a lesson after completing it.' }, { status: 403 });
		}

		const nowIso = new Date().toISOString();
		await db
			.update(userProgress)
			.set({ status: 'active', attemptState: null, startedAt: nowIso })
			.where(and(eq(userProgress.userId, locals.user.id), eq(userProgress.lessonId, lesson.id)));

		return json({ success: true, mode: 'fresh' });
	}

	if (lifecycle.status === 'completed') {
		return json(
			{ error: 'Completed lessons must be reset before saving a new retry attempt.' },
			{ status: 409 }
		);
	}

	let questionCount = 0;
	try {
		const parsedContent = JSON.parse(lesson.contentData) as { questions?: unknown[] };
		questionCount = Array.isArray(parsedContent.questions) ? parsedContent.questions.length : 0;
	} catch {
		questionCount = 0;
	}

	if (questionCount <= 0) {
		return json({ error: 'Lesson has no valid questions.' }, { status: 400 });
	}

	if (
		parsed.data.selectedAnswers.length !== questionCount ||
		parsed.data.checkedQuestions.length !== questionCount
	) {
		return json(
			{ error: 'Attempt progress does not match lesson question count.' },
			{ status: 400 }
		);
	}

	const normalizedState = normalizeLessonAttemptState(
		buildAttemptState(parsed.data.selectedAnswers, parsed.data.checkedQuestions),
		questionCount
	);

	await db
		.insert(userProgress)
		.values({
			userId: locals.user.id,
			lessonId: lesson.id,
			status: 'active',
			attemptState: serializeLessonAttemptState(normalizedState),
			startedAt: lifecycle.startedAt ?? new Date().toISOString()
		})
		.onConflictDoUpdate({
			target: [userProgress.userId, userProgress.lessonId],
			set: {
				status: 'active',
				attemptState: serializeLessonAttemptState(normalizedState)
			}
		});

	return json({ success: true, mode: 'resume', attemptState: normalizedState });
};
