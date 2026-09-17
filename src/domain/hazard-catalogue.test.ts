import { describe, it, expect } from "vitest";
import { HAZARD_CATALOGUE, HAZARD_TYPE_IDS, severityOf } from "./hazard-catalogue.js";

describe("hazard catalogue", () => {
  it("is closed and non-empty", () => {
    expect(HAZARD_TYPE_IDS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(HAZARD_TYPE_IDS).size).toBe(HAZARD_TYPE_IDS.length);
  });

  it("gives every type a severity in 1..5 and an authority", () => {
    for (const id of HAZARD_TYPE_IDS) {
      const t = HAZARD_CATALOGUE[id];
      expect(t.severity).toBeGreaterThanOrEqual(1);
      expect(t.severity).toBeLessThanOrEqual(5);
      expect(["mcd", "dda", "ddma"]).toContain(t.authority);
    }
  });

  it("carries the `other` escape hatch at the lowest severity", () => {
    expect(HAZARD_CATALOGUE.other.severity).toBe(1);
  });

  it("routes unauthorised construction to DDA", () => {
    expect(HAZARD_CATALOGUE.unauthorised_storey.authority).toBe("dda");
  });

  it("exposes severity by id", () => {
    expect(severityOf("load_bearing_crack")).toBe(5);
  });
});
