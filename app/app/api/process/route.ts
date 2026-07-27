import { NextRequest, NextResponse } from "next/server";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { deriveOutputKey, presignDownload } from "@/lib/aws";

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

  const downloadUrl = await presignDownload(outputKey);
  return NextResponse.json({ downloadUrl });
}
