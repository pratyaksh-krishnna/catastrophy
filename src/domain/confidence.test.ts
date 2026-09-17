import { describe, it, expect } from "vitest";
import { computeConfidence, REPORTER_CAP, type EvidenceRef } from "./confidence.js";

const NOW = new Date("2026-09-18T00:00:00Z");
const ev = (o: Partial<EvidenceRef> & { reporterId: string }): EvidenceRef => ({
  sourceClass: "resident_photo",
  capturedAt: NOW,
  geoAgreement: "unknown",
  ...o,
});

describe("computeConfidence", () => {
  it("is zero with no evidence", () => {
    expect(computeConfidence([], NOW)).toBe(0);
  });

  it("caps a single reporter no matter how much they submit", () => {
    const many = Array.from({ length: 50 }, () => ev({ reporterId: "r1" }));
    expect(computeConfidence(many, NOW)).toBeLessThanOrEqual(REPORTER_CAP + 1e-9);
  });

  it("rises with independent reporters", () => {
    const one = computeConfidence([ev({ reporterId: "r1" })], NOW);
    const three = computeConfidence(
      [ev({ reporterId: "r1" }), ev({ reporterId: "r2" }), ev({ reporterId: "r3" })],
      NOW,
    );
    expect(three).toBeGreaterThan(one);
  });

  it("weights an official record above a social post", () => {
    const official = computeConfidence([ev({ reporterId: "r1", sourceClass: "official_record" })], NOW);
    const social = computeConfidence([ev({ reporterId: "r1", sourceClass: "social_post" })], NOW);
    expect(official).toBeGreaterThan(social);
  });

  it("rewards corroboration across source classes over repetition within one", () => {
    const mixed = computeConfidence(
      [ev({ reporterId: "r1", sourceClass: "resident_photo" }), ev({ reporterId: "r2", sourceClass: "news_article" })],
      NOW,
    );
    const same = computeConfidence(
      [ev({ reporterId: "r1", sourceClass: "resident_photo" }), ev({ reporterId: "r2", sourceClass: "resident_photo" })],
      NOW,
    );
    expect(mixed).toBeGreaterThan(same);
  });

  it("decays with age", () => {
    const fresh = computeConfidence([ev({ reporterId: "r1" })], NOW);
    const old = computeConfidence(
      [ev({ reporterId: "r1", capturedAt: new Date("2024-09-18T00:00:00Z") })],
      NOW,
    );
    expect(old).toBeLessThan(fresh);
  });

  it("penalises a device fix that disagrees with EXIF", () => {
    const agree = computeConfidence([ev({ reporterId: "r1", geoAgreement: "agree" })], NOW);
    const disagree = computeConfidence([ev({ reporterId: "r1", geoAgreement: "disagree" })], NOW);
    expect(disagree).toBeLessThan(agree);
  });

  it("never exceeds 1", () => {
    const crowd = Array.from({ length: 200 }, (_, i) =>
      ev({ reporterId: `r${i}`, sourceClass: "official_record", geoAgreement: "agree" }),
    );
    expect(computeConfidence(crowd, NOW)).toBeLessThanOrEqual(1);
  });
});
