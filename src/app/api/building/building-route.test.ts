import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { resolveOrCreateBuilding } from "../../../db/buildings.js";
import { db, pool } from "../../../db/client.js";
import { buildingDetail } from "./detail.js";
import { GET } from "./[id]/route.js";
import { REPORTER_COOKIE, signReporterSession } from "../../../api/reporter.js";

afterAll(async () => { await pool.end(); });

describe("buildingDetail", () => {
  it("returns the Alert Level and never the internal Score", async () => {
    const tag = `D${Math.random().toString(36).slice(2, 8)}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.51,
      lon: 77.19,
      addressText: `${tag} Marg`,
    });
    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked)
      VALUES (${building.id}, 0.77, 'escalated', 'Two Hazards are on record.', '[]'::jsonb)
      ON CONFLICT (building_id) DO UPDATE SET
        score = EXCLUDED.score,
        alert_level = EXCLUDED.alert_level,
        narrative = EXCLUDED.narrative,
        ranked = EXCLUDED.ranked
    `);

    const detail = await buildingDetail(building.id);
    expect(detail!.alertLevel).toBe("escalated");
    expect(detail).not.toHaveProperty("score");
    expect(JSON.stringify(detail)).not.toContain("0.77");
  });

  it("returns null for a Building with no Assessment", async () => {
    const tag = `G${Math.random().toString(36).slice(2, 8)}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.52,
      lon: 77.18,
      addressText: `${tag} Marg`,
    });
    expect(await buildingDetail(building.id)).toBeNull();
  });

  it("conceals exact detail from a Reporter until residency is approved", async () => {
    const tag = `P${Math.random().toString(36).slice(2, 8)}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.70 + Math.random() * 0.01,
      lon: 77.30 + Math.random() * 0.01,
      addressText: `${tag} Lane`,
    });
    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked)
      VALUES (${building.id}, 0.4, 'act', 'Private narrative', '[]'::jsonb)
      ON CONFLICT (building_id) DO UPDATE SET narrative = EXCLUDED.narrative
    `);
    const reporter = await db.execute(sql`
      INSERT INTO reporters (pseudonym) VALUES ('private tester') RETURNING id
    `);
    const reporterId = reporter.rows[0]!.id as string;

    const denied = await GET(
      new NextRequest(`http://localhost/api/building/${building.id}`),
      { params: Promise.resolve({ id: building.id }) },
    );
    expect(denied.status).toBe(404);

    await db.execute(sql`
      INSERT INTO evidence (building_id, reporter_id, source_class, note, captured_at)
      VALUES (${building.id}, ${reporterId}, 'resident_account', 'observed crack', now())
    `);
    const stillDenied = await GET(
      new NextRequest(`http://localhost/api/building/${building.id}`, {
        headers: { Cookie: `${REPORTER_COOKIE}=${signReporterSession(reporterId)}` },
      }),
      { params: Promise.resolve({ id: building.id }) },
    );
    expect(stillDenied.status).toBe(404);

    await db.execute(sql`
      INSERT INTO building_residents (building_id, reporter_id, approved_at)
      VALUES (${building.id}, ${reporterId}, now())
    `);
    const unsigned = await GET(
      new NextRequest(`http://localhost/api/building/${building.id}`, {
        headers: { Cookie: `${REPORTER_COOKIE}=${reporterId}` },
      }),
      { params: Promise.resolve({ id: building.id }) },
    );
    expect(unsigned.status).toBe(404);

    const allowed = await GET(
      new NextRequest(`http://localhost/api/building/${building.id}`, {
        headers: { Cookie: `${REPORTER_COOKIE}=${signReporterSession(reporterId)}` },
      }),
      { params: Promise.resolve({ id: building.id }) },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).not.toHaveProperty("score");
  });
});
