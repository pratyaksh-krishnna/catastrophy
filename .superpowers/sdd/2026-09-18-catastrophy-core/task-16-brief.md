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
