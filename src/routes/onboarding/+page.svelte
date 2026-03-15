<script lang="ts">
	import {
		Send,
		User as UserIcon,
		Loader2,
		BookOpen,
		Bot,
		CheckCircle2,
		AlertCircle
	} from 'lucide-svelte';
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import MarkdownMessage from '$lib/MarkdownMessage.svelte';

	let { data } = $props() as { data: PageData };

	const chat = new Chat({
		transport: new DefaultChatTransport({
			api: '/api/ai/onboarding'
		})
	});

	const starterPrompt = "Hello! I am a new student. Let's start the interview.";
	// Tracks server-side completion; ratchets to true and never goes back.
	// Use $effect so the reactive `data` reference is properly tracked by Svelte.
	let completionFromServer = $state(false);
	$effect(() => {
		if (data.onboardingAlreadyComplete) {
			completionFromServer = true;
		}
	});

	// completionFromChat must be declared before onMount so the polling closure can reference it.
	let completionFromChat = $derived.by(() => {
		return chat.messages.some((message) =>
			message.parts?.some((part) => {
				if (part.type === 'tool-invocation') {
					const toolPart = part as any;
					return toolPart.toolName === 'saveMemoryFact' && toolPart.state === 'result';
				}

				return false;
			})
		);
	});

	let onboardingComplete = $derived(completionFromServer || completionFromChat);

	onMount(() => {
		// Send starter prompt only once per mounted chat instance.
		if (chat.messages.length === 0) {
			chat.sendMessage({ text: starterPrompt });
		}

		// Only poll if onboarding isn't already known to be complete.
		if (data.onboardingAlreadyComplete) return;

		let active = true;
		const interval = setInterval(async () => {
			if (!active || completionFromServer || completionFromChat) return;
			try {
				const res = await fetch('/api/user/onboarding-status');
				if (!res.ok) return;
				const parsed = (await res.json()) as { completed?: boolean };
				if (parsed.completed) {
					completionFromServer = true;
				}
			} catch {
				// Ignore transient polling errors.
			}
		}, 2000);

		return () => {
			active = false;
			clearInterval(interval);
		};
	});

	let inputStr = $state('');

	// Scroll chat log to bottom on new messages when already near the bottom.
	let chatLog = $state<HTMLElement | null>(null);
	$effect(() => {
		const _ = chat.messages.length;
		const el = chatLog;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
		if (nearBottom) {
			el.scrollTop = el.scrollHeight;
		}
	});

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (chat.status !== 'ready') return;
		if (inputStr.trim()) {
			chat.sendMessage({ text: inputStr });
			inputStr = '';
		}
	}
</script>

<div class="flex min-h-dvh flex-col items-center justify-center bg-base-200 p-3 sm:p-4">
	<div
		class="flex h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-xl sm:h-[80vh]"
	>
		<div
			class="flex shrink-0 flex-col items-center justify-center bg-primary p-5 text-center text-primary-content sm:p-6"
		>
			<div class="placeholder avatar mb-3">
				<div
					class="w-16 rounded-full bg-white text-primary ring-4 ring-primary-content/30 ring-offset-2 ring-offset-primary"
				>
					<Bot size={28} />
				</div>
			</div>
			<h1 class="text-2xl font-bold">Welcome, {data.user.name}!</h1>
			<p class="mt-1 text-sm opacity-90">Let's set up your personalized AI Tutor profile.</p>
		</div>

		<div
			bind:this={chatLog}
			class="flex-1 space-y-4 overflow-y-auto overscroll-contain bg-base-100 p-4"
			role="log"
			aria-live="polite"
			aria-label="Onboarding chat messages"
		>
			{#each chat.messages as message (message.id)}
				<!-- Hide the initial user-sent starter prompt from view -->
				{#if message.role !== 'user' || !message.parts?.some((p) => p.type === 'text' && p.text === starterPrompt)}
					<div class="chat {message.role === 'user' ? 'chat-end' : 'chat-start'}">
						<div class="avatar chat-image" aria-hidden="true">
							<div
								class="h-8 w-8 rounded-full {message.role === 'user'
									? 'bg-secondary text-secondary-content'
									: 'bg-primary/10 text-primary'} flex items-center justify-center"
							>
								{#if message.role === 'user'}
									<UserIcon size={16} />
								{:else}
									<Bot size={16} />
								{/if}
							</div>
						</div>
						{#if message.role === 'assistant'}
							<div
								class="chat-header mb-1 text-[10px] font-semibold tracking-wide uppercase opacity-40"
							>
								Buddy
							</div>
						{/if}
						<div
							class="chat-bubble max-w-[85%] break-words sm:max-w-[75%] {message.role === 'user'
								? 'chat-bubble-secondary text-secondary-content'
								: 'bg-base-200 text-base-content'}"
						>
							{#each message.parts as part, index (`${message.id}-${index}`)}
								{#if part.type === 'text'}
									{#if message.role === 'assistant'}
										<MarkdownMessage text={part.text} />
									{:else}
										<div class="whitespace-pre-wrap">{part.text}</div>
									{/if}
								{/if}
								{#if part.type === 'tool-invocation'}
									<div class="mt-2 flex items-center gap-2 text-sm italic opacity-60">
										{#if (part as any).state === 'call'}
											<Loader2 size={14} class="animate-spin" /> Saving your profile...
										{:else if (part as any).state === 'result'}
											<CheckCircle2 size={14} class="text-success" /> Profile saved successfully!
										{/if}
									</div>
								{/if}
							{/each}
							{#if message.role === 'assistant' && chat.status === 'streaming' && message.id === chat.messages.at(-1)?.id}
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

			{#if chat.status === 'submitted'}
				<div class="chat-start chat">
					<div class="avatar chat-image">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
						>
							<Bot size={16} />
						</div>
					</div>
					<div
						class="chat-header mb-1 text-[10px] font-semibold tracking-wide uppercase opacity-40"
					>
						Buddy
					</div>
					<div class="chat-bubble bg-base-200 text-base-content">
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

			{#if chat.status === 'error'}
				<div
					class="alert flex items-center gap-2 rounded-xl text-sm alert-error shadow-sm"
					role="alert"
				>
					<AlertCircle size={16} class="shrink-0" />
					<span class="flex-1">Something went wrong. Please try again.</span>
					<button class="btn btn-ghost btn-sm" onclick={() => chat.regenerate()}>Retry</button>
				</div>
			{/if}
		</div>

		{#if onboardingComplete}
			<div class="shrink-0 border-t border-base-300 bg-base-200 p-4">
				<a
					href="/learn"
					class="btn min-h-12 w-full rounded-full font-bold text-success-content shadow-[0_4px_0_0_#16a34a] btn-lg btn-success"
				>
					<BookOpen size={20} /> Start Learning
				</a>
			</div>
		{:else}
			<div class="shrink-0 border-t border-base-200 bg-base-100 p-4">
				<form onsubmit={handleSubmit} class="flex items-center gap-2">
					<label for="onboarding-input" class="sr-only">Type your onboarding answer</label>
					<input
						id="onboarding-input"
						type="text"
						bind:value={inputStr}
						placeholder="Type your answer..."
						class="input-bordered input min-h-12 flex-1 rounded-full bg-base-200 focus:bg-base-100"
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
		{/if}
	</div>
</div>
