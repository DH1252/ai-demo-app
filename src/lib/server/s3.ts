import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

// Initialize the S3 client
export const s3 = new S3Client({
	region: env.REGION || 'auto',
	endpoint: env.ENDPOINT || 'https://storage.railway.app',
	credentials: {
		accessKeyId: env.ACCESS_KEY_ID || '',
		secretAccessKey: env.SECRET_ACCESS_KEY || ''
	},
	forcePathStyle: true // Needed for custom endpoints like Railway/MinIO
});

/**
 * Uploads a file buffer or stream to the S3 bucket.
 */
export async function uploadToBucket(key: string, body: Buffer | Uint8Array | Blob | string | File, contentType?: string) {
	// If it's a File, we normally buffer it out first
	let uploadBody: Buffer | Uint8Array | Blob | string | File = body;
	const hasFileCtor = typeof File !== 'undefined';
	if ((hasFileCtor && body instanceof File) || body instanceof Blob) {
        uploadBody = Buffer.from(await body.arrayBuffer());
    }

    const command = new PutObjectCommand({
		Bucket: env.BUCKET || 'my-bucket',
		Key: key,
		Body: uploadBody,
		...(contentType && { ContentType: contentType })
	});

	return await s3.send(command);
}

/**
 * Generates a presigned URL to temporarily grant public read access to a private S3 object.
 */
export async function getS3PresignedUrl(key: string, expiresIn: number = 3600) {
	const command = new GetObjectCommand({
		Bucket: env.BUCKET || 'my-bucket',
		Key: key
	});

	return await getSignedUrl(s3, command, { expiresIn });
}

/**
 * Deletes an object from the S3 bucket.
 */
export async function deleteFromBucket(key: string) {
	const command = new DeleteObjectCommand({
		Bucket: env.BUCKET || 'my-bucket',
		Key: key
	});

	return await s3.send(command);
}