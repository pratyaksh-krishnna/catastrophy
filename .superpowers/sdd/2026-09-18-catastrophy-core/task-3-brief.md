### Task 3: Score aggregation and Alert Level

**Files:**
- Create: `src/domain/score.ts`
- Test: `src/domain/score.test.ts`

**Interfaces:**
- Consumes: `HazardTypeId`, `severityOf` from Task 1
- Produces: `AlertLevel`, `OpenHazard`, `hazardRisk(h)`, `buildingScore(hazards)`, `rankHazards(hazards)`, `alertLevel(hazards)`

- [ ] **Step 1: Write the failing test**

Create `src/domain/score.test.ts`:

```typescript
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
    expect(rankHazards([certainSpalling, credibleCrack])[0].typeId).toBe("load_bearing_crack");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/score.test.ts`
Expected: FAIL — cannot resolve `./score.js`

- [ ] **Step 3: Write the implementation**

Create `src/domain/score.ts`:

```typescript
import { severityOf, type HazardTypeId, type Severity } from "./hazard-catalogue.js";

export type AlertLevel = "monitor" | "act" | "escalated" | "critical";

export interface OpenHazard {
  typeId: HazardTypeId;
  confidence: number;
}

/** Severity times Confidence, normalised. The whole of ADR-0001 in one line. */
export function hazardRisk(hazard: OpenHazard): number {
  return (severityOf(hazard.typeId) / 5) * hazard.confidence;
}

/** Internal only. Never returned from an API route or rendered. */
export function buildingScore(hazards: OpenHazard[]): number {
  let combined = 0;
  for (const hazard of hazards) combined = 1 - (1 - combined) * (1 - hazardRisk(hazard));
  return Math.min(1, combined);
}

export function rankHazards(hazards: OpenHazard[]): OpenHazard[] {
  return [...hazards].sort((a, b) => hazardRisk(b) - hazardRisk(a));
}

const BANDS: ReadonlyArray<{ level: AlertLevel; minScore: number; minSeverity: Severity }> = [
  { level: "critical", minScore: 0.7, minSeverity: 5 },
  { level: "escalated", minScore: 0.4, minSeverity: 4 },
  { level: "act", minScore: 0.15, minSeverity: 1 },
];

/**
 * Bands the Score, then holds the band behind a matching Severity. Forty cracked
 * plaster reports are not an imminent collapse, and must never present as one.
 */
export function alertLevel(hazards: OpenHazard[]): AlertLevel {
  if (hazards.length === 0) return "monitor";
  const score = buildingScore(hazards);
  const maxSeverity = Math.max(...hazards.map((h) => severityOf(h.typeId)));
  for (const band of BANDS) {
    if (score >= band.minScore && maxSeverity >= band.minSeverity) return band.level;
  }
  return "monitor";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/score.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/score.ts src/domain/score.test.ts
git commit -m "feat: score aggregation and severity-gated alert level banding"
```

---

