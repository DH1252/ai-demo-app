<script lang="ts">
	import type { PageData } from './$types';
	import { userState } from '$lib/state/user.svelte';
	import {
		Play,
		Sparkles,
		Target,
		Trophy,
		CheckCircle2,
		Clock3,
		Lock,
		BookOpen
	} from 'lucide-svelte';
	import { resolve } from '$app/paths';

	let { data } = $props() as { data: PageData };

	const completedPercent = $derived(
		data.home.totalLessons > 0
			? Math.round((data.home.completedCount / data.home.totalLessons) * 100)
			: 0
	);

	const nextLessonLabel = $derived(
		data.home.activeLesson ? data.home.activeLesson.title : 'No active lesson yet'
	);

	const lessonTypeLabel = (type: 'standard' | 'ai-remedial' | 'test') => {
		if (type === 'ai-remedial') return 'AI Remedial';
		if (type === 'test') return 'Test';
		return 'Standard';
	};

	const lessonStatusIcon = (status: 'completed' | 'active' | 'locked') => {
		if (status === 'completed') return CheckCircle2;
		if (status === 'active') return Clock3;
		return Lock;
	};
</script>

<div class="flex flex-col gap-5 px-4 py-6 pb-24 sm:px-5">
	<!-- Greeting -->
	<div>
		<h1 class="text-2xl font-extrabold text-neutral">
			Hi, {(userState.name || 'Student').split(' ')[0]}! 👋
		</h1>
		<p class="mt-1 text-sm text-base-content/60">
			Keep your streak alive and pick up where you left off.
		</p>
	</div>

	<!-- Hero Card -->
	<div
		class="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-content shadow-lg shadow-primary/25"
	>
		<div class="flex items-center gap-4 px-5 pt-5">
			<div
				class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/30"
			>
				<Sparkles class="text-white" size={28} />
			</div>
			<div class="min-w-0 flex-1">
				<p class="text-xs font-semibold tracking-wider uppercase opacity-70">Today's Focus</p>
				<h2 class="truncate text-lg leading-tight font-extrabold">
					{#if data.home.activeLesson}
						{nextLessonLabel}
					{:else}
						Ready to learn
					{/if}
				</h2>
			</div>
		</div>

		<div class="px-5 pt-4 pb-5">
			<div class="mb-1.5 flex items-center justify-between text-xs font-semibold opacity-80">
				<span>{data.home.completedCount}/{data.home.totalLessons} lessons done</span>
				<span>{completedPercent}%</span>
			</div>
			<progress class="progress h-2 w-full progress-secondary" value={completedPercent} max="100"
			></progress>
			{#if data.home.activeLesson}
				<a
					href={resolve(`/lesson/${data.home.activeLesson.id}`)}
					class="btn mt-4 h-11 w-full rounded-full font-bold text-secondary-content btn-secondary"
				>
					<Play size={16} fill="currentColor" /> Continue Lesson
				</a>
			{:else}
				<a
					href={resolve('/learn')}
					class="btn mt-4 h-11 w-full rounded-full font-bold text-secondary-content btn-secondary"
				>
					<Play size={16} fill="currentColor" /> Start Learning
				</a>
			{/if}
		</div>
	</div>

	<!-- Stats Row -->
	<div class="grid grid-cols-2 gap-3">
		<div
			class="flex items-center gap-3 rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm"
		>
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50">
				<Trophy size={22} class="text-orange-400" fill="currentColor" />
			</div>
			<div class="min-w-0">
				<p class="truncate font-bold text-neutral">{userState.rank}</p>
				<p class="text-xs text-neutral/50">Current rank</p>
			</div>
		</div>

		<div
			class="flex items-center gap-3 rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm"
		>
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/10">
				<Target size={22} class="text-secondary" fill="currentColor" />
			</div>
			<div>
				<p class="font-bold text-neutral">{data.home.completedCount}</p>
				<p class="text-xs text-neutral/50">Lessons done</p>
			</div>
		</div>
	</div>

	<!-- Lesson Queue -->
	<div class="rounded-2xl border border-base-200 bg-base-100 shadow-sm">
		<div class="flex items-center justify-between px-4 pt-4 pb-3">
			<h2 class="font-bold text-neutral">Lesson Queue</h2>
			<a href={resolve('/learn')} class="btn rounded-full text-xs btn-ghost btn-sm">Open Path</a>
		</div>

		{#if data.home.lessons.length === 0}
			<div
				class="mx-4 mb-4 flex items-center gap-2 rounded-xl border border-dashed border-base-300 bg-base-200/60 p-4 text-sm text-base-content/60"
			>
				<BookOpen size={16} /> No lessons published yet.
			</div>
		{:else}
			<div class="flex flex-col divide-y divide-base-200">
				{#each data.home.lessons.slice(0, 5) as lesson (lesson.id)}
					{@const StatusIcon = lessonStatusIcon(lesson.status)}
					{@const href =
						lesson.status === 'locked' ? resolve('/learn') : resolve(`/lesson/${lesson.id}`)}
					<a
						{href}
						class="group flex items-center gap-3 px-4 py-3 transition-colors last:rounded-b-2xl
							{lesson.status === 'locked' ? 'hover:bg-base-50 opacity-60' : 'hover:bg-base-200/50'}"
					>
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full
								{lesson.status === 'completed'
								? 'bg-success/15 text-success'
								: lesson.status === 'active'
									? 'bg-secondary/15 text-secondary'
									: 'bg-base-200 text-base-content/40'}"
						>
							<StatusIcon size={16} />
						</div>
						<div class="min-w-0 flex-1">
							<p
								class="truncate text-sm font-semibold
								{lesson.status === 'active' ? 'text-secondary' : 'text-neutral'}"
							>
								{lesson.title}
							</p>
							<p class="text-xs text-base-content/50">
								{lessonTypeLabel(lesson.type)} ·
								<span
									class="capitalize {lesson.status === 'completed'
										? 'text-success'
										: lesson.status === 'active'
											? 'text-secondary'
											: ''}">{lesson.status}</span
								>
							</p>
						</div>
						{#if lesson.status === 'active'}
							<span class="badge rounded-full badge-sm badge-secondary">Go</span>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
