import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resolveOrCreateBuilding } from "../db/buildings";
import { db, pool } from "../db/client";
import { officeBearerForBuilding, reporterCanAccessBuilding } from "../app/api/building/detail";

afterAll(async () => { await pool.end(); });

function admin(command: string, ...args: string[]) {
  execFileSync(process.execPath, ["scripts/admin.mjs", command, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
  });
}

describe("manual access approvals", () => {
  it("grants private Assessment and Office-bearer access only after explicit review commands", async () => {
    const building = await resolveOrCreateBuilding({
      lat: 28.67,
      lon: 77.29,
      addressText: `Approval ${crypto.randomUUID()} Marg`,
    });
    const reporter = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('approval tester') RETURNING id`);
    const reporterId = reporter.rows[0]!.id as string;
    const evidence = await db.execute(sql`
      INSERT INTO evidence (building_id, reporter_id, source_class, note, captured_at)
      VALUES (${building.id}, ${reporterId}, 'resident_account', 'observed crack', now()) RETURNING id
    `);
    const evidenceId = evidence.rows[0]!.id as string;

    expect(await reporterCanAccessBuilding(reporterId, building.id)).toBe(false);
    expect(await officeBearerForBuilding(reporterId, building.id)).toBe(false);

    admin("resident", evidenceId);
    expect(await reporterCanAccessBuilding(reporterId, building.id)).toBe(true);
    expect(await officeBearerForBuilding(reporterId, building.id)).toBe(false);

    admin("society", evidenceId, `Society ${crypto.randomUUID()}`);
    admin("office", evidenceId);
    expect(await officeBearerForBuilding(reporterId, building.id)).toBe(true);
  });
});
