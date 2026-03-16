export type VideoProviderId = 'youtube';

export type VideoProvider = {
	id: VideoProviderId;
	label: string;
	inputExample: string;
	supportedHosts: readonly string[];
	frameSources: readonly string[];
	canEmbed: boolean;
	canGenerateFromUrl: boolean;
	toEmbedUrl: (parsedUrl: URL) => string | null;
};

function normalizeHostname(hostname: string): string {
	return hostname.replace(/^www\./, '').toLowerCase();
}

function uniqueSources(sources: readonly string[]): string[] {
	return [...new Set(sources)];
}

function extractYouTubeVideoId(parsedUrl: URL): string | null {
	const host = normalizeHostname(parsedUrl.hostname);

	if (host === 'youtu.be') {
		return parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
	}

	if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
		if (parsedUrl.pathname.startsWith('/watch')) {
			return parsedUrl.searchParams.get('v');
		}

		if (parsedUrl.pathname.startsWith('/embed/') || parsedUrl.pathname.startsWith('/shorts/')) {
			return parsedUrl.pathname.split('/')[2] ?? null;
		}
	}

	return null;
}

function getProviderForParsedUrl(parsedUrl: URL): VideoProvider | null {
	const host = normalizeHostname(parsedUrl.hostname);
	return (
		VIDEO_PROVIDERS.find((provider) =>
			provider.supportedHosts.some((supportedHost) => supportedHost === host)
		) ?? null
	);
}

export const VIDEO_PROVIDERS = [
	{
		id: 'youtube',
		label: 'YouTube',
		inputExample: 'https://www.youtube.com/watch?v=...',
		supportedHosts: ['youtu.be', 'youtube.com', 'm.youtube.com', 'youtube-nocookie.com'],
		frameSources: ['https://www.youtube-nocookie.com'],
		canEmbed: true,
		canGenerateFromUrl: true,
		toEmbedUrl(parsedUrl: URL): string | null {
			const videoId = extractYouTubeVideoId(parsedUrl);
			return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
		}
	}
] as const satisfies readonly VideoProvider[];

export const VIDEO_FRAME_SOURCES = uniqueSources(
	VIDEO_PROVIDERS.flatMap((provider) => provider.frameSources)
);

export const SUPPORTED_VIDEO_INPUT_EXAMPLES = VIDEO_PROVIDERS.map(
	(provider) => provider.inputExample
);
export const SUPPORTED_VIDEO_PROVIDER_LABELS = VIDEO_PROVIDERS.map((provider) => provider.label);
export const SUPPORTED_VIDEO_PROVIDER_TEXT = SUPPORTED_VIDEO_PROVIDER_LABELS.join(', ');
export const DEFAULT_VIDEO_INPUT_EXAMPLE =
	SUPPORTED_VIDEO_INPUT_EXAMPLES[0] ?? 'https://www.youtube.com/watch?v=...';
export const SUPPORTED_EXTERNAL_VIDEO_HELP_TEXT = `Supported external provider${SUPPORTED_VIDEO_PROVIDER_LABELS.length === 1 ? '' : 's'}: ${SUPPORTED_VIDEO_PROVIDER_TEXT}. Upload a native video or audio file for other sources.`;

export function getUnsupportedExternalVideoUrlMessage(): string {
	return `Unsupported external video URL. ${SUPPORTED_EXTERNAL_VIDEO_HELP_TEXT}`;
}

export function getVideoProvider(urlValue: string): VideoProvider | null {
	try {
		return getProviderForParsedUrl(new URL(urlValue));
	} catch {
		return null;
	}
}

export function isSupportedExternalVideoUrl(urlValue: string): boolean {
	return getVideoProvider(urlValue) !== null;
}

export function normalizeVideoEmbedUrl(urlValue: string): string | null {
	try {
		const parsedUrl = new URL(urlValue);
		const provider = getProviderForParsedUrl(parsedUrl);
		return provider?.toEmbedUrl(parsedUrl) ?? null;
	} catch {
		return null;
	}
}
