/**
 * Area Signals ingestion orchestrator.
 *
 * fetch -> drop seen sourceId -> extract -> resolve cell -> insert area_signals
 *
 * Invariant: this pipeline is cell-level only. It must never touch buildings,
 * hazards, evidence or assessments.
 */
import { sql } from "drizzle-orm";
import { extractSignal } from "../agents/extractor";
import { db } from "../db/client";
import { cellFor } from "../domain/localities";
import type { ContentSource } from "./source";

export interface IngestReport {
  fetched: number;
  skippedDuplicate: number; // sourceId already in area_signals
  droppedIrrelevant: number; // isRelevant === false
  droppedNoCell: number; // localityId null, or cellFor returned null (district-level)
  failed: number; // extractSignal threw for this item
  inserted: number;
  touchedCells: Array<{ geohash: string; precision: number }>; // deduped
}

export async function ingestSignals(source: ContentSource): Promise<IngestReport> {
  const items = await source.fetchRecent();

  const report: IngestReport = {
    fetched: items.length,
    skippedDuplicate: 0,
    droppedIrrelevant: 0,
    droppedNoCell: 0,
    failed: 0,
    inserted: 0,
    touchedCells: [],
  };

  if (items.length === 0) return report;

  // Query once up front rather than issuing one SELECT per item.
  const sourceIds = items.map((item) => item.sourceId);
  const sourceIdList = sql.join(
    sourceIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const existing = await db.execute(
    sql`SELECT source_id FROM area_signals WHERE source_id IN (${sourceIdList})`,
  );
  const seen = new Set<string>(existing.rows.map((row) => row.source_id as string));
  const touchedGeohashes = new Set<string>();

  for (const item of items) {
    if (seen.has(item.sourceId)) {
      report.skippedDuplicate++;
      continue;
    }

    let extraction;
    try {
      extraction = await extractSignal({ text: item.text });
    } catch (error) {
      console.error(`ingestSignals: extractSignal failed for sourceId ${item.sourceId}`, error);
      report.failed++;
      continue;
    }

    if (!extraction.isRelevant) {
      report.droppedIrrelevant++;
      continue;
    }

    const cell = extraction.localityId === null ? null : cellFor(extraction.localityId);
    if (cell === null) {
      report.droppedNoCell++;
      continue;
    }

    const result = await db.execute(sql`
      INSERT INTO area_signals (
        geohash, precision, source_id, text, occurred_at, topic_id,
        source_url, source_title, media_url, media_kind
      )
      VALUES (
        ${cell.geohash}, ${cell.precision}, ${item.sourceId}, ${item.text}, ${item.occurredAt}, ${extraction.topicId},
        ${item.url ?? null}, ${item.title ?? null}, ${item.media?.url ?? null}, ${item.media?.kind ?? null}
      )
      ON CONFLICT (source_id) DO NOTHING
      RETURNING id
    `);

    // Whether inserted or a within-batch duplicate hit the conflict, this
    // sourceId now exists (or already existed) in area_signals.
    seen.add(item.sourceId);

    if (result.rows.length === 0) {
      report.skippedDuplicate++;
      continue;
    }

    report.inserted++;
    if (!touchedGeohashes.has(cell.geohash)) {
      touchedGeohashes.add(cell.geohash);
      report.touchedCells.push({ geohash: cell.geohash, precision: cell.precision });
    }
  }

  return report;
}
