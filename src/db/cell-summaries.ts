import { sql } from "drizzle-orm";
import { db } from "./client";

export interface CellSummaryRecord {
  geohash: string;
  precision: number;
  summary: string;
  signalCount: number;
}

/** A cell has exactly one current summary; upsert replaces it wholesale. */
export async function upsertCellSummary(record: CellSummaryRecord): Promise<void> {
  await db.execute(sql`
    INSERT INTO cell_summaries (geohash, precision, summary, signal_count, generated_at)
    VALUES (
      ${record.geohash},
      ${record.precision},
      ${record.summary},
      ${record.signalCount},
      now()
    )
    ON CONFLICT (geohash) DO UPDATE SET
      summary = EXCLUDED.summary,
      precision = EXCLUDED.precision,
      signal_count = EXCLUDED.signal_count,
      generated_at = EXCLUDED.generated_at
  `);
}

export async function readCellSummaries(): Promise<
  Array<CellSummaryRecord & { generatedAt: Date }>
> {
  const result = await db.execute(sql`
    SELECT geohash, precision, summary, signal_count, generated_at
    FROM cell_summaries
  `);

  return result.rows.map((row) => ({
    geohash: row.geohash as string,
    precision: Number(row.precision),
    summary: row.summary as string,
    signalCount: Number(row.signal_count),
    generatedAt: new Date(row.generated_at as Date | string),
  }));
}
