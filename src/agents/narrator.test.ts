import { beforeEach, describe, expect, it, vi } from "vitest";

const converseForTool = vi.hoisted(() => vi.fn());

vi.mock("./bedrock.js", () => ({ converseForTool }));

import { narrateAssessment, narrateCellSummary } from "./narrator.js";

describe("narrateAssessment", () => {
  beforeEach(() => {
    converseForTool.mockReset();
    converseForTool.mockResolvedValue({ narrative: "  A calm summary.  " });
  });

  it("describes confidence qualitatively and never supplies an internal score", async () => {
    await expect(
      narrateAssessment({
        addressText: "12 Test Marg",
        alertLevel: "escalated",
        ranked: [
          { typeId: "slab_deflection", confidence: 0.72 },
          { typeId: "roof_damage", confidence: 0.5 },
          { typeId: "plaster_spalling", confidence: 0.2 },
        ],
      }),
    ).resolves.toBe("A calm summary.");

    const request = converseForTool.mock.calls[0]?.[0] as {
      system: string;
      prompt: string;
      tool: { inputSchema: Record<string, unknown> };
    };
    expect(request.prompt).toContain("well corroborated");
    expect(request.prompt).toContain("some corroboration");
    expect(request.prompt).toContain("single unconfirmed report");
    expect(request.prompt).not.toMatch(/score/i);
    expect(request.system).toMatch(/never state or infer a numeric score/i);
    expect(request.tool.inputSchema).toMatchObject({
      required: ["narrative"],
      additionalProperties: false,
    });
  });

  it("handles a building with no open hazards", async () => {
    await narrateAssessment({
      addressText: "12 Test Marg",
      alertLevel: "monitor",
      ranked: [],
    });

    expect(converseForTool.mock.calls[0]?.[0].prompt).toContain("- none on record");
  });

  it("rejects an empty generated narrative", async () => {
    converseForTool.mockResolvedValueOnce({ narrative: "   " });
    await expect(
      narrateAssessment({
        addressText: "12 Test Marg",
        alertLevel: "monitor",
        ranked: [],
      }),
    ).rejects.toThrow(/empty assessment/i);
  });
});

describe("narrateCellSummary", () => {
  beforeEach(() => {
    converseForTool.mockReset();
    converseForTool.mockResolvedValue({ summary: "  A calm area summary.  " });
  });

  it("includes the locality label and topic counts, and forces write_cell_summary", async () => {
    await expect(
      narrateCellSummary({
        localityLabel: "Laxmi Nagar",
        topics: [
          { topicId: "load_bearing_crack", count: 3 },
          { topicId: "other", count: 1 },
        ],
        signalCount: 4,
      }),
    ).resolves.toBe("A calm area summary.");

    const request = converseForTool.mock.calls[0]?.[0] as {
      system: string;
      prompt: string;
      tool: { name: string; inputSchema: Record<string, unknown> };
    };
    expect(request.prompt).toContain("Laxmi Nagar");
    expect(request.prompt).toContain("Cracking in a load-bearing wall");
    expect(request.prompt).toContain("3");
    expect(request.prompt).toContain("other");
    expect(request.prompt).toContain("1");
    expect(request.prompt).toContain("4");
    expect(request.tool.name).toBe("write_cell_summary");
    expect(request.tool.inputSchema).toMatchObject({
      required: ["summary"],
      additionalProperties: false,
    });
    expect(request.system).toMatch(/never state or infer a numeric score/i);
    expect(request.system).toMatch(/unverified/i);
    expect(request.system).toMatch(/never.*evacuate/i);
    expect(request.system).toMatch(/never name a specific building or address/i);
  });

  it("rejects a whitespace-only generated summary", async () => {
    converseForTool.mockResolvedValueOnce({ summary: "   " });
    await expect(
      narrateCellSummary({
        localityLabel: "Laxmi Nagar",
        topics: [],
        signalCount: 0,
      }),
    ).rejects.toThrow(/empty/i);
  });
});
