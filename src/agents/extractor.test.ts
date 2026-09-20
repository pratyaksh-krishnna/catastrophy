import { describe, expect, it, vi } from "vitest";

import { HAZARD_TYPE_IDS } from "../domain/hazard-catalogue.js";
import { LOCALITY_IDS } from "../domain/localities.js";
import { extractSignal, extractorTool } from "./extractor.js";

vi.mock("./bedrock.js", () => ({
  converseForTool: vi.fn(async () => ({
    localityId: "laxmi_nagar",
    topicId: "load_bearing_crack",
    isRelevant: true,
    rationale: "reported crack in building",
  })),
  modelId: () => "test-model",
}));

describe("extractor", () => {
  it("constrains locality and topic to the closed catalogues via schema enums, and forces the tool", async () => {
    const schema = extractorTool().inputSchema as {
      properties: {
        localityId: { enum: string[] };
        topicId: { enum: string[] };
      };
    };
    expect(schema.properties.localityId.enum.sort()).toEqual(
      [...LOCALITY_IDS, "unknown"].sort(),
    );
    expect(schema.properties.topicId.enum.sort()).toEqual(
      [...new Set([...HAZARD_TYPE_IDS, "other"])].sort(),
    );

    const { converseForTool } = await import("./bedrock.js");
    await extractSignal({ text: "some article" });
    expect(vi.mocked(converseForTool).mock.calls[0]![0]).toMatchObject({
      tool: { name: "record_extraction" },
    });
  });

  it("requires all four outputs and forbids extra properties", () => {
    const schema = extractorTool().inputSchema as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["localityId", "topicId", "isRelevant", "rationale"]),
    );
    expect(schema.required).toHaveLength(4);
    expect(schema.additionalProperties).toBe(false);
  });

  it("maps a well-formed model response to ExtractionResult", async () => {
    const result = await extractSignal({ text: "a building in Laxmi Nagar has a crack" });
    expect(result).toEqual({
      localityId: "laxmi_nagar",
      topicId: "load_bearing_crack",
      isRelevant: true,
      rationale: "reported crack in building",
    });
  });

  it("maps 'unknown' locality to null", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      localityId: "unknown",
      topicId: "other",
      isRelevant: false,
      rationale: "only district named",
    });

    const result = await extractSignal({ text: "somewhere in South Delhi" });
    expect(result.localityId).toBeNull();
  });

  it("maps an out-of-catalogue locality id to null", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      localityId: "mumbai",
      topicId: "other",
      isRelevant: false,
      rationale: "x",
    });

    const result = await extractSignal({ text: "x" });
    expect(result.localityId).toBeNull();
  });

  it("maps an out-of-catalogue topic to 'other'", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      localityId: "laxmi_nagar",
      topicId: "earthquake_prediction",
      isRelevant: true,
      rationale: "x",
    });

    const result = await extractSignal({ text: "x" });
    expect(result.topicId).toBe("other");
  });

  it("treats a missing or non-boolean isRelevant as false", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      localityId: "laxmi_nagar",
      topicId: "other",
      rationale: "x",
    });

    const result = await extractSignal({ text: "x" });
    expect(result.isRelevant).toBe(false);
  });

  it("treats a non-string rationale as empty string", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      localityId: null,
      topicId: "other",
      isRelevant: false,
      rationale: 42,
    });

    const result = await extractSignal({ text: "x" });
    expect(result.rationale).toBe("");
  });

  it("degrades safely on garbage (non-object) tool input rather than throwing", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce("not an object" as unknown as never);

    await expect(extractSignal({ text: "x" })).resolves.toEqual({
      localityId: null,
      topicId: "other",
      isRelevant: false,
      rationale: "",
    });

    vi.mocked(converseForTool).mockResolvedValueOnce(null);
    await expect(extractSignal({ text: "x" })).resolves.toEqual({
      localityId: null,
      topicId: "other",
      isRelevant: false,
      rationale: "",
    });
  });
});
