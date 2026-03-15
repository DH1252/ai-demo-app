<script lang="ts">
	import { Send, Sparkles, User as UserIcon, Loader2, Bot } from 'lucide-svelte';
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import MarkdownMessage from '$lib/MarkdownMessage.svelte';

	let { data } = $props() as { data: PageData };

	let q = $derived(page.url.searchParams.get('q'));
	let lessonId = $derived(page.url.searchParams.get('lessonId'));

	// Mode starts from URL param (so lesson pages can deep-link with ?mode=explain), else hint.
	const urlMode = page.url.searchParams.get('mode');
	let chatMode = $state<'hint' | 'explain'>(urlMode === 'explain' ? 'explain' : 'hint');

	let chatApi = $derived(
		lessonId
			? `/api/ai/tutor?lessonId=${lessonId}&mode=${chatMode}`
			: `/api/ai/tutor?mode=${chatMode}`
	);

	// Auto-escalate: after 3 exchanges in hint mode the student is clearly struggling —
	// switch to explain mode so the backend starts its progressive-reveal tiers.
	// We keep the full message history so the backend has conversation context.
	const HINT_ESCALATION_THRESHOLD = 3;
	let didEscalate = $state(false);
	$effect(() => {
		if (chatMode !== 'hint') return;
		const assistantTurns = chat.messages.filter((m) => m.role === 'assistant').length;
		if (assistantTurns >= HINT_ESCALATION_THRESHOLD) {
			chatMode = 'explain';
			didEscalate = true;
		}
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

	let lastSeededPromptSent = $state<string | null>(null);

	$effect(() => {
		const seededPrompt = q?.trim();
		// Track chat.status so the effect re-runs when the chat becomes ready.
		const status = chat.status;

		if (!seededPrompt) return;
		if (lastSeededPromptSent === seededPrompt) return;
		if (status !== 'ready') return;

		chat.sendMessage({ text: seededPrompt });
		lastSeededPromptSent = seededPrompt;
	});

	let inputStr = $state('');

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (chat.status !== 'ready') return;
		if (inputStr.trim()) {
			chat.sendMessage({ text: inputStr });
			inputStr = '';
		}
	}

	function setInputAndSend(text: string) {
		if (chat.status !== 'ready') return;
		if (!text.trim()) return;

		chat.sendMessage({ text });
		inputStr = '';
	}

	const fallbackSuggestions = ['Help me with Algebra', 'Explain Photosynthesis'];

	const promptSuggestions = $derived(
		data.promptSuggestions.length > 0 ? data.promptSuggestions : fallbackSuggestions
	);

	// True while the model is in its reasoning phase: the stream has started
	// (status = 'streaming') but the last assistant message has no visible text
	// yet. During this window we hide the empty bubble and keep the loading
	// indicator visible so the UI never shows a blank / dots-only bubble.
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

<div class="flex h-full min-h-0 touch-pan-y flex-col bg-base-100">
	<div
		class="z-10 flex shrink-0 items-center justify-between bg-primary p-4 text-primary-content shadow-md"
	>
		<div class="flex items-center gap-3">
			<div class="placeholder avatar">
				<div class="w-10 rounded-full bg-white text-primary ring ring-offset-2 ring-offset-primary">
					<Bot size={18} />
				</div>
			</div>
			<div>
				<h1 class="text-lg leading-tight font-bold">Buddy AI</h1>
				<p class="text-xs opacity-90">Your Smart Tutor</p>
			</div>
			{#if chatMode === 'explain'}
				<span class="badge border-0 bg-white/20 badge-sm text-primary-content">Explain Mode</span>
			{:else}
				<span class="badge border-0 bg-white/20 badge-sm text-primary-content">Hint Mode</span>
			{/if}
		</div>
		<Sparkles size={20} />
	</div>

	<div
		class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-base-200/40 p-4"
		role="log"
		aria-live="polite"
		aria-label="Tutor chat messages"
	>
		{#if chat.messages.length === 0}
			<div
				class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-neutral/50"
			>
				<div
					class="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 ring-2 ring-primary/20"
				>
					<Bot size={36} class="text-primary/70" />
				</div>
				<div>
					<p class="font-bold text-neutral/70">Hi! I'm Buddy.</p>
					<p class="text-sm">What are we learning today?</p>
				</div>
				{#if data.selectedPathName}
					<p class="text-xs opacity-60">
						Suggestions from: <span class="font-semibold">{data.selectedPathName}</span>
					</p>
				{/if}
				<div class="mt-2 flex flex-wrap justify-center gap-2">
					{#each promptSuggestions as suggestion (suggestion)}
						<button
							class="btn rounded-full border-base-300 bg-base-100 font-medium shadow-sm btn-sm hover:border-primary hover:bg-primary/10 hover:text-primary"
							onclick={() => setInputAndSend(suggestion)}
							disabled={chat.status !== 'ready'}>{suggestion}</button
						>
					{/each}
				</div>
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
						class="chat-bubble max-w-[85%] text-sm leading-relaxed break-words sm:max-w-[75%]
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
				<div class="chat-header mb-1 text-[10px] font-semibold tracking-wide uppercase opacity-40">
					Buddy
				</div>
				<div class="chat-bubble border border-base-200 bg-base-100 text-base-content shadow-sm">
					<span class="inline-flex items-center gap-0.5 opacity-50">
						<span
							class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"
						></span>
						<span
							class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"
						></span>
						<span class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current"></span>
					</span>
				</div>
			</div>
		{/if}

		{#if didEscalate}
			<div class="flex items-center gap-2 py-1 text-xs text-base-content/40">
				<div class="h-px flex-1 bg-base-300"></div>
				<span class="shrink-0 font-semibold">Switched to Explain Mode</span>
				<div class="h-px flex-1 bg-base-300"></div>
			</div>
		{/if}
	</div>

	<div class="pb-safe sticky bottom-0 z-10 shrink-0 border-t border-base-200 bg-base-100 p-4">
		<form onsubmit={handleSubmit} class="flex items-center gap-2">
			<label for="tutor-input" class="sr-only">Ask Buddy a question</label>
			<input
				id="tutor-input"
				type="text"
				bind:value={inputStr}
				placeholder="Ask Buddy a question..."
				class="input-bordered input min-h-12 flex-1 rounded-full bg-base-200 shadow-inner focus:bg-base-100"
				disabled={chat.status !== 'ready'}
			/>
			<button
				type="submit"
				class="btn btn-circle h-12 min-h-0 w-12 shrink-0 shadow-sm btn-primary"
				disabled={chat.status !== 'ready' || !inputStr.trim()}
			>
				<Send size={18} class="text-primary-content" />
			</button>
		</form>
	</div>
</div>
