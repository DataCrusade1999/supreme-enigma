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

export async function presignUpload(key: string, contentType: string): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: contentType,
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
