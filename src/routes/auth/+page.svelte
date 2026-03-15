<script lang="ts">
	import type { ActionData } from './$types';
	import { BookOpen, LogIn, UserPlus } from 'lucide-svelte';
	import { page } from '$app/state';

	let { form } = $props() as { form: ActionData };

	let isRegister = $state(false);
	let nextPath = $derived(page.url.searchParams.get('next') ?? '');

	// Hide the server error when the user switches between Sign In / Register tabs.
	// errorForRegister tracks which tab was active when the last server error arrived.
	// If the user switches tabs, isRegister no longer matches errorForRegister and the
	// stale error is hidden.
	let errorForRegister = $state(false); // false = login tab, true = register tab
	$effect(() => {
		if (form?.error) errorForRegister = isRegister;
	});
	const visibleError = $derived(form?.error && errorForRegister === isRegister ? form.error : null);
</script>

<div
	class="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-base-200 to-base-300 px-4 py-10"
>
	<!-- Brand mark -->
	<div class="mb-8 flex flex-col items-center gap-3 text-center">
		<div
			class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30"
		>
			<BookOpen size={30} class="text-primary-content" />
		</div>
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight text-neutral">EduQuest</h1>
			<p class="mt-1 text-sm text-base-content/60">Learn with your personal AI Buddy</p>
		</div>
	</div>

	<!-- Card -->
	<div
		class="w-full max-w-sm overflow-hidden rounded-3xl border border-base-200 bg-base-100 shadow-2xl"
	>
		<!-- Tab switcher -->
		<div class="flex border-b border-base-200">
			<button
				class="flex-1 py-4 text-sm font-bold transition-colors
					{!isRegister
					? 'border-b-2 border-primary text-primary'
					: 'text-base-content/50 hover:text-base-content/80'}"
				type="button"
				onclick={() => (isRegister = false)}
			>
				Sign In
			</button>
			<button
				class="flex-1 py-4 text-sm font-bold transition-colors
					{isRegister
					? 'border-b-2 border-primary text-primary'
					: 'text-base-content/50 hover:text-base-content/80'}"
				type="button"
				onclick={() => (isRegister = true)}
			>
				Register
			</button>
		</div>

		<div class="p-6">
			{#if visibleError}
				<div class="mb-5 alert py-2.5 text-sm alert-error" role="alert" aria-live="polite">
					{visibleError}
				</div>
			{/if}

			<form
				method="POST"
				action={isRegister ? '?/register' : '?/login'}
				class="flex flex-col gap-4"
			>
				<input type="hidden" name="next" value={nextPath} />

				{#if isRegister}
					<div class="form-control w-full">
						<label class="label pb-1" for="name">
							<span
								class="label-text text-xs font-semibold tracking-wide text-base-content/60 uppercase"
								>Display Name</span
							>
						</label>
						<input
							type="text"
							id="name"
							name="name"
							required
							autocomplete="name"
							placeholder="e.g. Alex D."
							class="input-bordered input h-12 rounded-xl"
						/>
					</div>
				{/if}

				<div class="form-control w-full">
					<label class="label pb-1" for="username">
						<span
							class="label-text text-xs font-semibold tracking-wide text-base-content/60 uppercase"
							>Username</span
						>
					</label>
					<input
						type="text"
						id="username"
						name="username"
						required
						autocomplete="username"
						placeholder="e.g. alexd123"
						class="input-bordered input h-12 rounded-xl lowercase"
					/>
				</div>

				<div class="form-control w-full">
					<label class="label pb-1" for="password">
						<span
							class="label-text text-xs font-semibold tracking-wide text-base-content/60 uppercase"
							>Password</span
						>
					</label>
					<input
						type="password"
						id="password"
						name="password"
						required
						autocomplete={isRegister ? 'new-password' : 'current-password'}
						placeholder="••••••••"
						class="input-bordered input h-12 rounded-xl"
					/>
				</div>

				<button
					type="submit"
					class="btn mt-2 h-12 w-full rounded-full text-base font-bold text-primary-content shadow-[0_4px_0_0_#ca8a04] btn-primary active:translate-y-1 active:shadow-none"
				>
					{#if isRegister}
						<UserPlus size={18} /> Create Account
					{:else}
						<LogIn size={18} /> Sign In
					{/if}
				</button>
			</form>
		</div>
	</div>
</div>
