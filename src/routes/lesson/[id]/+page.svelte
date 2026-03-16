<script lang="ts">
	import { userState } from '$lib/state/user.svelte';
	import {
		X,
		CheckCircle,
		XCircle,
		MessageCircleQuestion,
		ArrowRight,
		Bot,
		Send,
		User as UserIcon,
		Heart,
		Clock,
		Coins
	} from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import MarkdownMessage from '$lib/MarkdownMessage.svelte';
	import { showToast } from '$lib/state/toast.svelte';
	import { normalizeVideoEmbedUrl } from '$lib/video/providers';

	let { data, form } = $props() as { data: PageData; form: ActionData };

	type LessonQuestion = {
		id: string;
		text: string;
		options: Array<{ id: string; text: string }>;
		correctOptionId: string;
		explanation: string;
	};

	type QuestionResult = {
		selectedOptionId: string;
		isCorrect: boolean;
		explanation: string;
	};

	function parseQuestions(contentData: string): LessonQuestion[] {
		try {
			const parsed = JSON.parse(contentData) as { questions?: LessonQuestion[] };
			const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
			return questions.filter(
				(q) =>
					typeof q?.id === 'string' &&
					typeof q?.text === 'string' &&
					Array.isArray(q?.options) &&
					q.options.every((o) => typeof o?.id === 'string' && typeof o?.text === 'string') &&
					typeof q?.correctOptionId === 'string' &&
					typeof q?.explanation === 'string'
			);
		} catch {
			return [];
		}
	}

	let selectedAnswersLocal = $state<string[]>([]);
	let checkedQuestions = $state<boolean[]>([]);

	let overrideVideoUrl = $state<string | null>(null);
	let currentVideoUrl = $derived(
		overrideVideoUrl || data.lesson?.s3VideoUrl || data.lesson?.videoUrl
	);
	let overrideTokenExpiresAt = $state<number | null>(null);
	let tokenExpiresAt = $derived(overrideTokenExpiresAt ?? data.lesson?.s3VideoUrlExpiresAt ?? null);
	let tokenRetries = $state(0);
	let isRefreshingToken = $state(false);

	// ── Tutor overlay state ──────────────────────────────────────────────────
	let showTutorPanel = $state(false);
	let usedTutor = $state(false);
	let seedQuery = $state<string | null>(null);
	let lastSeededQuery = $state<string | null>(null);
	let tutorInputStr = $state('');

	// ── Heart gate countdown ─────────────────────────────────────────────────
	let heartCountdown = $state(0);

	// Keep heartCountdown in sync when the page data refreshes (e.g. after invalidateAll).
	$effect(() => {
		heartCountdown = data.nextHeartInSeconds ?? 0;
	});

	let iframeSrc = $derived(currentVideoUrl ? normalizeVideoEmbedUrl(currentVideoUrl) : null);

	const questions = $derived(parseQuestions(data.lesson?.contentData ?? ''));
	const selectedAnswers = $derived(
		selectedAnswersLocal.length === questions.length
			? selectedAnswersLocal
			: Array.from({ length: questions.length }, (_, index) => selectedAnswersLocal[index] ?? '')
	);

	const localQuestionResults = $derived<QuestionResult[]>(
		questions.map((question, index) => ({
			selectedOptionId: selectedAnswers[index] ?? '',
			isCorrect: selectedAnswers[index] === question.correctOptionId,
			explanation: question.explanation
		}))
	);

	const isChecked = $derived((index: number) => checkedQuestions[index] === true);

	const submitted = $derived(Boolean(form?.result));
	const isPerfect = $derived(Boolean(form?.result?.isPerfect));
	let submitting = $state(false);
	const questionResults = $derived<QuestionResult[]>(
		form?.result?.questionResults ?? localQuestionResults
	);

	const firstIncorrectIndex = $derived(questionResults.findIndex((result) => !result?.isCorrect));
	const tutorExplainQuery = $derived.by(() => {
		if (firstIncorrectIndex < 0) {
			return `Help me understand ${data.lesson?.title ?? 'this lesson'}`;
		}
		const question = questions[firstIncorrectIndex];
		if (!question?.text?.trim()) {
			return `Help me understand ${data.lesson?.title ?? 'this lesson'}`;
		}
		return `Explain this question and solution: ${question.text}`;
	});

	const allChecked = $derived(
		questions.length > 0 && checkedQuestions.filter(Boolean).length === questions.length
	);
	const localIsPerfect = $derived(allChecked && localQuestionResults.every((r) => r.isCorrect));

	const progress = $derived.by(() => {
		if (questions.length === 0) return 0;
		if (submitting) return 100;
		const checkedCount = checkedQuestions.filter(Boolean).length;
		return Math.round((checkedCount / questions.length) * 100);
	});

	// ── Buddy AI derived ─────────────────────────────────────────────────────
	// Tracks which question the tutor panel was last opened for.
	let activeTutorQuestionIndex = $state<number | null>(null);

	// Explain mode once the student has checked or submitted the active question (correct or wrong).
	// Hint mode only while the question has not been attempted yet.
	const chatMode = $derived<'hint' | 'explain'>(
		activeTutorQuestionIndex !== null && (checkedQuestions[activeTutorQuestionIndex] || submitted)
			? 'explain'
			: 'hint'
	);
	const chatApi = $derived(
		`/api/ai/tutor?lessonId=${data.lesson?.id ?? ''}&mode=${chatMode}&context=lesson`
	);

	// Reset message history on any mode change so the backend exchange counter
	// starts fresh in the new mode (prevents tier skipping in either direction).
	let prevChatMode = $state<'hint' | 'explain'>('hint');
	$effect(() => {
		const mode = chatMode;
		if (prevChatMode !== mode) {
			chat.messages = [];
			lastSeededQuery = null;
		}
		prevChatMode = mode;
	});

	// DefaultChatTransport caches the `api` URL at construction time (this.api = api in the
	// constructor), so the `get api()` getter trick does NOT work — the getter is evaluated
	// once during destructuring.  Using `prepareSendMessagesRequest` is the correct way to
	// supply a dynamic URL because it is called on every outgoing request.
	const chat = new Chat({
		transport: new DefaultChatTransport({
			prepareSendMessagesRequest: (opts) => ({
				api: chatApi,
				body: {
					...(opts.body ?? {}),
					id: opts.id,
					messages: opts.messages,
					trigger: opts.trigger,
					messageId: opts.messageId
				}
			})
		})
	});

	// Auto-seed when the panel opens with a new query.
	$effect(() => {
		const query = seedQuery?.trim();
		const status = chat.status;
		const panelOpen = showTutorPanel;

		if (!query || !panelOpen || lastSeededQuery === query || status !== 'ready') return;

		// BUG 3 fix: seeding counts as using the tutor (student received AI help).
		usedTutor = true;
		chat.sendMessage({ text: query });
		lastSeededQuery = query;
	});

	// Sync updated user stats to client state after server response.
	$effect(() => {
		if (!form?.user) return;
		userState.xp = form.user.xp;
		userState.hearts = form.user.hearts;
		userState.streak = form.user.streak;
		userState.coins = form.user.coins;
		userState.name = form.user.name || userState.name;
	});

	// Heart gate countdown — auto-invalidate when regen tick arrives.
	$effect(() => {
		if (!data.heartsGated) return;
		if (heartCountdown <= 0) {
			invalidateAll();
			return;
		}
		const timer = setInterval(() => {
			heartCountdown = Math.max(0, heartCountdown - 1);
			if (heartCountdown <= 0) {
				clearInterval(timer);
				invalidateAll();
			}
		}, 1000);
		return () => clearInterval(timer);
	});

	async function refreshVideoToken() {
		if (!data?.lesson?.id || isRefreshingToken || tokenRetries >= 3) return false;

		try {
			isRefreshingToken = true;
			tokenRetries++;
			const res = await fetch(resolve(`/api/lesson/${data.lesson.id}/presign`));
			if (res.ok) {
				const { s3VideoUrl, expiresAt } = await res.json();
				if (s3VideoUrl) {
					overrideVideoUrl = s3VideoUrl;
					overrideTokenExpiresAt = expiresAt || null;
					tokenRetries = 0;
					return true;
				}
			}
		} catch (e) {
			console.error('Failed to refresh video token:', e);
		} finally {
			isRefreshingToken = false;
		}

		return false;
	}

	async function handleVideoError() {
		await refreshVideoToken();
	}

	async function handleVideoTimeUpdate(event: Event) {
		const el = event.currentTarget as HTMLVideoElement | null;
		if (!el || el.paused || el.ended || !tokenExpiresAt) return;

		const refreshWindowMs = 90_000;
		if (Date.now() >= tokenExpiresAt - refreshWindowMs) {
			await refreshVideoToken();
		}
	}

	function continueLesson() {
		goto(data.nextLessonId ? resolve(`/lesson/${data.nextLessonId}`) : resolve('/learn'));
	}

	function openTutor(query: string, questionIndex?: number) {
		// Clear history when switching to a different question so the new context
		// starts fresh (different question = different mode + different seed query).
		if (questionIndex !== undefined && questionIndex !== activeTutorQuestionIndex) {
			chat.messages = [];
			activeTutorQuestionIndex = questionIndex;
		}
		// BUG 2 fix: reset lastSeededQuery so the auto-seed effect fires again on re-open.
		lastSeededQuery = null;
		seedQuery = query;
		showTutorPanel = true;
	}

	function handleTutorSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (chat.status !== 'ready' || !tutorInputStr.trim()) return;
		// BUG 3 fix: only mark usedTutor when the student actually sends a message.
		usedTutor = true;
		chat.sendMessage({ text: tutorInputStr });
		tutorInputStr = '';
	}

	// True while the model is in its reasoning phase: streaming has started but
	// the last assistant message has no visible text yet. Keeps the loading
	// indicator visible so the chat never shows a blank/dots-only bubble.
	const lastMessageId = $derived(chat.messages.at(-1)?.id);
	const isThinking = $derived(
		chat.status === 'streaming' &&
			chat.messages.at(-1)?.role === 'assistant' &&
			!chat.messages.at(-1)?.parts.some((p) => {
				if (p.type !== 'text') return false;
				const t = (p as { type: 'text'; text: string }).text;
				const closeIdx = t.lastIndexOf('</think>');
				if (closeIdx !== -1) return t.slice(closeIdx + 8).trim() !== '';
				return !/<think>/i.test(t) && t.trim() !== '';
			})
	);
</script>

<div class="pb-safe absolute inset-0 z-50 flex touch-pan-y flex-col bg-base-100">
	<!-- Top Progress Bar -->
	<div class="flex items-center gap-3 border-b border-base-200 px-4 py-3">
		<a
			href={resolve('/learn')}
			class="btn btn-square h-10 w-10 text-neutral btn-ghost"
			aria-label="Back to lessons"><X size={22} /></a
		>
		<progress
			class="progress h-2.5 flex-1 progress-primary"
			value={progress}
			max="100"
			aria-label="Lesson completion progress"
		></progress>
		<span class="text-xs font-bold text-base-content/40 tabular-nums">{progress}%</span>
		<button
			type="button"
			class="btn btn-square h-10 w-10 text-primary btn-ghost"
			onclick={() => openTutor('')}
			aria-label="Ask Buddy AI"
		>
			<Bot size={20} />
		</button>
	</div>

	<!-- Question Area -->
	<div class="flex-1 overflow-y-auto overscroll-contain">
		{#if currentVideoUrl && (data?.lesson?.s3Key || currentVideoUrl.endsWith('.mp4') || currentVideoUrl.includes('storage.railway.app'))}
			<div class="aspect-video w-full border-b border-base-300 bg-black">
				<video
					class="h-full w-full object-contain"
					controls
					preload="metadata"
					onerror={handleVideoError}
					ontimeupdate={handleVideoTimeUpdate}
					src={currentVideoUrl}
				>
					<track kind="captions" />
				</video>
			</div>
			<div class="bg-base-200 p-3 font-mono text-xs font-bold opacity-60">
				{data.lesson?.title}
			</div>
		{:else if iframeSrc}
			<div class="aspect-video w-full border-b border-base-300 bg-black">
				<iframe
					src={iframeSrc}
					class="h-full w-full"
					frameborder="0"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					referrerpolicy="strict-origin-when-cross-origin"
					allowfullscreen
					title="Video Lesson"
				></iframe>
			</div>
			<div class="bg-base-200 p-3 font-mono text-xs font-bold opacity-60">
				{data.lesson?.title}
			</div>
		{/if}

		<div class="mx-auto w-full max-w-lg px-4 py-6 sm:px-6">
			{#if questions.length > 0}
				<!-- Hidden form for final server submission (awards XP / deducts hearts) -->
				<form
					id="submit-lesson-form"
					method="POST"
					action="?/submitLesson"
					class="hidden"
					aria-hidden="true"
					use:enhance={() => {
						submitting = true;
						return async ({ result }) => {
							submitting = false;
							if (result.type === 'success' && result.data) {
								const r = result.data.result as any;
								const u = result.data.user as any;
								// Sync user state immediately so the top bar updates.
								if (u) {
									userState.xp = u.xp;
									userState.hearts = u.hearts;
									userState.streak = u.streak;
									userState.coins = u.coins;
									userState.name = u.name || userState.name;
									// Stat-change toasts are handled by the layout watcher reacting to
									// the userState mutations above — no manual showToast needed here.
								}
								// Navigate in one step — no second click needed.
								goto(
									data.nextLessonId ? resolve(`/lesson/${data.nextLessonId}`) : resolve('/learn')
								);
							} else if (result.type === 'failure') {
								const msg = (result.data as any)?.error ?? 'Submission failed.';
								showToast(msg, 'error');
							}
						};
					}}
				>
					<input type="hidden" name="selectedAnswers" value={JSON.stringify(selectedAnswers)} />
					<input type="hidden" name="usedTutor" value={usedTutor ? '1' : '0'} />
				</form>

				<div class="flex flex-col gap-8">
					{#each questions as question, questionIndex (question.id)}
						{@const checked = isChecked(questionIndex)}
						{@const result = questionResults[questionIndex]}
						{@const hasSelection = (selectedAnswers[questionIndex] ?? '').trim() !== ''}
						{@const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F']}
						{@const hasAttempted = checked || submitted}
						{@const botQuery = !hasAttempted
							? `Give me a hint for this question without giving away the answer: "${question.text}"`
							: result?.isCorrect
								? `Help me understand why this answer is correct: "${question.text}"`
								: `Explain this question and why my answer was wrong: "${question.text}"`}

						<div class="flex flex-col gap-3">
							<div class="flex items-center gap-2">
								<span
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-extrabold text-primary"
								>
									{questionIndex + 1}
								</span>
								<p class="flex-1 text-base font-semibold text-neutral">{question.text}</p>
								<button
									type="button"
									class="btn btn-circle shrink-0 btn-ghost btn-sm
									{hasAttempted && result?.isCorrect ? 'text-success/70' : ''}
									{hasAttempted && !result?.isCorrect ? 'text-error/70' : ''}
									{!hasAttempted ? 'text-primary/50' : ''}"
									onclick={() => openTutor(botQuery, questionIndex)}
									aria-label="Ask Buddy about this question"><Bot size={16} /></button
								>
							</div>

							<div class="flex flex-col gap-2">
								{#each question.options as answer, optIdx (answer.id)}
									{@const isSelected = selectedAnswers[questionIndex] === answer.id}
									{@const isCorrectOption = answer.id === question.correctOptionId}
									<button
										type="button"
										class="flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all
											{isSelected && !checked ? 'border-secondary bg-secondary/10 shadow-sm' : ''}
											{!isSelected && !checked
											? 'hover:bg-base-50 border-base-200 bg-base-100 hover:border-base-300'
											: ''}
											{checked && isSelected && result?.isCorrect ? 'border-success bg-success/15' : ''}
											{checked && isSelected && !result?.isCorrect ? 'border-error bg-error/15' : ''}
											{checked && !isSelected && isCorrectOption && !result?.isCorrect
											? 'border-success/60 bg-success/10'
											: ''}
											{checked && !isSelected && !isCorrectOption ? 'border-base-200 bg-base-100 opacity-50' : ''}"
										onclick={() => {
											if (checked || submitted) return;
											const next = [...selectedAnswersLocal];
											next[questionIndex] = answer.id;
											selectedAnswersLocal = next;
										}}
										disabled={checked || submitted}
									>
										<span
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold
												{isSelected && !checked ? 'border-secondary bg-secondary text-secondary-content' : ''}
												{!isSelected && !checked ? 'border-base-300 text-base-content/50' : ''}
												{checked && isSelected && result?.isCorrect ? 'border-success bg-success text-white' : ''}
												{checked && isSelected && !result?.isCorrect ? 'border-error bg-error text-white' : ''}
												{checked && !isSelected && isCorrectOption && !result?.isCorrect
												? 'border-success bg-success text-white'
												: ''}
												{checked && !isSelected && !isCorrectOption ? 'border-base-300 text-base-content/30' : ''}"
											>{optionLabels[optIdx] ?? optIdx + 1}</span
										>
										<span class="flex-1 text-sm leading-snug font-medium break-words"
											>{answer.text}</span
										>
									</button>
								{/each}
							</div>

							<!-- Per-question result feedback -->
							{#if checked && result?.explanation}
								<div
									class="flex items-start gap-3 rounded-2xl border p-3 text-sm
										{result.isCorrect ? 'border-success/30 bg-success/10' : 'border-error/30 bg-error/10'}"
								>
									{#if result.isCorrect}
										<CheckCircle size={18} class="mt-0.5 shrink-0 text-success" />
									{:else}
										<XCircle size={18} class="mt-0.5 shrink-0 text-error" />
									{/if}
									<span class="leading-relaxed text-base-content/80">{result.explanation}</span>
								</div>
							{/if}

							<!-- Per-question Check Answer button -->
							{#if !checked && !submitted}
								<button
									type="button"
									class="btn w-full rounded-full font-bold btn-md
										{hasSelection ? 'shadow-[0_3px_0_0_#ca8a04] btn-primary' : 'btn-disabled opacity-40'}"
									disabled={!hasSelection}
									onclick={() => {
										if (!hasSelection) return;
										const next = [...checkedQuestions];
										next[questionIndex] = true;
										checkedQuestions = next;
									}}
								>
									<CheckCircle size={16} /> Check Answer
								</button>
							{/if}
						</div>
					{/each}

					{#if form?.error}
						<div class="alert text-sm alert-error">{form.error}</div>
					{/if}
				</div>
			{:else}
				<div class="alert alert-warning">This lesson has no valid questions yet.</div>
			{/if}
		</div>
	</div>

	<!-- Bottom Sheet / Action Area -->
	<div
		class="flex min-h-28 flex-col justify-center border-t border-base-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]
        {allChecked && localIsPerfect ? 'bg-success/10' : ''}
        {allChecked && !localIsPerfect ? 'bg-error/10' : ''}
    "
	>
		{#if allChecked}
			<!-- All questions checked client-side — submit to server for XP / heart refill -->
			<div class="flex w-full flex-col gap-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						{#if localIsPerfect}
							<CheckCircle class="text-success" size={32} />
							<span class="text-xl font-bold text-success">Brilliant!</span>
						{:else}
							<XCircle class="text-error" size={32} />
							<span class="text-xl font-bold text-error">Some answers need work</span>
						{/if}
					</div>

					{#if !localIsPerfect}
						<button
							type="button"
							class="btn min-h-10 rounded-full btn-outline btn-sm btn-secondary"
							onclick={() => openTutor(tutorExplainQuery)}
						>
							<MessageCircleQuestion size={16} /> Explain it
						</button>
					{/if}
				</div>

				<button
					class="btn w-full rounded-full font-bold btn-lg
                    {localIsPerfect
						? 'text-success-content shadow-[0_4px_0_0_#16a34a] btn-success'
						: 'text-error-content shadow-[0_4px_0_0_#dc2626] btn-error'}"
					type="submit"
					form="submit-lesson-form"
					disabled={submitting}
				>
					{#if submitting}
						<span class="loading loading-sm loading-spinner"></span>
					{:else}
						Continue <ArrowRight size={18} />
					{/if}
				</button>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-1 text-center">
				<p class="text-sm font-semibold text-neutral/70">Answer each question above</p>
				<p class="text-xs text-base-content/40">Tap "Check Answer" after each one to continue</p>
			</div>
		{/if}
	</div>

	<!-- ── Heart Gate Overlay ────────────────────────────────────────────── -->
	{#if data.heartsGated}
		<div
			class="absolute inset-0 z-[55] flex flex-col items-center justify-center gap-6 bg-base-100 p-6"
		>
			<!-- Empty heart icon -->
			<div
				class="flex h-20 w-20 items-center justify-center rounded-full bg-error/10 ring-4 ring-error/20"
			>
				<Heart size={40} class="text-error/60" />
			</div>

			<!-- Heading -->
			<div class="text-center">
				<h2 class="text-2xl font-extrabold text-error">Out of Hearts</h2>
				<p class="mt-1 text-sm text-base-content/60">
					You need hearts to attempt lessons. Wait for one to regenerate or spend coins.
				</p>
			</div>

			<!-- Countdown -->
			{#if heartCountdown > 0}
				<div class="flex items-center gap-2 rounded-2xl bg-base-200 px-5 py-3">
					<Clock size={18} class="text-base-content/50" />
					<span class="font-mono text-sm font-bold text-base-content/70 tabular-nums">
						Next heart in {Math.floor(heartCountdown / 60)
							.toString()
							.padStart(2, '0')}:{(heartCountdown % 60).toString().padStart(2, '0')}
					</span>
				</div>
			{/if}

			<!-- Buy heart with coins -->
			<form method="POST" action="?/buyHeart" class="w-full max-w-xs">
				<button
					type="submit"
					class="btn w-full rounded-full font-bold shadow-[0_3px_0_0_#b45309] btn-warning"
				>
					<Coins size={18} /> Spend 5 coins for +1 heart
				</button>
				{#if form?.error}
					<p class="mt-2 text-center text-xs text-error">{form.error}</p>
				{/if}
			</form>

			<!-- Back to learn -->
			<a href={resolve('/learn')} class="btn rounded-full text-base-content/50 btn-ghost btn-sm">
				← Back to lessons
			</a>
		</div>
	{/if}

	<!-- ── Buddy AI Overlay ────────────────────────────────────────────────── -->
	{#if showTutorPanel}
		<div class="absolute inset-0 z-[60] overflow-hidden">
			<!-- Backdrop -->
			<div
				class="absolute inset-0 bg-black/40"
				role="button"
				tabindex="-1"
				aria-label="Close Buddy AI"
				onclick={() => (showTutorPanel = false)}
				onkeydown={(e) => e.key === 'Escape' && (showTutorPanel = false)}
			></div>

			<!-- Slide-up panel -->
			<div
				class="absolute right-0 bottom-0 left-0 flex h-[70%] flex-col rounded-t-2xl bg-base-100 shadow-2xl"
			>
				<!-- Panel header -->
				<div
					class="flex shrink-0 items-center justify-between rounded-t-2xl bg-primary px-4 py-3 text-primary-content"
				>
					<div class="flex items-center gap-2">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30"
						>
							<Bot size={16} />
						</div>
						<span class="font-bold">Buddy AI</span>
						{#if chatMode === 'explain'}
							<span class="badge border-0 bg-white/20 badge-sm text-primary-content"
								>Explain Mode</span
							>
						{:else}
							<span class="badge border-0 bg-white/20 badge-sm text-primary-content">Hint Mode</span
							>
						{/if}
					</div>
					<button
						type="button"
						class="btn btn-circle text-primary-content btn-ghost btn-sm hover:bg-white/20"
						onclick={() => (showTutorPanel = false)}
						aria-label="Close Buddy AI"
					>
						<X size={18} />
					</button>
				</div>

				<!-- Messages -->
				<div
					class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-base-200/40 p-4"
					role="log"
					aria-live="polite"
					aria-label="Buddy AI chat messages"
				>
					{#if chat.messages.length === 0}
						<div
							class="flex h-full flex-col items-center justify-center gap-2 text-center text-neutral/50"
						>
							<div
								class="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20"
							>
								<Bot size={28} class="text-primary/70" />
							</div>
							<p class="text-sm font-medium text-neutral/60">
								Ask Buddy anything about this lesson
							</p>
						</div>
					{/if}

					{#each chat.messages as message (message.id)}
						{#if !(isThinking && message.id === lastMessageId) && (message.role !== 'assistant' || message.parts.some((p) => p.type === 'text' && p.text.trim()))}
							<div class="chat {message.role === 'user' ? 'chat-end' : 'chat-start'}">
								<div class="avatar chat-image" aria-hidden="true">
									<div
										class="flex h-8 w-8 items-center justify-center rounded-full
											{message.role === 'user'
											? 'bg-secondary text-secondary-content'
											: 'border border-base-300 bg-base-100 text-primary'}"
									>
										{#if message.role === 'user'}
											<UserIcon size={15} />
										{:else}
											<Bot size={15} />
										{/if}
									</div>
								</div>
								<div
									class="chat-header mb-1 text-[10px] font-semibold tracking-wide uppercase opacity-40"
								>
									{message.role === 'user' ? 'You' : 'Buddy'}
								</div>
								<div
									class="chat-bubble max-w-[85%] text-sm leading-relaxed break-words
										{message.role === 'user'
										? 'chat-bubble-secondary text-secondary-content'
										: 'border border-base-200 bg-base-100 text-base-content shadow-sm'}"
								>
									{#each message.parts as part, index (`${message.id}-${index}`)}
										{#if part.type === 'text'}
											{#if message.role === 'assistant'}
												<MarkdownMessage
													text={part.text}
													streaming={chat.status === 'streaming' && message.id === lastMessageId}
												/>
											{:else}
												<div class="whitespace-pre-wrap">{part.text}</div>
											{/if}
										{/if}
									{/each}
									{#if message.role === 'assistant' && chat.status === 'streaming' && message.id === lastMessageId}
										<span class="mt-1 inline-flex items-center gap-0.5 opacity-50">
											<span
												class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"
											></span>
											<span
												class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"
											></span>
											<span class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current"
											></span>
										</span>
									{/if}
								</div>
							</div>
						{/if}
					{/each}

					{#if chat.status === 'submitted' || isThinking}
						<div class="chat-start chat">
							<div class="avatar chat-image" aria-hidden="true">
								<div
									class="flex h-8 w-8 items-center justify-center rounded-full border border-base-300 bg-base-100 text-primary"
								>
									<Bot size={15} />
								</div>
							</div>
							<div
								class="chat-header mb-1 text-[10px] font-semibold tracking-wide uppercase opacity-40"
							>
								Buddy
							</div>
							<div
								class="chat-bubble border border-base-200 bg-base-100 text-base-content shadow-sm"
							>
								<span class="inline-flex items-center gap-0.5 opacity-50">
									<span
										class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"
									></span>
									<span
										class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"
									></span>
									<span class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current"
									></span>
								</span>
							</div>
						</div>
					{/if}
				</div>

				<!-- Input bar -->
				<div class="shrink-0 border-t border-base-200 bg-base-100 p-3">
					<form onsubmit={handleTutorSubmit} class="flex items-center gap-2">
						<label for="buddy-input" class="sr-only">Ask Buddy a question</label>
						<input
							id="buddy-input"
							type="text"
							bind:value={tutorInputStr}
							placeholder="Ask Buddy..."
							class="input-bordered input min-h-10 flex-1 rounded-full bg-base-200 text-sm focus:bg-base-100"
							disabled={chat.status !== 'ready'}
						/>
						<button
							type="submit"
							class="btn btn-circle h-10 min-h-0 w-10 shrink-0 shadow-sm btn-primary"
							disabled={chat.status !== 'ready' || !tutorInputStr.trim()}
							aria-label="Send message"
						>
							<Send size={15} class="text-primary-content" />
						</button>
					</form>
				</div>
			</div>
		</div>
	{/if}
</div>
