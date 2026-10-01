import { z } from "zod";
import recorded from "./mospi-tools.json";

// MoSPI's own tool schemas, recorded from tools/list on 2026-09-26. Recorded
// rather than fetched per question: one call fewer, and a schema change shows up
// as MoSPI rejecting a call, which goes back to the model to correct.
export const MOSPI_TOOLS = ["list_datasets", "get_indicators", "get_metadata", "get_data"] as const;
export type MospiTool = (typeof MOSPI_TOOLS)[number];

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type RecordedTool = {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, unknown> } & Record<string, unknown>;
};

export function isMospiTool(name: string): name is MospiTool {
  return (MOSPI_TOOLS as readonly string[]).includes(name);
}

export function mospiToolDefinitions(): ToolDefinition[] {
  return (recorded as unknown as { tools: RecordedTool[] }).tools
    .filter((t) => isMospiTool(t.name))
    .map((t) => {
      // user_query asks for the user's question verbatim "for telemetry". The
      // owner's questions are not MoSPI's to collect.
      const { user_query: _dropped, ...properties } = t.inputSchema.properties ?? {};
      void _dropped;
      return {
        type: "function",
        function: { name: t.name, description: t.description, parameters: { ...t.inputSchema, properties } },
      };
    });
}

const stringMap = { type: "object", additionalProperties: { type: "string" } };

export const ANSWER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "answer",
    description:
      "Give your final answer. Call this once, when you are done or cannot find the data. " +
      "text: a short plain answer that states only numbers from tool results, with their period and base year. " +
      "chart: when the answer is a time series from one get_data query, that query, so the server can re-run it and draw it; otherwise null. " +
      "Put in filters exactly what you passed to get_data, without limit and page. " +
      'If that query returns several series (a CPI division also returns its groups and classes), set match to row fields that pick one, such as {"code": "01"}.',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "chart"],
      properties: {
        text: { type: "string" },
        chart: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["title", "unit", "dataset", "filters", "valueField"],
              properties: {
                title: { type: "string", description: 'Short title, e.g. "Retail inflation, All India"' },
                unit: { type: "string", description: '"%" for rates; otherwise a short unit, or ""' },
                dataset: { type: "string" },
                filters: stringMap,
                valueField: { type: "string", description: "The row field holding the number, e.g. inflation, growth_rate, value" },
                match: stringMap,
              },
            },
          ],
        },
      },
    },
  },
};

// The model sometimes sends a code as a number; MoSPI filters are strings.
const stringRecord = z.record(z.string(), z.coerce.string());

export const answerArgsSchema = z.object({
  text: z.string().min(1),
  chart: z
    .object({
      title: z.string().min(1),
      unit: z.string(),
      dataset: z.string().min(1),
      filters: stringRecord,
      valueField: z.string().min(1),
      match: stringRecord.optional(),
    })
    .nullable(),
});

export function stepLabel(name: MospiTool, args: Record<string, unknown>): string {
  const dataset = typeof args.dataset === "string" ? args.dataset : "MoSPI";
  switch (name) {
    case "list_datasets":
      return "Looking through MoSPI's datasets…";
    case "get_indicators":
      return `Reading ${dataset} indicators…`;
    case "get_metadata":
      return `Reading ${dataset} filters…`;
    case "get_data":
      return `Fetching ${dataset} data…`;
  }
}
