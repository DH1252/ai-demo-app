import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

/**
 * Takes a video File (or any media File), writes it to a temp dir,
 * extracts the audio as MP3, and returns the audio as a Blob,
 * then cleans up the temp files.
 */
export async function extractAudioFromVideo(file: File): Promise<Blob> {
	const fileId = crypto.randomUUID();
	const inputPath = join(tmpdir(), `${fileId}_input`);
	const outputPath = join(tmpdir(), `${fileId}_output.mp3`);

	try {
		// Write the incoming file to temp storage
		const buffer = Buffer.from(await file.arrayBuffer());
		await writeFile(inputPath, buffer);

		// Run ffmpeg directly: strip video stream, encode audio as MP3
		await execFileAsync(ffmpegInstaller.path, [
			'-i',
			inputPath,
			'-vn', // no video
			'-acodec',
			'libmp3lame',
			'-y', // overwrite output without prompting
			outputPath
		]);

		// Read the resulting MP3 and return as Blob
		const audioBuffer = await readFile(outputPath);
		return new Blob([audioBuffer], { type: 'audio/mp3' });
	} catch (e) {
		console.error('Audio extraction failed:', e);
		throw e;
	} finally {
		// Cleanup temp files — ignore errors (files may not exist if we failed early)
		await unlink(inputPath).catch(() => {});
		await unlink(outputPath).catch(() => {});
	}
}
