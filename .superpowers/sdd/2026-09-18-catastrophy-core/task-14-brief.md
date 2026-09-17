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

