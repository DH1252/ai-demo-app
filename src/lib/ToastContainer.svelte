<script lang="ts">
	import { toasts } from '$lib/state/toast.svelte';
	import { fly, fade } from 'svelte/transition';
	import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-svelte';

	// Show at most 3 toasts at once — prevents a wall of notifications when
	// multiple stats change simultaneously (e.g. XP + coins + streak on submit).
	const visible = $derived(toasts.slice(-3));
</script>

<!--
  Fixed at the top of the viewport (top-20 clears both the shell header and the
  lesson-page progress header). Using top placement avoids covering the bottom
  nav on shell pages and the AI tutor panel input on the lesson page.
-->
<div
	class="pointer-events-none fixed inset-x-0 top-20 z-[200] flex flex-col items-center gap-2 px-4"
	aria-live="polite"
	aria-atomic="false"
>
	{#each visible as toast (toast.id)}
		<div
			in:fly={{ y: -14, duration: 220 }}
			out:fade={{ duration: 180 }}
			role="status"
			class="pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg
				{toast.type === 'success' ? 'bg-success text-success-content' : ''}
				{toast.type === 'error' ? 'bg-error text-error-content' : ''}
				{toast.type === 'warning' ? 'bg-warning text-warning-content' : ''}
				{toast.type === 'info' ? 'bg-info text-info-content' : ''}"
		>
			{#if toast.type === 'success'}
				<CheckCircle size={16} class="shrink-0" />
			{:else if toast.type === 'error'}
				<XCircle size={16} class="shrink-0" />
			{:else if toast.type === 'warning'}
				<AlertTriangle size={16} class="shrink-0" />
			{:else}
				<Info size={16} class="shrink-0" />
			{/if}
			<span>{toast.message}</span>
		</div>
	{/each}
</div>
