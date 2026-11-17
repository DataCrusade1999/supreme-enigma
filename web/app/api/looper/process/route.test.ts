import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const send = vi.fn();
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(function () {
    return { send };
  }),
  InvokeCommand: vi.fn(function (input) {
    return { input };
  }),
}));
vi.mock("@/lib/aws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aws")>()),
  awsCredentials: () => ({}),
  presignDownload: vi.fn(async () => "https://example.test/download"),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/looper/process", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/looper/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "bucket";
    process.env.LAMBDA_FUNCTION_NAME = "fn";
  });

  it.each([
    "resume/published.json",
    "outputs/0b6c1c1e-8a52-4f39-9d7a-3c1d2e4f5a6b.mp3",
    "uploads/../resume/current.pdf",
    "uploads/not-a-uuid.mp3",
    "uploads/0b6c1c1e-8a52-4f39-9d7a-3c1d2e4f5a6b",
    42,
    undefined,
  ])("refuses key %s without invoking the Lambda", async (key) => {
    const res = await post({ key });

    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("invokes the Lambda with the upload key and its outputs/ twin", async () => {
    send.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({ output_key: "outputs/x.mp3", peaks: [], tempo_bpm: 96 }),
      ),
    });
    const key = "uploads/0b6c1c1e-8a52-4f39-9d7a-3c1d2e4f5a6b.mp3";

    await post({ key });

    const payload = JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString());
    expect(payload).toEqual({
      bucket: "bucket",
      input_key: key,
      output_key: "outputs/0b6c1c1e-8a52-4f39-9d7a-3c1d2e4f5a6b.mp3",
    });
  });
});
