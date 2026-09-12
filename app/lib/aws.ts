import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Presigned URLs last five minutes. Exported so the process route can tell
 * the page when its download link stops working. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

export function getS3Client(): S3Client {
  return new S3Client({ region: process.env.APP_AWS_REGION! });
}

export function keyForUpload(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `uploads/${randomUUID()}${ext}`;
}

// Signed into the presigned URL rather than checked after the fact. A URL signed
// without a length authorizes an object of any size up to S3's 5 GB single-PUT
// ceiling; by the time a server-side size check runs, the bytes have already been
// stored and paid for.
export const MAX_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_RESUME_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function presignUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export async function presignDownload(key: string): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export function deriveOutputKey(inputKey: string): string {
  return inputKey.replace(/^uploads\//, "outputs/");
}
