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
