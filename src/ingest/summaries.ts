/**
 * Regenerates cell_summaries prose for a set of touched cells.
 *
 * For each cell: read area_signals for the geohash to get the signal count
 * and per-topic counts, resolve a locality label, ask the narrator for
 * prose, and upsert cell_summaries. A narrator failure on one cell is
 * logged and counted; the previous summary for that cell stands and the
 * remaining cells still run.
 */
import { sql } from "drizzle-orm";
import type { HazardTypeId } from "../domain/hazard-catalogue";
import { narrateCellSummary } from "../agents/narrator";
import { db } from "../db/client";
import { upsertCellSummary } from "../db/cell-summaries";
import { cellFor, LOCALITY_CATALOGUE, LOCALITY_IDS } from "../domain/localities";

export interface SummaryReport {
  cellsConsidered: number;
  summarised: number;
  failed: number;
}

/** geohash -> locality label, built once from the closed gazetteer. */
const LABEL_BY_GEOHASH: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  for (const id of LOCALITY_IDS) {
    const cell = cellFor(id);
    if (cell) index[cell.geohash] = LOCALITY_CATALOGUE[id].label;
  }
  return index;
})();

function localityLabelFor(geohash: string): string {
  return LABEL_BY_GEOHASH[geohash] ?? "this area";
}

export async function regenerateCellSummaries(
  cells: Array<{ geohash: string; precision: number }>,
): Promise<SummaryReport> {
  const report: SummaryReport = { cellsConsidered: cells.length, summarised: 0, failed: 0 };

  for (const cell of cells) {
    const result = await db.execute(sql`
      SELECT topic_id, count(*)::int AS count
      FROM area_signals
      WHERE geohash = ${cell.geohash}
      GROUP BY topic_id
    `);

    const topics = result.rows.map((row) => ({
      topicId: (row.topic_id as HazardTypeId | "other" | null) ?? "other",
      count: Number(row.count),
    }));
    const signalCount = topics.reduce((sum, topic) => sum + topic.count, 0);

    try {
      const summary = await narrateCellSummary({
        localityLabel: localityLabelFor(cell.geohash),
        topics,
        signalCount,
      });

      await upsertCellSummary({
        geohash: cell.geohash,
        precision: cell.precision,
        summary,
        signalCount,
      });
      report.summarised++;
    } catch (error) {
      console.error(`regenerateCellSummaries: narrator failed for geohash ${cell.geohash}`, error);
      report.failed++;
    }
  }

  return report;
}
