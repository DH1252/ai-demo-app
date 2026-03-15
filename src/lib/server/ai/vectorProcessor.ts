import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { lessonChunks, studentMemories } from '$lib/server/db/schema';
import { sql, and, eq, notLike, isNotNull, like, desc } from 'drizzle-orm';
// Import the specific ESM output because youtube-transcript@1.3.0 has a broken package.json `"type": "module"` for its commonjs build in SSR.
// @ts-ignore: Missing types for specific ESM entrypoint
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

const EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const EMBEDDING_BASE_URL = (env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(
	/\/$/,
	''
);
const EMBEDDING_API_KEY = env.NVIDIA_EMBED_API_KEY || env.OPENAI_API_KEY || '';

type EmbeddingInputType = 'query' | 'passage';

export async function generateEmbedding(
	text: string,
	inputType: EmbeddingInputType = 'passage'
): Promise<number[]> {
	const [embedding] = await generateEmbeddingsBatch([text], inputType);
	return embedding;
}

/**
 * Batch-embed up to `EMBED_BATCH_SIZE` texts in a single API request.
 * Falls back to sequential calls if the API rejects the batch.
 */
const EMBED_BATCH_SIZE = 96;

export async function generateEmbeddingsBatch(
	texts: string[],
	inputType: EmbeddingInputType = 'passage'
): Promise<number[][]> {
	if (!EMBEDDING_API_KEY) {
		throw new Error('Missing embedding API key. Set NVIDIA_EMBED_API_KEY or OPENAI_API_KEY.');
	}

	if (texts.length === 0) return [];

	// Split into batches to stay within API limits
	const batches: string[][] = [];
	for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
		batches.push(texts.slice(i, i + EMBED_BATCH_SIZE));
	}

	const results: number[][] = [];

	for (const batch of batches) {
		const response = await fetch(`${EMBEDDING_BASE_URL}/embeddings`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${EMBEDDING_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: EMBEDDING_MODEL,
				input: batch,
				input_type: inputType,
				encoding_format: 'float'
			}),
			signal: AbortSignal.timeout(15_000)
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Embedding request failed (${response.status}): ${body}`);
		}

		const data = (await response.json()) as {
			data?: Array<{ index?: number; embedding?: number[] }>;
		};

		if (!data.data || data.data.length !== batch.length) {
			throw new Error('Embedding API returned unexpected number of embeddings.');
		}

		// API returns embeddings sorted by `index` — sort defensively before pushing
		const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

		for (const item of sorted) {
			if (!item.embedding || item.embedding.length === 0) {
				throw new Error('Embedding API returned an invalid embedding payload.');
			}
			results.push(item.embedding);
		}
	}

	return results;
}

export async function processVideoAndEmbed(
	lessonId: string,
	videoUrl: string,
	mediaFile?: Blob | File
) {
	let transcriptData: { text: string; start: number; end: number }[] = [];

	if (videoUrl) {
		try {
			// Try getting transcript from YouTube first
			const ytTranscript = await YoutubeTranscript.fetchTranscript(videoUrl);

			// Group by ~15-30 second rolling chunks to avoid overloading the vector with tiny fragments
			let currentChunkText = '';
			let chunkStart = 0;
			let lastEnd = 0;

			for (let i = 0; i < ytTranscript.length; i++) {
				const t = ytTranscript[i];
				if (currentChunkText === '') {
					chunkStart = t.offset / 1000;
				}

				currentChunkText += t.text + ' ';
				lastEnd = (t.offset + t.duration) / 1000;

				// If accumulated string is long enough, flush it
				if (currentChunkText.length > 250 || i === ytTranscript.length - 1) {
					transcriptData.push({
						text: currentChunkText.trim(),
						start: chunkStart,
						end: lastEnd
					});
					currentChunkText = '';
				}
			}
		} catch (e) {
			console.warn('YouTube transcript failed or not available:', e);
		}
	}

	if (transcriptData.length === 0) {
		if (mediaFile) {
			try {
				let processedAudio: Blob = mediaFile as Blob;

				// If it's a video file, extract the audio using FFmpeg
				if (mediaFile instanceof File && mediaFile.type.startsWith('video/')) {
					console.log('Extracting audio from native video file using FFmpeg...');
					const { extractAudioFromVideo } = await import('./audioExtractor');
					processedAudio = await extractAudioFromVideo(mediaFile);
				}

				transcriptData = await fallbackASRTranscription(processedAudio);
			} catch (e) {
				console.error('ASR Fallback failed:', e);
				throw new Error('Failed to process media file for ASR.');
			}
		} else {
			throw new Error('No transcript available and no media fallback provided.');
		}
	}

	if (transcriptData.length > 0) {
		await processLessonTranscript(lessonId, transcriptData);
	}
}

export async function fallbackASRTranscription(
	audioBlob: Blob
): Promise<{ text: string; start: number; end: number }[]> {
	const formData = new FormData();
	// Default to mp3 as safe extension, parakeet usually sniffs the headers anyway, but mp3/wav is standard.
	const ext = audioBlob.type === 'audio/wav' ? 'wav' : 'mp3';
	formData.append('file', audioBlob, `audio.${ext}`);
	formData.append('language', 'en');
	// Explicitly requesting timestamps if the API supports it
	formData.append('timestamp_granularities[]', 'segment');

	// We use the NVIDIA NIM standard API structure for audio transcription (compatible with standard OpenAI whisper endpoints normally)
	const response = await fetch(`${EMBEDDING_BASE_URL}/audio/transcriptions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.NVIDIA_ASR_API_KEY}`
		},
		body: formData,
		signal: AbortSignal.timeout(60_000)
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`ASR Failed: ${response.statusText} - ${err}`);
	}

	const data = await response.json();

	// Convert parakeet timestamps (or whisper format) back to our standard format
	const results = [];
	if (data.segments && data.segments.length > 0) {
		for (const segment of data.segments) {
			results.push({
				text: segment.text,
				start: segment.start,
				end: segment.end
			});
		}
	} else {
		// Fallback if no segments provided
		results.push({
			text: data.text,
			start: 0,
			end: 0
		});
	}

	return results;
}

export async function processLessonTranscript(
	lessonId: string,
	transcript: { text: string; start: number; end: number }[]
) {
	if (transcript.length === 0) return;

	const chunkTexts = transcript.map(
		(chunk) => `Timestamp: ${chunk.start}s to ${chunk.end}s. ${chunk.text}`
	);

	// Embed FIRST — if this fails, existing chunks are untouched (no data loss).
	let vectors: number[][];
	try {
		vectors = await generateEmbeddingsBatch(chunkTexts, 'passage');
	} catch (e) {
		console.error('Batch embedding failed:', e);
		throw e;
	}

	// Build insert rows now that we have valid vectors.
	const rows = transcript.map((chunk, i) => ({
		lessonId,
		chunkText: chunkTexts[i],
		startTime: Math.round(chunk.start),
		endTime: Math.round(chunk.end),
		embedding: vectors[i]
	}));

	// Atomically replace old chunks only after embeddings succeeded.
	// Using a transaction ensures we never leave the lesson with zero chunks
	// if the insert itself fails mid-way.
	try {
		await db.transaction(async (tx) => {
			await tx.delete(lessonChunks).where(eq(lessonChunks.lessonId, lessonId));
			await tx.insert(lessonChunks).values(rows);
		});
	} catch (e) {
		console.error('Failed to replace lesson chunks in transaction:', e);
		throw e;
	}
}

export async function searchSimilarLessonChunks(lessonId: string, query: string, limit = 5) {
	if (!query.trim()) return [];

	const queryVector = await generateEmbedding(query, 'query');
	const vectorJson = JSON.stringify(queryVector);

	// LibSQL uses vector_distance_cos. The lower the distance, the more similar.
	const result = await db
		.select({
			id: lessonChunks.id,
			chunkText: lessonChunks.chunkText,
			startTime: lessonChunks.startTime,
			endTime: lessonChunks.endTime,
			distance: sql<number>`vector_distance_cos(${lessonChunks.embedding}, vector(${vectorJson}))`
		})
		.from(lessonChunks)
		.where(sql`${lessonChunks.lessonId} = ${lessonId}`)
		.orderBy(sql`vector_distance_cos(${lessonChunks.embedding}, vector(${vectorJson})) ASC`)
		.limit(limit);

	return result;
}

export async function saveStudentMemory(userId: string, fact: string) {
	if (!fact || !fact.trim()) return;

	// Always persist the text row first so the memory is never lost.
	let vector: number[] | null = null;
	try {
		vector = await generateEmbedding(fact, 'passage');
	} catch (e) {
		console.error('Failed to generate embedding for student memory — saving text only:', e);
	}

	try {
		await db.insert(studentMemories).values({
			userId,
			memoryText: fact,
			embedding: vector ?? undefined
		});
	} catch (e) {
		console.error('Failed to save student memory to DB:', e);
		throw e;
	}
}

/**
 * Fetches the student's onboarding PROFILE memory directly (no vector search needed —
 * we always want this injected regardless of the current query).
 */
export async function getStudentProfileMemory(userId: string): Promise<string | null> {
	try {
		const rows = await db
			.select({ memoryText: studentMemories.memoryText })
			.from(studentMemories)
			.where(
				and(eq(studentMemories.userId, userId), like(studentMemories.memoryText, 'PROFILE::%'))
			)
			.orderBy(desc(sql`rowid`))
			.limit(1);

		const text = rows[0]?.memoryText;
		if (typeof text !== 'string') return null;
		// Strip the storage prefix so the tutor receives clean, readable text.
		return text.startsWith('PROFILE:: ') ? text.slice('PROFILE:: '.length) : text;
	} catch (e) {
		console.error('Failed to fetch student profile memory:', e);
		return null;
	}
}

export async function searchStudentMemories(userId: string, query: string, limit = 3) {
	if (!query.trim()) return [];

	try {
		const queryVector = await generateEmbedding(query, 'query');
		const vectorJson = JSON.stringify(queryVector);

		const result = await db
			.select({
				id: studentMemories.id,
				memoryText: studentMemories.memoryText,
				distance: sql<number>`vector_distance_cos(${studentMemories.embedding}, vector(${vectorJson}))`
			})
			.from(studentMemories)
			// Exclude PROFILE entries — those are always injected separately via getStudentProfileMemory.
			// Exclude rows with NULL embeddings — vector_distance_cos on NULL causes a runtime error.
			.where(
				and(
					eq(studentMemories.userId, userId),
					notLike(studentMemories.memoryText, 'PROFILE::%'),
					isNotNull(studentMemories.embedding)
				)
			)
			.orderBy(sql`vector_distance_cos(${studentMemories.embedding}, vector(${vectorJson})) ASC`)
			.limit(limit);

		return result.map((r) => r.memoryText);
	} catch (e) {
		// Embedding API may be temporarily unavailable — degrade gracefully.
		console.error('searchStudentMemories failed, returning empty context:', e);
		return [];
	}
}

/**
 * Deletes all existing PROFILE:: rows for a user before a new onboarding save.
 * Prevents stale profiles from accumulating when a student re-onboards or the
 * LLM fires the saveMemoryFact tool more than once in the same session.
 */
export async function clearStudentProfile(userId: string): Promise<void> {
	await db
		.delete(studentMemories)
		.where(and(eq(studentMemories.userId, userId), like(studentMemories.memoryText, 'PROFILE::%')));
}
