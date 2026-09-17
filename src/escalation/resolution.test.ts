import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";

const getAssessment = vi.hoisted(() => vi.fn());

vi.mock("../db/assessments.js", () => ({ getAssessment }));

import {
  claimResolution,
  CONTEST_WINDOW_MS,
  disputeClaim,
  settleClaim,
} from "./resolution.js";

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  getAssessment.mockReset();
  getAssessment.mockResolvedValue({
    buildingId: "x",
    score: 0.1,
    alertLevel: "act",
    narrative: "",
    ranked: [],
  });
});

async function seed(
  typeId: string,
  options: { approved?: boolean; linkedSociety?: boolean } = {},
) {
  const tag = `R${Math.random().toString(36).slice(2, 10)}`;
  const society = await db.execute(
    sql`INSERT INTO societies (name) VALUES (${tag}) RETURNING id`,
  );
  const societyId = society.rows[0]!.id as string;
  const building = await resolveOrCreateBuilding({
    // A distinct point avoids cross-test proximity dedupe when the database is
    // intentionally reused between integration-test runs.
    lat: 28.1 + Math.random() * 0.7,
    lon: 76.8 + Math.random() * 0.7,
    addressText: `${tag} Path`,
    ...(options.linkedSociety === false ? {} : { societyId }),
  });
  const reporter = await db.execute(
    sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`,
  );
  const officeBearer = await db.execute(sql`
    INSERT INTO office_bearers (society_id, reporter_id, approved_at)
    VALUES (
      ${societyId},
      ${reporter.rows[0]!.id},
      ${options.approved === false ? null : new Date().toISOString()}
    )
    RETURNING id
  `);
  const hazard = await db.execute(sql`
    INSERT INTO hazards (building_id, type_id)
    VALUES (${building.id}, ${typeId})
    RETURNING id
  `);
  const evidence = await db.execute(sql`
    INSERT INTO evidence (building_id, reporter_id, source_class, captured_at, note)
    VALUES (${building.id}, ${reporter.rows[0]!.id}, 'resident_photo', now(), 'after photo')
    RETURNING id
  `);
  return {
    buildingId: building.id,
    reporterId: reporter.rows[0]!.id as string,
    hazardId: hazard.rows[0]!.id as string,
    officeBearerId: officeBearer.rows[0]!.id as string,
    evidenceId: evidence.rows[0]!.id as string,
  };
}

describe("Resolution Claims", () => {
  it("opens a contest window rather than resolving immediately", async () => {
    const seeded = await seed("plaster_spalling");
    const claim = await claimResolution(seeded);
    expect(claim.contestUntil.getTime()).toBeGreaterThan(Date.now());

    const hazard = await db.execute(
      sql`SELECT status FROM hazards WHERE id = ${seeded.hazardId}`,
    );
    expect(hazard.rows[0]!.status).toBe("open");
  });

  it("resolves the Hazard once the window passes uncontested", async () => {
    const seeded = await seed("drainage_failure");
    const claim = await claimResolution(seeded);
    await expect(
      settleClaim(claim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1_000)),
    ).resolves.toBe("resolved");

    const hazard = await db.execute(
      sql`SELECT status, resolved_at FROM hazards WHERE id = ${seeded.hazardId}`,
    );
    expect(hazard.rows[0]!.status).toBe("resolved");
    expect(hazard.rows[0]!.resolved_at).not.toBeNull();
  });

  it("keeps the Hazard open when any Reporter disputes in time", async () => {
    const seeded = await seed("roof_damage");
    const claim = await claimResolution(seeded);
    await disputeClaim(claim.id);
    await expect(
      settleClaim(claim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1_000)),
    ).resolves.toBe("reopened");

    const hazard = await db.execute(
      sql`SELECT status FROM hazards WHERE id = ${seeded.hazardId}`,
    );
    expect(hazard.rows[0]!.status).toBe("open");
  });

  it("leaves an uncontested claim pending before its window closes", async () => {
    const seeded = await seed("staircase_damage");
    const claim = await claimResolution(seeded);
    await expect(settleClaim(claim.id, new Date())).resolves.toBe("pending");
  });

  it("allows only one active claim for a Hazard", async () => {
    const seeded = await seed("boundary_wall_lean");
    await claimResolution(seeded);
    await expect(claimResolution(seeded)).rejects.toThrow(/already exists/i);
  });

  it("database-enforces one active claim during concurrent creation", async () => {
    const seeded = await seed("water_seepage_structural");
    const results = await Promise.allSettled([
      claimResolution(seeded),
      claimResolution(seeded),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("refuses a claim against a Building at critical", async () => {
    getAssessment.mockResolvedValueOnce({
      buildingId: "x",
      score: 0.9,
      alertLevel: "critical",
      narrative: "",
      ranked: [],
    });
    const seeded = await seed("column_failure");
    await expect(claimResolution(seeded)).rejects.toThrow(/critical/i);
  });

  it("requires an approved Office-bearer", async () => {
    const seeded = await seed("plaster_spalling", { approved: false });
    await expect(claimResolution(seeded)).rejects.toThrow(/not approved/i);
  });

  it("requires the Building to have the exact Office-bearer's Society", async () => {
    const unassigned = await seed("electrical_hazard", { linkedSociety: false });
    await expect(claimResolution(unassigned)).rejects.toThrow(/not assigned to a Society/i);

    const represented = await seed("lift_shaft_damage");
    const otherSociety = await seed("gas_pipeline_proximity");
    await expect(
      claimResolution({
        hazardId: represented.hazardId,
        officeBearerId: otherSociety.officeBearerId,
        evidenceId: represented.evidenceId,
      }),
    ).rejects.toThrow(/does not represent/i);
  });

  it("requires fresh Evidence from the same Building", async () => {
    const seeded = await seed("plaster_spalling");
    const other = await seed("drainage_failure");
    await expect(
      claimResolution({
        hazardId: seeded.hazardId,
        officeBearerId: seeded.officeBearerId,
        evidenceId: other.evidenceId,
      }),
    ).rejects.toThrow(/Hazard's Building/i);

    await db.execute(sql`
      UPDATE evidence SET captured_at = '2000-01-01T00:00:00Z'
      WHERE id = ${seeded.evidenceId}
    `);
    await expect(claimResolution(seeded)).rejects.toThrow(/fresh/i);
  });

  it("fails closed at settlement when the current Assessment is missing or critical", async () => {
    const missing = await seed("sewage_undermining");
    const missingClaim = await claimResolution(missing);
    getAssessment.mockResolvedValueOnce(null);
    await expect(
      settleClaim(missingClaim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1_000)),
    ).rejects.toThrow(/current Assessment/i);

    const critical = await seed("overloaded_water_tank");
    const criticalClaim = await claimResolution(critical);
    getAssessment.mockResolvedValueOnce({
      buildingId: critical.buildingId,
      score: 0.9,
      alertLevel: "critical",
      narrative: "",
      ranked: [],
    });
    await expect(
      settleClaim(criticalClaim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1_000)),
    ).rejects.toThrow(/critical/i);

    const hazards = await db.execute(sql`
      SELECT id, status
      FROM hazards
      WHERE id IN (${missing.hazardId}, ${critical.hazardId})
    `);
    expect(hazards.rows.every((row) => row.status === "open")).toBe(true);
  });

  it("rejects an old claim when newer Evidence supports the Hazard", async () => {
    const seeded = await seed("facade_detachment");
    const claim = await claimResolution(seeded);
    const newer = await db.execute(sql`
      INSERT INTO evidence (
        building_id, reporter_id, source_class, captured_at, note, created_at
      )
      VALUES (
        ${seeded.buildingId},
        ${seeded.reporterId},
        'resident_photo',
        now(),
        'new evidence during contest',
        now() + interval '1 second'
      )
      RETURNING id
    `);
    await db.execute(sql`
      INSERT INTO evidence_hazards (evidence_id, hazard_id)
      VALUES (${newer.rows[0]!.id}, ${seeded.hazardId})
    `);

    await expect(
      settleClaim(claim.id, new Date(Date.now() + CONTEST_WINDOW_MS + 1_000)),
    ).resolves.toBe("reopened");

    const state = await db.execute(sql`
      SELECT rc.status AS claim_status, h.status AS hazard_status
      FROM resolution_claims rc
      JOIN hazards h ON h.id = rc.hazard_id
      WHERE rc.id = ${claim.id}
    `);
    expect(state.rows[0]).toMatchObject({
      claim_status: "rejected",
      hazard_status: "open",
    });
  });
});
