import { describe, expect, it } from "vitest";
import { authoritiesNeedingEscalation } from "./eligibility";

const base = {
  buildingId: "building",
  score: 0.55,
  alertLevel: "escalated" as const,
  narrative: "n",
  ranked: [{ typeId: "slab_deflection" as const, confidence: 0.6 }],
};

describe("Escalation eligibility", () => {
  it("does not send again after an unchanged or improved Assessment", () => {
    expect(authoritiesNeedingEscalation(base, [{ authority: "mcd", snapshot: base }])).toEqual([]);
    expect(authoritiesNeedingEscalation(
      { ...base, score: 0.5 },
      [{ authority: "mcd", snapshot: base }],
    )).toEqual([]);
  });

  it("sends when risk rises and routes a newly added authority", () => {
    expect(authoritiesNeedingEscalation(
      { ...base, score: 0.7 },
      [{ authority: "mcd", snapshot: base }],
    )).toEqual(["mcd"]);
    const current = {
      ...base,
      ranked: [
        ...base.ranked,
        { typeId: "unauthorised_storey" as const, confidence: 0.5 },
      ],
    };
    expect(authoritiesNeedingEscalation(current, [{ authority: "mcd", snapshot: base }])).toEqual(["mcd", "dda"]);
  });
});
