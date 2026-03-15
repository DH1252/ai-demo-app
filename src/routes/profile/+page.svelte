<script lang="ts">
	import type { PageData } from './$types';
	import { Shield, Medal, Star, Flame, Settings, Coins, Heart } from 'lucide-svelte';

	let { data } = $props() as { data: PageData };

	const completionPercent = $derived(
		data.profile.totalLessons > 0
			? Math.round((data.profile.completedLessons / data.profile.totalLessons) * 100)
			: 0
	);

	const achievements = $derived([
		{
			id: 1,
			title: 'First Steps',
			icon: Star,
			color: 'text-yellow-500',
			bg: 'bg-yellow-100',
			earned: data.profile.completedLessons >= 1
		},
		{
			id: 2,
			title: 'Streak Runner',
			icon: Flame,
			color: 'text-orange-500',
			bg: 'bg-orange-100',
			earned: data.profile.streak >= 7
		},
		{
			id: 3,
			title: 'Path Master',
			icon: Medal,
			color: 'text-cyan-600',
			bg: 'bg-cyan-100',
			earned:
				data.profile.totalLessons > 0 && data.profile.completedLessons === data.profile.totalLessons
		}
	]);
</script>

<div class="mx-auto max-w-md px-4 py-8 pb-24">
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold text-neutral">Profile</h1>
		<button
			type="button"
			class="btn btn-circle h-11 w-11 cursor-not-allowed opacity-40 btn-ghost"
			aria-label="Settings (coming soon)"
			title="Coming soon"
			disabled><Settings size={20} class="text-neutral-content" /></button
		>
	</div>

	<div
		class="mb-8 flex items-center gap-4 rounded-2xl border border-base-200 bg-base-100 p-4 shadow-sm"
	>
		<div class="placeholder avatar">
			<div
				class="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-content"
			>
				<span class="text-2xl font-bold">{data.profile.name.charAt(0)}</span>
			</div>
		</div>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-xl font-bold text-neutral">{data.profile.name}</h2>
			<p class="flex items-center gap-1 text-sm font-medium text-secondary">
				<Shield size={14} />
				{data.profile.rankLabel}
			</p>
			<p class="mt-0.5 text-xs text-base-content/50">
				Rank #{data.profile.rank} of {data.profile.totalUsers}
			</p>
		</div>
		<div class="shrink-0 text-right">
			<div class="text-3xl leading-none font-extrabold text-primary">{data.profile.xp}</div>
			<div class="mt-0.5 text-[10px] font-bold tracking-widest text-base-content/40 uppercase">
				XP
			</div>
		</div>
	</div>

	<div class="mb-8 grid grid-cols-3 gap-3">
		<div class="card border border-base-200 bg-base-100 shadow-sm">
			<div class="card-body items-center p-3 text-center">
				<div class="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-100">
					<Coins size={18} class="text-yellow-600" />
				</div>
				<p class="text-lg leading-none font-extrabold">{data.profile.coins}</p>
				<p class="text-[10px] font-semibold tracking-wide text-base-content/50 uppercase">Coins</p>
			</div>
		</div>
		<div class="card border border-base-200 bg-base-100 shadow-sm">
			<div class="card-body items-center p-3 text-center">
				<div class="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-red-100">
					<Heart size={18} class="text-error" fill="currentColor" />
				</div>
				<p class="text-lg leading-none font-extrabold">{data.profile.hearts}</p>
				<p class="text-[10px] font-semibold tracking-wide text-base-content/50 uppercase">Hearts</p>
			</div>
		</div>
		<div class="card border border-base-200 bg-base-100 shadow-sm">
			<div class="card-body items-center p-3 text-center">
				<div class="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100">
					<Flame size={18} class="text-orange-500" />
				</div>
				<p class="text-lg leading-none font-extrabold">{data.profile.streak}</p>
				<p class="text-[10px] font-semibold tracking-wide text-base-content/50 uppercase">Streak</p>
			</div>
		</div>
	</div>

	<div class="card mb-8 border border-base-200 bg-base-100 shadow-sm">
		<div class="card-body gap-2 p-4">
			<div class="flex items-center justify-between">
				<span class="text-sm font-semibold">Path completion</span>
				<span class="text-sm font-extrabold text-primary">{completionPercent}%</span>
			</div>
			<progress class="progress h-2.5 w-full progress-primary" value={completionPercent} max="100"
			></progress>
			<p class="text-xs text-base-content/50">
				{data.profile.completedLessons} of {data.profile.totalLessons} lessons completed
			</p>
		</div>
	</div>

	<h3 class="mb-3 text-base font-bold tracking-wide text-neutral uppercase">Achievements</h3>
	<div class="mb-8 grid grid-cols-3 gap-3">
		{#each achievements as badge (badge.id)}
			<div
				class="flex flex-col items-center rounded-xl border p-3 text-center shadow-sm transition-all
					{badge.earned
					? 'border-base-300 bg-base-100 ring-2 ring-primary/30'
					: 'bg-base-50 border-base-200 opacity-50 grayscale'}"
			>
				<div class="mb-2 flex h-12 w-12 items-center justify-center rounded-full {badge.bg}">
					<badge.icon size={24} class={badge.color} />
				</div>
				<span class="text-[11px] leading-tight font-bold">{badge.title}</span>
				{#if badge.earned}
					<span class="mt-1 text-[9px] font-bold tracking-widest text-primary/70 uppercase"
						>Earned</span
					>
				{/if}
			</div>
		{/each}
	</div>

	<h3 class="mb-3 text-base font-bold tracking-wide text-neutral uppercase">Class Leaderboard</h3>
	<div class="overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-sm">
		{#each data.profile.leaderboard as user, i (i)}
			<div
				class="flex min-h-14 items-center gap-3 border-b border-base-200 p-3 last:border-b-0
					{user.isMe ? 'border-l-4 border-l-secondary bg-secondary/10' : ''}"
			>
				<div
					class="w-7 shrink-0 text-center text-sm font-extrabold
						{user.rank === 1
						? 'text-yellow-500'
						: user.rank === 2
							? 'text-slate-400'
							: user.rank === 3
								? 'text-orange-400'
								: 'text-neutral/30'}"
				>
					{user.rank <= 3 ? ['🥇', '🥈', '🥉'][user.rank - 1] : user.rank}
				</div>
				<div class="placeholder avatar">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full
							{user.isMe ? 'bg-secondary text-secondary-content' : 'bg-base-200 text-neutral'}"
					>
						<span class="text-xs font-bold">{user.name.charAt(0)}</span>
					</div>
				</div>
				<div
					class="flex-1 truncate text-sm
						{user.isMe ? 'font-extrabold text-secondary' : 'font-medium text-neutral'}"
				>
					{user.name}{user.isMe ? ' (you)' : ''}
				</div>
				<div class="shrink-0 text-sm font-bold text-neutral/60">
					{user.xp.toLocaleString()} XP
				</div>
			</div>
		{/each}
	</div>
</div>
