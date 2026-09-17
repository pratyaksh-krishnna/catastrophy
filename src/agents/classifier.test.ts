import { describe, expect, it, vi } from "vitest";

import { HAZARD_TYPE_IDS } from "../domain/hazard-catalogue.js";
import { classifierTool, classifyEvidence } from "./classifier.js";

vi.mock("./bedrock.js", () => ({
  converseForTool: vi.fn(async () => ({
    hazardTypeIds: ["load_bearing_crack"],
    rationale: "diagonal crack",
  })),
  modelId: () => "test-model",
}));

describe("classifier", () => {
  it("constrains the model to the closed catalogue via a schema enum", () => {
    const schema = classifierTool().inputSchema as {
      properties: { hazardTypeIds: { items: { enum: string[] } } };
    };
    const members = schema.properties.hazardTypeIds.items.enum;
    expect(members.sort()).toEqual([...HAZARD_TYPE_IDS].sort());
  });

  it("requires both outputs and forbids extra properties", () => {
    const schema = classifierTool().inputSchema as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(expect.arrayContaining(["hazardTypeIds", "rationale"]));
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns the classified hazard types", async () => {
    const result = await classifyEvidence({
      note: "long diagonal crack on the stair wall",
      sourceClass: "resident_photo",
    });
    expect(result.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });

  it("drops anything outside the catalogue the model somehow returns", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      hazardTypeIds: ["load_bearing_crack", "wall_is_wobbly"],
      rationale: "x",
    });

    const result = await classifyEvidence({ note: "x", sourceClass: "resident_photo" });
    expect(result.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });

  it("safely normalises malformed tool output", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce(null);

    await expect(
      classifyEvidence({ note: "x", sourceClass: "resident_account" }),
    ).resolves.toEqual({ hazardTypeIds: [], rationale: "" });
  });
});
