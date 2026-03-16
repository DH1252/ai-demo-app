type LessonStatus = 'completed' | 'active' | 'locked';

export type LessonAttemptState = {
	selectedAnswers: string[];
	checkedQuestions: boolean[];
	updatedAt: string;
};

type LessonLike<TType extends string = string> = {
	id: string;
	title: string;
	type: TType;
};

type ProgressStatus = {
	lessonId: string;
	status: LessonStatus;
};

export function emptyLessonAttemptState(): LessonAttemptState {
	return {
		selectedAnswers: [],
		checkedQuestions: [],
		updatedAt: new Date(0).toISOString()
	};
}

export function parseLessonAttemptState(raw: string | null | undefined): LessonAttemptState | null {
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as {
			selectedAnswers?: unknown;
			checkedQuestions?: unknown;
			updatedAt?: unknown;
		};

		if (!Array.isArray(parsed.selectedAnswers) || !Array.isArray(parsed.checkedQuestions)) {
			return null;
		}

		const selectedAnswers = parsed.selectedAnswers.map((value) =>
			typeof value === 'string' ? value : ''
		);
		const checkedQuestions = parsed.checkedQuestions.map((value) => value === true);
		const updatedAt =
			typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
				? parsed.updatedAt
				: new Date(0).toISOString();

		return { selectedAnswers, checkedQuestions, updatedAt };
	} catch {
		return null;
	}
}

export function serializeLessonAttemptState(state: LessonAttemptState | null): string | null {
	if (!state) return null;
	return JSON.stringify({
		selectedAnswers: [...state.selectedAnswers],
		checkedQuestions: [...state.checkedQuestions],
		updatedAt: state.updatedAt
	});
}

export function normalizeLessonAttemptState(
	state: LessonAttemptState,
	questionCount: number
): LessonAttemptState {
	return {
		selectedAnswers: Array.from(
			{ length: questionCount },
			(_, index) => state.selectedAnswers[index] ?? ''
		),
		checkedQuestions: Array.from(
			{ length: questionCount },
			(_, index) => state.checkedQuestions[index] === true
		),
		updatedAt: state.updatedAt
	};
}

type StoredLessonProgress = {
	status: 'completed' | 'active';
	attemptState: string | null;
	startedAt: string | null;
};

export type LessonAttemptLifecycle = {
	mode: 'resume' | 'fresh';
	canReset: boolean;
	status: 'completed' | 'active' | null;
	attemptState: LessonAttemptState | null;
	startedAt: string | null;
};

export function getLessonAttemptLifecycle(
	progress: StoredLessonProgress | null | undefined
): LessonAttemptLifecycle {
	if (!progress) {
		return {
			mode: 'fresh',
			canReset: false,
			status: null,
			attemptState: null,
			startedAt: null
		};
	}

	const attemptState = parseLessonAttemptState(progress.attemptState);
	const shouldResume = progress.status === 'active' && attemptState !== null;

	return {
		mode: shouldResume ? 'resume' : 'fresh',
		canReset: progress.status === 'completed',
		status: progress.status,
		attemptState,
		startedAt: progress.startedAt
	};
}

export function canResetLessonAttempt(lifecycle: LessonAttemptLifecycle): boolean {
	return lifecycle.canReset;
}

export function withDerivedLessonStatus<TType extends string>(
	allLessons: LessonLike<TType>[],
	progressRows: ProgressStatus[]
): Array<LessonLike<TType> & { status: LessonStatus }> {
	const progressMap = new Map(progressRows.map((row) => [row.lessonId, row.status]));

	const lessonsWithStatus = allLessons.map((lesson) => ({
		...lesson,
		status: (progressMap.get(lesson.id) ?? 'locked') as LessonStatus
	}));

	const activeIndexes = lessonsWithStatus
		.map((lesson, index) => ({ status: lesson.status, index }))
		.filter((item) => item.status === 'active')
		.map((item) => item.index);

	if (activeIndexes.length > 1) {
		for (const index of activeIndexes.slice(1)) {
			lessonsWithStatus[index].status = 'locked';
		}
	}

	if (activeIndexes.length === 0) {
		const firstIncompleteIndex = lessonsWithStatus.findIndex(
			(lesson) => lesson.status !== 'completed'
		);
		if (firstIncompleteIndex !== -1) {
			lessonsWithStatus[firstIncompleteIndex].status = 'active';
		}
	}

	return lessonsWithStatus;
}
