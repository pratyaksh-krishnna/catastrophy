import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { narrateAssessment } from "../agents/narrator.js";
import { db, pool } from "./client.js";
import { resolveOrCreateBuilding } from "./buildings.js";
import { buildAssessment, getAssessment, replaceAssessment } from "./assessments.js";

vi.mock("../agents/narrator.js", () => ({
  narrateAssessment: vi.fn(async () => "Two problems are on record for this Building."),
}));

afterAll(async () => {
  await pool.end();
});

async function seedReporter(): Promise<string> {
  const result = await db.execute(
    sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`,
  );
  return result.rows[0]!.id as string;
}

describe("assessments", () => {
  it("builds from scratch and ranks a severe credible Hazard first", async () => {
    const tag = `A${crypto.randomUUID()}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.55,
      lon: 77.25,
      addressText: `${tag} Road`,
    });
    const reporterOne = await seedReporter();
    const reporterTwo = await seedReporter();

    for (const [reporterId, typeId] of [
      [reporterOne, "load_bearing_crack"],
      [reporterTwo, "plaster_spalling"],
    ] as const) {
      const evidence = await db.execute(sql`
        INSERT INTO evidence (building_id, reporter_id, source_class, captured_at, note)
        VALUES (${building.id}, ${reporterId}, 'resident_photo', now(), 'seed')
        RETURNING id
      `);
      const hazard = await db.execute(sql`
        INSERT INTO hazards (building_id, type_id)
        VALUES (${building.id}, ${typeId})
        ON CONFLICT (building_id, type_id) DO UPDATE SET status = 'open'
        RETURNING id
      `);
      await db.execute(sql`
        INSERT INTO evidence_hazards (evidence_id, hazard_id)
        VALUES (${evidence.rows[0]!.id}, ${hazard.rows[0]!.id})
      `);
    }

    const assessment = await buildAssessment(building.id, new Date());
    expect(assessment.ranked[0]?.typeId).toBe("load_bearing_crack");
    expect(assessment.alertLevel).not.toBe("monitor");
    expect(narrateAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        addressText: `${tag} Road`,
        alertLevel: assessment.alertLevel,
        ranked: assessment.ranked,
      }),
    );
  });

  it("replaces an Assessment wholesale rather than appending", async () => {
    const tag = `B${crypto.randomUUID()}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.44,
      lon: 77.11,
      addressText: `${tag} Lane`,
    });

    await replaceAssessment({
      buildingId: building.id,
      score: 0.2,
      alertLevel: "act",
      narrative: "first",
      ranked: [],
    });
    await replaceAssessment({
      buildingId: building.id,
      score: 0.8,
      alertLevel: "critical",
      narrative: "second",
      ranked: [],
    });

    const rows = await db.execute(sql`
      SELECT count(*)::int AS n FROM assessments WHERE building_id = ${building.id}
    `);
    expect(rows.rows[0]!.n).toBe(1);
    await expect(getAssessment(building.id)).resolves.toMatchObject({
      narrative: "second",
      score: 0.8,
      alertLevel: "critical",
    });
  });

  it("returns null for a Building with no Assessment", async () => {
    const tag = `C${crypto.randomUUID()}`;
    const building = await resolveOrCreateBuilding({
      lat: 28.33,
      lon: 77.33,
      addressText: `${tag} Marg`,
    });
    await expect(getAssessment(building.id)).resolves.toBeNull();
  });

  it("rejects a nonexistent Building", async () => {
    await expect(
      buildAssessment("00000000-0000-0000-0000-000000000000", new Date()),
    ).rejects.toThrow(/no such building/i);
  });
});
