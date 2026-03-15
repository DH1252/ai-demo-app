<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import {
		Film,
		BookOpen,
		PlusCircle,
		X,
		Upload,
		ArrowUp,
		ArrowDown,
		Sparkles,
		LoaderCircle,
		GripVertical,
		Trash2,
		Pencil,
		Coins,
		Heart,
		Flame,
		Trophy,
		Bug
	} from 'lucide-svelte';

	let { data, form } = $props() as { data: PageData; form: ActionData };

	let showForm = $state(false);

	const ADMIN_SECRET_KEY = 'admin-secret-key';

	type QuestionOption = {
		id: string;
		text: string;
	};

	type QuestionDraft = {
		id: string;
		text: string;
		options: QuestionOption[];
		correctOptionId: string;
		explanation: string;
	};

	const createOption = () => ({
		id: crypto.randomUUID(),
		text: ''
	});

	const createQuestion = (): QuestionDraft => {
		const firstOption = createOption();
		const secondOption = createOption();

		return {
			id: crypto.randomUUID(),
			text: '',
			options: [firstOption, secondOption],
			correctOptionId: firstOption.id,
			explanation: ''
		};
	};

	let questions = $state<QuestionDraft[]>([createQuestion()]);
	let draggedQuestionIndex = $state<number | null>(null);
	let dropTargetIndex = $state<number | null>(null);
	let dropPlacement = $state<'before' | 'after'>('before');
	let videoUrlValue = $state('');
	let mediaFiles = $state<FileList | null>(null);
	let isAnalyzingVideo = $state(false);
	let analyzeError = $state<string | null>(null);
	let questionCount = $state(3);
	let adminSecretValue = $state('');
	let editingLessonId = $state<string | null>(null);
	let aiDebugEnabled = $state(false);
	let aiDebugLoading = $state(false);

	onMount(() => {
		const stored = localStorage.getItem(ADMIN_SECRET_KEY);
		if (stored) {
			adminSecretValue = stored;
		}
		// Fetch current AI debug state from server (no auth required for GET)
		fetch('/api/admin/ai-debug')
			.then((r) => r.json())
			.then((d: { enabled: boolean }) => {
				aiDebugEnabled = d.enabled;
			})
			.catch(() => {});
	});

	$effect(() => {
		if (adminSecretValue) {
			localStorage.setItem(ADMIN_SECRET_KEY, adminSecretValue);
		} else {
			localStorage.removeItem(ADMIN_SECRET_KEY);
		}
	});

	async function toggleAiDebug() {
		if (!adminSecretValue.trim() || aiDebugLoading) return;
		aiDebugLoading = true;
		try {
			const res = await fetch('/api/admin/ai-debug', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ secret: adminSecretValue, enabled: !aiDebugEnabled })
			});
			if (res.ok) {
				const d: { enabled: boolean } = await res.json();
				aiDebugEnabled = d.enabled;
			}
		} finally {
			aiDebugLoading = false;
		}
	}
	let editTitle = $state('');
	let editType = $state<'standard' | 'test' | 'ai-remedial'>('standard');
	let editVideoUrl = $state('');
	let editQuestions = $state<QuestionDraft[]>([createQuestion()]);
	let editContentError = $state<string | null>(null);
	let newPathName = $state('');
	let newPathDescription = $state('');
	let analysisProgress = $state(0);
	let analysisStatus = $state('Idle');
	let analysisLogs = $state<string[]>([]);

	const contentDataString = $derived(
		JSON.stringify({
			questions: questions.map((question, index) => ({
				id: question.id,
				order: index + 1,
				text: question.text.trim(),
				options: question.options.map((option) => ({
					id: option.id,
					text: option.text.trim()
				})),
				correctOptionId: question.correctOptionId,
				explanation: question.explanation.trim()
			}))
		})
	);

	const editContentDataString = $derived(
		JSON.stringify({
			questions: editQuestions.map((question, index) => ({
				id: question.id,
				order: index + 1,
				text: question.text.trim(),
				options: question.options.map((option) => ({
					id: option.id,
					text: option.text.trim()
				})),
				correctOptionId: question.correctOptionId,
				explanation: question.explanation.trim()
			}))
		})
	);

	function addQuestion() {
		questions = [...questions, createQuestion()];
	}

	function removeQuestion(index: number) {
		if (questions.length === 1) return;
		questions = questions.filter((_, i) => i !== index);
	}

	function moveQuestionUp(index: number) {
		if (index === 0) return;
		const next = [...questions];
		[next[index - 1], next[index]] = [next[index], next[index - 1]];
		questions = next;
	}

	function moveQuestionDown(index: number) {
		if (index === questions.length - 1) return;
		const next = [...questions];
		[next[index + 1], next[index]] = [next[index], next[index + 1]];
		questions = next;
	}

	function reorderQuestions(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const next = [...questions];
		const [moved] = next.splice(fromIndex, 1);
		if (!moved) return;
		next.splice(toIndex, 0, moved);
		questions = next;
	}

	function onQuestionDragStart(index: number, event: DragEvent) {
		draggedQuestionIndex = index;
		event.dataTransfer?.setData('text/plain', String(index));
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function onQuestionDragOver(index: number, event: DragEvent) {
		if (draggedQuestionIndex === null) return;
		event.preventDefault();
		dropTargetIndex = index;
		const target = event.currentTarget as HTMLElement | null;
		if (target) {
			const rect = target.getBoundingClientRect();
			const midpoint = rect.top + rect.height / 2;
			dropPlacement = event.clientY < midpoint ? 'before' : 'after';
		}
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	}

	function onQuestionDrop(index: number, event: DragEvent) {
		if (draggedQuestionIndex === null) return;
		event.preventDefault();
		const data = event.dataTransfer?.getData('text/plain');
		const sourceIndex = data ? Number.parseInt(data, 10) : draggedQuestionIndex;

		if (typeof sourceIndex === 'number' && Number.isInteger(sourceIndex)) {
			let targetIndex = dropPlacement === 'after' ? index + 1 : index;
			if (sourceIndex < targetIndex) targetIndex -= 1;
			reorderQuestions(sourceIndex, targetIndex);
		}

		draggedQuestionIndex = null;
		dropTargetIndex = null;
		dropPlacement = 'before';
	}

	function onQuestionDragLeave(index: number) {
		if (dropTargetIndex === index) {
			dropTargetIndex = null;
		}
	}

	function onQuestionDragEnd() {
		draggedQuestionIndex = null;
		dropTargetIndex = null;
		dropPlacement = 'before';
	}

	function addOption(questionIndex: number) {
		const question = questions[questionIndex];
		if (!question) return;

		const option = createOption();
		question.options = [...question.options, option];
	}

	function removeOption(questionIndex: number, optionIndex: number) {
		const question = questions[questionIndex];
		if (!question || question.options.length <= 2) return;

		const removed = question.options[optionIndex];
		question.options = question.options.filter((_, i) => i !== optionIndex);

		if (removed && question.correctOptionId === removed.id) {
			question.correctOptionId = question.options[0]?.id ?? '';
		}
	}

	function addEditQuestion() {
		editQuestions = [...editQuestions, createQuestion()];
	}

	function removeEditQuestion(index: number) {
		if (editQuestions.length === 1) return;
		editQuestions = editQuestions.filter((_, i) => i !== index);
	}

	function moveEditQuestionUp(index: number) {
		if (index === 0) return;
		const next = [...editQuestions];
		[next[index - 1], next[index]] = [next[index], next[index - 1]];
		editQuestions = next;
	}

	function moveEditQuestionDown(index: number) {
		if (index === editQuestions.length - 1) return;
		const next = [...editQuestions];
		[next[index + 1], next[index]] = [next[index], next[index + 1]];
		editQuestions = next;
	}

	function addEditOption(questionIndex: number) {
		const question = editQuestions[questionIndex];
		if (!question) return;

		const option = createOption();
		question.options = [...question.options, option];
	}

	function removeEditOption(questionIndex: number, optionIndex: number) {
		const question = editQuestions[questionIndex];
		if (!question || question.options.length <= 2) return;

		const removed = question.options[optionIndex];
		question.options = question.options.filter((_, i) => i !== optionIndex);

		if (removed && question.correctOptionId === removed.id) {
			question.correctOptionId = question.options[0]?.id ?? '';
		}
	}

	function toQuestionDraftFromStored(question: any): QuestionDraft {
		const optionDrafts: QuestionOption[] = Array.isArray(question?.options)
			? question.options
					.filter((option: any) => typeof option?.text === 'string')
					.map((option: any) => ({
						id: typeof option?.id === 'string' && option.id ? option.id : crypto.randomUUID(),
						text: option.text
					}))
			: [];

		const normalizedOptions =
			optionDrafts.length >= 2 ? optionDrafts : [createOption(), createOption()];

		const providedCorrectOptionId =
			typeof question?.correctOptionId === 'string' ? question.correctOptionId : '';
		const resolvedCorrectOptionId = normalizedOptions.some(
			(option) => option.id === providedCorrectOptionId
		)
			? providedCorrectOptionId
			: normalizedOptions[0].id;

		return {
			id: typeof question?.id === 'string' && question.id ? question.id : crypto.randomUUID(),
			text: typeof question?.text === 'string' ? question.text : '',
			options: normalizedOptions,
			correctOptionId: resolvedCorrectOptionId,
			explanation: typeof question?.explanation === 'string' ? question.explanation : ''
		};
	}

	function questionDraftIsValid(question: QuestionDraft): boolean {
		if (!question.text.trim() || !question.explanation.trim()) return false;
		if (question.options.length < 2) return false;
		if (question.options.some((option) => !option.text.trim())) return false;
		return question.options.some((option) => option.id === question.correctOptionId);
	}

	type GeneratedQuestion = {
		text: string;
		options: string[];
		correctOptionIndex: number;
		explanation: string;
	};

	function toQuestionDraft(generated: GeneratedQuestion): QuestionDraft {
		const optionDrafts = generated.options.map((text) => ({
			id: crypto.randomUUID(),
			text
		}));

		const safeCorrectIndex = Math.max(
			0,
			Math.min(generated.correctOptionIndex, optionDrafts.length - 1)
		);

		return {
			id: crypto.randomUUID(),
			text: generated.text,
			options: optionDrafts,
			correctOptionId: optionDrafts[safeCorrectIndex]?.id ?? optionDrafts[0]?.id ?? '',
			explanation: generated.explanation
		};
	}

	function isPlaceholderQuestion(question: QuestionDraft): boolean {
		return (
			question.text.trim() === '' &&
			question.explanation.trim() === '' &&
			question.options.every((option) => option.text.trim() === '')
		);
	}

	function addAnalysisLog(message: string) {
		const timestamp = new Date().toLocaleTimeString();
		analysisLogs = [...analysisLogs, `[${timestamp}] ${message}`];
	}

	async function analyzeVideoAndGenerateQuestions() {
		const mediaFile = mediaFiles?.item(0) ?? null;
		const trimmedVideoUrl = videoUrlValue.trim();

		if (!trimmedVideoUrl && !mediaFile) {
			analyzeError = 'Add a video URL or upload a media file before analyzing.';
			return;
		}

		if (!adminSecretValue.trim()) {
			analyzeError = 'Enter admin secret before generating questions.';
			return;
		}

		isAnalyzingVideo = true;
		analyzeError = null;
		analysisProgress = 3;
		analysisStatus = 'Starting';
		analysisLogs = [];
		addAnalysisLog('Preparing video analysis request.');
		if (trimmedVideoUrl) {
			addAnalysisLog(`Video URL detected: ${trimmedVideoUrl}`);
		}
		if (mediaFile) {
			addAnalysisLog(
				`Uploaded media detected: ${mediaFile.name} (${Math.round(mediaFile.size / 1024)} KB).`
			);
		}

		try {
			const payload = new FormData();
			if (trimmedVideoUrl) payload.append('videoUrl', trimmedVideoUrl);
			if (mediaFile) payload.append('mediaFile', mediaFile);
			payload.append('secret', adminSecretValue);
			payload.append('questionCount', String(questionCount));

			const response = await fetch('/api/admin/generate-from-video', {
				method: 'POST',
				body: payload
			});

			if (!response.ok) {
				let message = 'Video analysis failed.';
				try {
					const body = (await response.json()) as { error?: string };
					message = body.error || message;
				} catch {
					const text = await response.text();
					message = text || message;
				}
				throw new Error(message);
			}

			// Read Server-Sent Events from the response body stream
			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body stream available.');

			const decoder = new TextDecoder();
			let buffer = '';
			let generatedQuestions: GeneratedQuestion[] = [];

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// SSE events are separated by double newlines
				const parts = buffer.split('\n\n');
				// Keep any incomplete trailing chunk in the buffer
				buffer = parts.pop() ?? '';

				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data:')) continue;

					let parsed: {
						type: string;
						message?: string;
						progress?: number;
						status?: string;
						questions?: GeneratedQuestion[];
					};
					try {
						parsed = JSON.parse(line.slice('data:'.length).trim());
					} catch {
						continue;
					}

					if (parsed.type === 'log') {
						if (parsed.progress !== undefined) {
							analysisProgress = parsed.progress;
						}
						if (parsed.status) {
							analysisStatus = parsed.status;
						}
						if (parsed.message) {
							addAnalysisLog(parsed.message);
						}
					} else if (parsed.type === 'done') {
						generatedQuestions = parsed.questions ?? [];
						analysisProgress = 100;
						analysisStatus = 'Completed';
						addAnalysisLog(
							`Generated ${generatedQuestions.length} question${generatedQuestions.length === 1 ? '' : 's'} successfully.`
						);
						break outer;
					} else if (parsed.type === 'error') {
						throw new Error(parsed.message || 'Video analysis failed.');
					}
				}
			}

			if (generatedQuestions.length === 0) {
				throw new Error('No questions were generated from this video.');
			}

			const generatedDrafts = generatedQuestions.map(toQuestionDraft);
			const shouldReplaceInitialPlaceholder =
				questions.length === 1 && isPlaceholderQuestion(questions[0]);
			questions = shouldReplaceInitialPlaceholder
				? generatedDrafts
				: [...questions, ...generatedDrafts];
		} catch (error) {
			analyzeError = error instanceof Error ? error.message : 'Failed to analyze video.';
			analysisStatus = 'Failed';
			addAnalysisLog(analyzeError);
		} finally {
			isAnalyzingVideo = false;
		}
	}

	function confirmDelete(event: SubmitEvent, lessonTitle: string) {
		if (!confirm(`Delete lesson \"${lessonTitle}\"? This action cannot be undone.`)) {
			event.preventDefault();
		}
	}

	function startEditLesson(lesson: PageData['lessons'][number]) {
		editingLessonId = lesson.id;
		editTitle = lesson.title;
		editType = lesson.type;
		editVideoUrl = lesson.videoUrl ?? '';

		try {
			const parsed = JSON.parse(lesson.contentData) as { questions?: unknown[] };
			const parsedQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
			const nextQuestions =
				parsedQuestions.length > 0
					? parsedQuestions.map((question) => toQuestionDraftFromStored(question))
					: [createQuestion()];
			editQuestions = nextQuestions;
			editContentError = null;
		} catch {
			editQuestions = [createQuestion()];
			editContentError =
				'Existing lesson data is invalid. Rebuild questions and save to repair it.';
		}
	}

	function cancelEditLesson() {
		editingLessonId = null;
		editTitle = '';
		editType = 'standard';
		editVideoUrl = '';
		editQuestions = [createQuestion()];
		editContentError = null;
	}

	function submitEditLesson(event: SubmitEvent) {
		if (!adminSecretValue.trim()) {
			event.preventDefault();
			editContentError = 'Enter admin secret before updating a lesson.';
			return;
		}

		if (
			editQuestions.length === 0 ||
			editQuestions.some((question) => !questionDraftIsValid(question))
		) {
			event.preventDefault();
			editContentError =
				'Every question needs text, at least 2 options, one correct answer, and an explanation.';
			return;
		}

		editContentError = null;
	}

	let createFormError = $state<string | null>(null);
	let isPublishing = $state(false);

	function submitCreateLesson(event: SubmitEvent) {
		if (!adminSecretValue.trim()) {
			event.preventDefault();
			createFormError = 'Enter admin secret before publishing a lesson.';
			return;
		}

		if (questions.length === 0 || questions.some((question) => !questionDraftIsValid(question))) {
			event.preventDefault();
			createFormError =
				'Every question needs text, at least 2 options, one correct answer, and an explanation.';
			return;
		}

		createFormError = null;
	}
</script>

<div class="min-h-screen bg-base-100 p-4 pb-24 sm:p-6">
	<!-- Sticky Admin Secret Bar -->
	<div
		class="sticky top-0 z-30 -mx-4 -mt-4 mb-6 border-b border-base-200 bg-base-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6"
	>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
			<label class="label shrink-0 p-0 sm:w-40" for="admin-secret-global">
				<span class="label-text font-semibold text-warning">Admin Secret</span>
			</label>
			<input
				type="password"
				id="admin-secret-global"
				bind:value={adminSecretValue}
				placeholder="Enter admin password to unlock actions"
				class="input-bordered input min-h-10 w-full"
			/>
			{#if adminSecretValue.trim()}
				<span class="badge shrink-0 gap-1 text-xs badge-success">Unlocked</span>
			{:else}
				<span class="badge shrink-0 gap-1 text-xs badge-warning">Locked</span>
			{/if}
		</div>
	</div>

	<div class="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h1 class="text-2xl font-bold text-neutral sm:text-3xl">
			Admin CMS <span class="rounded bg-base-200 px-2 text-sm font-normal opacity-50">v1.0</span>
		</h1>
		<button
			type="button"
			class="btn min-h-11 self-start btn-primary sm:self-auto"
			onclick={() => (showForm = !showForm)}
		>
			{#if showForm}
				<X size={20} /> Cancel
			{:else}
				<PlusCircle size={20} /> New Lesson
			{/if}
		</button>
	</div>

	{#if form?.error}
		<div class="mb-6 alert alert-error shadow-sm" role="alert" aria-live="polite">
			<span class="font-bold">{form.error}</span>
		</div>
	{/if}
	{#if form?.success}
		<div class="mb-6 alert alert-success shadow-sm" role="status" aria-live="polite">
			<span class="font-bold">{form.success}</span>
		</div>
	{/if}

	{#if editingLessonId}
		<div class="card mb-8 border border-base-300 bg-base-200 shadow-xl">
			<div class="card-body">
				<div class="mb-2 flex items-center justify-between gap-3">
					<h2 class="card-title">Edit Lesson</h2>
					<button class="btn btn-ghost btn-sm" type="button" onclick={cancelEditLesson}>
						<X size={16} /> Close
					</button>
				</div>

				<form
					method="POST"
					action="?/updateLesson"
					class="flex flex-col gap-4"
					onsubmit={submitEditLesson}
				>
					<input type="hidden" name="lessonId" value={editingLessonId} />
					<input type="hidden" name="secret" value={adminSecretValue} />
					<input type="hidden" name="contentData" value={editContentDataString} />

					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="form-control w-full md:col-span-2">
							<label class="label" for="edit-title"
								><span class="label-text font-medium">Lesson Title</span></label
							>
							<input
								type="text"
								id="edit-title"
								name="title"
								bind:value={editTitle}
								required
								class="input-bordered input min-h-11"
							/>
						</div>
						<div class="form-control w-full">
							<label class="label" for="edit-type"
								><span class="label-text font-medium">Type</span></label
							>
							<select
								id="edit-type"
								name="type"
								class="select-bordered select min-h-11"
								bind:value={editType}
								required
							>
								<option value="standard">Standard</option>
								<option value="test">Test</option>
								<option value="ai-remedial">AI Remedial</option>
							</select>
						</div>
					</div>

					<div class="form-control w-full">
						<label class="label" for="edit-video-url">
							<span class="label-text flex items-center gap-1 font-medium"
								><Film size={16} /> Video URL</span
							>
							<span class="label-text-alt text-base-content/60">Optional</span>
						</label>
						<input
							type="url"
							id="edit-video-url"
							name="videoUrl"
							bind:value={editVideoUrl}
							class="input-bordered input min-h-11"
							placeholder="https://www.youtube.com/watch?v=..."
						/>
					</div>

					<div class="form-control w-full gap-3">
						<div class="flex items-center justify-between gap-3">
							<label class="label p-0" for="edit-question-editor-start">
								<span class="label-text font-medium">Question Designer</span>
							</label>
							<button class="btn btn-outline btn-sm" type="button" onclick={addEditQuestion}>
								<PlusCircle size={16} /> Add Question
							</button>
						</div>

						<div id="edit-question-editor-start" class="space-y-4">
							{#each editQuestions as question, questionIndex (question.id)}
								<div class="card border border-base-300 bg-base-100 shadow-sm">
									<div class="card-body gap-4">
										<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<h3 class="text-base font-semibold">Question {questionIndex + 1}</h3>
											<div class="flex items-center gap-2">
												<button
													class="btn btn-ghost btn-sm"
													type="button"
													onclick={() => moveEditQuestionUp(questionIndex)}
													disabled={questionIndex === 0}
													aria-label={`Move question ${questionIndex + 1} up`}
												>
													<ArrowUp size={16} />
												</button>
												<button
													class="btn btn-ghost btn-sm"
													type="button"
													onclick={() => moveEditQuestionDown(questionIndex)}
													disabled={questionIndex === editQuestions.length - 1}
													aria-label={`Move question ${questionIndex + 1} down`}
												>
													<ArrowDown size={16} />
												</button>
												<button
													class="btn text-error btn-ghost btn-sm"
													type="button"
													onclick={() => removeEditQuestion(questionIndex)}
													disabled={editQuestions.length === 1}
													aria-label={`Remove question ${questionIndex + 1}`}
												>
													<X size={16} />
												</button>
											</div>
										</div>

										<div class="form-control w-full">
											<label class="label" for={`edit-question-${question.id}`}>
												<span class="label-text">Question Text</span>
											</label>
											<input
												id={`edit-question-${question.id}`}
												type="text"
												class="input-bordered input"
												bind:value={question.text}
												required
												placeholder="Enter the question prompt"
											/>
										</div>

										<div class="space-y-2">
											<div class="flex items-center justify-between gap-3">
												<span class="text-sm font-medium">Answer Options</span>
												<button
													class="btn btn-outline btn-xs"
													type="button"
													onclick={() => addEditOption(questionIndex)}
												>
													<PlusCircle size={14} /> Add Option
												</button>
											</div>

											{#each question.options as option, optionIndex (option.id)}
												<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2">
													<input
														id={`edit-correct-${question.id}-${option.id}`}
														type="radio"
														class="radio radio-primary"
														name={`edit-correct-option-${question.id}`}
														checked={question.correctOptionId === option.id}
														onchange={() => (question.correctOptionId = option.id)}
														aria-label={`Mark option ${optionIndex + 1} as correct`}
													/>
													<input
														id={`edit-option-${question.id}-${option.id}`}
														type="text"
														class="input-bordered input"
														bind:value={option.text}
														required
														placeholder={`Option ${optionIndex + 1}`}
													/>
													<button
														class="btn text-error btn-ghost btn-sm"
														type="button"
														onclick={() => removeEditOption(questionIndex, optionIndex)}
														disabled={question.options.length <= 2}
														aria-label={`Remove option ${optionIndex + 1}`}
													>
														<X size={14} />
													</button>
												</div>
											{/each}
											<p class="text-xs opacity-70">
												Select the radio button for the correct option.
											</p>
										</div>

										<div class="form-control w-full">
											<label class="label" for={`edit-explanation-${question.id}`}>
												<span class="label-text">Explanation</span>
											</label>
											<textarea
												id={`edit-explanation-${question.id}`}
												class="textarea-bordered textarea min-h-24"
												bind:value={question.explanation}
												required
												placeholder="Explain why the correct answer is correct"
											></textarea>
										</div>
									</div>
								</div>
							{/each}
						</div>

						{#if editContentError}
							<p class="mt-1 text-xs text-error">{editContentError}</p>
						{/if}
					</div>

					<div class="mt-2 card-actions justify-end">
						<button class="btn btn-outline" type="button" onclick={cancelEditLesson}>Cancel</button>
						<button class="btn btn-primary" type="submit" disabled={!adminSecretValue.trim()}>
							<Upload size={16} /> Save Changes
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if showForm}
		<div class="card mb-8 border border-base-300 bg-base-200 shadow-xl">
			<div class="card-body">
				<h2 class="mb-4 card-title">Create New Lesson</h2>
				<form
					method="POST"
					action="?/createLesson"
					enctype="multipart/form-data"
					class="flex flex-col gap-4"
					onsubmit={submitCreateLesson}
					use:enhance={() => {
						isPublishing = true;
						return async ({ update }) => {
							await update();
							isPublishing = false;
						};
					}}
				>
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div class="form-control w-full md:col-span-2">
							<label class="label" for="title"
								><span class="label-text font-medium">Lesson Title</span></label
							>
							<input
								type="text"
								id="title"
								name="title"
								required
								placeholder="e.g. Intro to Algebra"
								class="input-bordered input min-h-11"
							/>
						</div>
						<div class="form-control w-full">
							<label class="label" for="type"
								><span class="label-text font-medium">Type</span></label
							>
							<select id="type" name="type" class="select-bordered select min-h-11" required>
								<option value="standard">Standard</option>
								<option value="test">Test</option>
								<option value="ai-remedial">AI Remedial</option>
							</select>
						</div>
					</div>

					<div class="form-control w-full">
						<label class="label" for="videoUrl">
							<span class="label-text flex items-center gap-1 font-medium"
								><Film size={16} /> Video Embed URL</span
							>
							<span class="label-text-alt text-base-content/60">Optional</span>
						</label>
						<input
							type="url"
							id="videoUrl"
							name="videoUrl"
							bind:value={videoUrlValue}
							placeholder="https://www.youtube.com/watch?v=..."
							class="input-bordered input min-h-11"
						/>
					</div>

					<div class="form-control w-full">
						<label class="label" for="mediaFile">
							<span class="label-text font-medium text-warning">Native Video or Audio File</span>
							<span class="label-text-alt text-base-content/60"
								>Upload .mp4, .webm, .wav, or .mp3</span
							>
						</label>
						<input
							type="file"
							id="mediaFile"
							name="mediaFile"
							bind:files={mediaFiles}
							accept="video/*,audio/*"
							class="file-input-bordered file-input min-h-11 w-full file-input-warning"
						/>
					</div>

					<div class="form-control w-full gap-3">
						<div class="flex items-center justify-between gap-3">
							<label class="label p-0" for="question-editor-start">
								<span class="label-text font-medium">Question Designer</span>
							</label>
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex items-center gap-2">
									<label
										for="question-count"
										class="label-text text-sm font-medium whitespace-nowrap">Questions</label
									>
									<input
										id="question-count"
										type="number"
										min="1"
										max="10"
										bind:value={questionCount}
										class="input-bordered input input-sm w-16 text-center"
									/>
								</div>
								<button
									class="btn btn-sm btn-accent"
									type="button"
									onclick={analyzeVideoAndGenerateQuestions}
									disabled={isAnalyzingVideo}
								>
									{#if isAnalyzingVideo}
										<LoaderCircle size={16} class="animate-spin" /> Analyzing Video...
									{:else}
										<Sparkles size={16} /> Analyze Video & Generate Questions
									{/if}
								</button>
								<button class="btn btn-outline btn-sm" type="button" onclick={addQuestion}>
									<PlusCircle size={16} /> Add Question
								</button>
							</div>
						</div>

						{#if analyzeError}
							<div class="alert py-2 alert-warning">
								<span>{analyzeError}</span>
							</div>
						{/if}

						{#if isAnalyzingVideo || analysisLogs.length > 0}
							<div class="card border border-base-300 bg-base-100 shadow-sm">
								<div class="card-body gap-3 p-4">
									<div class="flex items-center justify-between text-sm">
										<span class="font-medium">Video Analysis Progress</span>
										<span class="font-mono opacity-70">{analysisProgress}%</span>
									</div>
									<progress
										class="progress w-full progress-accent"
										value={analysisProgress}
										max="100"
									></progress>
									<p class="text-xs opacity-70">Status: {analysisStatus}</p>

									<div
										class="max-h-44 overflow-y-auto rounded-lg border border-base-300 bg-base-200/60 p-3"
									>
										<div class="mb-2 text-xs font-semibold">Analysis Logs</div>
										<ul class="space-y-1 font-mono text-xs leading-snug">
											{#each analysisLogs as log, index (index)}
												<li>{log}</li>
											{/each}
											{#if isAnalyzingVideo}
												<li class="opacity-70">...processing</li>
											{/if}
										</ul>
									</div>
								</div>
							</div>
						{/if}

						<input type="hidden" name="contentData" value={contentDataString} />

						<div id="question-editor-start" class="space-y-4" role="list">
							{#each questions as question, questionIndex (question.id)}
								<div
									class="card relative border bg-base-100 shadow-sm transition-colors {dropTargetIndex ===
									questionIndex
										? 'border-primary'
										: 'border-base-300'}"
									role="listitem"
									ondragover={(event) => onQuestionDragOver(questionIndex, event)}
									ondragleave={() => onQuestionDragLeave(questionIndex)}
									ondrop={(event) => onQuestionDrop(questionIndex, event)}
								>
									{#if dropTargetIndex === questionIndex}
										<div
											class="pointer-events-none absolute right-3 left-3 z-10 h-1 rounded-full bg-primary"
											style={dropPlacement === 'before' ? 'top: -2px;' : 'bottom: -2px;'}
											aria-hidden="true"
										></div>
									{/if}
									<div class="card-body gap-4">
										<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
											<h3 class="text-base font-semibold">Question {questionIndex + 1}</h3>
											<div class="flex items-center gap-2">
												<button
													class="btn cursor-move btn-ghost btn-sm"
													type="button"
													draggable="true"
													ondragstart={(event) => onQuestionDragStart(questionIndex, event)}
													ondragend={onQuestionDragEnd}
													aria-label={`Drag question ${questionIndex + 1} to reorder`}
													title="Drag to reorder"
												>
													<GripVertical size={16} /> Drag
												</button>
												<button
													class="btn btn-ghost btn-sm"
													type="button"
													onclick={() => moveQuestionUp(questionIndex)}
													disabled={questionIndex === 0}
													aria-label={`Move question ${questionIndex + 1} up`}
												>
													<ArrowUp size={16} />
												</button>
												<button
													class="btn btn-ghost btn-sm"
													type="button"
													onclick={() => moveQuestionDown(questionIndex)}
													disabled={questionIndex === questions.length - 1}
													aria-label={`Move question ${questionIndex + 1} down`}
												>
													<ArrowDown size={16} />
												</button>
												<button
													class="btn text-error btn-ghost btn-sm"
													type="button"
													onclick={() => removeQuestion(questionIndex)}
													disabled={questions.length === 1}
													aria-label={`Remove question ${questionIndex + 1}`}
												>
													<X size={16} />
												</button>
											</div>
										</div>

										<div class="form-control w-full">
											<label class="label" for={`question-${question.id}`}>
												<span class="label-text">Question Text</span>
											</label>
											<input
												id={`question-${question.id}`}
												type="text"
												class="input-bordered input"
												bind:value={question.text}
												required
												placeholder="Enter the question prompt"
											/>
										</div>

										<div class="space-y-2">
											<div class="flex items-center justify-between gap-3">
												<span class="text-sm font-medium">Answer Options</span>
												<button
													class="btn btn-outline btn-xs"
													type="button"
													onclick={() => addOption(questionIndex)}
												>
													<PlusCircle size={14} /> Add Option
												</button>
											</div>

											{#each question.options as option, optionIndex (option.id)}
												<div class="grid grid-cols-[auto_1fr_auto] items-center gap-2">
													<input
														id={`correct-${question.id}-${option.id}`}
														type="radio"
														class="radio radio-primary"
														name={`correct-option-${question.id}`}
														checked={question.correctOptionId === option.id}
														onchange={() => (question.correctOptionId = option.id)}
														aria-label={`Mark option ${optionIndex + 1} as correct`}
													/>
													<input
														id={`option-${question.id}-${option.id}`}
														type="text"
														class="input-bordered input"
														bind:value={option.text}
														required
														placeholder={`Option ${optionIndex + 1}`}
													/>
													<button
														class="btn text-error btn-ghost btn-sm"
														type="button"
														onclick={() => removeOption(questionIndex, optionIndex)}
														disabled={question.options.length <= 2}
														aria-label={`Remove option ${optionIndex + 1}`}
													>
														<X size={14} />
													</button>
												</div>
											{/each}
											<p class="text-xs opacity-70">
												Select the radio button for the correct option.
											</p>
										</div>

										<div class="form-control w-full">
											<label class="label" for={`explanation-${question.id}`}>
												<span class="label-text">Explanation</span>
											</label>
											<textarea
												id={`explanation-${question.id}`}
												class="textarea-bordered textarea min-h-24"
												bind:value={question.explanation}
												required
												placeholder="Explain why the correct answer is correct"
											></textarea>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<input type="hidden" name="secret" value={adminSecretValue} />

					{#if createFormError}
						<p class="mt-1 text-xs text-error">{createFormError}</p>
					{/if}

					<div class="mt-4 card-actions justify-end">
						<button
							class="btn min-h-11 btn-primary"
							type="submit"
							disabled={!adminSecretValue.trim() || isPublishing}
						>
							{#if isPublishing}
								<LoaderCircle size={16} class="animate-spin" /> Publishing...
							{:else}
								<Upload size={16} /> Publish Lesson
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<div class="card mb-6 border border-base-200 bg-base-100 shadow-sm">
		<div class="card-body gap-4 p-4">
			<h2 class="text-lg font-bold">Learning Path Manager</h2>

			<form
				method="POST"
				action="?/createPath"
				class="grid grid-cols-1 items-end gap-3 md:grid-cols-3"
			>
				<input type="hidden" name="secret" value={adminSecretValue} />
				<div class="form-control w-full">
					<label class="label" for="path-name"><span class="label-text">Path Name</span></label>
					<input
						id="path-name"
						name="name"
						class="input-bordered input"
						bind:value={newPathName}
						required
						placeholder="e.g. Algebra Foundations"
					/>
				</div>
				<div class="form-control w-full md:col-span-2">
					<label class="label" for="path-description"
						><span class="label-text">Description</span></label
					>
					<div class="flex gap-2">
						<input
							id="path-description"
							name="description"
							class="input-bordered input w-full"
							bind:value={newPathDescription}
							placeholder="Optional description"
						/>
						<button class="btn btn-primary" type="submit" disabled={!adminSecretValue.trim()}
							>Create Path</button
						>
					</div>
				</div>
			</form>

			{#if data.paths.length === 0}
				<p class="text-sm opacity-70">No learning paths yet. Create one above.</p>
			{:else}
				<div class="space-y-4">
					{#each data.paths as path (path.id)}
						<div class="card border border-base-300 bg-base-200">
							<div class="card-body gap-3 p-4">
								<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<h3 class="font-semibold">{path.name}</h3>
										{#if path.description}
											<p class="text-sm opacity-70">{path.description}</p>
										{/if}
									</div>
									<form method="POST" action="?/setActivePath">
										<input type="hidden" name="pathId" value={path.id} />
										<input type="hidden" name="secret" value={adminSecretValue} />
										<button
											class="btn btn-sm {path.isActive ? 'btn-success' : 'btn-outline'}"
											type="submit"
											disabled={!adminSecretValue.trim()}
										>
											{path.isActive ? 'Active Path' : 'Set Active'}
										</button>
									</form>
								</div>

								<form method="POST" action="?/updatePathLessons" class="space-y-3">
									<input type="hidden" name="pathId" value={path.id} />
									<input type="hidden" name="secret" value={adminSecretValue} />

									<label class="label" for={`path-lessons-${path.id}`}>
										<span class="label-text">Include Lessons (Ctrl/Cmd + Click for multiple)</span>
									</label>
									<select
										id={`path-lessons-${path.id}`}
										name="lessonIds"
										class="select-bordered select h-40 w-full"
										multiple
									>
										{#each data.lessons as lesson (lesson.id)}
											<option value={lesson.id} selected={path.lessonIds.includes(lesson.id)}>
												{lesson.title}
											</option>
										{/each}
									</select>

									<div class="flex justify-end">
										<button
											class="btn btn-outline btn-sm"
											type="submit"
											disabled={!adminSecretValue.trim()}
										>
											Save Included Lessons
										</button>
									</div>
								</form>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="card mb-6 border border-base-200 bg-base-100 shadow-sm">
		<div class="card-body gap-4 p-4">
			<h2 class="text-lg font-bold">Student Rewards & Currency</h2>

			{#if data.students.length === 0}
				<p class="text-sm opacity-70">No students found yet.</p>
			{:else}
				<div class="space-y-3">
					{#each data.students as student (student.id)}
						<form
							method="POST"
							action="?/updateStudentRewards"
							class="card border border-base-300 bg-base-200"
						>
							<div class="card-body gap-3 p-4">
								<input type="hidden" name="studentId" value={student.id} />
								<input type="hidden" name="secret" value={adminSecretValue} />

								<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<h3 class="font-semibold">{student.name}</h3>
										<p class="text-xs opacity-60">@{student.username}</p>
									</div>
									<span class="badge badge-outline">Student</span>
								</div>

								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
									<div class="form-control w-full">
										<label class="label" for={`reward-xp-${student.id}`}>
											<span class="label-text flex items-center gap-1 text-xs font-medium"
												><Trophy size={14} /> XP</span
											>
										</label>
										<input
											type="number"
											min="0"
											id={`reward-xp-${student.id}`}
											name="xp"
											value={student.xp}
											class="input-bordered input input-sm"
											required
										/>
									</div>
									<div class="form-control w-full">
										<label class="label" for={`reward-streak-${student.id}`}>
											<span class="label-text flex items-center gap-1 text-xs font-medium"
												><Flame size={14} /> Streak</span
											>
										</label>
										<input
											type="number"
											min="0"
											id={`reward-streak-${student.id}`}
											name="streak"
											value={student.streak}
											class="input-bordered input input-sm"
											required
										/>
									</div>
									<div class="form-control w-full">
										<label class="label" for={`reward-hearts-${student.id}`}>
											<span class="label-text flex items-center gap-1 text-xs font-medium"
												><Heart size={14} /> Hearts</span
											>
										</label>
										<input
											type="number"
											min="0"
											max="5"
											id={`reward-hearts-${student.id}`}
											name="hearts"
											value={student.hearts}
											class="input-bordered input input-sm"
											required
										/>
									</div>
									<div class="form-control w-full">
										<label class="label" for={`reward-coins-${student.id}`}>
											<span class="label-text flex items-center gap-1 text-xs font-medium"
												><Coins size={14} /> Coins</span
											>
										</label>
										<input
											type="number"
											min="0"
											id={`reward-coins-${student.id}`}
											name="coins"
											value={student.coins}
											class="input-bordered input input-sm"
											required
										/>
									</div>
								</div>

								<div class="flex justify-end">
									<button
										class="btn btn-sm btn-primary"
										type="submit"
										disabled={!adminSecretValue.trim()}
									>
										Save Rewards
									</button>
								</div>
							</div>
						</form>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- AI Debug Mode -->
	<div class="card mb-6 border border-base-200 bg-base-100 shadow-sm">
		<div class="card-body gap-4 p-4">
			<h2 class="flex items-center gap-2 text-lg font-bold"><Bug size={18} /> AI Debug Mode</h2>
			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-sm text-base-content/70">
						Prints the full system prompt, per-step reasoning, tool calls, and token usage to the
						server console on every AI request.
					</p>
					<p class="mt-1 text-xs text-base-content/40">Resets to OFF on server restart.</p>
				</div>
				<div class="flex shrink-0 items-center gap-3">
					{#if aiDebugEnabled}
						<span class="badge badge-sm font-bold badge-success">ON</span>
					{:else}
						<span class="badge badge-ghost badge-sm">OFF</span>
					{/if}
					<button
						type="button"
						class="btn btn-sm {aiDebugEnabled ? 'btn-error' : 'btn-primary'}"
						disabled={!adminSecretValue.trim() || aiDebugLoading}
						onclick={toggleAiDebug}
					>
						{#if aiDebugLoading}<LoaderCircle size={14} class="animate-spin" />{/if}
						{aiDebugEnabled ? 'Disable' : 'Enable'}
					</button>
				</div>
			</div>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		{#each data.lessons as lesson (lesson.id)}
			<div class="card border border-base-200 bg-base-100 shadow-sm transition-all hover:shadow">
				<div class="card-body p-5">
					<div class="flex items-start justify-between">
						<h3 class="text-lg font-bold">{lesson.title}</h3>
						<div
							class="badge {lesson.type === 'standard'
								? 'badge-primary'
								: lesson.type === 'test'
									? 'badge-neutral'
									: 'badge-secondary'} badge-sm"
						>
							{lesson.type}
						</div>
					</div>
					<div class="mt-2 w-full truncate font-mono text-sm opacity-60">
						ID: {lesson.id}
					</div>
					{#if lesson.videoUrl}
						<div
							class="mt-4 flex items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm font-medium text-info"
						>
							<Film size={16} /> Attached Video Lesson
						</div>
					{/if}

					<button
						class="btn mt-4 btn-outline btn-sm"
						type="button"
						onclick={() => startEditLesson(lesson)}
					>
						<Pencil size={14} /> Edit Lesson
					</button>

					<form
						method="POST"
						action="?/deleteLesson"
						class="mt-4"
						onsubmit={(event) => confirmDelete(event, lesson.title)}
					>
						<input type="hidden" name="lessonId" value={lesson.id} />
						<input type="hidden" name="secret" value={adminSecretValue} />
						<button class="btn btn-sm btn-error" type="submit" disabled={!adminSecretValue.trim()}>
							<Trash2 size={14} /> Delete Lesson
						</button>
					</form>
				</div>
			</div>
		{/each}

		{#if data.lessons.length === 0}
			<div
				class="col-span-full rounded-xl border border-dashed border-base-300 bg-base-200 py-12 text-center text-base-content/50"
			>
				<BookOpen size={48} class="mx-auto mb-4 opacity-50" />
				<p>No lessons found in the database. Create one above!</p>
			</div>
		{/if}
	</div>
</div>
