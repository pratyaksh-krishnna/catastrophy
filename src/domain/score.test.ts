import { describe, it, expect } from "vitest";
import { buildingScore, rankHazards, alertLevel, hazardRisk, type OpenHazard } from "./score.js";

const h = (typeId: OpenHazard["typeId"], confidence: number): OpenHazard => ({ typeId, confidence });

describe("score", () => {
  it("is zero with no open hazards", () => {
    expect(buildingScore([])).toBe(0);
  });

  it("ranks a credible severe hazard above a widely-reported trivial one — ADR-0001", () => {
    const credibleCrack = h("load_bearing_crack", 0.5);
    const certainSpalling = h("plaster_spalling", 1.0);
    expect(hazardRisk(credibleCrack)).toBeGreaterThan(hazardRisk(certainSpalling));
    const ranked = rankHazards([certainSpalling, credibleCrack]);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.typeId).toBe("load_bearing_crack");
  });

  it("scales risk by confidence", () => {
    expect(hazardRisk(h("load_bearing_crack", 0.2))).toBeLessThan(hazardRisk(h("load_bearing_crack", 0.9)));
  });

  it("bands a quiet building as monitor", () => {
    expect(alertLevel([h("plaster_spalling", 0.2)])).toBe("monitor");
  });

  it("never reaches critical without a severity-5 hazard, however many minor ones pile up", () => {
    const manyMinor = Array.from({ length: 40 }, () => h("plaster_spalling", 1.0));
    expect(buildingScore(manyMinor)).toBeGreaterThan(0.7);
    expect(alertLevel(manyMinor)).not.toBe("critical");
  });

  it("reaches critical on a confident severity-5 hazard", () => {
    expect(alertLevel([h("load_bearing_crack", 0.95)])).toBe("critical");
  });

  it("caps escalated behind a severity-4 hazard", () => {
    const manyTrivial = Array.from({ length: 40 }, () => h("drainage_failure", 1.0));
    expect(alertLevel(manyTrivial)).toBe("act");
  });

  it("stays within 0..1", () => {
    const crowd = Array.from({ length: 100 }, () => h("column_failure", 1.0));
    expect(buildingScore(crowd)).toBeLessThanOrEqual(1);
  });
});
