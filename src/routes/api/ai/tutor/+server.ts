import {
	streamText,
	convertToModelMessages,
	tool,
	stepCountIs,
	wrapLanguageModel,
	extractReasoningMiddleware
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import {
	searchSimilarLessonChunks,
	searchStudentMemories,
	saveStudentMemory,
	getStudentProfileMemory
} from '$lib/server/ai/vectorProcessor';
import { isAiDebugEnabled } from '$lib/server/ai/debugState';
import type { RequestHandler } from './$types';
import type { UIMessage } from 'ai';

/** Narrows an unknown message object to one with a matching `role` string. */
function hasRole<R extends string>(m: unknown, role: R): m is { role: R } {
	return typeof m === 'object' && m !== null && (m as Record<string, unknown>).role === role;
}

const openai = createOpenAI({
	baseURL: (env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
	get apiKey() {
		const key = env.OPENAI_API_KEY;
		if (!key) throw new Error('Missing required environment variable: OPENAI_API_KEY');
		return key;
	}
});

/** Converts a raw second value into a MM:SS display string (e.g. 155 → "2:35"). */
function formatTimestamp(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return new Response('Unauthorized', { status: 401 });
	}

	// Reject oversized payloads before parsing to prevent memory exhaustion.
	const contentLength = request.headers.get('content-length');
	if (contentLength && parseInt(contentLength, 10) > 100_000) {
		return new Response('Payload too large', { status: 413 });
	}

	const body = await request.json();
	const parsed = z.object({ messages: z.array(z.unknown()) }).safeParse(body);
	if (!parsed.success) {
		return new Response('Invalid payload', { status: 400 });
	}

	const messages = parsed.data.messages as Array<Omit<UIMessage, 'id'>>;

	// Cap conversation history: keep the first message (seeded question context)
	// plus the most recent 20 to avoid silently overflowing the model context window.
	const MAX_HISTORY = 20;
	const cappedMessages =
		messages.length > MAX_HISTORY + 1 ? [messages[0], ...messages.slice(-MAX_HISTORY)] : messages;

	const reqUrl = new URL(request.url);
	const lessonId = reqUrl.searchParams.get('lessonId');
	const rawMode = reqUrl.searchParams.get('mode');
	const tutorMode: 'hint' | 'explain' = rawMode === 'explain' ? 'explain' : 'hint';
	// 'lesson' = in-question panel inside a lesson; anything else = standalone /tutor page.
	const tutorContext: 'lesson' | 'tutor' =
		reqUrl.searchParams.get('context') === 'lesson' ? 'lesson' : 'tutor';

	// Find the last message sent by the user (role check prevents picking up assistant messages).
	const lastUserMessageObj = [...cappedMessages].reverse().find((m) => hasRole(m, 'user')) as
		| { role: string; content?: unknown; parts?: Array<{ type?: string; text?: string }> }
		| undefined;

	let lastUserMessage = '';
	if (lastUserMessageObj) {
		if (typeof lastUserMessageObj.content === 'string') {
			lastUserMessage = lastUserMessageObj.content;
		} else if (Array.isArray(lastUserMessageObj.parts)) {
			const textPart = lastUserMessageObj.parts.find((p) => p.type === 'text');
			if (textPart?.text) lastUserMessage = textPart.text;
		}
	}

	// 1. Always fetch the student's onboarding profile directly (not via vector search,
	//    so it is injected on every request regardless of query similarity).
	// 2. Fetch semantically similar non-profile memories and lesson context in parallel.
	const [profileMemory, lessonContext, quirksContext] = await Promise.all([
		getStudentProfileMemory(locals.user.id),
		lessonId ? searchSimilarLessonChunks(lessonId, lastUserMessage, 3) : Promise.resolve([]),
		searchStudentMemories(locals.user.id, lastUserMessage, 3)
	]);

	// Format Lesson Context
	let lessonString = '';
	if (lessonContext.length > 0) {
		lessonString = '### RELEVANT LESSON VIDEO CONTEXT ###\n';
		for (const chunk of lessonContext) {
			lessonString += `[Timestamp: ${formatTimestamp(chunk.startTime ?? 0)} - ${formatTimestamp(chunk.endTime ?? 0)}]: ${chunk.chunkText}\n`;
		}
		lessonString +=
			'\n*Instruction: If you use the lesson context above to answer, ALWAYS boldly cite the exact video timestamp in MM:SS format (e.g. **2:35**) so the student knows where to re-watch!*\n\n';
	}

	// Format Student Profile + Quirks
	let memoryString = '';
	const allMemories = [...(profileMemory ? [profileMemory] : []), ...quirksContext];
	if (allMemories.length > 0) {
		memoryString = '### STUDENT PROFILE & QUIRKS (Personalize your response based on this) ###\n';
		for (const fact of allMemories) {
			memoryString += `- ${fact}\n`;
		}
		memoryString += '\n';
	}

	// Count prior assistant turns to drive explain-mode escalation tiers (tutor context only).
	const assistantTurnCount = cappedMessages.filter((m) => hasRole(m, 'assistant')).length;
	const nextExchange = assistantTurnCount + 1;

	let modeBlock: string;

	if (tutorMode === 'hint') {
		// ── Hint mode (both contexts) ─────────────────────────────────────────
		// Never reveal the answer. Guide the student with questions and nudges.
		modeBlock = `
TUTORING MODE: HINT ONLY
- Never reveal the correct answer directly, even if the student explicitly asks for it.
- Use only guiding questions and small nudges to lead the student toward the answer themselves.
- If the student is stuck, rephrase the question or offer a smaller hint — never the answer.`;
	} else if (tutorContext === 'lesson') {
		// ── Lesson in-question explain mode ──────────────────────────────────
		// Student has already answered (correctly or after exhausting attempts).
		// Give the full explanation immediately — no gating, no tiers.
		modeBlock = `
TUTORING MODE: FULL EXPLANATION
The student has finished attempting this question and wants a complete understanding.
- Immediately give a clear, thorough explanation of the concept being tested.
- State the correct answer and explain exactly why it is correct.
- Explain why the other options are incorrect (if multiple choice).
- Connect the concept to the broader lesson topic so it sticks.
- Keep it focused and digestible — thorough does not mean exhaustive.`;
	} else {
		// ── Standalone tutor explain mode (progressive tiers) ─────────────────
		// Student is struggling and has been escalated from hint mode.
		// Reveal detail gradually across exchanges to keep them engaged.
		let tier: string;
		if (nextExchange <= 2) {
			tier =
				'Give hints and guiding questions only. Do NOT reveal the correct answer yet — nudge the student toward it.';
		} else if (nextExchange <= 4) {
			tier =
				'Explain the concept step by step. Guide the student through the reasoning, but do not state the final answer outright.';
		} else {
			tier =
				'Give a complete explanation including the correct answer and full reasoning. Be thorough and clear.';
		}
		modeBlock = `
TUTORING MODE: PROGRESSIVE EXPLAIN (exchange ${nextExchange})
The student answered a question incorrectly and needs help. Escalate detail gradually.
Current tier instruction: ${tier}`;
	}

	// Sanitize display name to prevent prompt injection via crafted usernames.
	const safeName = locals.user.name.replace(/[^\w\s'\-]/g, '').trim() || 'Student';

	const systemPrompt = `You are a friendly, encouraging AI Study Mascot Tutor. You are tutoring ${safeName}.

RULES:
1. Be uplifting, highly encouraging, and fun. Use 1-2 emojis per message maximum.
2. Keep responses concise — 2-4 sentences unless a step-by-step explanation is needed.
3. Do not give the answer directly. Use the Socratic method — ask guiding questions to help the student arrive at the correct answer themselves.
4. Personalize your approach based on the student's quirks.
5. Keep explanations simple, clear, and appropriate for a high school reading level.
6. If the student STATES something new and personal about themselves — a hobby, interest, favorite subject, learning preference, or any detail about their life outside the current academic topic — you MUST call the saveMemoryFact tool to store it BEFORE replying. Only trigger this when the student is actively sharing information, not asking questions or talking about the lesson.
   ✅ Trigger: "I love gaming", "I hate reading", "I'm a visual learner", "I play basketball", "I have a math test tomorrow"
   ❌ Do NOT trigger: "do you remember my preferences?", "what do you know about me?", or any academic/lesson questions.
7. You MUST always end every response with at least one sentence of visible text addressed directly to the student — even after calling a tool. A tool call is never a substitute for a reply. Never produce a response that is empty or contains only your internal reasoning.
${modeBlock}
${lessonString}
${memoryString}`;

	// Capture userId before entering any async callbacks to avoid referencing
	// locals after the request handler may have returned.
	const userId = locals.user.id;

	// Debug logging — prints to server console when AI debug mode is enabled
	// from the admin panel.
	const debug = isAiDebugEnabled();
	if (debug) {
		console.log('\n[AI DEBUG] ════════════════ New Tutor Request ════════════════');
		console.log(`[AI DEBUG]  User    : ${locals.user.name} (${userId})`);
		console.log(`[AI DEBUG]  Mode    : ${tutorMode} | Lesson: ${lessonId ?? 'none'}`);
		console.log(`[AI DEBUG]  Messages: ${messages.length}`);
		console.log(`[AI DEBUG]  System Prompt:\n${systemPrompt}`);
		console.log('[AI DEBUG] ═══════════════════════════════════════════════════\n');
	}

	// Per-request flag — prevents the tool from firing more than once per turn.
	let memoryFactSaved = false;

	try {
		const result = streamText({
			model: wrapLanguageModel({
				model: openai.chat(env.AI_MODEL || 'nvidia/nemotron-3-super-120b-a12b'),
				middleware: extractReasoningMiddleware({ tagName: 'think' })
			}),
			temperature: 1,
			topP: 0.95,
			system: systemPrompt,
			messages: await convertToModelMessages(cappedMessages),
			// Allow up to 5 steps so the model has room to: call the tool, receive the
			// result, and still produce a visible text reply even if the first tool call
			// attempt has an unexpected shape.
			stopWhen: stepCountIs(5),
			tools: {
				saveMemoryFact: tool({
					description:
						'Save a personal fact about the student to memory. Call this only when the student is actively stating new personal information — a hobby, interest, learning preference, or life detail. Do NOT call for questions, greetings, or academic content.',
					inputSchema: z.object({
						summary: z
							.string()
							.describe(
								'A single plain-English sentence describing the fact. Example: "Student enjoys board games." Pass a plain string — do NOT use nested objects or key-value pairs.'
							)
					}),
					execute: async (input: { summary: string }) => {
						if (memoryFactSaved) return 'Memory already saved this turn.';

						// The model sometimes sends non-standard shapes such as
						// { hobby: "..." } or { properties: { hobby: "..." } }
						// instead of { summary: "..." }. Extract any string value
						// we can find rather than hard-failing.
						let fact: string = input.summary?.trim() ?? '';
						if (!fact) {
							const raw = input as unknown as Record<string, unknown>;
							outer: for (const v of Object.values(raw)) {
								if (typeof v === 'string' && v.trim()) {
									fact = v.trim();
									break;
								}
								if (typeof v === 'object' && v !== null) {
									for (const inner of Object.values(v as Record<string, unknown>)) {
										if (typeof inner === 'string' && inner.trim()) {
											fact = inner.trim();
											break outer;
										}
									}
								}
							}
						}

						if (!fact) return 'No fact found in input — nothing was saved.';
						memoryFactSaved = true;
						await saveStudentMemory(userId, fact);
						return 'Fact saved to student memory successfully.';
					}
				})
			},
			onStepFinish: (step) => {
				if (!isAiDebugEnabled()) return;
				console.log(`\n[AI DEBUG] ── Step ${step.stepNumber} ──`);
				console.log(`[AI DEBUG]  Finish reason : ${step.finishReason}`);
				if (step.reasoningText) {
					const preview = step.reasoningText.slice(0, 500);
					console.log(
						`[AI DEBUG]  Reasoning     : ${preview}${step.reasoningText.length > 500 ? '…' : ''}`
					);
				}
				if (step.text) {
					const preview = step.text.slice(0, 500);
					console.log(`[AI DEBUG]  Text          : ${preview}${step.text.length > 500 ? '…' : ''}`);
				}
				if (step.toolCalls && step.toolCalls.length > 0) {
					console.log(`[AI DEBUG]  Tool calls    : ${JSON.stringify(step.toolCalls)}`);
				}
				if (step.toolResults && step.toolResults.length > 0) {
					console.log(`[AI DEBUG]  Tool results  : ${JSON.stringify(step.toolResults)}`);
				}
				if (step.usage) {
					console.log(
						`[AI DEBUG]  Usage         : input=${step.usage.inputTokens} output=${step.usage.outputTokens}`
					);
				}
			},
			onFinish: (result) => {
				if (!isAiDebugEnabled()) return;
				console.log('\n[AI DEBUG] ════════════════ Request Complete ════════════════');
				console.log(`[AI DEBUG]  Steps         : ${result.steps.length}`);
				console.log(`[AI DEBUG]  Finish reason : ${result.finishReason}`);
				if (result.usage) {
					console.log(
						`[AI DEBUG]  Total usage   : input=${result.usage.inputTokens} output=${result.usage.outputTokens} total=${result.usage.totalTokens}`
					);
				}
				console.log('[AI DEBUG] ═══════════════════════════════════════════════════\n');
			}
		});

		return result.toUIMessageStreamResponse();
	} catch (e) {
		console.error('Tutor streamText initialisation failed:', e);
		return new Response(JSON.stringify({ error: 'AI service unavailable. Please try again.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
