import { resumeJsonSchema } from "./resume-schema";

// Bounds worst-case output cost per invocation. See the design spec §9.1.
const MAX_TOKENS = 4000;

const PROMPT =
  "Extract this resume into the required JSON schema. Use the exact wording from " +
  'the document for bullets. For a current role, use "Present" as the end value.';

/**
 * Send a resume PDF to OpenRouter and return the parsed JSON it replies with.
 *
 * The response is NOT schema-validated here — the caller validates with the zod
 * schema, so that a provider-side `strict: true` guarantee and our own contract
 * are checked independently. Returns `unknown` to make that explicit.
 *
 * This request shape was measured end to end on 2026-09-12 at $0.0071 per run
 * (spec §5.2). Changing the model, the plugin, or the engine means re-measuring.
 */
export async function extractResumeFromPdf(pdf: Buffer): Promise<unknown> {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      max_tokens: MAX_TOKENS,
      // OpenRouter cannot read from S3 by reference, so the bytes transit this
      // route as a data URL. At the 5 MB cap that is ~6.7 MB base64 in function
      // memory — which is why the cap is not negotiable. See spec §5.3.
      plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "resume", strict: true, schema: resumeJsonSchema },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "file",
              file: {
                filename: "resume.pdf",
                file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    // Only the provider's own message is surfaced. The request carried the API
    // key in a header and must never be echoed into an error.
    const message = json?.error?.message ?? `status ${res.status}`;
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter returned no content");
  }

  try {
    return JSON.parse(content);
  } catch {
    // strict: true should make this impossible, but a refusal or a truncated
    // response still arrives as a 200 with prose in the content field.
    throw new Error("OpenRouter response was not valid JSON");
  }
}
