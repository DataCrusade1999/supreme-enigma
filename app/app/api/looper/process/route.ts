import { NextRequest, NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { deriveOutputKey, presignDownload, DOWNLOAD_URL_TTL_SECONDS } from "@/lib/aws";
import { parseLambdaPayload, toLoopResult } from "@/lib/looper";

export async function POST(request: NextRequest) {
  const { key } = await request.json();
  const outputKey = deriveOutputKey(key);

  const client = new LambdaClient({ region: process.env.APP_AWS_REGION! });
  const command = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_NAME!,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(
      JSON.stringify({
        bucket: process.env.S3_BUCKET_NAME,
        input_key: key,
        output_key: outputKey,
      }),
    ),
  });

  const response = await client.send(command);
  if (response.FunctionError) {
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  // The pipeline's own description of the loop rides back in the invoke
  // payload; the page draws the result waveform and the decisions panel from it.
  const payload = parseLambdaPayload(response.Payload);
  if (!payload) {
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  const downloadUrl = await presignDownload(outputKey);
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
  return NextResponse.json(toLoopResult(payload, downloadUrl, expiresAt));
}
