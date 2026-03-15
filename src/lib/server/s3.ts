import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

// Lazy S3 client — created on first use so the server starts cleanly in dev
// even without S3 credentials, but throws immediately the first time an S3
// operation is attempted with missing config.
let _s3: S3Client | null = null;

function getS3Client(): S3Client {
	if (_s3) return _s3;
	const accessKeyId = env.ACCESS_KEY_ID;
	const secretAccessKey = env.SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			'Missing S3 credentials: ACCESS_KEY_ID and SECRET_ACCESS_KEY environment variables must be set.'
		);
	}
	_s3 = new S3Client({
		region: env.REGION || 'auto',
		endpoint: env.ENDPOINT || 'https://storage.railway.app',
		credentials: { accessKeyId, secretAccessKey },
		forcePathStyle: true // Needed for custom endpoints like Railway/MinIO
	});
	return _s3;
}

function getBucket(): string {
	const bucket = env.BUCKET;
	if (!bucket) {
		throw new Error('Missing S3 configuration: BUCKET environment variable must be set.');
	}
	return bucket;
}

/**
 * Uploads a file buffer or stream to the S3 bucket.
 */
export async function uploadToBucket(
	key: string,
	body: Buffer | Uint8Array | Blob | string | File,
	contentType?: string
) {
	// If it's a File, we normally buffer it out first
	let uploadBody: Buffer | Uint8Array | Blob | string | File = body;
	const hasFileCtor = typeof File !== 'undefined';
	if ((hasFileCtor && body instanceof File) || body instanceof Blob) {
		uploadBody = Buffer.from(await body.arrayBuffer());
	}

	const command = new PutObjectCommand({
		Bucket: getBucket(),
		Key: key,
		Body: uploadBody,
		...(contentType && { ContentType: contentType })
	});

	return await getS3Client().send(command);
}

/**
 * Generates a presigned URL to temporarily grant public read access to a private S3 object.
 */
export async function getS3PresignedUrl(key: string, expiresIn: number = 3600) {
	const command = new GetObjectCommand({
		Bucket: getBucket(),
		Key: key
	});

	return await getSignedUrl(getS3Client(), command, { expiresIn });
}

/**
 * Deletes an object from the S3 bucket.
 */
export async function deleteFromBucket(key: string) {
	const command = new DeleteObjectCommand({
		Bucket: getBucket(),
		Key: key
	});

	return await getS3Client().send(command);
}
