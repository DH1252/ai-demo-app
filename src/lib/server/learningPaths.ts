import { db } from '$lib/server/db';
import {
	learningPathLessons,
	learningPaths,
	lessons,
	userLearningPathSelections
} from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';

type LessonListItem = {
	id: string;
	title: string;
	type: 'standard' | 'test' | 'ai-remedial';
};

let ensured = false;
let ensuringPromise: Promise<void> | null = null;

async function _doEnsure(): Promise<void> {
	await db.$client.execute(`
        CREATE TABLE IF NOT EXISTS learning_paths (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

	await db.$client.execute(`
        CREATE TABLE IF NOT EXISTS learning_path_lessons (
            id TEXT PRIMARY KEY NOT NULL,
            path_id TEXT NOT NULL REFERENCES learning_paths(id),
            lesson_id TEXT NOT NULL REFERENCES lessons(id),
            "order" INTEGER NOT NULL DEFAULT 0
        )
    `);

	await db.$client.execute(`
        CREATE TABLE IF NOT EXISTS user_learning_path_selections (
            user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
            path_id TEXT NOT NULL REFERENCES learning_paths(id),
            selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

	ensured = true;
}

export async function ensureLearningPathTables(): Promise<void> {
	if (ensured) return;
	if (!ensuringPromise) {
		ensuringPromise = _doEnsure().catch((err) => {
			// Reset so the next call retries rather than re-throwing the same
			// rejected promise forever (which would permanently break all learning
			// path functionality for the lifetime of this worker).
			ensuringPromise = null;
			throw err;
		});
	}
	return ensuringPromise;
}

export async function getPathIdForUser(userId: string | null): Promise<string | null> {
	await ensureLearningPathTables();

	if (userId) {
		const selectedRows = await db
			.select({ pathId: userLearningPathSelections.pathId })
			.from(userLearningPathSelections)
			.where(eq(userLearningPathSelections.userId, userId))
			.limit(1);

		if (selectedRows[0]?.pathId) {
			return selectedRows[0].pathId;
		}
	}

	const activeRows = await db
		.select({ id: learningPaths.id })
		.from(learningPaths)
		.where(eq(learningPaths.isActive, 1))
		.limit(1);

	return activeRows[0]?.id ?? null;
}

export async function getLessonsForPath(pathId: string | null): Promise<LessonListItem[] | null> {
	await ensureLearningPathTables();

	if (!pathId) return null;

	// Single JOIN query instead of two round-trips.
	const rows = await db
		.select({
			id: lessons.id,
			title: lessons.title,
			type: lessons.type,
			order: learningPathLessons.order
		})
		.from(learningPathLessons)
		.innerJoin(lessons, eq(lessons.id, learningPathLessons.lessonId))
		.where(eq(learningPathLessons.pathId, pathId))
		.orderBy(asc(learningPathLessons.order));

	return rows.map(({ id, title, type }) => ({ id, title, type }));
}

export async function getOrderedLessonsForUser(userId: string | null): Promise<LessonListItem[]> {
	await ensureLearningPathTables();

	const selectedPathId = await getPathIdForUser(userId);
	const pathLessons = await getLessonsForPath(selectedPathId);

	if (pathLessons !== null) {
		return pathLessons;
	}

	return db
		.select({
			id: lessons.id,
			title: lessons.title,
			type: lessons.type
		})
		.from(lessons);
}

export async function getPathSummaries() {
	await ensureLearningPathTables();

	const paths = await db
		.select({
			id: learningPaths.id,
			name: learningPaths.name,
			description: learningPaths.description,
			isActive: learningPaths.isActive
		})
		.from(learningPaths)
		.orderBy(asc(learningPaths.createdAt));

	const mapping = await db
		.select({
			pathId: learningPathLessons.pathId,
			lessonId: learningPathLessons.lessonId,
			order: learningPathLessons.order
		})
		.from(learningPathLessons)
		.orderBy(asc(learningPathLessons.order));

	const mapByPath = new Map<string, Array<{ lessonId: string; order: number }>>();
	for (const row of mapping) {
		const existing = mapByPath.get(row.pathId) ?? [];
		existing.push({ lessonId: row.lessonId, order: row.order });
		mapByPath.set(row.pathId, existing);
	}

	return paths.map((path) => ({
		...path,
		lessonIds: (mapByPath.get(path.id) ?? []).map((item) => item.lessonId)
	}));
}

export async function selectPathForUser(userId: string, pathId: string) {
	await ensureLearningPathTables();

	const pathRows = await db
		.select({ id: learningPaths.id })
		.from(learningPaths)
		.where(eq(learningPaths.id, pathId))
		.limit(1);

	if (!pathRows[0]) {
		return false;
	}

	// Use upsert instead of delete+insert to eliminate the TOCTOU race window
	// where a concurrent request could read a missing row between the two statements.
	await db
		.insert(userLearningPathSelections)
		.values({ userId, pathId })
		.onConflictDoUpdate({
			target: userLearningPathSelections.userId,
			set: { pathId, selectedAt: new Date().toISOString() }
		});

	return true;
}

export async function hasOnboardingProfileMemory(userId: string): Promise<boolean> {
	await ensureLearningPathTables();

	const rows = await db.$client.execute({
		sql: 'SELECT id FROM student_memories WHERE user_id = ? AND memory_text LIKE ? LIMIT 1',
		args: [userId, 'PROFILE::%']
	});

	return (rows.rows?.length ?? 0) > 0;
}

export async function pathExists(pathId: string): Promise<boolean> {
	await ensureLearningPathTables();

	const rows = await db
		.select({ id: learningPaths.id })
		.from(learningPaths)
		.where(eq(learningPaths.id, pathId))
		.limit(1);

	return Boolean(rows[0]);
}

export async function setActivePath(pathId: string) {
	await ensureLearningPathTables();

	await db.transaction(async (tx) => {
		await tx.update(learningPaths).set({ isActive: 0 });
		await tx.update(learningPaths).set({ isActive: 1 }).where(eq(learningPaths.id, pathId));
	});
}

export async function setPathLessons(pathId: string, lessonIds: string[]) {
	await ensureLearningPathTables();

	await db.delete(learningPathLessons).where(eq(learningPathLessons.pathId, pathId));

	if (lessonIds.length === 0) return;

	await db.insert(learningPathLessons).values(
		lessonIds.map((lessonId, index) => ({
			pathId,
			lessonId,
			order: index + 1
		}))
	);
}

export async function createPath(name: string, description: string) {
	await ensureLearningPathTables();

	const inserted = await db
		.insert(learningPaths)
		.values({
			name,
			description: description || '',
			isActive: 0
		})
		.returning({ id: learningPaths.id });

	return inserted[0]?.id ?? null;
}
