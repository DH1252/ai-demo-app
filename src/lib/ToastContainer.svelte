<script lang="ts">
	import { toasts } from '$lib/state/toast.svelte';
	import { fly, fade } from 'svelte/transition';
	import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-svelte';
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-20 z-[200] flex flex-col items-center gap-2 px-4"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toasts as toast (toast.id)}
		<div
			in:fly={{ y: 16, duration: 220 }}
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
