<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { userState, initializeState, syncState } from '$lib/state/user.svelte';
	import { showToast } from '$lib/state/toast.svelte';
	import ToastContainer from '$lib/ToastContainer.svelte';
	import { Heart, Flame, Coins, Zap, Home, BookOpen, Bot, User } from 'lucide-svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';

	let { data, children } = $props();

	// Sync user state with layout data (client-side only — userState is a shared
	// module-level singleton; mutating it during SSR would bleed one user's data
	// into another user's rendered response under concurrent requests).
	$effect.pre(() => {
		if (typeof window === 'undefined') return;
		if (data.user) {
			initializeState(data);
		} else {
			// Reset state on logout
			userState.id = null;
			userState.name = 'Student';
			userState.xp = 0;
			userState.streak = 0;
			userState.hearts = 5;
			userState.coins = 0;
			userState.rank = 'Bronze Learner';
		}
	});

	// Refresh client state from the server on mount (picks up any server-side
	// changes — e.g. streak updates — that happened outside this session).
	$effect(() => {
		if (data.user) {
			syncState();
		}
	});

	// ── Stat-change toast watcher ──────────────────────────────────────────────
	// Plain (non-reactive) variables hold the last-known values. The effect only
	// reads from userState (reactive), so it re-runs whenever a stat changes.
	// statsReady gates the watcher: it becomes true after syncState() finishes,
	// so hydration writes from initializeState/syncState never produce toasts.
	let statsInitialized = false;
	let prevXp = 0;
	let prevHearts = 0;
	let prevCoins = 0;
	let prevStreak = 0;

	$effect(() => {
		if (!userState.statsReady) return;

		const xp = userState.xp;
		const hearts = userState.hearts;
		const coins = userState.coins;
		const streak = userState.streak;

		if (!statsInitialized) {
			// First run after sync — capture baseline without toasting.
			prevXp = xp;
			prevHearts = hearts;
			prevCoins = coins;
			prevStreak = streak;
			statsInitialized = true;
			return;
		}

		if (xp !== prevXp) {
			const d = xp - prevXp;
			showToast(d > 0 ? `+${d} XP` : `${d} XP`, d > 0 ? 'success' : 'warning');
			prevXp = xp;
		}
		if (hearts !== prevHearts) {
			const d = hearts - prevHearts;
			showToast(
				d > 0 ? `+${d} heart restored` : `${Math.abs(d)} heart lost`,
				d > 0 ? 'success' : 'error'
			);
			prevHearts = hearts;
		}
		if (coins !== prevCoins) {
			const d = coins - prevCoins;
			showToast(
				d > 0 ? `+${d} coins` : `${Math.abs(d)} coins spent`,
				d > 0 ? 'success' : 'warning'
			);
			prevCoins = coins;
		}
		if (streak !== prevStreak) {
			const d = streak - prevStreak;
			if (d > 0) showToast(`🔥 Streak: ${streak} days!`, 'success');
			prevStreak = streak;
		}
	});

	const shellRoutePrefixes = ['/', '/learn', '/tutor', '/profile'];
	let showShell = $derived(
		shellRoutePrefixes.some((prefix) =>
			prefix === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(prefix)
		)
	);

	let isActive = (path: string) => {
		return page.url.pathname === path || (path !== '/' && page.url.pathname.startsWith(path));
	};
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if showShell}
	<div class="fixed inset-0 flex w-full justify-center bg-slate-100 font-sans sm:px-4 sm:py-4">
		<div
			class="relative flex h-full w-full max-w-md flex-col overflow-hidden border-x border-base-200 bg-base-100 shadow-2xl sm:h-[calc(100%-2rem)] sm:rounded-3xl sm:border"
		>
			<!-- Top App Bar -->
			<header
				class="z-50 flex shrink-0 items-center gap-2 border-b border-base-200 bg-base-100/95 px-3 py-2.5 backdrop-blur sm:px-4"
			>
				<!-- Streak -->
				<div
					class="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-orange-50 px-2 py-1.5 text-sm font-bold text-orange-500 ring-1 ring-orange-100"
				>
					<Flame size={15} fill="currentColor" />
					<span>{userState.streak}</span>
				</div>

				<!-- XP -->
				<div
					class="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1.5 text-sm font-bold text-emerald-600 ring-1 ring-emerald-100"
				>
					<Zap size={15} fill="currentColor" />
					<span>{userState.xp}</span>
				</div>

				<!-- Coins -->
				<div
					class="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary/10 px-2 py-1.5 text-sm font-bold text-primary ring-1 ring-primary/20"
				>
					<Coins size={15} fill="currentColor" />
					<span>{userState.coins}</span>
				</div>

				<!-- Hearts -->
				<div
					class="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-red-50 px-2 py-1.5 text-sm font-bold text-red-500 ring-1 ring-red-100"
				>
					<Heart size={15} fill={userState.hearts > 0 ? 'currentColor' : 'none'} />
					<span>{userState.hearts}</span>
				</div>
			</header>

			<!-- Main Content Area -->
			<main class="relative w-full flex-1 overflow-y-auto overscroll-contain">
				{@render children()}
			</main>

			<!-- Bottom Navigation -->
			<nav
				aria-label="Primary"
				class="flex shrink-0 items-stretch justify-around border-t border-base-200 bg-base-100 pb-[env(safe-area-inset-bottom)]"
			>
				{#each [{ path: '/', icon: Home, label: 'Home' }, { path: '/learn', icon: BookOpen, label: 'Learn' }, { path: '/tutor', icon: Bot, label: 'Tutor' }, { path: '/profile', icon: User, label: 'Profile' }] as item (item.path)}
					{@const active = isActive(item.path)}
					<a
						href={base + item.path}
						aria-current={active ? 'page' : undefined}
						class="relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors
							{active ? 'text-primary' : 'text-neutral/40 hover:text-neutral/70'}"
					>
						{#if active}
							<span
								class="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-b-full bg-primary"
								aria-hidden="true"
							></span>
						{/if}

						{#if item.label === 'Tutor' && userState.hearts < userState.maxHearts}
							<div class="relative">
								<span
									class="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-error text-[9px] font-extrabold text-white ring-2 ring-base-100"
									aria-label="{userState.hearts} hearts remaining">{userState.hearts}</span
								>
								<item.icon size={22} />
							</div>
						{:else}
							<item.icon size={22} />
						{/if}

						<span>{item.label}</span>
					</a>
				{/each}
			</nav>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-base-100">
		{@render children()}
	</div>
{/if}

<ToastContainer />
