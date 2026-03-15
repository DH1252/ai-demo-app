<script lang="ts">
	import { marked } from 'marked';

	type Props = {
		text: string;
		// True only while this specific message bubble is the actively-streaming
		// one. When false (completed messages, or non-last messages) we never
		// suppress content — even if the model forgot to close </think>.
		streaming?: boolean;
	};

	let { text, streaming = false }: Props = $props();

	// Configure marked: no implicit line breaks (GFM default), open links in
	// new tab via a custom renderer so internal navigation is not broken.
	const renderer = new marked.Renderer();
	renderer.link = ({ href, title, text: linkText }) => {
		const titleAttr = title ? ` title="${title}"` : '';
		return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${linkText}</a>`;
	};

	// Strip <think>...</think> reasoning blocks emitted by Nemotron / other
	// reasoning models.
	//
	// Cases handled:
	//  1. Content exists AFTER </think>  →  show only that  (ideal path)
	//  2. </think> present but nothing follows AND still streaming  →  return ''
	//     (answer not yet arrived; keep loading indicator, don't show reasoning)
	//  3. </think> present, nothing follows, streaming DONE  →  reply was
	//     embedded inside the think block; strip just the tags, keep content
	//  4. <think> open, no </think> yet, AND still streaming  →  return ''
	//     (blank bubble while the model is still thinking is fine)
	//  5. <think> open, no </think>, but streaming is DONE  →  strip the open
	//     tag and show the content (model never closed the block — prevent
	//     permanently blank bubbles)
	function stripThinkBlocks(raw: string, isStreaming: boolean): string {
		const closeTag = '</think>';
		const closeIdx = raw.lastIndexOf(closeTag);

		if (closeIdx !== -1) {
			const afterClose = raw.slice(closeIdx + closeTag.length).trim();
			if (afterClose.length > 0) {
				// Normal path: answer follows the closing tag.
				return afterClose;
			}
			// Nothing after </think> yet — if still streaming, suppress until
			// the real answer text arrives so the bubble is never blank.
			if (isStreaming) return '';
			// Stream finished but reply was embedded inside the think block.
			// Remove only the <think> / </think> wrapper and show the content.
			return raw.replace(/<\/?think>/gi, '').trim();
		}

		if (/<think>/i.test(raw)) {
			// Still inside an unclosed think block.
			if (isStreaming) {
				// Mid-stream — suppress until </think> arrives.
				return '';
			}
			// Stream finished without a closing tag — show the content anyway
			// so the bubble is never permanently blank.
			return raw.replace(/<\/?think>/gi, '').trim();
		}

		// No think tags at all — pass through unchanged.
		return raw;
	}

	const html = $derived(
		marked(stripThinkBlocks(text, streaming), {
			renderer,
			gfm: true,
			breaks: false
		}) as string
	);
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="markdown-body">{@html html}</div>
