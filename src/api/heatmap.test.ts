import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import ngeohash from "ngeohash";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";
import { normalizePrecision, publicHeatmap } from "./heatmap.js";

afterAll(async () => { await pool.end(); });

const BBOX = { minLat: 28.4, minLon: 76.9, maxLat: 28.9, maxLon: 77.4 };

async function seedScored(tag: string, n: number, lat: number, lon: number) {
  for (let i = 0; i < n; i += 1) {
    const building = await resolveOrCreateBuilding({
      lat: lat + i * 0.0003,
      lon: lon + i * 0.0003,
      addressText: `${tag} ${i}`,
    });
    await db.execute(sql`
      INSERT INTO assessments (building_id, score, alert_level, narrative, ranked)
      VALUES (${building.id}, 0.6, 'act', 'n', '[]'::jsonb)
      ON CONFLICT (building_id) DO UPDATE SET score = 0.6
    `);
  }
}

describe("publicHeatmap", () => {
  it("never returns a Building count, Score, coordinate, or address", async () => {
    await seedScored(`H${Math.random().toString(36).slice(2, 7)}`, 8, 28.6315, 77.2167);
    const cells = await publicHeatmap(BBOX, 7);

    for (const cell of cells) {
      expect(Object.keys(cell).sort()).toEqual(["geohash", "intensity", "precision"]);
    }
    expect(JSON.stringify(cells)).not.toMatch(/address|buildingCount|score|"lat"|"lon"/i);
  });

  it("never emits an isolated Building at the requested fine precision", async () => {
    const tag = `I${Math.random().toString(36).slice(2, 7)}`;
    const lat = 28.41 + Math.random() * 0.46;
    const lon = 76.81 + Math.random() * 0.57;
    await seedScored(tag, 1, lat, lon);
    const cells = await publicHeatmap(
      { minLat: lat - 0.002, minLon: lon - 0.002, maxLat: lat + 0.002, maxLon: lon + 0.002 },
      7,
    );
    // The Building may legitimately be folded into a coarser k-safe parent if
    // other Buildings exist nearby, but its fine-grained cell must stay hidden.
    expect(cells.some((cell) => cell.geohash === ngeohash.encode(lat, lon, 7))).toBe(false);
  });

  it("clamps public precision to the privacy-reviewed range", () => {
    expect(normalizePrecision(20)).toBe(7);
    expect(normalizePrecision(1)).toBe(4);
    expect(() => normalizePrecision(Number.NaN)).toThrow(/finite/);
  });
});
