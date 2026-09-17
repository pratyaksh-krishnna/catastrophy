### Task 2: Confidence

**Files:**
- Create: `src/domain/confidence.ts`
- Test: `src/domain/confidence.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `SourceClass`, `SOURCE_CLASS_WEIGHT`, `GeoAgreement`, `EvidenceRef`, `computeConfidence(evidence, now)`, `REPORTER_CAP`

- [ ] **Step 1: Write the failing test**

Create `src/domain/confidence.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/confidence.test.ts`
Expected: FAIL — cannot resolve `./confidence.js`

- [ ] **Step 3: Write the implementation**

Create `src/domain/confidence.ts`:

```typescript
export type SourceClass =
  | "official_record"
  | "resident_video"
  | "resident_photo"
  | "news_article"
  | "resident_account"
  | "social_post";

export type GeoAgreement = "agree" | "disagree" | "unknown";

export interface EvidenceRef {
  reporterId: string;
  sourceClass: SourceClass;
  capturedAt: Date;
  geoAgreement: GeoAgreement;
}

/** How much trust an origin lends. Moved by the feedback loop; never by volume. */
export const SOURCE_CLASS_WEIGHT: Record<SourceClass, number> = {
  official_record: 0.9,
  resident_video: 0.65,
  resident_photo: 0.6,
  news_article: 0.45,
  resident_account: 0.35,
  social_post: 0.2,
};

/** One Reporter can never push Confidence past this alone — see ADR-0001. */
export const REPORTER_CAP = 0.5;
export const HALF_LIFE_DAYS = 180;
export const CROSS_CLASS_BONUS = 0.15;

const GEO_FACTOR: Record<GeoAgreement, number> = { agree: 1.1, unknown: 1.0, disagree: 0.5 };

function decay(capturedAt: Date, now: Date): number {
  const days = (now.getTime() - capturedAt.getTime()) / 86_400_000;
  return days <= 0 ? 1 : Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function itemStrength(e: EvidenceRef, now: Date): number {
  return Math.min(1, SOURCE_CLASS_WEIGHT[e.sourceClass] * GEO_FACTOR[e.geoAgreement]) * decay(e.capturedAt, now);
}

export function computeConfidence(evidence: EvidenceRef[], now: Date): number {
  if (evidence.length === 0) return 0;

  // Per Reporter, take their single strongest item. Volume from one person adds nothing.
  const strongestByReporter = new Map<string, number>();
  for (const e of evidence) {
    const s = itemStrength(e, now);
    strongestByReporter.set(e.reporterId, Math.max(strongestByReporter.get(e.reporterId) ?? 0, s));
  }

  // Noisy-OR across independent Reporters: diminishing returns, never reaching 1.
  let combined = 0;
  for (const s of strongestByReporter.values()) {
    combined = 1 - (1 - combined) * (1 - Math.min(s, REPORTER_CAP));
  }

  const classes = new Set(evidence.map((e) => e.sourceClass));
  if (classes.size >= 2) combined += (1 - combined) * CROSS_CLASS_BONUS;

  return Math.min(1, combined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/confidence.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/confidence.ts src/domain/confidence.test.ts
git commit -m "feat: confidence from independent reporters, source class, corroboration and recency"
```

---

