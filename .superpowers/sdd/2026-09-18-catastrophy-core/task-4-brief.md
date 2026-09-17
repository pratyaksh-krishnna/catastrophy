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
