export type ToastType = 'success' | 'error' | 'warning' | 'info';

export type Toast = {
	id: number;
	message: string;
	type: ToastType;
};

const AUTO_DISMISS_MS = 3500;
let nextId = 0;

export const toasts = $state<Toast[]>([]);

export function showToast(message: string, type: ToastType = 'info') {
	const id = nextId++;
	toasts.push({ id, message, type });
	setTimeout(() => {
		const idx = toasts.findIndex((t) => t.id === id);
		if (idx !== -1) toasts.splice(idx, 1);
	}, AUTO_DISMISS_MS);
}
