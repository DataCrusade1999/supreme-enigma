import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/** Presigned URLs last five minutes. Exported so the process route can tell
 * the page when its download link stops working.
 *
 * Do not raise this without raising the assumed role's session duration too.
 * A URL signed with role credentials embeds X-Amz-Security-Token and dies with
 * the session; the SDK only refreshes at five minutes remaining, and this TTL
 * is exactly that, so a longer TTL would start handing out URLs that expire
 * before they say they do. */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Credentials for every AWS client the app builds.
 *
 * With APP_AWS_ROLE_ARN set — which Terraform sets on Vercel for production and
 * preview — this federates through the Vercel OIDC token and no long-lived key
 * exists. Without it this returns nothing at all, so the client falls through to
 * the SDK's default chain: that is what keeps the unit tests, Playwright's
 * self-hosted server and local `npm run dev` working on static env-var keys. */
export function awsCredentials() {
  const roleArn = process.env.APP_AWS_ROLE_ARN;
  return roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {};
}

export function getS3Client(): S3Client {
  return new S3Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() });
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

// The bucket is a parameter because resume objects live in main's bucket on
// every branch (RESUME_BUCKET_NAME) while audio lives in the per-branch bucket
// (S3_BUCKET_NAME). The two-argument wrappers below keep the audio call sites
// unchanged. See the design spec §4.1.
export async function presignUploadTo(
  bucket: string,
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

// contentDisposition is signed into the URL as response-content-disposition.
// A browser ignores an <a download> attribute when the href redirects to
// another origin, so for a cross-origin download this header is the only way
// to force a save and name the file.
export async function presignDownloadFrom(
  bucket: string,
  key: string,
  contentDisposition?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

export async function presignUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return presignUploadTo(process.env.S3_BUCKET_NAME!, key, contentType, contentLength);
}

export async function presignDownload(key: string): Promise<string> {
  return presignDownloadFrom(process.env.S3_BUCKET_NAME!, key);
}

export async function getObjectBytes(bucket: string, key: string): Promise<Buffer> {
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function putObjectJson(
  bucket: string,
  key: string,
  body: unknown,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/json",
      Body: JSON.stringify(body, null, 2),
    }),
  );
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    // Only "it isn't there" is a false; anything else (credentials, network,
    // a bucket that does not exist) must surface rather than be reported as
    // an absent object, which callers treat as a normal first-publish state.
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw err;
  }
}

export async function copyObject(
  bucket: string,
  fromKey: string,
  toKey: string,
): Promise<void> {
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${fromKey}`,
      Key: toKey,
    }),
  );
}

export function deriveOutputKey(inputKey: string): string {
  return inputKey.replace(/^uploads\//, "outputs/");
}
