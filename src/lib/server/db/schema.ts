import {
	integer,
	sqliteTable,
	text,
	customType,
	uniqueIndex,
	index
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const vector = customType<{ data: number[]; driverData: any }>({
	dataType() {
		return 'F32_BLOB(1024)';
	},
	toDriver(value: number[]) {
		return new Float32Array(value);
	},
	fromDriver(value: unknown) {
		if (value instanceof Float32Array) return Array.from(value);
		const buf = value as any;
		if (buf && buf.buffer) {
			return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
		}
		return Array.isArray(value) ? value : [];
	}
});

export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	username: text('username').unique().notNull(),
	passwordHash: text('password_hash').notNull(),
	name: text('name').notNull(),
	xp: integer('xp').notNull().default(0),
	streak: integer('streak').notNull().default(0),
	hearts: integer('hearts').notNull().default(5),
	coins: integer('coins').notNull().default(0),
	role: text('role', { enum: ['student', 'admin'] })
		.notNull()
		.default('student'),
	lastActiveDate: text('last_active_date'),
	// ISO timestamp of last hearts mutation — used for passive heart regen (1/30 min).
	heartsLastUpdated: text('hearts_last_updated')
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	expiresAt: integer('expires_at').notNull()
});

export const lessons = sqliteTable('lessons', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	type: text('type', { enum: ['standard', 'test', 'ai-remedial'] })
		.notNull()
		.default('standard'),
	contentData: text('content_data').notNull(), // stringified JSON
	videoUrl: text('video_url'),
	s3Key: text('s3_key'),
	aiContext: text('ai_context')
});

export const userProgress = sqliteTable(
	'user_progress',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		lessonId: text('lesson_id')
			.notNull()
			.references(() => lessons.id),
		status: text('status', { enum: ['completed', 'active'] })
			.notNull()
			.default('active'),
		// Server-recorded ISO timestamp of first lesson activation — used for
		// server-side speed bonus computation (replaces client-sent elapsedSeconds).
		startedAt: text('started_at')
	},
	(table) => [uniqueIndex('user_progress_user_lesson_idx').on(table.userId, table.lessonId)]
);

export const studentMemories = sqliteTable(
	'student_memories',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		memoryText: text('memory_text').notNull(),
		embedding: vector('embedding')
	},
	(table) => [index('student_memories_user_idx').on(table.userId)]
);

export const lessonChunks = sqliteTable(
	'lesson_chunks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		lessonId: text('lesson_id')
			.notNull()
			.references(() => lessons.id),
		chunkText: text('chunk_text').notNull(),
		startTime: integer('start_time'),
		endTime: integer('end_time'),
		embedding: vector('embedding')
	},
	(table) => [index('lesson_chunks_lesson_idx').on(table.lessonId)]
);

export const learningPaths = sqliteTable('learning_paths', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	description: text('description').notNull().default(''),
	isActive: integer('is_active').notNull().default(0),
	createdAt: text('created_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});

export const learningPathLessons = sqliteTable(
	'learning_path_lessons',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		pathId: text('path_id')
			.notNull()
			.references(() => learningPaths.id),
		lessonId: text('lesson_id')
			.notNull()
			.references(() => lessons.id),
		order: integer('order').notNull().default(0)
	},
	(table) => [uniqueIndex('learning_path_lessons_path_lesson_idx').on(table.pathId, table.lessonId)]
);

export const userLearningPathSelections = sqliteTable('user_learning_path_selections', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id),
	pathId: text('path_id')
		.notNull()
		.references(() => learningPaths.id),
	selectedAt: text('selected_at')
		.notNull()
		.default(sql`CURRENT_TIMESTAMP`)
});
