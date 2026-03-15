import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { saveStudentMemory, clearStudentProfile } from '$lib/server/ai/vectorProcessor';
import type { RequestHandler } from './$types';
import type { UIMessage } from 'ai';

const MAX_TIMEOUT_RETRIES = 3;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const text = `${error.name} ${error.message}`.toLowerCase();
	return (
		text.includes('timeout') ||
		text.includes('timed out') ||
		text.includes('etimedout') ||
		text.includes('fetch failed') ||
		text.includes('gateway timeout') ||
		text.includes('503')
	);
}

const openai = createOpenAI({
	baseURL: (env.OPENAI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
	apiKey: env.OPENAI_API_KEY || 'fake-key-for-now'
});

export const POST: RequestHandler = async ({ request, locals }) => {
	// Return 401 if unauthorized
	if (!locals.user) {
		return new Response('Unauthorized', { status: 401 });
	}

	const userId = locals.user.id;
	const body = await request.json();
	const parsed = z.object({ messages: z.array(z.unknown()) }).safeParse(body);
	if (!parsed.success) {
		return new Response('Invalid payload', { status: 400 });
	}

	const messages = parsed.data.messages as Array<Omit<UIMessage, 'id'>>;

	const systemPrompt = `You are Buddy, a friendly AI Study Mascot making a new high school student profile for ${locals.user.name}.
Your job is to interview the student conversationally about three things:
1. Their learning pace and style (e.g. Visual, reading-focused, hands-on, fast/slow)
2. Their hobbies and interests outside of school
3. The specific subjects they struggle with the most

INTERVIEW RULES:
- Be warm, welcoming, and conversational.
- Ask one question at a time.
- Keep messages short.
- Do not engage with any academic subject matter during the interview — redirect to the next interview question.

REQUIRED ACTION:
Once you have learned about their learning style, hobbies, AND struggled subjects, you MUST call the "saveMemoryFact" tool to save their profile summary and tell them they are ready to click "Start Learning".
`;

	const modelMessages = await convertToModelMessages(messages);

	for (let attempt = 1; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
		try {
			const result = streamText({
				model: openai.chat(env.AI_MODEL || 'nvidia/nemotron-3-super-120b-a12b'),
				temperature: 1,
				topP: 0.95,
				system: systemPrompt,
				messages: modelMessages,
				// stopWhen: stepCountIs(2) allows one tool-call step + one follow-up step.
				// The default stopWhen is stepCountIs(1), which stops immediately after the
				// first LLM response — meaning the tool execute() never runs and nothing
				// is saved to the DB.
				stopWhen: stepCountIs(2),
				tools: {
					saveMemoryFact: tool({
						description:
							'Saves the discovered learning profile, hobbies, and struggles into the student memory database once the interview is complete.',
						inputSchema: z.object({
							summary: z
								.string()
								.min(1)
								.describe(
									"A concise but highly detailed paragraph summarizing the student's learning style, hobbies, and subjects they struggle with."
								)
						}),
						execute: async (args: { summary: string }) => {
							const summary = typeof args?.summary === 'string' ? args.summary.trim() : '';
							if (!summary) {
								return 'Profile save skipped — summary was empty. Continue the interview and try again.';
							}
							// Remove any stale profile rows before saving the new one, so re-onboarding
							// or a double tool-call never accumulates duplicate PROFILE:: records.
							await clearStudentProfile(userId);
							await saveStudentMemory(userId, `PROFILE:: ${summary}`);

							return 'Profile successfully saved. Tell the user they are ready to learn!';
						}
					})
				}
			});

			return result.toUIMessageStreamResponse();
		} catch (error) {
			if (attempt < MAX_TIMEOUT_RETRIES && isRetryableTimeoutError(error)) {
				await sleep(300 * attempt);
				continue;
			}

			if (isRetryableTimeoutError(error)) {
				return new Response('AI request timed out. Please retry.', { status: 504 });
			}

			console.error('Onboarding AI request failed:', error);
			return new Response('Onboarding AI request failed.', { status: 500 });
		}
	}

	return new Response('AI request timed out. Please retry.', { status: 504 });
};
