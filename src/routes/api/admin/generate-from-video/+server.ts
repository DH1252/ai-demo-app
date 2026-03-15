import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { fallbackASRTranscription } from '$lib/server/ai/vectorProcessor';
import { extractAudioFromVideo } from '$lib/server/ai/audioExtractor';
import ytdl from '@distube/ytdl-core';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
// Import specific ESM entrypoint for SSR compatibility.
// @ts-ignore: package lacks typings for this path.
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import type { RequestHandler } from './$types';

const questionSchema = z.object({
	text: z.string().min(8),
	options: z.array(z.string().min(1)).length(4),
	correctOptionIndex: z.number().int().min(0).max(3),
	explanation: z.string().min(8)
});

function buildResponseSchema(count: number) {
	return z.object({
		questions: z.array(questionSchema).min(count)
	});
}

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim();

	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		return JSON.parse(trimmed);
	}

	const withoutCodeFences = trimmed
		.replace(/^```json\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/```$/i, '')
		.trim();

	if (withoutCodeFences.startsWith('{') && withoutCodeFences.endsWith('}')) {
		return JSON.parse(withoutCodeFences);
	}

	const firstBrace = withoutCodeFences.indexOf('{');
	const lastBrace = withoutCodeFences.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		const candidate = withoutCodeFences.slice(firstBrace, lastBrace + 1);
		return JSON.parse(candidate);
	}

	throw new Error('Model did not return valid JSON object.');
}

type TranscriptChunk = {
	text: string;
	start: number;
	end: number;
};

function normalizeTranscript(chunks: TranscriptChunk[]): TranscriptChunk[] {
	return chunks
		.map((chunk) => ({
			text: chunk.text.replace(/\s+/g, ' ').trim(),
			start: Number.isFinite(chunk.start) ? chunk.start : 0,
			end: Number.isFinite(chunk.end) ? chunk.end : 0
		}))
		.filter((chunk) => chunk.text.length >= 12);
}

function isLikelyHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

function isLikelyVideoPath(value: string): boolean {
	try {
		const pathname = new URL(value).pathname.toLowerCase();
		return ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].some((ext) => pathname.endsWith(ext));
	} catch {
		return false;
	}
}

function isPrivateIPv4(value: string): boolean {
	const parts = value.split('.').map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
		return false;
	}

	const [a, b] = parts;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 0) return true;
	return false;
}

function isPrivateIPv6(value: string): boolean {
	const normalized = value.toLowerCase();
	// ::ffff:x.x.x.x is an IPv6-mapped IPv4 address — treat it as IPv4 for
	// SSRF purposes so that e.g. ::ffff:127.0.0.1 is correctly blocked.
	if (normalized.startsWith('::ffff:')) {
		const ipv4Part = normalized.slice('::ffff:'.length);
		return isPrivateIPv4(ipv4Part);
	}
	return (
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80:')
	);
}

function isPrivateIp(value: string): boolean {
	const version = isIP(value);
	if (version === 4) return isPrivateIPv4(value);
	if (version === 6) return isPrivateIPv6(value);
	return false;
}

async function isSafeRemoteHost(urlValue: string): Promise<boolean> {
	const parsed = new URL(urlValue);
	const hostname = parsed.hostname.toLowerCase();

	if (hostname === 'localhost' || hostname.endsWith('.local')) {
		return false;
	}

	if (isPrivateIp(hostname)) {
		return false;
	}

	try {
		const resolved = await lookup(hostname, { all: true });
		if (resolved.some((entry) => isPrivateIp(entry.address))) {
			return false;
		}
	} catch {
		return false;
	}

	return true;
}

async function fromYoutube(videoUrl: string): Promise<TranscriptChunk[]> {
	try {
		const transcript = await YoutubeTranscript.fetchTranscript(videoUrl);
		return transcript.map((row: { text: string; offset: number; duration: number }) => ({
			text: row.text,
			start: row.offset / 1000,
			end: (row.offset + row.duration) / 1000
		}));
	} catch {
		return [];
	}
}

async function downloadYoutubeAudioBlob(videoUrl: string): Promise<Blob> {
	if (!ytdl.validateURL(videoUrl)) {
		throw new Error('Invalid YouTube URL for media download.');
	}

	const maxBytes = 100 * 1024 * 1024;
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	await new Promise<void>((resolve, reject) => {
		const stream = ytdl(videoUrl, {
			filter: 'audioonly',
			quality: 'lowestaudio',
			highWaterMark: 1 << 24
		});

		stream.on('data', (chunk: Buffer) => {
			totalBytes += chunk.length;
			if (totalBytes > maxBytes) {
				stream.destroy(new Error('Downloaded YouTube audio exceeds 100MB limit.'));
				return;
			}
			chunks.push(chunk);
		});

		stream.on('end', () => resolve());
		stream.on('error', (error) => reject(error));
	});

	const blobParts = chunks.map(
		(chunk) =>
			chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
	);
	return new Blob(blobParts, { type: 'audio/mp4' });
}

async function downloadRemoteMediaBlob(mediaUrl: string): Promise<Blob> {
	const maxBytes = 100 * 1024 * 1024;
	const response = await fetch(mediaUrl, {
		signal: AbortSignal.timeout(45_000)
	});

	if (!response.ok || !response.body) {
		throw new Error('Failed to download remote media URL.');
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const mediaTypeAllowed =
		contentType.startsWith('video/') ||
		contentType.startsWith('audio/') ||
		(contentType === 'application/octet-stream' && isLikelyVideoPath(mediaUrl));

	if (!mediaTypeAllowed) {
		throw new Error('Remote URL does not appear to be downloadable video/audio media.');
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let totalBytes = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;

		totalBytes += value.length;
		if (totalBytes > maxBytes) {
			throw new Error('Downloaded remote media exceeds 100MB limit.');
		}

		chunks.push(
			new Uint8Array(
				value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
			)
		);
	}

	return new Blob(chunks, { type: contentType });
}

async function generateQuestionsFromTranscript(
	transcriptContext: string,
	count: number,
	strictConceptMode = false
): Promise<unknown> {
	const baseUrl = (env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
	const apiKey = env.OPENAI_API_KEY || '';
	const model = env.AI_MODEL || 'nvidia/nemotron-3-super-120b-a12b';

	if (!apiKey) {
		throw new Error('Missing OPENAI_API_KEY for question generation.');
	}

	const systemMessage = `You are an expert assessment designer. Your only output is a valid JSON object — no prose, no markdown fences, no explanation outside the JSON.

Output contract — return exactly this shape:
{
    "questions": [
        {
            "text": "string",
            "options": ["string", "string", "string", "string"],
            "correctOptionIndex": 0,
            "explanation": "string"
        }
    ]
}
${strictConceptMode ? '\nSTRICT CONCEPT MODE: Every question, option, and explanation must be purely about the academic subject. Do not reference the video, lecture, transcript, timestamp, narrator, speaker, clip, scene, or any time marker. Reject any draft that contains such references and regenerate internally before responding.' : ''}`;

	const userMessage = `Create exactly ${count} multiple-choice question${count === 1 ? '' : 's'} based on the academic subject taught in the lesson content below.

Quality rubric:
- Audience: high school students.
- Coverage: spread questions across different ideas, not the same fact repeated.
- Cognitive level: prioritize understanding and application over trivial memorization.
- Focus: ask about the underlying subject concepts, not about the video itself, speaker phrasing, timeline, or production details.
- Options: exactly 4 options per question, all plausible in context.
- Distractors: incorrect options must be believable misconceptions, not obviously silly.
- Correct answer: one correct option index from 0 to 3.
- Explanation: concise explanation for why the correct option is correct and why the distractors are less appropriate.
- Uniqueness: no duplicate or near-duplicate questions.
- Grounding: do not invent facts not present or inferable from the content.

Avoid wording such as "according to the video", "at minute", "the speaker says", or any reference to timestamps.

Lesson content:
${transcriptContext}`;

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		signal: AbortSignal.timeout(45_000),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model,
			temperature: 1,
			top_p: 0.95,
			messages: [
				{ role: 'system', content: systemMessage },
				{ role: 'user', content: userMessage }
			]
		})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Model request failed (${response.status}): ${body}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string | null } }>;
	};

	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('Model response did not include message content.');
	}

	return extractJsonObject(content);
}

const videoReferencePattern =
	/(according to (the )?(video|lecture|transcript)|in (the )?(video|lecture|clip)|speaker says|narrator|timestamp|timecode|minute\s*\d|at\s*\d+\s*(s|sec|seconds|min|minutes))/i;

function hasVideoReference(value: string): boolean {
	return videoReferencePattern.test(value);
}

type ResponsePayload = {
	questions: Array<{ text: string; options: string[]; explanation: string }>;
};

function containsVideoReferences(payload: ResponsePayload): boolean {
	return payload.questions.some((question) => {
		if (hasVideoReference(question.text) || hasVideoReference(question.explanation)) {
			return true;
		}

		return question.options.some((option) => hasVideoReference(option));
	});
}

export const POST: RequestHandler = async ({ request }) => {
	const encoder = new TextEncoder();

	// ── Early validation (returns plain JSON errors before any stream opens) ──
	const formData = await request.formData();
	const rawVideoUrl = formData.get('videoUrl');
	const rawMediaFile = formData.get('mediaFile');
	const rawSecret = formData.get('secret');

	const videoUrl = typeof rawVideoUrl === 'string' ? rawVideoUrl.trim() : '';
	const mediaFile = rawMediaFile instanceof File ? rawMediaFile : null;
	const secret = typeof rawSecret === 'string' ? rawSecret.trim() : '';

	const rawQuestionCount = formData.get('questionCount');
	const parsedCount = rawQuestionCount !== null ? Number.parseInt(String(rawQuestionCount), 10) : 3;
	const questionCount =
		Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 10 ? parsedCount : 3;

	if (!secret || secret !== env.ADMIN_SECRET) {
		return json({ error: 'Invalid admin secret.' }, { status: 403 });
	}

	if (!videoUrl && (!mediaFile || mediaFile.size === 0)) {
		return json({ error: 'Provide a video URL or upload a media file first.' }, { status: 400 });
	}

	if (videoUrl && !isLikelyHttpUrl(videoUrl)) {
		return json({ error: 'Video URL must start with http:// or https://.' }, { status: 400 });
	}

	if (videoUrl && !(await isSafeRemoteHost(videoUrl))) {
		return json({ error: 'Video URL host is not allowed.' }, { status: 400 });
	}

	if (mediaFile && mediaFile.size > 0) {
		const isSupportedType =
			mediaFile.type.startsWith('video/') || mediaFile.type.startsWith('audio/');
		if (!isSupportedType) {
			return json(
				{ error: 'Unsupported media type. Use video/* or audio/* files.' },
				{ status: 400 }
			);
		}
		const maxBytes = 100 * 1024 * 1024;
		if (mediaFile.size > maxBytes) {
			return json({ error: 'Media file is too large. Maximum size is 100MB.' }, { status: 413 });
		}
	}

	// ── SSE stream — all processing happens inside here ──
	type SseEvent =
		| { type: 'log'; message: string; progress?: number; status?: string }
		| { type: 'done'; questions: z.infer<typeof questionSchema>[] }
		| { type: 'error'; message: string };

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const emit = (event: SseEvent) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					// client disconnected — ignore
				}
			};

			const log = (message: string, progress?: number, status?: string) =>
				emit({
					type: 'log',
					message,
					...(progress !== undefined ? { progress } : {}),
					...(status ? { status } : {})
				});

			try {
				log('Request validated. Starting analysis pipeline.', 3, 'Starting');

				if (videoUrl) {
					log(`Source: URL — ${videoUrl}`, 4);
				}
				if (mediaFile && mediaFile.size > 0) {
					const kb = (mediaFile.size / 1024).toFixed(0);
					log(`Source: Uploaded file — ${mediaFile.name} (${kb} KB)`, 4);
				}
				log(`Target: ${questionCount} question${questionCount === 1 ? '' : 's'}.`, 5, 'Starting');

				let transcriptData: TranscriptChunk[] = [];

				// ── Stage 1: YouTube captions ──
				if (videoUrl) {
					log('Fetching YouTube captions...', 8, 'Fetching captions');
					const raw = await fromYoutube(videoUrl);
					const normalized = normalizeTranscript(raw);

					if (normalized.length > 0) {
						transcriptData = normalized;
						const wordCount = normalized.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0);
						log(
							`Captions found: ${raw.length} segments → ${normalized.length} passages (~${wordCount.toLocaleString()} words).`,
							22,
							'Captions fetched'
						);
					} else {
						log('No usable captions found for this video.', 12);
					}

					// ── Stage 2: Audio download + ASR fallback ──
					if (transcriptData.length === 0) {
						log('Falling back to audio download + speech recognition...', 14, 'Downloading audio');

						try {
							let downloadedBlob: Blob;

							if (ytdl.validateURL(videoUrl)) {
								log('Identified as YouTube video — downloading audio-only stream...', 16);
								downloadedBlob = await downloadYoutubeAudioBlob(videoUrl);
								const mb = (downloadedBlob.size / 1024 / 1024).toFixed(2);
								log(
									`YouTube audio downloaded (${mb} MB). Preparing for transcription...`,
									38,
									'Audio downloaded'
								);
							} else {
								log('Identified as direct media URL — downloading...', 16);
								downloadedBlob = await downloadRemoteMediaBlob(videoUrl);
								const mb = (downloadedBlob.size / 1024 / 1024).toFixed(2);
								log(
									`Remote media downloaded (${mb} MB, type: ${downloadedBlob.type || 'unknown'}).`,
									38,
									'Media downloaded'
								);
							}

							const isVideo =
								downloadedBlob.type.startsWith('video/') || isLikelyVideoPath(videoUrl);

							if (isVideo) {
								log(
									'Video stream detected — extracting audio track with FFmpeg...',
									40,
									'Extracting audio'
								);
								const videoFile = new File([downloadedBlob], 'remote-video', {
									type: downloadedBlob.type || 'video/mp4'
								});
								const extractedAudio = await extractAudioFromVideo(videoFile);
								const mb = (extractedAudio.size / 1024 / 1024).toFixed(2);
								log(
									`Audio extracted (${mb} MB). Sending to speech recognition API...`,
									52,
									'Transcribing'
								);
								transcriptData = normalizeTranscript(
									await fallbackASRTranscription(extractedAudio)
								);
							} else {
								const mb = (downloadedBlob.size / 1024 / 1024).toFixed(2);
								log(
									`Audio ready (${mb} MB). Sending to speech recognition API...`,
									42,
									'Transcribing'
								);
								transcriptData = normalizeTranscript(
									await fallbackASRTranscription(downloadedBlob)
								);
							}

							if (transcriptData.length > 0) {
								const wordCount = transcriptData.reduce(
									(sum, c) => sum + c.text.split(/\s+/).length,
									0
								);
								log(
									`Speech recognition complete: ${transcriptData.length} segments (~${wordCount.toLocaleString()} words).`,
									60,
									'Transcript ready'
								);
							} else {
								log(
									'Speech recognition returned no usable segments. Will try uploaded file if available.',
									60
								);
							}
						} catch (downloadErr) {
							log(
								`Audio download/ASR failed: ${downloadErr instanceof Error ? downloadErr.message : 'unknown error'}`,
								60
							);
						}
					}
				}

				// ── Stage 3: Uploaded media fallback ──
				if (transcriptData.length === 0 && mediaFile && mediaFile.size > 0) {
					const kb = (mediaFile.size / 1024).toFixed(0);
					log(`Processing uploaded file: ${mediaFile.name} (${kb} KB)...`, 14, 'Processing upload');

					let audioBlob: Blob = mediaFile;

					if (mediaFile.type.startsWith('video/')) {
						log('Video file detected — extracting audio with FFmpeg...', 20, 'Extracting audio');
						audioBlob = await extractAudioFromVideo(mediaFile);
						const mb = (audioBlob.size / 1024 / 1024).toFixed(2);
						log(
							`Audio extracted (${mb} MB). Sending to speech recognition API...`,
							40,
							'Transcribing'
						);
					} else {
						const mb = (audioBlob.size / 1024 / 1024).toFixed(2);
						log(
							`Audio file ready (${mb} MB). Sending to speech recognition API...`,
							22,
							'Transcribing'
						);
					}

					transcriptData = normalizeTranscript(await fallbackASRTranscription(audioBlob));

					if (transcriptData.length > 0) {
						const wordCount = transcriptData.reduce(
							(sum, c) => sum + c.text.split(/\s+/).length,
							0
						);
						log(
							`Speech recognition complete: ${transcriptData.length} segments (~${wordCount.toLocaleString()} words).`,
							60,
							'Transcript ready'
						);
					} else {
						log('Speech recognition returned no usable segments.', 60);
					}
				}

				// ── No transcript ──
				if (transcriptData.length === 0) {
					log('Transcript extraction failed — no usable content found from any source.', 65);
					emit({
						type: 'error',
						message:
							'Could not extract transcript from this source. For non-YouTube links, upload the media file instead.'
					});
					return;
				}

				// ── Stage 4: Build context + generate questions ──
				const transcriptContext = transcriptData
					.map((c) => c.text)
					.join(' ')
					.slice(0, 12_000);
				const contextWords = transcriptContext.split(/\s+/).length;
				log(
					`Context built: ~${contextWords.toLocaleString()} words across ${transcriptData.length} chunks (capped at 12,000 chars).`,
					65,
					'Generating questions'
				);
				log(
					`Sending transcript to LLM — requesting ${questionCount} question${questionCount === 1 ? '' : 's'}...`,
					68
				);

				const parsedObject = await generateQuestionsFromTranscript(
					transcriptContext,
					questionCount
				);

				// ── Stage 5: Validate ──
				log('LLM response received. Validating question schema...', 84, 'Validating');
				const responseSchema = buildResponseSchema(questionCount);
				let validated = responseSchema.safeParse(parsedObject);

				if (!validated.success) {
					const issues = validated.error.issues
						.map((issue: { message: string }) => issue.message)
						.join('; ');
					log(`Schema validation failed: ${issues}`, 86);
					emit({ type: 'error', message: 'AI returned invalid question format.' });
					return;
				}

				log(
					`Schema valid — model returned ${validated.data.questions.length} question${validated.data.questions.length === 1 ? '' : 's'}.`,
					87,
					'Quality check'
				);

				// ── Stage 6: Video reference check ──
				log('Checking questions for video-referential wording...', 88);

				if (containsVideoReferences(validated.data)) {
					log(
						'⚠ Video references detected — regenerating in strict concept mode...',
						90,
						'Strict mode'
					);

					const regenerated = await generateQuestionsFromTranscript(
						transcriptContext,
						questionCount,
						true
					);

					log('Strict mode response received. Re-validating schema...', 94);
					validated = responseSchema.safeParse(regenerated);

					if (!validated.success) {
						log('Strict regeneration failed schema validation.', 95);
						emit({ type: 'error', message: 'AI strict regeneration returned invalid format.' });
						return;
					}

					if (containsVideoReferences(validated.data)) {
						log('Strict regeneration still contains video-referential content.', 95);
						emit({
							type: 'error',
							message: 'AI generation remained too video-referential. Please retry.'
						});
						return;
					}

					log('Strict regeneration passed — all questions are concept-focused.', 96);
				} else {
					log('No video references detected — all questions are concept-focused.', 92);
				}

				// ── Done ──
				const finalQuestions = validated.data.questions.slice(0, questionCount);
				log(
					`All checks passed. Returning ${finalQuestions.length} question${finalQuestions.length === 1 ? '' : 's'}.`,
					98,
					'Finalizing'
				);

				emit({ type: 'done', questions: finalQuestions });
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: 'Failed to analyze video and generate questions.';
				log(`Unexpected error: ${message}`, undefined, 'Error');
				emit({ type: 'error', message });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			// Prevent nginx/Railway proxy from buffering the stream
			'X-Accel-Buffering': 'no'
		}
	});
};
