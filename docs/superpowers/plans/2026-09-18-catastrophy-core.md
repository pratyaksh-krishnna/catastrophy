# Catastrophy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the resident hero flow — pin a Building, submit geotagged Evidence, receive a generated Assessment with an Alert Level, escalate to the responsible authority — plus the k-suppressed public heatmap.

**Architecture:** A pure domain core (catalogue, confidence, score, cells) with no I/O, tested in isolation and depended on by everything else. Persistence in Aurora PostgreSQL with PostGIS doing proximity and aggregation. Agents run on Bedrock Converse behind one adapter. Assessment regeneration runs out of the request path on Inngest, debounced with a severity bypass.

**Tech Stack:** TypeScript, Next.js (App Router), Vitest, Drizzle ORM, PostgreSQL 16 + PostGIS 3, Inngest, AWS SDK v3 (Bedrock Runtime, S3, SES, Location Service), `ngeohash`, `exifr`, `sharp`.

**Spec:** [docs/SPEC.md](../../SPEC.md). Vocabulary: [CONTEXT.md](../../../CONTEXT.md). Decisions: [docs/adr/](../../adr/).

**Scope note:** External ingestion (Firecrawl, Extractor, Source Scout, Area Signals, the what's-happening feed) is a second plan. This plan produces working, demonstrable software on its own.

## Global Constraints

- Node 20+. TypeScript strict mode on. ES modules.
- **Severity is never computed, inferred, or adjusted at runtime.** It is a literal in the catalogue. Any code path that writes a severity is a bug — see ADR-0001.
- **Score is never returned from an API route or rendered in a component.** Only `AlertLevel` crosses that boundary — see ADR-0001.
- **No endpoint returns a Building's coordinates or address to an unauthenticated caller**, and no public response includes a cell's building count — see ADR-0002.
- Model id comes from `process.env.MODEL`. Never hardcode a model string.
- Tests run against a real PostGIS instance from `docker-compose.yml` at `DATABASE_URL_TEST`. No mocking the database.
- Every task ends with a commit.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/hazard-catalogue.ts` | The closed catalogue: Hazard Types, their Severity, their routing authority |
| `src/domain/confidence.ts` | Source Class weights and the Confidence computation |
| `src/domain/score.ts` | Score aggregation, Hazard ranking, Alert Level banding |
| `src/domain/cells.ts` | Geohash cells and k-suppression merge-upward |
| `src/db/schema.ts` | Drizzle table definitions including PostGIS columns |
| `src/db/client.ts` | Pool and Drizzle instance |
| `src/db/buildings.ts` | Proximity dedupe and resolve-or-create |
| `src/db/assessments.ts` | Assessment read/replace |
| `src/media/exif.ts` | Read EXIF GPS, produce a stripped derivative |
| `src/media/upload.ts` | S3 put for original and public derivative |
| `src/agents/bedrock.ts` | Converse adapter, model from env |
| `src/agents/classifier.ts` | Evidence → Hazard Type, enum-enforced |
| `src/agents/narrator.ts` | Assessment prose |
| `src/pipeline/regenerate.ts` | Inngest function: debounce + severity bypass |
| `src/escalation/routing.ts` | Hazard Type → authority |
| `src/escalation/send.ts` | SES delivery with immutable snapshot |
| `src/escalation/resolution.ts` | Resolution Claims and the contest window |
| `src/app/api/heatmap/route.ts` | Public k-suppressed cells |
| `src/app/api/evidence/route.ts` | Evidence submission |
| `src/app/page.tsx` | Public map |
| `src/app/building/[id]/page.tsx` | Assessment view |

---

### Task 1: Project scaffold and the Hazard catalogue

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `docker-compose.yml`
- Create: `src/domain/hazard-catalogue.ts`
- Test: `src/domain/hazard-catalogue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `HazardTypeId`, `Severity`, `AuthorityId`, `HazardType`, `HAZARD_CATALOGUE`, `HAZARD_TYPE_IDS`, `severityOf(id)`

- [ ] **Step 1: Scaffold the project**

```bash
npm init -y
npm pkg set type=module
npm i -D typescript vitest @types/node
npm i ngeohash
npx tsc --init --strict --module esnext --moduleResolution bundler --target es2022
```

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Create `docker-compose.yml` (used from Task 5 onward):

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_PASSWORD: catastrophy
      POSTGRES_DB: catastrophy
    ports: ["5432:5432"]
```

- [ ] **Step 2: Write the failing test**

Create `src/domain/hazard-catalogue.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/domain/hazard-catalogue.test.ts`
Expected: FAIL — cannot resolve `./hazard-catalogue.js`

- [ ] **Step 4: Write the catalogue**

Create `src/domain/hazard-catalogue.ts`:

```typescript
export type Severity = 1 | 2 | 3 | 4 | 5;
export type AuthorityId = "mcd" | "dda" | "ddma";

export interface HazardType {
  readonly id: HazardTypeId;
  readonly label: string;
  /** Harm if real. Grounded in UBBL 2016. Never computed — see ADR-0001. */
  readonly severity: Severity;
  readonly authority: AuthorityId;
  readonly byelawRef: string | null;
}

const RAW = {
  load_bearing_crack:        ["Cracking in a load-bearing wall", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  foundation_settlement:     ["Foundation settlement or tilt", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  column_failure:            ["Column spalling or failure", 5, "mcd",  "UBBL 2016 cl. 1.6"],
  illegal_basement_excavation: ["Unauthorised basement excavation", 5, "dda", "UBBL 2016 cl. 3.3"],
  slab_deflection:           ["Visible slab deflection", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  unauthorised_storey:       ["Unauthorised additional storey", 4, "dda",  "UBBL 2016 cl. 3.3"],
  cantilever_overload:       ["Overloaded cantilever projection", 4, "dda",  "UBBL 2016 cl. 3.8"],
  rebar_corrosion:           ["Exposed or corroding reinforcement", 4, "mcd",  "UBBL 2016 cl. 1.6"],
  adjacent_excavation:       ["Excavation undermining an adjacent plot", 4, "dda", "UBBL 2016 cl. 3.3"],
  balcony_detachment:        ["Balcony separating from the structure", 4, "mcd",  null],
  facade_detachment:         ["Facade or cladding detaching", 4, "mcd",  null],
  fire_egress_blocked:       ["Blocked or absent means of egress", 4, "mcd",  "UBBL 2016 cl. 4.0"],
  water_seepage_structural:  ["Seepage reaching structural members", 3, "mcd",  null],
  staircase_damage:          ["Damaged or unsupported staircase", 3, "mcd",  null],
  boundary_wall_lean:        ["Leaning boundary or parapet wall", 3, "mcd",  null],
  electrical_hazard:         ["Exposed or overloaded electrical work", 3, "mcd",  null],
  lift_shaft_damage:         ["Lift shaft structural damage", 3, "mcd",  null],
  roof_damage:               ["Roof structural damage", 3, "mcd",  null],
  gas_pipeline_proximity:    ["Gas line routed unsafely", 3, "mcd",  null],
  overloaded_water_tank:     ["Overloaded rooftop water tank", 3, "mcd",  null],
  sewage_undermining:        ["Sewage or drainage undermining foundations", 3, "mcd", null],
  drainage_failure:          ["Drainage failure causing standing water", 2, "mcd",  null],
  plaster_spalling:          ["Plaster spalling without exposed rebar", 2, "mcd",  null],
  seismic_retrofit_absent:   ["No seismic retrofit on a pre-code structure", 2, "mcd", "UBBL 2016 cl. 1.6"],
  other:                     ["Uncategorised — pending review", 1, "mcd",  null],
} as const satisfies Record<string, readonly [string, Severity, AuthorityId, string | null]>;

export type HazardTypeId = keyof typeof RAW;

export const HAZARD_CATALOGUE: Record<HazardTypeId, HazardType> = Object.fromEntries(
  Object.entries(RAW).map(([id, [label, severity, authority, byelawRef]]) => [
    id,
    { id: id as HazardTypeId, label, severity, authority, byelawRef },
  ]),
) as Record<HazardTypeId, HazardType>;

export const HAZARD_TYPE_IDS = Object.keys(RAW) as HazardTypeId[];

export function severityOf(id: HazardTypeId): Severity {
  return HAZARD_CATALOGUE[id].severity;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/domain/hazard-catalogue.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git init && git add -A
git commit -m "feat: scaffold project and add closed hazard catalogue"
```

---

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

### Task 4: Cells and k-suppression

**Files:**
- Create: `src/domain/cells.ts`
- Test: `src/domain/cells.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `K_SUPPRESSION`, `ReportedPoint`, `RenderedCell`, `suppressCells(points, startPrecision, k?)`

- [ ] **Step 1: Write the failing test**

Create `src/domain/cells.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { suppressCells, K_SUPPRESSION, type ReportedPoint } from "./cells.js";

// Connaught Place, Delhi — points a few metres apart share a precision-7 cell.
const dense = (n: number): ReportedPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    buildingId: `b${i}`,
    lat: 28.6315 + i * 0.00002,
    lon: 77.2167 + i * 0.00002,
    score: 0.5,
  }));

describe("suppressCells", () => {
  it("renders nothing for a lone reported building", () => {
    expect(suppressCells(dense(1), 7)).toEqual([]);
  });

  it("renders nothing below the k threshold", () => {
    expect(suppressCells(dense(K_SUPPRESSION - 1), 7)).toEqual([]);
  });

  it("renders a cell once k distinct buildings fall inside it", () => {
    const cells = suppressCells(dense(K_SUPPRESSION), 7);
    expect(cells.length).toBe(1);
    expect(cells[0].buildingCount).toBeGreaterThanOrEqual(K_SUPPRESSION);
  });

  it("merges sparse points upward into a coarser cell rather than dropping them", () => {
    // Six points spread across separate precision-7 cells but one precision-5 cell.
    const spread: ReportedPoint[] = Array.from({ length: 6 }, (_, i) => ({
      buildingId: `s${i}`,
      lat: 28.63 + i * 0.004,
      lon: 77.21 + i * 0.004,
      score: 0.4,
    }));
    const cells = suppressCells(spread, 7);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0].precision).toBeLessThan(7);
  });

  it("counts each building once however many times it appears", () => {
    const dup = [...dense(K_SUPPRESSION), ...dense(K_SUPPRESSION)];
    const cells = suppressCells(dup, 7);
    expect(cells[0].buildingCount).toBe(K_SUPPRESSION);
  });

  it("gives intensity in 0..1 and never leaks a raw count through it", () => {
    const cells = suppressCells(dense(20), 7);
    expect(cells[0].intensity).toBeGreaterThan(0);
    expect(cells[0].intensity).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/cells.test.ts`
Expected: FAIL — cannot resolve `./cells.js`

- [ ] **Step 3: Write the implementation**

Create `src/domain/cells.ts`:

```typescript
import ngeohash from "ngeohash";

/** ADR-0002: a cell renders only once this many distinct Buildings fall inside it. */
export const K_SUPPRESSION = 5;

/** Coarsest cell we will merge up to. Below this, the area is simply not shown. */
export const MIN_PRECISION = 4;

export interface ReportedPoint {
  buildingId: string;
  lat: number;
  lon: number;
  /** Internal Score. Aggregated into intensity; never emitted. */
  score: number;
}

export interface RenderedCell {
  geohash: string;
  precision: number;
  /** Server-side only. ADR-0002 forbids sending this to a public caller. */
  buildingCount: number;
  intensity: number;
}

/**
 * Buckets points into geohash cells at the requested precision, then merges any
 * cell holding fewer than k distinct Buildings into its parent, repeating until
 * every rendered cell clears the threshold. A hot cell in a sparse area is an
 * address, so a cell that never clears it is dropped rather than shown coarsely.
 */
export function suppressCells(
  points: ReportedPoint[],
  startPrecision: number,
  k: number = K_SUPPRESSION,
): RenderedCell[] {
  const byBuilding = new Map<string, ReportedPoint>();
  for (const p of points) byBuilding.set(p.buildingId, p);

  let pending = [...byBuilding.values()];
  const rendered: RenderedCell[] = [];

  for (let precision = startPrecision; precision >= MIN_PRECISION; precision--) {
    const groups = new Map<string, ReportedPoint[]>();
    for (const p of pending) {
      const hash = ngeohash.encode(p.lat, p.lon, precision);
      (groups.get(hash) ?? groups.set(hash, []).get(hash)!).push(p);
    }

    const carried: ReportedPoint[] = [];
    for (const [geohash, members] of groups) {
      if (members.length >= k) {
        rendered.push({
          geohash,
          precision,
          buildingCount: members.length,
          intensity: aggregateIntensity(members),
        });
      } else {
        carried.push(...members);
      }
    }
    pending = carried;
    if (pending.length === 0) break;
  }

  return rendered;
}

/** Noisy-OR of member Scores, so intensity reflects risk rather than headcount. */
function aggregateIntensity(members: ReportedPoint[]): number {
  let combined = 0;
  for (const m of members) combined = 1 - (1 - combined) * (1 - Math.max(0, Math.min(1, m.score)));
  return Math.min(1, combined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/cells.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/domain/cells.ts src/domain/cells.test.ts package.json
git commit -m "feat: geohash cells with k-suppression merge-upward per ADR-0002"
```

---
### Task 5: Database schema and PostGIS migration

**Files:**
- Create: `src/db/client.ts`, `src/db/schema.ts`, `drizzle/0000_init.sql`, `drizzle.config.ts`, `.env.example`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `HazardTypeId` (Task 1), `SourceClass`/`GeoAgreement` (Task 2), `AlertLevel` (Task 3)
- Produces: `db`, `pool`, and tables `societies`, `reporters`, `officeBearers`, `buildings`, `evidence`, `hazards`, `evidenceHazards`, `assessments`, `escalations`, `resolutionClaims`, `areaSignals`

- [ ] **Step 1: Install dependencies and write the migration**

```bash
npm i drizzle-orm pg
npm i -D drizzle-kit @types/pg
docker compose up -d
```

Create `.env.example`:

```
DATABASE_URL=postgres://postgres:catastrophy@localhost:5432/catastrophy
DATABASE_URL_TEST=postgres://postgres:catastrophy@localhost:5432/catastrophy
MODEL=anthropic.claude-opus-5
AWS_REGION=ap-south-1
S3_BUCKET=catastrophy-media
SES_FROM=alerts@example.invalid
ESCALATION_INBOX=escalations@example.invalid
```

Create `drizzle/0000_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE societies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reporters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym   text NOT NULL,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE office_bearers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id),
  reporter_id uuid NOT NULL REFERENCES reporters(id),
  approved_at timestamptz,
  UNIQUE (society_id, reporter_id)
);

CREATE TABLE buildings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id   uuid REFERENCES societies(id),
  address_text text NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buildings_location_idx ON buildings USING GIST (location);

CREATE TABLE evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES buildings(id),
  reporter_id     uuid NOT NULL REFERENCES reporters(id),
  source_class    text NOT NULL,
  note            text,
  captured_at     timestamptz NOT NULL,
  device_location geography(Point, 4326),
  exif_location   geography(Point, 4326),
  geo_agreement   text NOT NULL DEFAULT 'unknown',
  s3_key_original text,
  s3_key_public   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_building_idx ON evidence (building_id);

CREATE TABLE hazards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES buildings(id),
  type_id     text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  opened_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (building_id, type_id)
);
CREATE INDEX hazards_building_idx ON hazards (building_id);

CREATE TABLE evidence_hazards (
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  hazard_id   uuid NOT NULL REFERENCES hazards(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, hazard_id)
);

-- One current Assessment per Building. Replaced wholesale, never appended to.
CREATE TABLE assessments (
  building_id  uuid PRIMARY KEY REFERENCES buildings(id),
  score        double precision NOT NULL,
  alert_level  text NOT NULL,
  narrative    text NOT NULL,
  ranked       jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escalations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     uuid NOT NULL REFERENCES buildings(id),
  authority       text NOT NULL,
  snapshot        jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'sent',
  external_ticket text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz
);
CREATE INDEX escalations_building_idx ON escalations (building_id);

CREATE TABLE resolution_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id       uuid NOT NULL REFERENCES hazards(id),
  office_bearer_id uuid NOT NULL REFERENCES office_bearers(id),
  evidence_id     uuid NOT NULL REFERENCES evidence(id),
  contest_until   timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Located to a cell, never to a Building. Never touches Confidence or Score.
CREATE TABLE area_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geohash     text NOT NULL,
  precision   integer NOT NULL,
  source_id   text NOT NULL,
  text        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX area_signals_geohash_idx ON area_signals (geohash);
```

Apply it:

```bash
psql "$DATABASE_URL" -f drizzle/0000_init.sql
```

- [ ] **Step 2: Write the failing test**

Create `src/db/schema.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { buildings } from "./schema.js";

afterAll(async () => { await pool.end(); });

describe("schema", () => {
  it("has postgis available", async () => {
    const r = await db.execute(sql`SELECT PostGIS_Version() AS v`);
    expect(r.rows[0].v).toBeTruthy();
  });

  it("stores and reads a building's point", async () => {
    const [row] = await db
      .insert(buildings)
      .values({
        addressText: "12 Test Marg, Lajpat Nagar",
        location: sql`ST_SetSRID(ST_MakePoint(77.2432, 28.5677), 4326)::geography`,
      })
      .returning({ id: buildings.id });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);

    const back = await db.execute(
      sql`SELECT ST_Y(location::geometry) AS lat FROM buildings WHERE id = ${row.id}`,
    );
    expect(Number(back.rows[0].lat)).toBeCloseTo(28.5677, 4);
  });

  it("refuses a second hazard of the same type on one building", async () => {
    const [b] = await db
      .insert(buildings)
      .values({
        addressText: "dup test",
        location: sql`ST_SetSRID(ST_MakePoint(77.0, 28.0), 4326)::geography`,
      })
      .returning({ id: buildings.id });

    await db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, 'load_bearing_crack')`);
    await expect(
      db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, 'load_bearing_crack')`),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL — cannot resolve `./client.js`

- [ ] **Step 4: Write the client and schema**

Create `src/db/client.ts`:

```typescript
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool);
```

Create `src/db/schema.ts`:

```typescript
import {
  pgTable, uuid, text, timestamp, doublePrecision, jsonb, integer, primaryKey, customType,
} from "drizzle-orm/pg-core";

/** PostGIS geography(Point,4326). Written with ST_* SQL, read via ST_X/ST_Y. */
const point = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Point, 4326)",
});

export const societies = pgTable("societies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reporters = pgTable("reporters", {
  id: uuid("id").primaryKey().defaultRandom(),
  pseudonym: text("pseudonym").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const officeBearers = pgTable("office_bearers", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").notNull().references(() => societies.id),
  reporterId: uuid("reporter_id").notNull().references(() => reporters.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const buildings = pgTable("buildings", {
  id: uuid("id").primaryKey().defaultRandom(),
  societyId: uuid("society_id").references(() => societies.id),
  addressText: text("address_text").notNull(),
  location: point("location").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  reporterId: uuid("reporter_id").notNull().references(() => reporters.id),
  sourceClass: text("source_class").notNull(),
  note: text("note"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  deviceLocation: point("device_location"),
  exifLocation: point("exif_location"),
  geoAgreement: text("geo_agreement").notNull().default("unknown"),
  s3KeyOriginal: text("s3_key_original"),
  s3KeyPublic: text("s3_key_public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hazards = pgTable("hazards", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  typeId: text("type_id").notNull(),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const evidenceHazards = pgTable(
  "evidence_hazards",
  {
    evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
    hazardId: uuid("hazard_id").notNull().references(() => hazards.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.evidenceId, t.hazardId] }) }),
);

export const assessments = pgTable("assessments", {
  buildingId: uuid("building_id").primaryKey().references(() => buildings.id),
  score: doublePrecision("score").notNull(),
  alertLevel: text("alert_level").notNull(),
  narrative: text("narrative").notNull(),
  ranked: jsonb("ranked").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  buildingId: uuid("building_id").notNull().references(() => buildings.id),
  authority: text("authority").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  status: text("status").notNull().default("sent"),
  externalTicket: text("external_ticket"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const resolutionClaims = pgTable("resolution_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  hazardId: uuid("hazard_id").notNull().references(() => hazards.id),
  officeBearerId: uuid("office_bearer_id").notNull().references(() => officeBearers.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
  contestUntil: timestamp("contest_until", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const areaSignals = pgTable("area_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  geohash: text("geohash").notNull(),
  precision: integer("precision").notNull(),
  sourceId: text("source_id").notNull(),
  text: text("text").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/db drizzle drizzle.config.ts docker-compose.yml .env.example package.json
git commit -m "feat: postgis schema for buildings, evidence, hazards, assessments and escalations"
```

---

### Task 6: Building proximity dedupe

**Files:**
- Create: `src/db/buildings.ts`
- Test: `src/db/buildings.test.ts`

**Interfaces:**
- Consumes: `db` (Task 5)
- Produces: `DEDUPE_RADIUS_M`, `LOCATION_CONFIRM_RADIUS_M`, `findNearbyBuilding(lat, lon, address)`, `resolveOrCreateBuilding(input)`, `distanceToBuilding(buildingId, lat, lon)`

- [ ] **Step 1: Write the failing test**

Create `src/db/buildings.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "./client.js";
import { resolveOrCreateBuilding, distanceToBuilding, LOCATION_CONFIRM_RADIUS_M } from "./buildings.js";

afterAll(async () => { await pool.end(); });

const uniq = () => `T${Math.random().toString(36).slice(2, 8)}`;

describe("building dedupe", () => {
  it("creates a building when nothing is nearby", async () => {
    const name = uniq();
    const b = await resolveOrCreateBuilding({ lat: 28.7041, lon: 77.1025, addressText: `${name} Block A` });
    expect(b.created).toBe(true);
  });

  it("reuses the same building for a near-identical pin and address", async () => {
    const name = uniq();
    const first = await resolveOrCreateBuilding({ lat: 28.5677, lon: 77.2432, addressText: `${name} Main Road` });
    const second = await resolveOrCreateBuilding({ lat: 28.56772, lon: 77.24322, addressText: `${name} Main Rd` });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("keeps distinct buildings at the same address apart when pinned far enough", async () => {
    const name = uniq();
    const a = await resolveOrCreateBuilding({ lat: 28.61, lon: 77.20, addressText: `${name} Tower` });
    const b = await resolveOrCreateBuilding({ lat: 28.6120, lon: 77.2020, addressText: `${name} Tower` });
    expect(b.id).not.toBe(a.id);
  });

  it("measures distance from a submitted fix to the claimed building", async () => {
    const name = uniq();
    const b = await resolveOrCreateBuilding({ lat: 28.50, lon: 77.30, addressText: `${name} Far` });
    const near = await distanceToBuilding(b.id, 28.50005, 77.30005);
    const far = await distanceToBuilding(b.id, 28.52, 77.32);
    expect(near).toBeLessThan(LOCATION_CONFIRM_RADIUS_M);
    expect(far).toBeGreaterThan(LOCATION_CONFIRM_RADIUS_M);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/buildings.test.ts`
Expected: FAIL — cannot resolve `./buildings.js`

- [ ] **Step 3: Write the implementation**

Create `src/db/buildings.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "./client.js";

/** Two pins closer than this with a similar address are taken to be one Building. */
export const DEDUPE_RADIUS_M = 25;
/** Beyond this from the claimed Building, ask the submitter to confirm. */
export const LOCATION_CONFIRM_RADIUS_M = 150;
/** trigram similarity floor for treating two address strings as the same place */
export const ADDRESS_SIMILARITY = 0.3;

export interface BuildingInput {
  lat: number;
  lon: number;
  addressText: string;
  societyId?: string;
}

export interface ResolvedBuilding {
  id: string;
  created: boolean;
}

export async function findNearbyBuilding(
  lat: number,
  lon: number,
  addressText: string,
): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT id
    FROM buildings
    WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${DEDUPE_RADIUS_M})
      AND similarity(address_text, ${addressText}) >= ${ADDRESS_SIMILARITY}
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
    LIMIT 1
  `);
  return r.rows.length > 0 ? (r.rows[0].id as string) : null;
}

export async function resolveOrCreateBuilding(input: BuildingInput): Promise<ResolvedBuilding> {
  const existing = await findNearbyBuilding(input.lat, input.lon, input.addressText);
  if (existing) return { id: existing, created: false };

  const r = await db.execute(sql`
    INSERT INTO buildings (society_id, address_text, location)
    VALUES (
      ${input.societyId ?? null},
      ${input.addressText},
      ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography
    )
    RETURNING id
  `);
  return { id: r.rows[0].id as string, created: true };
}

export async function distanceToBuilding(buildingId: string, lat: number, lon: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS d
    FROM buildings WHERE id = ${buildingId}
  `);
  return Number(r.rows[0].d);
}
```

- [ ] **Step 4: Enable the trigram extension the dedupe depends on**

Append to `drizzle/0000_init.sql` and re-apply:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Run: `psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/buildings.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/db/buildings.ts src/db/buildings.test.ts drizzle/0000_init.sql
git commit -m "feat: proximity dedupe and resolve-or-create for buildings"
```

---

### Task 7: EXIF handling and media upload

**Files:**
- Create: `src/media/exif.ts`, `src/media/upload.ts`
- Test: `src/media/exif.test.ts`

**Interfaces:**
- Consumes: `GeoAgreement` (Task 2)
- Produces: `readExifLocation(buf)`, `stripExif(buf)`, `compareLocations(device, exif)`, `EXIF_AGREEMENT_RADIUS_M`, `storeEvidenceMedia(buf, key)`

- [ ] **Step 1: Write the failing test**

Create `src/media/exif.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readExifLocation, stripExif, compareLocations } from "./exif.js";
import { readFileSync } from "node:fs";

// Fixture: any JPEG with GPS EXIF. Generate once with:
//   exiftool -GPSLatitude=28.5677 -GPSLatitudeRef=N -GPSLongitude=77.2432 \
//            -GPSLongitudeRef=E src/media/__fixtures__/geotagged.jpg
const geotagged = () => readFileSync("src/media/__fixtures__/geotagged.jpg");

describe("exif", () => {
  it("reads GPS out of a geotagged photo", async () => {
    const loc = await readExifLocation(geotagged());
    expect(loc).not.toBeNull();
    expect(loc!.lat).toBeCloseTo(28.5677, 3);
  });

  it("returns null rather than throwing when GPS was stripped by the sharing app", async () => {
    const stripped = await stripExif(geotagged());
    expect(await readExifLocation(stripped)).toBeNull();
  });

  it("produces a derivative with no GPS — ADR-0002", async () => {
    const stripped = await stripExif(geotagged());
    expect(await readExifLocation(stripped)).toBeNull();
    expect(stripped.byteLength).toBeGreaterThan(0);
  });

  it("calls close readings agreement", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, { lat: 28.56775, lon: 77.24325 })).toBe("agree");
  });

  it("calls distant readings disagreement", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, { lat: 28.70, lon: 77.10 })).toBe("disagree");
  });

  it("calls a missing EXIF reading unknown, never a rejection", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, null)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/media/exif.test.ts`
Expected: FAIL — cannot resolve `./exif.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i exifr sharp @aws-sdk/client-s3
mkdir -p src/media/__fixtures__
```

Create `src/media/exif.ts`:

```typescript
import exifr from "exifr";
import sharp from "sharp";
import type { GeoAgreement } from "../domain/confidence.js";

export interface LatLon { lat: number; lon: number; }

/** Device fix and EXIF fix within this distance corroborate each other. */
export const EXIF_AGREEMENT_RADIUS_M = 100;

export async function readExifLocation(buf: Buffer | Uint8Array): Promise<LatLon | null> {
  try {
    const gps = await exifr.gps(buf);
    if (!gps || typeof gps.latitude !== "number" || typeof gps.longitude !== "number") return null;
    return { lat: gps.latitude, lon: gps.longitude };
  } catch {
    // Most real uploads arrive with EXIF already stripped by the sharing app.
    // That is normal and never a reason to reject the upload.
    return null;
  }
}

/** The derivative served below the resident tier. The original keeps its metadata. */
export async function stripExif(buf: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(buf).rotate().toBuffer();
}

function haversineM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function compareLocations(device: LatLon, exif: LatLon | null): GeoAgreement {
  if (!exif) return "unknown";
  return haversineM(device, exif) <= EXIF_AGREEMENT_RADIUS_M ? "agree" : "disagree";
}
```

Create `src/media/upload.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { stripExif } from "./exif.js";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = () => {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
};

export interface StoredMedia { originalKey: string; publicKey: string; }

/**
 * Stores the untouched original — its metadata is part of what makes it evidence
 * to an authority — alongside an EXIF-stripped derivative for anyone below the
 * resident tier. ADR-0002.
 */
export async function storeEvidenceMedia(buf: Buffer, keyBase: string): Promise<StoredMedia> {
  const originalKey = `original/${keyBase}`;
  const publicKey = `public/${keyBase}`;
  const stripped = await stripExif(buf);

  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: bucket(), Key: originalKey, Body: buf, ContentType: "image/jpeg" })),
    s3.send(new PutObjectCommand({ Bucket: bucket(), Key: publicKey, Body: stripped, ContentType: "image/jpeg" })),
  ]);

  return { originalKey, publicKey };
}
```

- [ ] **Step 4: Create the fixture**

```bash
npx sharp-cli -i /dev/null -o src/media/__fixtures__/geotagged.jpg 2>/dev/null || \
  node -e "require('sharp')({create:{width:64,height:64,channels:3,background:'#888'}}).jpeg().toFile('src/media/__fixtures__/geotagged.jpg')"
exiftool -overwrite_original -GPSLatitude=28.5677 -GPSLatitudeRef=N \
  -GPSLongitude=77.2432 -GPSLongitudeRef=E src/media/__fixtures__/geotagged.jpg
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/media/exif.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/media package.json
git commit -m "feat: read exif gps, strip derivatives, corroborate device fix"
```

---

### Task 8: Bedrock Converse adapter

**Files:**
- Create: `src/agents/bedrock.ts`
- Test: `src/agents/bedrock.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ToolSpec`, `converseForTool<T>({ system, prompt, tool })`, `modelId()`

- [ ] **Step 1: Write the failing test**

Create `src/agents/bedrock.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { modelId } from "./bedrock.js";

describe("bedrock adapter", () => {
  beforeEach(() => { delete process.env.MODEL; });

  it("reads the model from env", () => {
    process.env.MODEL = "anthropic.claude-opus-5";
    expect(modelId()).toBe("anthropic.claude-opus-5");
  });

  it("refuses to guess a model when env is unset", () => {
    expect(() => modelId()).toThrow(/MODEL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/bedrock.test.ts`
Expected: FAIL — cannot resolve `./bedrock.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i @aws-sdk/client-bedrock-runtime
```

Create `src/agents/bedrock.ts`:

```typescript
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

export function modelId(): string {
  const m = process.env.MODEL;
  if (!m) throw new Error("MODEL is not set — the model id is never hardcoded");
  return m;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema. Enum members here are what actually enforce a closed set. */
  inputSchema: Record<string, unknown>;
}

/**
 * Runs one Converse turn that must answer by calling `tool`, and returns the
 * tool input. Converse is provider-neutral, so the closed Hazard catalogue is
 * enforced by the schema enum plus toolChoice rather than by prompt wording.
 */
export async function converseForTool<T>(args: {
  system: string;
  prompt: string;
  tool: ToolSpec;
}): Promise<T> {
  const res = await client.send(
    new ConverseCommand({
      modelId: modelId(),
      system: [{ text: args.system }],
      messages: [{ role: "user", content: [{ text: args.prompt }] }],
      toolConfig: {
        tools: [{ toolSpec: { name: args.tool.name, description: args.tool.description, inputSchema: { json: args.tool.inputSchema } } }],
        toolChoice: { tool: { name: args.tool.name } },
      },
      additionalModelRequestFields: { thinking: { type: "adaptive" } },
    }),
  );

  const block = res.output?.message?.content?.find((c) => c.toolUse);
  if (!block?.toolUse?.input) throw new Error(`model did not call ${args.tool.name}`);
  return block.toolUse.input as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/bedrock.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents package.json
git commit -m "feat: bedrock converse adapter with model from env"
```

---

### Task 9: Classifier

**Files:**
- Create: `src/agents/classifier.ts`
- Test: `src/agents/classifier.test.ts`

**Interfaces:**
- Consumes: `HAZARD_TYPE_IDS` (Task 1), `converseForTool` (Task 8)
- Produces: `ClassificationResult`, `classifierTool()`, `classifyEvidence({ note, sourceClass })`

- [ ] **Step 1: Write the failing test**

Create `src/agents/classifier.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HAZARD_TYPE_IDS } from "../domain/hazard-catalogue.js";
import { classifierTool, classifyEvidence } from "./classifier.js";

vi.mock("./bedrock.js", () => ({
  converseForTool: vi.fn(async () => ({ hazardTypeIds: ["load_bearing_crack"], rationale: "diagonal crack" })),
  modelId: () => "test-model",
}));

describe("classifier", () => {
  it("constrains the model to the closed catalogue via a schema enum", () => {
    const tool = classifierTool();
    const schema = tool.inputSchema as any;
    const members: string[] = schema.properties.hazardTypeIds.items.enum;
    expect(members.sort()).toEqual([...HAZARD_TYPE_IDS].sort());
  });

  it("requires the hazard list and forbids extra properties", () => {
    const schema = classifierTool().inputSchema as any;
    expect(schema.required).toContain("hazardTypeIds");
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns the classified hazard types", async () => {
    const r = await classifyEvidence({ note: "long diagonal crack on the stair wall", sourceClass: "resident_photo" });
    expect(r.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });

  it("drops anything outside the catalogue the model somehow returns", async () => {
    const { converseForTool } = await import("./bedrock.js");
    vi.mocked(converseForTool).mockResolvedValueOnce({
      hazardTypeIds: ["load_bearing_crack", "wall_is_wobbly"],
      rationale: "x",
    } as never);
    const r = await classifyEvidence({ note: "x", sourceClass: "resident_photo" });
    expect(r.hazardTypeIds).toEqual(["load_bearing_crack"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/classifier.test.ts`
Expected: FAIL — cannot resolve `./classifier.js`

- [ ] **Step 3: Write the implementation**

Create `src/agents/classifier.ts`:

```typescript
import { HAZARD_CATALOGUE, HAZARD_TYPE_IDS, type HazardTypeId } from "../domain/hazard-catalogue.js";
import type { SourceClass } from "../domain/confidence.js";
import { converseForTool, type ToolSpec } from "./bedrock.js";

export interface ClassificationResult {
  hazardTypeIds: HazardTypeId[];
  rationale: string;
}

const SYSTEM = `You classify evidence about building safety in Delhi into a fixed catalogue of hazard types.
Choose only types genuinely supported by the evidence. Choose "other" when nothing fits — never force a match.
Never assess how severe a hazard is; severity is fixed by the catalogue and is not yours to judge.`;

export function classifierTool(): ToolSpec {
  const catalogue = HAZARD_TYPE_IDS.map((id) => `${id}: ${HAZARD_CATALOGUE[id].label}`).join("\n");
  return {
    name: "record_hazards",
    description: `Record which hazard types this evidence supports.\n\nCatalogue:\n${catalogue}`,
    inputSchema: {
      type: "object",
      properties: {
        hazardTypeIds: {
          type: "array",
          items: { type: "string", enum: [...HAZARD_TYPE_IDS] },
          description: "Hazard types this evidence supports. Empty if none.",
        },
        rationale: { type: "string", description: "One sentence on what in the evidence supports this." },
      },
      required: ["hazardTypeIds", "rationale"],
      additionalProperties: false,
    },
  };
}

export async function classifyEvidence(input: {
  note: string;
  sourceClass: SourceClass;
}): Promise<ClassificationResult> {
  const raw = await converseForTool<ClassificationResult>({
    system: SYSTEM,
    prompt: `Source class: ${input.sourceClass}\n\nEvidence:\n${input.note}`,
    tool: classifierTool(),
  });

  // Belt and braces: the enum constrains the model, this constrains the data.
  const valid = new Set<string>(HAZARD_TYPE_IDS);
  return {
    hazardTypeIds: (raw.hazardTypeIds ?? []).filter((id): id is HazardTypeId => valid.has(id)),
    rationale: raw.rationale ?? "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/classifier.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/classifier.ts src/agents/classifier.test.ts
git commit -m "feat: enum-enforced classifier over the closed hazard catalogue"
```

---
### Task 10: Assessment generation and persistence

**Files:**
- Create: `src/agents/narrator.ts`, `src/db/assessments.ts`
- Test: `src/db/assessments.test.ts`

**Interfaces:**
- Consumes: `computeConfidence` (Task 2), `rankHazards`/`buildingScore`/`alertLevel` (Task 3), `db` (Task 5), `converseForTool` (Task 8)
- Produces: `narrateAssessment({ addressText, ranked, alertLevel })`, `AssessmentRecord`, `buildAssessment(buildingId, now)`, `replaceAssessment(record)`, `getAssessment(buildingId)`

- [ ] **Step 1: Write the failing test**

Create `src/db/assessments.test.ts`:

```typescript
import { describe, it, expect, vi, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { resolveOrCreateBuilding } from "./buildings.js";
import { buildAssessment, replaceAssessment, getAssessment } from "./assessments.js";

vi.mock("../agents/narrator.js", () => ({
  narrateAssessment: vi.fn(async () => "Two structural problems are on record for this building."),
}));

afterAll(async () => { await pool.end(); });

async function seedReporter(): Promise<string> {
  const r = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`);
  return r.rows[0].id as string;
}

describe("assessments", () => {
  it("builds an assessment ranking the severe credible hazard first", async () => {
    const tag = `A${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.55, lon: 77.25, addressText: `${tag} Road` });
    const r1 = await seedReporter();
    const r2 = await seedReporter();

    for (const [reporter, typeId] of [[r1, "load_bearing_crack"], [r2, "plaster_spalling"]] as const) {
      const ev = await db.execute(sql`
        INSERT INTO evidence (building_id, reporter_id, source_class, captured_at, note)
        VALUES (${b.id}, ${reporter}, 'resident_photo', now(), 'seed') RETURNING id`);
      const hz = await db.execute(sql`
        INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, ${typeId})
        ON CONFLICT (building_id, type_id) DO UPDATE SET status='open' RETURNING id`);
      await db.execute(sql`
        INSERT INTO evidence_hazards (evidence_id, hazard_id) VALUES (${ev.rows[0].id}, ${hz.rows[0].id})`);
    }

    const assessment = await buildAssessment(b.id, new Date());
    expect(assessment.ranked[0].typeId).toBe("load_bearing_crack");
    expect(assessment.alertLevel).not.toBe("monitor");
  });

  it("replaces an assessment wholesale rather than appending", async () => {
    const tag = `B${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.44, lon: 77.11, addressText: `${tag} Lane` });

    await replaceAssessment({ buildingId: b.id, score: 0.2, alertLevel: "act", narrative: "first", ranked: [] });
    await replaceAssessment({ buildingId: b.id, score: 0.8, alertLevel: "critical", narrative: "second", ranked: [] });

    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM assessments WHERE building_id = ${b.id}`);
    expect(rows.rows[0].n).toBe(1);
    expect((await getAssessment(b.id))!.narrative).toBe("second");
  });

  it("returns null for a building with no assessment yet", async () => {
    const tag = `C${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.33, lon: 77.33, addressText: `${tag} Marg` });
    expect(await getAssessment(b.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/assessments.test.ts`
Expected: FAIL — cannot resolve `./assessments.js`

- [ ] **Step 3: Write the narrator**

Create `src/agents/narrator.ts`:

```typescript
import { HAZARD_CATALOGUE, type HazardTypeId } from "../domain/hazard-catalogue.js";
import type { AlertLevel } from "../domain/score.js";
import { converseForTool } from "./bedrock.js";

const SYSTEM = `You write the resident-facing summary of a building safety assessment in plain, calm English.
State what is on record and how well supported it is. Two to four sentences.
Never tell anyone to evacuate — the system reports risk and notifies authorities, it does not order people out of their homes.
Never invent a hazard that is not in the list you are given, and never state a numeric score.`;

export async function narrateAssessment(input: {
  addressText: string;
  alertLevel: AlertLevel;
  ranked: Array<{ typeId: HazardTypeId; confidence: number }>;
}): Promise<string> {
  const lines = input.ranked
    .map((h) => `- ${HAZARD_CATALOGUE[h.typeId].label} (support: ${describeConfidence(h.confidence)})`)
    .join("\n");

  const out = await converseForTool<{ narrative: string }>({
    system: SYSTEM,
    prompt: `Building: ${input.addressText}\nAlert level: ${input.alertLevel}\nHazards, most serious first:\n${lines || "- none on record"}`,
    tool: {
      name: "write_summary",
      description: "Record the resident-facing summary.",
      inputSchema: {
        type: "object",
        properties: { narrative: { type: "string" } },
        required: ["narrative"],
        additionalProperties: false,
      },
    },
  });
  return out.narrative;
}

function describeConfidence(c: number): string {
  if (c >= 0.7) return "well corroborated";
  if (c >= 0.4) return "some corroboration";
  return "single unconfirmed report";
}
```

- [ ] **Step 4: Write the assessment store**

Create `src/db/assessments.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "./client.js";
import { computeConfidence, type EvidenceRef, type SourceClass, type GeoAgreement } from "../domain/confidence.js";
import { alertLevel, buildingScore, rankHazards, type AlertLevel, type OpenHazard } from "../domain/score.js";
import type { HazardTypeId } from "../domain/hazard-catalogue.js";
import { narrateAssessment } from "../agents/narrator.js";

export interface AssessmentRecord {
  buildingId: string;
  score: number;
  alertLevel: AlertLevel;
  narrative: string;
  ranked: OpenHazard[];
}

interface EvidenceRow {
  type_id: HazardTypeId;
  reporter_id: string;
  source_class: SourceClass;
  captured_at: string;
  geo_agreement: GeoAgreement;
}

/** Recomputes a Building's Assessment from scratch. Never mutates the previous one. */
export async function buildAssessment(buildingId: string, now: Date): Promise<AssessmentRecord> {
  const rows = await db.execute(sql`
    SELECT h.type_id, e.reporter_id, e.source_class, e.captured_at, e.geo_agreement
    FROM hazards h
    JOIN evidence_hazards eh ON eh.hazard_id = h.id
    JOIN evidence e ON e.id = eh.evidence_id
    WHERE h.building_id = ${buildingId} AND h.status = 'open'
  `);

  const byType = new Map<HazardTypeId, EvidenceRef[]>();
  for (const r of rows.rows as unknown as EvidenceRow[]) {
    const ref: EvidenceRef = {
      reporterId: r.reporter_id,
      sourceClass: r.source_class,
      capturedAt: new Date(r.captured_at),
      geoAgreement: r.geo_agreement,
    };
    byType.set(r.type_id, [...(byType.get(r.type_id) ?? []), ref]);
  }

  const open: OpenHazard[] = [...byType.entries()].map(([typeId, refs]) => ({
    typeId,
    confidence: computeConfidence(refs, now),
  }));

  const ranked = rankHazards(open);
  const level = alertLevel(open);
  const addr = await db.execute(sql`SELECT address_text FROM buildings WHERE id = ${buildingId}`);

  return {
    buildingId,
    score: buildingScore(open),
    alertLevel: level,
    ranked,
    narrative: await narrateAssessment({
      addressText: addr.rows[0].address_text as string,
      alertLevel: level,
      ranked,
    }),
  };
}

export async function replaceAssessment(record: AssessmentRecord): Promise<void> {
  await db.execute(sql`
    INSERT INTO assessments (building_id, score, alert_level, narrative, ranked, generated_at)
    VALUES (${record.buildingId}, ${record.score}, ${record.alertLevel}, ${record.narrative},
            ${JSON.stringify(record.ranked)}::jsonb, now())
    ON CONFLICT (building_id) DO UPDATE SET
      score = EXCLUDED.score, alert_level = EXCLUDED.alert_level,
      narrative = EXCLUDED.narrative, ranked = EXCLUDED.ranked, generated_at = now()
  `);
}

export async function getAssessment(buildingId: string): Promise<AssessmentRecord | null> {
  const r = await db.execute(sql`
    SELECT building_id, score, alert_level, narrative, ranked FROM assessments WHERE building_id = ${buildingId}`);
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    buildingId: row.building_id as string,
    score: Number(row.score),
    alertLevel: row.alert_level as AlertLevel,
    narrative: row.narrative as string,
    ranked: row.ranked as OpenHazard[],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/assessments.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/agents/narrator.ts src/db/assessments.ts src/db/assessments.test.ts
git commit -m "feat: build, narrate and wholesale-replace building assessments"
```

---

### Task 11: Debounced regeneration with a severity bypass

**Files:**
- Create: `src/pipeline/inngest.ts`, `src/pipeline/regenerate.ts`
- Test: `src/pipeline/regenerate.test.ts`

**Interfaces:**
- Consumes: `severityOf` (Task 1), `buildAssessment`/`replaceAssessment` (Task 10)
- Produces: `inngest`, `REGENERATE_DEBOUNCE`, `isUrgent(typeIds)`, `regenerateAssessment` (Inngest function), `requestRegeneration({ buildingId, hazardTypeIds })`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/regenerate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { isUrgent, requestRegeneration } from "./regenerate.js";

const sent: Array<{ name: string; data: unknown }> = [];
vi.mock("./inngest.js", () => ({
  inngest: {
    send: vi.fn(async (e: { name: string; data: unknown }) => { sent.push(e); }),
    createFunction: (_c: unknown, _t: unknown, h: unknown) => h,
  },
}));

describe("regeneration triggers", () => {
  it("treats a severity-5 hazard as urgent", () => {
    expect(isUrgent(["load_bearing_crack"])).toBe(true);
  });

  it("does not treat minor hazards as urgent", () => {
    expect(isUrgent(["plaster_spalling", "drainage_failure"])).toBe(false);
  });

  it("is urgent if any one hazard in the batch is severity 5", () => {
    expect(isUrgent(["plaster_spalling", "foundation_settlement"])).toBe(true);
  });

  it("routes urgent evidence to the immediate event, bypassing the debounce", async () => {
    sent.length = 0;
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["column_failure"] });
    expect(sent[0].name).toBe("assessment/regenerate.urgent");
  });

  it("routes ordinary evidence to the debounced event", async () => {
    sent.length = 0;
    await requestRegeneration({ buildingId: "b1", hazardTypeIds: ["plaster_spalling"] });
    expect(sent[0].name).toBe("assessment/regenerate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/regenerate.test.ts`
Expected: FAIL — cannot resolve `./regenerate.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i inngest
```

Create `src/pipeline/inngest.ts`:

```typescript
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "catastrophy" });
```

Create `src/pipeline/regenerate.ts`:

```typescript
import { severityOf, type HazardTypeId } from "../domain/hazard-catalogue.js";
import { buildAssessment, replaceAssessment } from "../db/assessments.js";
import { inngest } from "./inngest.js";

/**
 * Ordinary evidence coalesces, so a burst of reports costs one regeneration.
 * A photo of a building about to come down must not wait for that window.
 */
export const REGENERATE_DEBOUNCE = "30s";
const URGENT_SEVERITY = 5;

export function isUrgent(hazardTypeIds: HazardTypeId[]): boolean {
  return hazardTypeIds.some((id) => severityOf(id) >= URGENT_SEVERITY);
}

export async function requestRegeneration(input: {
  buildingId: string;
  hazardTypeIds: HazardTypeId[];
}): Promise<void> {
  await inngest.send({
    name: isUrgent(input.hazardTypeIds) ? "assessment/regenerate.urgent" : "assessment/regenerate",
    data: { buildingId: input.buildingId },
  });
}

async function run({ event }: { event: { data: { buildingId: string } } }) {
  const record = await buildAssessment(event.data.buildingId, new Date());
  await replaceAssessment(record);
  return { buildingId: record.buildingId, alertLevel: record.alertLevel };
}

export const regenerateAssessment = inngest.createFunction(
  { id: "regenerate-assessment", debounce: { period: REGENERATE_DEBOUNCE, key: "event.data.buildingId" } },
  { event: "assessment/regenerate" },
  run,
);

export const regenerateAssessmentUrgent = inngest.createFunction(
  { id: "regenerate-assessment-urgent" },
  { event: "assessment/regenerate.urgent" },
  run,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/regenerate.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline package.json
git commit -m "feat: debounced assessment regeneration with severity-5 bypass"
```

---

### Task 12: Escalation routing and delivery

**Files:**
- Create: `src/escalation/routing.ts`, `src/escalation/send.ts`
- Test: `src/escalation/routing.test.ts`, `src/escalation/send.test.ts`

**Interfaces:**
- Consumes: `HAZARD_CATALOGUE`/`severityOf` (Task 1), `AssessmentRecord` (Task 10), `db` (Task 5)
- Produces: `routeAuthorities(ranked)`, `sendEscalation({ buildingId, assessment, addressText })`, `recordExternalTicket(id, ticket)`, `acknowledgeEscalation(id)`

- [ ] **Step 1: Write the failing tests**

Create `src/escalation/routing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routeAuthorities } from "./routing.js";

describe("routeAuthorities", () => {
  it("sends structural problems to MCD", () => {
    expect(routeAuthorities([{ typeId: "slab_deflection", confidence: 0.6 }])).toEqual(["mcd"]);
  });

  it("sends unauthorised construction to DDA", () => {
    expect(routeAuthorities([{ typeId: "unauthorised_storey", confidence: 0.6 }])).toEqual(["dda"]);
  });

  it("adds DDMA alongside MCD when a severity-5 hazard is present", () => {
    const out = routeAuthorities([{ typeId: "column_failure", confidence: 0.9 }]);
    expect(out).toContain("ddma");
    expect(out).toContain("mcd");
  });

  it("deduplicates authorities across several hazards", () => {
    const out = routeAuthorities([
      { typeId: "slab_deflection", confidence: 0.5 },
      { typeId: "roof_damage", confidence: 0.5 },
    ]);
    expect(out).toEqual(["mcd"]);
  });

  it("routes nothing when there are no open hazards", () => {
    expect(routeAuthorities([])).toEqual([]);
  });
});
```

Create `src/escalation/send.test.ts`:

```typescript
import { describe, it, expect, vi, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";
import { sendEscalation } from "./send.js";

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class { async send() { return {}; } },
  SendEmailCommand: class { constructor(public input: unknown) {} },
}));

afterAll(async () => { await pool.end(); });

describe("sendEscalation", () => {
  it("stores an immutable snapshot of the assessment it was sent with", async () => {
    const tag = `E${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.61, lon: 77.23, addressText: `${tag} Marg` });
    const assessment = {
      buildingId: b.id, score: 0.82, alertLevel: "critical" as const,
      narrative: "n", ranked: [{ typeId: "column_failure" as const, confidence: 0.9 }],
    };

    const ids = await sendEscalation({ buildingId: b.id, assessment, addressText: `${tag} Marg` });
    expect(ids.length).toBeGreaterThan(0);

    const rows = await db.execute(sql`SELECT snapshot, authority FROM escalations WHERE building_id = ${b.id}`);
    const snap = rows.rows[0].snapshot as { alertLevel: string };
    expect(snap.alertLevel).toBe("critical");
  });

  it("later worsening creates a new escalation rather than mutating the old one", async () => {
    const tag = `F${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.62, lon: 77.24, addressText: `${tag} Marg` });
    const base = { buildingId: b.id, narrative: "n", ranked: [{ typeId: "slab_deflection" as const, confidence: 0.5 }] };

    await sendEscalation({ buildingId: b.id, addressText: `${tag} Marg`, assessment: { ...base, score: 0.45, alertLevel: "escalated" } });
    await sendEscalation({ buildingId: b.id, addressText: `${tag} Marg`, assessment: { ...base, score: 0.9, alertLevel: "critical" } });

    const rows = await db.execute(sql`SELECT alert_level FROM escalations WHERE building_id = ${b.id}`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/escalation`
Expected: FAIL — cannot resolve `./routing.js`

- [ ] **Step 3: Write the routing**

Create `src/escalation/routing.ts`:

```typescript
import { HAZARD_CATALOGUE, severityOf, type AuthorityId } from "../domain/hazard-catalogue.js";
import type { OpenHazard } from "../domain/score.js";

const IMMINENT_SEVERITY = 5;

/**
 * Structural goes to MCD, unauthorised construction to DDA. A severity-5 hazard
 * additionally reaches DDMA, which is the distinction between the Escalated and
 * Critical bands.
 */
export function routeAuthorities(ranked: OpenHazard[]): AuthorityId[] {
  const out = new Set<AuthorityId>();
  for (const h of ranked) {
    out.add(HAZARD_CATALOGUE[h.typeId].authority);
    if (severityOf(h.typeId) >= IMMINENT_SEVERITY) {
      out.add("ddma");
      out.add("mcd");
    }
  }
  return [...out];
}
```

- [ ] **Step 4: Write the delivery**

```bash
npm i @aws-sdk/client-ses
```

Create `src/escalation/send.ts`:

```typescript
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { HAZARD_CATALOGUE } from "../domain/hazard-catalogue.js";
import type { AssessmentRecord } from "../db/assessments.js";
import { routeAuthorities } from "./routing.js";

const ses = new SESClient({ region: process.env.AWS_REGION });

/**
 * No Delhi authority exposes an API, so an Escalation is email of record plus a
 * pre-filled complaint an Office-bearer submits by hand. The snapshot is frozen:
 * "what did we tell them, and when" is the first question asked after a collapse.
 */
export async function sendEscalation(input: {
  buildingId: string;
  addressText: string;
  assessment: AssessmentRecord;
}): Promise<string[]> {
  const authorities = routeAuthorities(input.assessment.ranked);
  const ids: string[] = [];

  for (const authority of authorities) {
    const r = await db.execute(sql`
      INSERT INTO escalations (building_id, authority, snapshot)
      VALUES (${input.buildingId}, ${authority}, ${JSON.stringify(input.assessment)}::jsonb)
      RETURNING id`);
    const id = r.rows[0].id as string;
    ids.push(id);

    await ses.send(
      new SendEmailCommand({
        Source: process.env.SES_FROM!,
        Destination: { ToAddresses: [process.env.ESCALATION_INBOX!] },
        Message: {
          Subject: { Data: `[${input.assessment.alertLevel.toUpperCase()}] ${input.addressText} — ref ${id}` },
          Body: { Text: { Data: body(input.addressText, input.assessment, authority, id) } },
        },
      }),
    );
  }
  return ids;
}

function body(addressText: string, a: AssessmentRecord, authority: string, ref: string): string {
  const hazards = a.ranked
    .map((h, i) => `${i + 1}. ${HAZARD_CATALOGUE[h.typeId].label}` +
      (HAZARD_CATALOGUE[h.typeId].byelawRef ? ` [${HAZARD_CATALOGUE[h.typeId].byelawRef}]` : ""))
    .join("\n");

  return [
    `Building: ${addressText}`,
    `Alert level: ${a.alertLevel}`,
    `Reference: ${ref}`,
    `Addressed to: ${authority.toUpperCase()}`,
    ``,
    `Problems on record, most serious first:`,
    hazards || "none",
    ``,
    a.narrative,
    ``,
    `This report was generated from resident-submitted evidence. Reply to this address`,
    `to acknowledge, or quote the reference above when raising a ticket.`,
  ].join("\n");
}

export async function recordExternalTicket(escalationId: string, ticket: string): Promise<void> {
  await db.execute(sql`UPDATE escalations SET external_ticket = ${ticket} WHERE id = ${escalationId}`);
}

export async function acknowledgeEscalation(escalationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE escalations SET status = 'acknowledged', acknowledged_at = now() WHERE id = ${escalationId}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/escalation`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/escalation package.json
git commit -m "feat: escalation routing by hazard type with immutable assessment snapshots"
```

---

### Task 13: Resolution Claims and the contest window

**Files:**
- Create: `src/escalation/resolution.ts`
- Test: `src/escalation/resolution.test.ts`

**Interfaces:**
- Consumes: `db` (Task 5), `getAssessment` (Task 10)
- Produces: `CONTEST_WINDOW_MS`, `claimResolution({ hazardId, officeBearerId, evidenceId })`, `disputeClaim(claimId)`, `settleClaim(claimId, now)`

- [ ] **Step 1: Write the failing test**

Create `src/escalation/resolution.test.ts`:

```typescript
import { describe, it, expect, vi, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";
import { claimResolution, disputeClaim, settleClaim, CONTEST_WINDOW_MS } from "./resolution.js";

vi.mock("../db/assessments.js", async (orig) => ({
  ...(await orig<typeof import("../db/assessments.js")>()),
  getAssessment: vi.fn(async () => ({
    buildingId: "x", score: 0.1, alertLevel: "act" as const, narrative: "", ranked: [],
  })),
}));

afterAll(async () => { await pool.end(); });

async function seed(typeId: string) {
  const tag = `R${Math.random().toString(36).slice(2, 8)}`;
  const b = await resolveOrCreateBuilding({ lat: 28.7, lon: 77.05, addressText: `${tag} Path` });
  const rep = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`);
  const soc = await db.execute(sql`INSERT INTO societies (name) VALUES (${tag}) RETURNING id`);
  const ob = await db.execute(sql`
    INSERT INTO office_bearers (society_id, reporter_id, approved_at)
    VALUES (${soc.rows[0].id}, ${rep.rows[0].id}, now()) RETURNING id`);
  const hz = await db.execute(sql`
    INSERT INTO hazards (building_id, type_id) VALUES (${b.id}, ${typeId}) RETURNING id`);
  const ev = await db.execute(sql`
    INSERT INTO evidence (building_id, reporter_id, source_class, captured_at, note)
    VALUES (${b.id}, ${rep.rows[0].id}, 'resident_photo', now(), 'after photo') RETURNING id`);
  return { hazardId: hz.rows[0].id as string, officeBearerId: ob.rows[0].id as string, evidenceId: ev.rows[0].id as string };
}

describe("resolution claims", () => {
  it("opens a contest window rather than resolving immediately", async () => {
    const s = await seed("plaster_spalling");
    const claim = await claimResolution(s);
    expect(claim.contestUntil.getTime()).toBeGreaterThan(Date.now());

    const hz = await db.execute(sql`SELECT status FROM hazards WHERE id = ${s.hazardId}`);
    expect(hz.rows[0].status).toBe("open");
  });

  it("resolves the hazard once the window passes uncontested", async () => {
    const s = await seed("drainage_failure");
    const claim = await claimResolution(s);
    await settleClaim(claim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1000));

    const hz = await db.execute(sql`SELECT status FROM hazards WHERE id = ${s.hazardId}`);
    expect(hz.rows[0].status).toBe("resolved");
  });

  it("reopens the hazard when any reporter disputes", async () => {
    const s = await seed("roof_damage");
    const claim = await claimResolution(s);
    await disputeClaim(claim.id);
    await settleClaim(claim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1000));

    const hz = await db.execute(sql`SELECT status FROM hazards WHERE id = ${s.hazardId}`);
    expect(hz.rows[0].status).toBe("open");
  });

  it("refuses a claim against a building at critical", async () => {
    const { getAssessment } = await import("../db/assessments.js");
    vi.mocked(getAssessment).mockResolvedValueOnce({
      buildingId: "x", score: 0.9, alertLevel: "critical", narrative: "", ranked: [],
    });
    const s = await seed("column_failure");
    await expect(claimResolution(s)).rejects.toThrow(/critical/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/escalation/resolution.test.ts`
Expected: FAIL — cannot resolve `./resolution.js`

- [ ] **Step 3: Write the implementation**

Create `src/escalation/resolution.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getAssessment } from "../db/assessments.js";

/** How long any Reporter has to dispute a claim before it takes effect. */
export const CONTEST_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface ResolutionClaim {
  id: string;
  hazardId: string;
  contestUntil: Date;
}

/**
 * A Society has a direct interest in its Buildings looking safe, so a claim is
 * never self-executing: it needs fresh Evidence and survives a contest window in
 * which any Reporter can reopen it. A Building at critical cannot be closed this
 * way at all — that needs an authority or a reviewed structural certificate.
 */
export async function claimResolution(input: {
  hazardId: string;
  officeBearerId: string;
  evidenceId: string;
}): Promise<ResolutionClaim> {
  const hz = await db.execute(sql`SELECT building_id FROM hazards WHERE id = ${input.hazardId}`);
  if (hz.rows.length === 0) throw new Error("no such hazard");

  const assessment = await getAssessment(hz.rows[0].building_id as string);
  if (assessment?.alertLevel === "critical") {
    throw new Error("a building at critical cannot be resolved by claim");
  }

  const contestUntil = new Date(Date.now() + CONTEST_WINDOW_MS);
  const r = await db.execute(sql`
    INSERT INTO resolution_claims (hazard_id, office_bearer_id, evidence_id, contest_until)
    VALUES (${input.hazardId}, ${input.officeBearerId}, ${input.evidenceId}, ${contestUntil.toISOString()})
    RETURNING id`);

  return { id: r.rows[0].id as string, hazardId: input.hazardId, contestUntil };
}

export async function disputeClaim(claimId: string): Promise<void> {
  await db.execute(sql`UPDATE resolution_claims SET status = 'disputed' WHERE id = ${claimId}`);
}

/** Applies a claim whose window has closed. Disputed claims leave the Hazard open. */
export async function settleClaim(claimId: string, now: Date): Promise<"resolved" | "reopened" | "pending"> {
  const r = await db.execute(sql`
    SELECT hazard_id, status, contest_until FROM resolution_claims WHERE id = ${claimId}`);
  if (r.rows.length === 0) throw new Error("no such claim");

  const { hazard_id: hazardId, status, contest_until: contestUntil } = r.rows[0] as Record<string, string>;
  if (now < new Date(contestUntil)) return "pending";

  if (status === "disputed") {
    await db.execute(sql`UPDATE resolution_claims SET status = 'rejected' WHERE id = ${claimId}`);
    return "reopened";
  }

  await db.execute(sql`UPDATE hazards SET status = 'resolved', resolved_at = now() WHERE id = ${hazardId}`);
  await db.execute(sql`UPDATE resolution_claims SET status = 'accepted' WHERE id = ${claimId}`);
  return "resolved";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/escalation/resolution.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/escalation/resolution.ts src/escalation/resolution.test.ts
git commit -m "feat: contestable resolution claims, blocked at critical"
```

---
### Task 14: Public heatmap endpoint

**Files:**
- Create: `src/api/heatmap.ts`, `src/app/api/heatmap/route.ts`
- Test: `src/api/heatmap.test.ts`

**Interfaces:**
- Consumes: `suppressCells`/`RenderedCell` (Task 4), `db` (Task 5)
- Produces: `PublicCell`, `publicHeatmap(bbox, precision)`

- [ ] **Step 1: Write the failing test**

Create `src/api/heatmap.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";
import { publicHeatmap } from "./heatmap.js";

afterAll(async () => { await pool.end(); });

const BBOX = { minLat: 28.4, minLon: 76.9, maxLat: 28.9, maxLon: 77.4 };

async function seedScored(tag: string, n: number, lat: number, lon: number) {
  for (let i = 0; i < n; i++) {
    const b = await resolveOrCreateBuilding({
      lat: lat + i * 0.00002, lon: lon + i * 0.00002, addressText: `${tag} ${i}`,
    });
    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked)
      VALUES (${b.id}, 0.6, 'act', 'n', '[]'::jsonb)
      ON CONFLICT (building_id) DO UPDATE SET score = 0.6`);
  }
}

describe("publicHeatmap", () => {
  it("never returns a building count — ADR-0002", async () => {
    await seedScored(`H${Math.random().toString(36).slice(2, 7)}`, 8, 28.6315, 77.2167);
    const cells = await publicHeatmap(BBOX, 7);
    for (const c of cells) {
      expect(Object.keys(c)).toEqual(expect.arrayContaining(["geohash", "precision", "intensity"]));
      expect(c).not.toHaveProperty("buildingCount");
    }
  });

  it("never returns coordinates or addresses", async () => {
    const cells = await publicHeatmap(BBOX, 7);
    const serialized = JSON.stringify(cells);
    expect(serialized).not.toMatch(/address/i);
    expect(serialized).not.toMatch(/"lat"/);
  });

  it("emits no cell for an isolated reported building", async () => {
    const tag = `I${Math.random().toString(36).slice(2, 7)}`;
    await seedScored(tag, 1, 28.88, 76.95);
    const cells = await publicHeatmap({ minLat: 28.87, minLon: 76.94, maxLat: 28.89, maxLon: 76.96 }, 7);
    expect(cells).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/heatmap.test.ts`
Expected: FAIL — cannot resolve `./heatmap.js`

- [ ] **Step 3: Write the implementation**

Create `src/api/heatmap.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { suppressCells, type ReportedPoint } from "../domain/cells.js";

export interface BBox { minLat: number; minLon: number; maxLat: number; maxLon: number; }

/** What crosses the wire to an unauthenticated caller. Deliberately thin. */
export interface PublicCell {
  geohash: string;
  precision: number;
  intensity: number;
}

export async function publicHeatmap(bbox: BBox, precision: number): Promise<PublicCell[]> {
  const rows = await db.execute(sql`
    SELECT b.id, ST_Y(b.location::geometry) AS lat, ST_X(b.location::geometry) AS lon, a.score
    FROM buildings b
    JOIN assessments a ON a.building_id = b.id
    WHERE b.location && ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)::geography
  `);

  const points: ReportedPoint[] = rows.rows.map((r) => ({
    buildingId: r.id as string,
    lat: Number(r.lat),
    lon: Number(r.lon),
    score: Number(r.score),
  }));

  // buildingCount is computed by suppressCells and deliberately dropped here.
  return suppressCells(points, precision).map(({ geohash, precision, intensity }) => ({
    geohash, precision, intensity,
  }));
}
```

Create `src/app/api/heatmap/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { publicHeatmap } from "../../../api/heatmap.js";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const num = (k: string, d: number) => Number(p.get(k) ?? d);

  const cells = await publicHeatmap(
    { minLat: num("minLat", 28.4), minLon: num("minLon", 76.8), maxLat: num("maxLat", 28.9), maxLon: num("maxLon", 77.4) },
    Math.min(7, Math.max(4, num("precision", 7))),
  );
  return NextResponse.json({ cells });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/heatmap.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/api src/app/api/heatmap
git commit -m "feat: k-suppressed public heatmap endpoint that leaks neither counts nor coordinates"
```

---

### Task 15: Evidence submission

**Files:**
- Create: `src/api/submit-evidence.ts`, `src/app/api/evidence/route.ts`
- Test: `src/api/submit-evidence.test.ts`

**Interfaces:**
- Consumes: `resolveOrCreateBuilding`/`distanceToBuilding`/`LOCATION_CONFIRM_RADIUS_M` (Task 6), `readExifLocation`/`compareLocations`/`storeEvidenceMedia` (Task 7), `classifyEvidence` (Task 9), `requestRegeneration` (Task 11)
- Produces: `SubmitEvidenceInput`, `SubmitEvidenceResult`, `submitEvidence(input)`

- [ ] **Step 1: Write the failing test**

Create `src/api/submit-evidence.test.ts`:

```typescript
import { describe, it, expect, vi, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { submitEvidence } from "./submit-evidence.js";

vi.mock("../agents/classifier.js", () => ({
  classifyEvidence: vi.fn(async () => ({ hazardTypeIds: ["load_bearing_crack"], rationale: "crack" })),
}));
vi.mock("../media/upload.js", () => ({
  storeEvidenceMedia: vi.fn(async () => ({ originalKey: "original/x", publicKey: "public/x" })),
}));
const regen = vi.fn(async () => {});
vi.mock("../pipeline/regenerate.js", async (orig) => ({
  ...(await orig<typeof import("../pipeline/regenerate.js")>()),
  requestRegeneration: regen,
}));

afterAll(async () => { await pool.end(); });

async function reporter(): Promise<string> {
  const r = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`);
  return r.rows[0].id as string;
}

const base = () => ({
  reporterId: "",
  addressText: `S${Math.random().toString(36).slice(2, 8)} Marg`,
  note: "long diagonal crack",
  sourceClass: "resident_photo" as const,
  deviceLocation: { lat: 28.5677, lon: 77.2432 },
  capturedAt: new Date(),
});

describe("submitEvidence", () => {
  it("accepts an upload with no geotag rather than rejecting it", async () => {
    const input = { ...base(), reporterId: await reporter(), media: undefined };
    const out = await submitEvidence(input);
    expect(out.evidenceId).toBeTruthy();
    expect(out.geoAgreement).toBe("unknown");
  });

  it("opens the classified hazards against the building", async () => {
    const out = await submitEvidence({ ...base(), reporterId: await reporter() });
    const rows = await db.execute(sql`SELECT type_id FROM hazards WHERE building_id = ${out.buildingId}`);
    expect(rows.rows.map((r) => r.type_id)).toContain("load_bearing_crack");
  });

  it("asks for confirmation when the device fix is far from the claimed building", async () => {
    const shared = base();
    const first = await submitEvidence({ ...shared, reporterId: await reporter() });
    const second = await submitEvidence({
      ...shared,
      reporterId: await reporter(),
      buildingId: first.buildingId,
      deviceLocation: { lat: 28.60, lon: 77.30 },
    });
    expect(second.needsLocationConfirmation).toBe(true);
  });

  it("requests regeneration so the assessment is never built in the request path", async () => {
    regen.mockClear();
    await submitEvidence({ ...base(), reporterId: await reporter() });
    expect(regen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/submit-evidence.test.ts`
Expected: FAIL — cannot resolve `./submit-evidence.js`

- [ ] **Step 3: Write the implementation**

Create `src/api/submit-evidence.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { resolveOrCreateBuilding, distanceToBuilding, LOCATION_CONFIRM_RADIUS_M } from "../db/buildings.js";
import { readExifLocation, compareLocations, type LatLon } from "../media/exif.js";
import { storeEvidenceMedia } from "../media/upload.js";
import { classifyEvidence } from "../agents/classifier.js";
import { requestRegeneration } from "../pipeline/regenerate.js";
import type { GeoAgreement, SourceClass } from "../domain/confidence.js";
import type { HazardTypeId } from "../domain/hazard-catalogue.js";

export interface SubmitEvidenceInput {
  reporterId: string;
  addressText: string;
  note: string;
  sourceClass: SourceClass;
  deviceLocation: LatLon;
  capturedAt: Date;
  buildingId?: string;
  media?: Buffer;
}

export interface SubmitEvidenceResult {
  evidenceId: string;
  buildingId: string;
  geoAgreement: GeoAgreement;
  hazardTypeIds: HazardTypeId[];
  needsLocationConfirmation: boolean;
}

export async function submitEvidence(input: SubmitEvidenceInput): Promise<SubmitEvidenceResult> {
  const buildingId =
    input.buildingId ??
    (await resolveOrCreateBuilding({
      lat: input.deviceLocation.lat,
      lon: input.deviceLocation.lon,
      addressText: input.addressText,
    })).id;

  const distance = await distanceToBuilding(buildingId, input.deviceLocation.lat, input.deviceLocation.lon);
  const needsLocationConfirmation = distance > LOCATION_CONFIRM_RADIUS_M;

  const exif = input.media ? await readExifLocation(input.media) : null;
  const geoAgreement = compareLocations(input.deviceLocation, exif);
  const media = input.media
    ? await storeEvidenceMedia(input.media, `${buildingId}/${Date.now()}.jpg`)
    : null;

  const ev = await db.execute(sql`
    INSERT INTO evidence (building_id, reporter_id, source_class, note, captured_at,
                          device_location, exif_location, geo_agreement, s3_key_original, s3_key_public)
    VALUES (
      ${buildingId}, ${input.reporterId}, ${input.sourceClass}, ${input.note}, ${input.capturedAt.toISOString()},
      ST_SetSRID(ST_MakePoint(${input.deviceLocation.lon}, ${input.deviceLocation.lat}), 4326)::geography,
      ${exif ? sql`ST_SetSRID(ST_MakePoint(${exif.lon}, ${exif.lat}), 4326)::geography` : null},
      ${geoAgreement}, ${media?.originalKey ?? null}, ${media?.publicKey ?? null}
    ) RETURNING id`);
  const evidenceId = ev.rows[0].id as string;

  const { hazardTypeIds } = await classifyEvidence({ note: input.note, sourceClass: input.sourceClass });

  for (const typeId of hazardTypeIds) {
    const hz = await db.execute(sql`
      INSERT INTO hazards (building_id, type_id) VALUES (${buildingId}, ${typeId})
      ON CONFLICT (building_id, type_id) DO UPDATE SET status = 'open', resolved_at = NULL
      RETURNING id`);
    await db.execute(sql`
      INSERT INTO evidence_hazards (evidence_id, hazard_id) VALUES (${evidenceId}, ${hz.rows[0].id})
      ON CONFLICT DO NOTHING`);
  }

  // Never build the Assessment here — it belongs off the request path.
  await requestRegeneration({ buildingId, hazardTypeIds });

  return { evidenceId, buildingId, geoAgreement, hazardTypeIds, needsLocationConfirmation };
}
```

Create `src/app/api/evidence/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { submitEvidence } from "../../../api/submit-evidence.js";
import type { SourceClass } from "../../../domain/confidence.js";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("media");
  const media = file instanceof File ? Buffer.from(await file.arrayBuffer()) : undefined;

  const result = await submitEvidence({
    reporterId: String(form.get("reporterId")),
    addressText: String(form.get("addressText")),
    note: String(form.get("note") ?? ""),
    sourceClass: (form.get("sourceClass") as SourceClass) ?? "resident_account",
    deviceLocation: { lat: Number(form.get("lat")), lon: Number(form.get("lon")) },
    capturedAt: new Date(),
    buildingId: form.get("buildingId") ? String(form.get("buildingId")) : undefined,
    media,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/submit-evidence.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/submit-evidence.ts src/api/submit-evidence.test.ts src/app/api/evidence
git commit -m "feat: evidence submission with exif corroboration and off-path regeneration"
```

---

### Task 16: Hero flow UI and public map

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/report/page.tsx`, `src/app/building/[id]/page.tsx`
- Create: `src/app/api/building/[id]/route.ts`
- Test: `src/app/api/building/building-route.test.ts`

**Interfaces:**
- Consumes: `getAssessment` (Task 10), `publicHeatmap` (Task 14), `submitEvidence` (Task 15)
- Produces: the four pages and a building detail endpoint

- [ ] **Step 1: Write the failing test**

Create `src/app/api/building/building-route.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../../../db/client.js";
import { resolveOrCreateBuilding } from "../../../db/buildings.js";
import { buildingDetail } from "./detail.js";

afterAll(async () => { await pool.end(); });

describe("buildingDetail", () => {
  it("returns the alert level and never the score — ADR-0001", async () => {
    const tag = `D${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.51, lon: 77.19, addressText: `${tag} Marg` });
    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked)
      VALUES (${b.id}, 0.77, 'escalated', 'Two problems on record.', '[]'::jsonb)`);

    const detail = await buildingDetail(b.id);
    expect(detail!.alertLevel).toBe("escalated");
    expect(detail).not.toHaveProperty("score");
    expect(JSON.stringify(detail)).not.toContain("0.77");
  });

  it("returns null for a building with no assessment", async () => {
    const tag = `G${Math.random().toString(36).slice(2, 8)}`;
    const b = await resolveOrCreateBuilding({ lat: 28.52, lon: 77.18, addressText: `${tag} Marg` });
    expect(await buildingDetail(b.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/building/building-route.test.ts`
Expected: FAIL — cannot resolve `./detail.js`

- [ ] **Step 3: Write the detail reader and route**

Create `src/app/api/building/detail.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "../../../db/client.js";
import { getAssessment } from "../../../db/assessments.js";
import { HAZARD_CATALOGUE } from "../../../domain/hazard-catalogue.js";
import type { AlertLevel } from "../../../domain/score.js";

export interface BuildingDetail {
  buildingId: string;
  addressText: string;
  alertLevel: AlertLevel;
  narrative: string;
  hazards: Array<{ label: string; support: "well corroborated" | "some corroboration" | "single unconfirmed report" }>;
}

/** Score is deliberately absent from this shape. ADR-0001. */
export async function buildingDetail(buildingId: string): Promise<BuildingDetail | null> {
  const assessment = await getAssessment(buildingId);
  if (!assessment) return null;

  const b = await db.execute(sql`SELECT address_text FROM buildings WHERE id = ${buildingId}`);

  return {
    buildingId,
    addressText: b.rows[0].address_text as string,
    alertLevel: assessment.alertLevel,
    narrative: assessment.narrative,
    hazards: assessment.ranked.map((h) => ({
      label: HAZARD_CATALOGUE[h.typeId].label,
      support: h.confidence >= 0.7 ? "well corroborated" : h.confidence >= 0.4 ? "some corroboration" : "single unconfirmed report",
    })),
  };
}
```

Create `src/app/api/building/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildingDetail } from "../detail.js";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await buildingDetail(id);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "not found" }, { status: 404 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/building/building-route.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Build the pages**

```bash
npm i next react react-dom maplibre-gl
npm i -D @types/react @types/react-dom
```

Create `src/app/layout.tsx`:

```tsx
export const metadata = { title: "Catastrophy", description: "Building safety in Delhi" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
```

Create `src/app/page.tsx` (public map — heat only, no pins):

```tsx
"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import ngeohash from "ngeohash";
import "maplibre-gl/dist/maplibre-gl.css";

export default function PublicMap() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [77.2167, 28.6315],
      zoom: 11,
    });

    map.on("load", async () => {
      const res = await fetch("/api/heatmap?precision=7");
      const { cells } = await res.json();

      map.addSource("cells", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: cells.map((c: { geohash: string; intensity: number }) => {
            const b = ngeohash.decode_bbox(c.geohash);
            return {
              type: "Feature",
              properties: { intensity: c.intensity },
              geometry: {
                type: "Polygon",
                coordinates: [[[b[1], b[0]], [b[3], b[0]], [b[3], b[2]], [b[1], b[2]], [b[1], b[0]]]],
              },
            };
          }),
        },
      });

      map.addLayer({
        id: "cells-fill",
        type: "fill",
        source: "cells",
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "intensity"], 0, "#ffe08a", 0.5, "#f08c3a", 1, "#c0392b"],
          "fill-opacity": 0.55,
        },
      });
    });

    return () => map.remove();
  }, []);

  return (
    <main>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <a
        href="/report"
        style={{
          position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#c0392b", color: "white", padding: "14px 24px", borderRadius: 999,
          textDecoration: "none", fontWeight: 600,
        }}
      >
        Report a building
      </a>
    </main>
  );
}
```

Create `src/app/report/page.tsx` (the hero flow):

```tsx
"use client";
import { useState } from "react";

export default function Report() {
  const [status, setStatus] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("Getting your location…");
    const pos = await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true }),
    );

    const form = new FormData(e.currentTarget);
    form.set("lat", String(pos.coords.latitude));
    form.set("lon", String(pos.coords.longitude));
    form.set("sourceClass", form.get("media") instanceof File && (form.get("media") as File).size > 0
      ? "resident_photo" : "resident_account");

    setStatus("Submitting…");
    const res = await fetch("/api/evidence", { method: "POST", body: form });
    const out = await res.json();

    setStatus(
      out.needsLocationConfirmation
        ? "You seem to be some distance from this building — please confirm the address."
        : "Submitted. Your report is being assessed.",
    );
    if (!out.needsLocationConfirmation) location.href = `/building/${out.buildingId}`;
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
      <h1>Report a building</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="reporterId" placeholder="Your reporter id" required />
        <input name="addressText" placeholder="Building address" required />
        <textarea name="note" placeholder="What have you seen?" rows={4} required />
        <input type="file" name="media" accept="image/*" capture="environment" />
        <button type="submit">Submit</button>
      </form>
      <p>{status}</p>
    </main>
  );
}
```

Create `src/app/building/[id]/page.tsx`:

```tsx
import { buildingDetail } from "../../api/building/detail.js";

const COPY: Record<string, string> = {
  monitor: "Problems are on record. Nothing here is urgent.",
  act: "Have a structural engineer assess this building and raise it with your society.",
  escalated: "Authorities have been notified. Seek a professional structural assessment.",
  critical: "Authorities including disaster management have been notified. Seek a professional structural assessment immediately.",
};

export default async function Building({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await buildingDetail(id);

  if (!detail) {
    return <main style={{ padding: 24 }}><p>No assessment yet. Check back shortly.</p></main>;
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <p style={{ textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
        {detail.alertLevel}
      </p>
      <h1>{detail.addressText}</h1>
      <p>{COPY[detail.alertLevel]}</p>
      <p>{detail.narrative}</p>
      <h2>What is on record</h2>
      <ol>
        {detail.hazards.map((h, i) => (
          <li key={i}>{h.label} — <em>{h.support}</em></li>
        ))}
      </ol>
    </main>
  );
}
```

- [ ] **Step 6: Verify the app runs**

Run: `npx next dev` then open `http://localhost:3000`
Expected: the map renders coloured cells with no pins, and `/report` submits through to a building page.

- [ ] **Step 7: Commit**

```bash
git add src/app package.json
git commit -m "feat: public heat map, report flow and assessment view"
```

---

## Self-Review

Run against `docs/SPEC.md` after the plan is executed, not before.

**Spec coverage.** Hero flow: Tasks 15, 16. Closed catalogue and enum enforcement: 1, 9. Confidence rules: 2. Score, ranking, severity-gated banding: 3. Assessment replacement and narration: 10. Debounce with severity bypass: 11. Cell k-suppression: 4, 14. EXIF read/strip/corroborate: 7. Proximity dedupe and the 150m prompt: 6, 15. Escalation routing, snapshot, SES, ticket capture: 12. Resolution claims, contest window, critical block: 13. Four visibility tiers: partially — the public tier is enforced by Tasks 14 and 16, but **Reporter, resident and Office-bearer tiers have no authentication in this plan**. That is the known gap; there is no auth layer, so `reporterId` is supplied by the caller. Add authentication before anything resembling real use.

**Deferred to plan two.** Extractor, Source Scout, Firecrawl ingestion, Area Signals population, the what's-happening cell summaries, USGS and SACHET adapters, guided hand-submission UI, admin promotion of `other` into the catalogue, feedback-driven Source Class weights, Society roll-up views.

**Type consistency.** `HazardTypeId` flows from Task 1 into 3, 9, 10, 12, 15. `OpenHazard` from Task 3 into 10, 12. `AssessmentRecord` from Task 10 into 12. `SourceClass`/`GeoAgreement` from Task 2 into 5, 7, 15. `RenderedCell` from Task 4 is narrowed to `PublicCell` in Task 14, which is where `buildingCount` is dropped.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-catastrophy-core.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
