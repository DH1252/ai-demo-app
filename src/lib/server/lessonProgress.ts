type LessonStatus = 'completed' | 'active' | 'locked';

type LessonLike<TType extends string = string> = {
	id: string;
	title: string;
	type: TType;
};

type ProgressStatus = {
	lessonId: string;
	status: LessonStatus;
};

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
