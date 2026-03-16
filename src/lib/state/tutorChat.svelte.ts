import type { UIMessage } from 'ai';

/**
 * Module-level singleton — persists across client-side navigation but is
 * wiped on a full page reload (not stored in localStorage intentionally).
 * The tutor page reads this on mount and writes back on every message change.
 */
export const tutorChatState = $state({
	messages: [] as UIMessage[],
	chatMode: 'hint' as 'hint' | 'explain',
	didEscalate: false
});

export function clearTutorChat() {
	tutorChatState.messages = [];
	tutorChatState.chatMode = 'hint';
	tutorChatState.didEscalate = false;
}
