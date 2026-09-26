// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ANSWER_TOOL, answerArgsSchema, isMospiTool, mospiToolDefinitions, stepLabel } from "./mospi-tools";

describe("mospiToolDefinitions", () => {
  it("offers the four MoSPI tools as OpenRouter functions", () => {
    const defs = mospiToolDefinitions();
    expect(defs.map((d) => d.function.name).sort()).toEqual(["get_data", "get_indicators", "get_metadata", "list_datasets"]);
    const getData = defs.find((d) => d.function.name === "get_data")!;
    expect(getData.type).toBe("function");
    expect(getData.function.parameters).toMatchObject({ required: ["dataset", "filters"] });
  });

  it("does not offer MoSPI's telemetry parameter for the owner's question", () => {
    expect(JSON.stringify(mospiToolDefinitions())).not.toContain("user_query");
  });
});

describe("ANSWER_TOOL", () => {
  it("requires text and a chart that may be null", () => {
    expect(ANSWER_TOOL.function.name).toBe("answer");
    expect(ANSWER_TOOL.function.parameters).toMatchObject({ required: ["text", "chart"] });
  });
});

describe("answerArgsSchema", () => {
  it("accepts a chart query and turns numeric filter values into strings", () => {
    const parsed = answerArgsSchema.parse({
      text: "Retail inflation was 4.82% in August 2026.",
      chart: { title: "Retail inflation", unit: "%", dataset: "CPI", filters: { base_year: "2024", state_code: 1 }, valueField: "inflation" },
    });
    expect(parsed.chart?.filters).toEqual({ base_year: "2024", state_code: "1" });
  });

  it("accepts no chart", () => {
    expect(answerArgsSchema.parse({ text: "No data.", chart: null }).chart).toBeNull();
  });
});

describe("stepLabel", () => {
  it("names the dataset for each MoSPI tool", () => {
    expect(stepLabel("list_datasets", {})).toBe("Looking through MoSPI's datasets…");
    expect(stepLabel("get_indicators", { dataset: "IIP" })).toBe("Reading IIP indicators…");
    expect(stepLabel("get_metadata", { dataset: "CPI" })).toBe("Reading CPI filters…");
    expect(stepLabel("get_data", { dataset: "PLFS" })).toBe("Fetching PLFS data…");
  });

  it("recognises only MoSPI's tools", () => {
    expect(isMospiTool("get_data")).toBe(true);
    expect(isMospiTool("answer")).toBe(false);
  });
});
