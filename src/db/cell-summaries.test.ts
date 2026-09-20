import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { readCellSummaries, upsertCellSummary } from "./cell-summaries.js";

afterAll(async () => {
  await pool.end();
});

async function cleanup(geohash: string): Promise<void> {
  await db.execute(sql`DELETE FROM cell_summaries WHERE geohash = ${geohash}`);
}

describe("cell-summaries", () => {
  it("inserts a summary and reads it back", async () => {
    const geohash = `tsq${crypto.randomUUID().slice(0, 8)}`;
    try {
      await upsertCellSummary({
        geohash,
        precision: 6,
        summary: "Several reports of structural cracking in this area.",
        signalCount: 3,
      });

      const rows = await readCellSummaries();
      const row = rows.find((r) => r.geohash === geohash);
      expect(row).toMatchObject({
        geohash,
        precision: 6,
        summary: "Several reports of structural cracking in this area.",
        signalCount: 3,
      });
      expect(row?.generatedAt).toBeInstanceOf(Date);
    } finally {
      await cleanup(geohash);
    }
  });

  it("updates rather than duplicates on a second upsert for the same geohash, moving generatedAt forward", async () => {
    const geohash = `tsq${crypto.randomUUID().slice(0, 8)}`;
    try {
      await upsertCellSummary({
        geohash,
        precision: 6,
        summary: "First summary.",
        signalCount: 1,
      });
      const firstRows = await readCellSummaries();
      const first = firstRows.find((r) => r.geohash === geohash);
      expect(first).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 10));

      await upsertCellSummary({
        geohash,
        precision: 7,
        summary: "Second summary.",
        signalCount: 5,
      });

      const rows = await readCellSummaries();
      const matching = rows.filter((r) => r.geohash === geohash);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        geohash,
        precision: 7,
        summary: "Second summary.",
        signalCount: 5,
      });
      expect(matching[0]!.generatedAt.getTime()).toBeGreaterThan(first!.generatedAt.getTime());
    } finally {
      await cleanup(geohash);
    }
  });
});
