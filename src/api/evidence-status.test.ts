import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolveOrCreateBuilding } from "../db/buildings";
import { db, pool } from "../db/client";
import { approvedBuildingForEvidence, reporterEvidenceStatus } from "./evidence-status";

afterAll(async () => { await pool.end(); });

describe("private Evidence receipt", () => {
  it("shows only the owner's processing status and unlocks detail after approval", async () => {
    const building = await resolveOrCreateBuilding({
      lat: 28.64,
      lon: 77.24,
      addressText: `Receipt ${crypto.randomUUID()} Marg`,
    });
    const owner = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('owner') RETURNING id`);
    const stranger = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('stranger') RETURNING id`);
    const ownerId = owner.rows[0]!.id as string;
    const strangerId = stranger.rows[0]!.id as string;
    const evidence = await db.execute(sql`
      INSERT INTO evidence (building_id, reporter_id, source_class, note, captured_at)
      VALUES (${building.id}, ${ownerId}, 'resident_account', 'visible crack', now())
      RETURNING id
    `);
    const evidenceId = evidence.rows[0]!.id as string;

    expect(await reporterEvidenceStatus(strangerId, evidenceId)).toBeNull();
    expect(await reporterEvidenceStatus(ownerId, evidenceId)).toMatchObject({ status: "processing" });
    expect(await approvedBuildingForEvidence(ownerId, evidenceId)).toBeNull();

    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked, generated_at)
      VALUES (${building.id}, 0.8, 'critical', 'Private details', '[]'::jsonb, now() + interval '1 second')
    `);
    const receipt = await reporterEvidenceStatus(ownerId, evidenceId);
    expect(receipt?.status).toBe("assessed");
    expect(receipt).not.toHaveProperty("buildingId");
    expect(JSON.stringify(receipt)).not.toContain("Private details");

    await db.execute(sql`
      INSERT INTO building_residents (building_id, reporter_id, approved_at)
      VALUES (${building.id}, ${ownerId}, now())
    `);
    expect(await approvedBuildingForEvidence(ownerId, evidenceId)).toBe(building.id);
    expect(await approvedBuildingForEvidence(strangerId, evidenceId)).toBeNull();
  });
});
