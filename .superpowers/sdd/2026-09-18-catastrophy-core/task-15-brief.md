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

