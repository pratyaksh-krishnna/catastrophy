import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { narrateCellSummary } from "../agents/narrator.js";
import { readCellSummaries } from "../db/cell-summaries.js";
import { db, pool } from "../db/client.js";
import { cellFor } from "../domain/localities.js";
import { regenerateCellSummaries } from "./summaries.js";

vi.mock("../agents/narrator.js", () => ({
  narrateCellSummary: vi.fn(),
}));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.mocked(narrateCellSummary).mockReset();
  vi.mocked(narrateCellSummary).mockResolvedValue("Default narrated summary.");
});

async function insertSignal(input: {
  geohash: string;
  precision: number;
  sourceId: string;
  topicId: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO area_signals (geohash, precision, source_id, text, occurred_at, topic_id)
    VALUES (${input.geohash}, ${input.precision}, ${input.sourceId}, 'test text', now(), ${input.topicId})
  `);
}

async function cleanupSignals(sourceIds: string[]): Promise<void> {
  const idList = sql.join(
    sourceIds.map((id) => sql`${id}`),
    sql`, `,
  );
  await db.execute(sql`DELETE FROM area_signals WHERE source_id IN (${idList})`);
}

async function cleanupSummary(geohash: string): Promise<void> {
  await db.execute(sql`DELETE FROM cell_summaries WHERE geohash = ${geohash}`);
}

describe("regenerateCellSummaries", () => {
  it("aggregates per-topic counts and passes them to the narrator", async () => {
    const tag = crypto.randomUUID();
    // A synthetic geohash unique to this test, so counts cannot be polluted
    // by other tests/files sharing this Postgres database with rows at the
    // well-known catalogue geohashes.
    const cell = { geohash: `tc${tag.slice(0, 10)}`, precision: 6 };
    const sourceIds = [`${tag}-1`, `${tag}-2`, `${tag}-3`];
    try {
      await insertSignal({ ...cell, sourceId: sourceIds[0]!, topicId: "load_bearing_crack" });
      await insertSignal({ ...cell, sourceId: sourceIds[1]!, topicId: "load_bearing_crack" });
      await insertSignal({ ...cell, sourceId: sourceIds[2]!, topicId: "drainage_failure" });

      const report = await regenerateCellSummaries([cell]);

      expect(report).toEqual({ cellsConsidered: 1, summarised: 1, failed: 0 });
      expect(narrateCellSummary).toHaveBeenCalledTimes(1);
      const call = vi.mocked(narrateCellSummary).mock.calls[0]![0];
      expect(call.signalCount).toBe(3);
      expect(call.topics).toEqual(
        expect.arrayContaining([
          { topicId: "load_bearing_crack", count: 2 },
          { topicId: "drainage_failure", count: 1 },
        ]),
      );
    } finally {
      await cleanupSignals(sourceIds);
      await cleanupSummary(cell.geohash);
    }
  });

  it("resolves the locality label for a real locality geohash", async () => {
    const tag = crypto.randomUUID();
    const cell = cellFor("karol_bagh")!;
    const sourceId = `${tag}-label`;
    try {
      await insertSignal({ ...cell, sourceId, topicId: "other" });

      await regenerateCellSummaries([cell]);

      const call = vi.mocked(narrateCellSummary).mock.calls[0]![0];
      expect(call.localityLabel).toBe("Karol Bagh");
    } finally {
      await cleanupSignals([sourceId]);
      await cleanupSummary(cell.geohash);
    }
  });

  it("falls back to 'this area' when the geohash matches no catalogue locality", async () => {
    const tag = crypto.randomUUID();
    const geohash = `zzzz${crypto.randomUUID().slice(0, 6)}`;
    const sourceId = `${tag}-nolabel`;
    try {
      await insertSignal({ geohash, precision: 6, sourceId, topicId: "other" });

      await regenerateCellSummaries([{ geohash, precision: 6 }]);

      const call = vi.mocked(narrateCellSummary).mock.calls[0]![0];
      expect(call.localityLabel).toBe("this area");
    } finally {
      await cleanupSignals([sourceId]);
      await cleanupSummary(geohash);
    }
  });

  it("counts a narrator throw as failed without aborting the run", async () => {
    const tag = crypto.randomUUID();
    const cellA = cellFor("laxmi_nagar")!;
    const cellB = cellFor("karol_bagh")!;
    const sourceIdA = `${tag}-a`;
    const sourceIdB = `${tag}-b`;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await insertSignal({ ...cellA, sourceId: sourceIdA, topicId: "other" });
      await insertSignal({ ...cellB, sourceId: sourceIdB, topicId: "other" });

      vi.mocked(narrateCellSummary).mockImplementation(async (input) => {
        if (input.localityLabel === "Laxmi Nagar") throw new Error("model unavailable");
        return "Narrated summary for the second cell.";
      });

      const report = await regenerateCellSummaries([cellA, cellB]);

      expect(report).toEqual({ cellsConsidered: 2, summarised: 1, failed: 1 });
      expect(consoleError).toHaveBeenCalled();

      const summaries = await readCellSummaries();
      expect(summaries.some((s) => s.geohash === cellA.geohash)).toBe(false);
      expect(summaries.find((s) => s.geohash === cellB.geohash)).toMatchObject({
        summary: "Narrated summary for the second cell.",
      });
    } finally {
      consoleError.mockRestore();
      await cleanupSignals([sourceIdA, sourceIdB]);
      await cleanupSummary(cellA.geohash);
      await cleanupSummary(cellB.geohash);
    }
  });

  it("persists the summary and a re-run updates it", async () => {
    const tag = crypto.randomUUID();
    // Synthetic geohash: isolates the signalCount assertion from rows other
    // tests/files may have left at the well-known catalogue geohashes.
    const cell = { geohash: `tp${tag.slice(0, 10)}`, precision: 6 };
    const sourceId = `${tag}-persist`;
    try {
      await insertSignal({ ...cell, sourceId, topicId: "other" });

      vi.mocked(narrateCellSummary).mockResolvedValueOnce("First summary.");
      await regenerateCellSummaries([cell]);

      let summaries = await readCellSummaries();
      expect(summaries.find((s) => s.geohash === cell.geohash)).toMatchObject({
        summary: "First summary.",
        signalCount: 1,
      });

      vi.mocked(narrateCellSummary).mockResolvedValueOnce("Second summary.");
      await regenerateCellSummaries([cell]);

      summaries = await readCellSummaries();
      const matching = summaries.filter((s) => s.geohash === cell.geohash);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({ summary: "Second summary.", signalCount: 1 });
    } finally {
      await cleanupSignals([sourceId]);
      await cleanupSummary(cell.geohash);
    }
  });
});
