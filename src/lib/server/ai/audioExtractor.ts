import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile } from 'fs/promises';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

        // Run ffmpeg to extract audio
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .noVideo() // Remove video stream
                .audioCodec('libmp3lame') // Convert to MP3
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(outputPath);
        });

        // Read the resulting mp3
        const audioBuffer = await readFile(outputPath);
        
        // Convert to Blob for fetch API
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' });
        
        return audioBlob;

    } catch (e) {
        console.error("Audio extraction failed:", e);
        throw e;
    } finally {
        // Cleanup temp files
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
    }
}
