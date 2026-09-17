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

