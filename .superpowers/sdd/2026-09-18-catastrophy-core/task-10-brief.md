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

