<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import {
		Check,
		BookOpen,
		BrainCircuit,
		Lock,
		PlayCircle,
		ChevronRight,
		Heart
	} from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { userState } from '$lib/state/user.svelte';

	let { data, form } = $props() as { data: PageData; form: ActionData };

	const completedPercent = $derived(
		data.totalLessons > 0 ? Math.round((data.completedCount / data.totalLessons) * 100) : 0
	);

	const typeLabel = (type: 'standard' | 'ai-remedial' | 'test') => {
		if (type === 'ai-remedial') return 'AI Remedial';
		if (type === 'test') return 'Test';
		return 'Standard';
	};
</script>

<div class="flex min-h-full flex-col px-4 py-6 pb-28 sm:px-5">
	<div class="mb-5">
		<h1 class="text-2xl font-extrabold text-neutral">Learning Path</h1>
		<p class="mt-1 text-sm text-base-content/60">Complete lessons in order to unlock the next.</p>
	</div>

	{#if form?.error}
		<div class="mb-4 alert text-sm alert-error" role="alert" aria-live="polite">
			{form.error}
		</div>
	{/if}
	{#if form?.success}
		<div class="mb-4 alert text-sm alert-success" role="status" aria-live="polite">
			{form.success}
		</div>
	{/if}

	<!-- No-hearts warning — shown reactively using client state, no server round-trip needed -->
	{#if userState.statsReady && userState.hearts === 0}
		<div
			class="mb-4 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/5 px-4 py-3"
			role="alert"
		>
			<Heart size={18} class="mt-0.5 shrink-0 text-error" />
			<p class="text-sm font-medium text-error">
				You're out of hearts. Hearts regenerate every 30 min — or open a lesson to spend coins for
				an instant restore.
			</p>
		</div>
	{/if}

	<!-- Path selector -->
	{#if data.learningPaths.length > 0}
		<div class="mb-5 rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm">
			<form method="POST" action="?/selectPath" class="flex items-end gap-3">
				<div class="form-control min-w-0 flex-1">
					<label class="label pb-1" for="path-select">
						<span
							class="label-text text-xs font-semibold tracking-wide text-base-content/60 uppercase"
							>Active Path</span
						>
					</label>
					<select
						id="path-select"
						name="pathId"
						class="select-bordered select h-11 rounded-xl"
						required
					>
						{#each data.learningPaths as path (path.id)}
							<option value={path.id} selected={data.selectedPathId === path.id}>
								{path.name}
							</option>
						{/each}
					</select>
				</div>
				<button type="submit" class="btn h-11 shrink-0 rounded-xl btn-primary">Apply</button>
			</form>
		</div>
	{/if}

	<!-- Progress bar -->
	<div class="mb-6 rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm">
		<div class="mb-2 flex items-center justify-between text-sm font-semibold">
			<span class="text-neutral">Progress</span>
			<span class="text-base-content/60"
				>{data.completedCount}/{data.totalLessons} · {completedPercent}%</span
			>
		</div>
		<progress
			class="progress h-2.5 w-full rounded-full progress-primary"
			value={completedPercent}
			max="100"
		></progress>
	</div>

	<!-- Lesson nodes with connecting line -->
	{#if data.lessonNodes.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-base-300 bg-base-100 py-14 text-center text-base-content/50 shadow-sm"
		>
			<BookOpen size={40} class="opacity-40" />
			<p class="text-sm">No lessons published yet.</p>
		</div>
	{:else}
		<div class="relative">
			<!-- Vertical connector line -->
			<div
				class="absolute top-8 bottom-8 left-7 w-0.5 -translate-x-1/2 bg-base-200"
				aria-hidden="true"
			></div>

			<div class="flex flex-col gap-3">
				{#each data.lessonNodes as node (node.id)}
					{#if node.status === 'completed'}
						<a
							href={resolve(`/lesson/${node.id}`)}
							class="group relative flex items-center gap-4 rounded-2xl border border-success/20 bg-base-100 p-4 shadow-sm transition-all hover:border-success/40 hover:shadow"
						>
							<div
								class="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success text-success-content shadow-sm"
							>
								<Check size={18} strokeWidth={3} />
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-semibold text-neutral">{node.title}</p>
								<p class="text-xs text-base-content/50">{typeLabel(node.type)} · Completed</p>
							</div>
							<ChevronRight
								size={16}
								class="shrink-0 text-base-content/30 transition-transform group-hover:translate-x-0.5"
							/>
						</a>
					{:else if node.status === 'active'}
						<a
							href={resolve(`/lesson/${node.id}`)}
							class="group relative flex items-center gap-4 rounded-2xl border-2 border-secondary bg-secondary/5 p-4 shadow-md transition-all hover:bg-secondary/10 hover:shadow-lg"
						>
							<div
								class="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-white shadow-md shadow-secondary/40"
							>
								{#if node.type === 'ai-remedial'}
									<BrainCircuit size={18} />
								{:else}
									<PlayCircle size={18} />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-bold text-secondary">{node.title}</p>
								<p class="text-xs text-secondary/70">{typeLabel(node.type)} · Active</p>
							</div>
							<span
								class="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-white"
							>
								Continue
							</span>
						</a>
					{:else}
						<div
							class="relative flex items-center gap-4 rounded-2xl border border-base-200 bg-base-100 p-4 opacity-60 shadow-sm"
						>
							<div
								class="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-200 text-base-content/40"
							>
								{#if node.type === 'test'}
									<BookOpen size={18} />
								{:else if node.type === 'ai-remedial'}
									<BrainCircuit size={18} />
								{:else}
									<Lock size={18} />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-semibold text-neutral/60">{node.title}</p>
								<p class="text-xs text-base-content/40">{typeLabel(node.type)} · Locked</p>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>
