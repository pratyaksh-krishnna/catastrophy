import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { buildings } from "./schema.js";

afterAll(async () => { await pool.end(); });

describe("schema", () => {
  it("has postgis available", async () => {
    const r = await db.execute(sql`SELECT PostGIS_Version() AS v`);
    expect(r.rows[0]!.v).toBeTruthy();
  });

  it("stores and reads a building's point", async () => {
    const [row] = await db
      .insert(buildings)
      .values({
        addressText: "12 Test Marg, Lajpat Nagar",
        location: sql`ST_SetSRID(ST_MakePoint(77.2432, 28.5677), 4326)::geography`,
      })
      .returning({ id: buildings.id });
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);

    const back = await db.execute(
      sql`SELECT ST_Y(location::geometry) AS lat FROM buildings WHERE id = ${row!.id}`,
    );
    expect(Number(back.rows[0]!.lat)).toBeCloseTo(28.5677, 4);
  });

  it("refuses a second hazard of the same type on one building", async () => {
    const [b] = await db
      .insert(buildings)
      .values({
        addressText: "dup test",
        location: sql`ST_SetSRID(ST_MakePoint(77.0, 28.0), 4326)::geography`,
      })
      .returning({ id: buildings.id });

    await db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b!.id}, 'load_bearing_crack')`);
    await expect(
      db.execute(sql`INSERT INTO hazards (building_id, type_id) VALUES (${b!.id}, 'load_bearing_crack')`),
    ).rejects.toThrow();
  });
});
