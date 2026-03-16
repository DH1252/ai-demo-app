import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const BASELINE_REQUIRED_TABLES = ['users', 'lessons', 'lesson_chunks', 'student_memories'];

const isRailway = Boolean(process.env.RAILWAY_PROJECT_ID);
const legacyMigrateFlag = process.env.RUN_DB_PUSH_ON_START;
const migrateOnStartFlag = process.env.RUN_DB_MIGRATE_ON_START;
const shouldMigrate =
	migrateOnStartFlag === 'true' ||
	(migrateOnStartFlag !== 'false' && legacyMigrateFlag === 'true') ||
	(isRailway && migrateOnStartFlag !== 'false' && legacyMigrateFlag !== 'false');

function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		env: process.env,
		shell: false
	});

	if (typeof result.status === 'number' && result.status !== 0) {
		process.exit(result.status);
	}

	if (result.error) {
		throw result.error;
	}
}

/**
 * Baseline an existing pre-migration database.
 *
 * When switching from `db:push` to `db:migrate`, the production DB already
 * has the correct schema but no migration tracking table. Without baselining,
 * `db:migrate` would try to re-run the initial migration and fail on
 * "table already exists" errors.
 *
 * This function:
 *   1. Detects whether the DB was provisioned before migrations were introduced
 *      (has tables but no __drizzle_migrations tracking table).
 *   2. If so, creates the tracking table and marks every current migration as
 *      applied (by inserting their SHA-256 hashes) WITHOUT running their SQL.
 *   3. After baselining, `db:migrate` becomes a safe no-op for the initial
 *      migration and only applies genuinely new ones going forward.
 */
async function baselineIfNeeded() {
	if (!process.env.DATABASE_URL) {
		console.warn('[startup] DATABASE_URL not set — skipping baseline check.');
		return;
	}

	const journalPath = join(projectRoot, 'drizzle', 'meta', '_journal.json');
	if (!existsSync(journalPath)) {
		console.log('[startup] No migration journal found — skipping baseline.');
		return;
	}

	// @libsql/client requires a proper URI scheme. Railway sets DATABASE_URL to
	// a bare path like "/data/sqlite.db" — prefix it with "file:" if needed.
	const rawUrl = process.env.DATABASE_URL;
	const dbUrl = rawUrl.startsWith('file:') ? rawUrl : `file:${rawUrl}`;
	const client = createClient({ url: dbUrl });

	try {
		const requiredTablesSql = BASELINE_REQUIRED_TABLES.map(() => '?').join(', ');
		const tablesResult = await client.execute({
			sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTablesSql})`,
			args: BASELINE_REQUIRED_TABLES
		});
		if (tablesResult.rows.length === 0) {
			// Fresh DB — let db:migrate build everything from scratch.
			console.log('[startup] Fresh database detected — no baseline needed.');
			return;
		}

		if (tablesResult.rows.length !== BASELINE_REQUIRED_TABLES.length) {
			console.log('[startup] Partial pre-migration schema detected — skipping baseline.');
			return;
		}

		// DB has tables — check whether migration tracking already exists.
		const migTableResult = await client.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
		);
		if (migTableResult.rows.length > 0) {
			console.log('[startup] Migration tracking already set up — skipping baseline.');
			return;
		}

		// Existing DB without migration tracking — create the table and mark all
		// current migrations as applied so db:migrate treats them as already done.
		console.log('[startup] Baselining existing database for migration tracking...');

		await client.execute(`
      CREATE TABLE __drizzle_migrations (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        hash  TEXT    NOT NULL,
        created_at NUMERIC NOT NULL
      )
    `);

		const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

		for (const entry of journal.entries) {
			const sqlPath = join(projectRoot, 'drizzle', `${entry.tag}.sql`);
			if (!existsSync(sqlPath)) {
				console.warn(`[startup] Migration file not found: ${entry.tag}.sql — skipping.`);
				continue;
			}
			// drizzle-orm computes the stored hash as sha256 of the raw SQL content.
			const sql = readFileSync(sqlPath, 'utf8');
			const hash = createHash('sha256').update(sql).digest('hex');

			await client.execute({
				sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
				args: [hash, entry.when]
			});
			console.log(`[startup]  ✓ Marked as applied: ${entry.tag}`);
		}

		console.log('[startup] Database baseline complete.');
	} finally {
		client.close();
	}
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (shouldMigrate) {
	await baselineIfNeeded();
	console.log('[startup] Running database migrations...');
	run(npmCmd, ['run', 'db:migrate']);
}

console.log('[startup] Starting app server...');
run('node', ['build/index.js']);
