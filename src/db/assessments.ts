import { sql } from "drizzle-orm";
import { narrateAssessment } from "../agents/narrator";
import {
  computeConfidence,
  type EvidenceRef,
  type GeoAgreement,
  type SourceClass,
} from "../domain/confidence";
import type { HazardTypeId } from "../domain/hazard-catalogue";
import {
  alertLevel,
  buildingScore,
  rankHazards,
  type AlertLevel,
  type OpenHazard,
} from "../domain/score";
import { db } from "./client";

export interface AssessmentRecord {
  buildingId: string;
  /** Internal only. Do not return this field from a public API. */
  score: number;
  alertLevel: AlertLevel;
  narrative: string;
  ranked: OpenHazard[];
}

interface EvidenceRow {
  type_id: HazardTypeId;
  reporter_id: string;
  source_class: SourceClass;
  captured_at: Date | string;
  geo_agreement: GeoAgreement;
}

/** Recompute a Building's complete current Assessment from its open Hazards. */
export async function buildAssessment(buildingId: string, now: Date): Promise<AssessmentRecord> {
  const evidenceRows = await db.execute(sql`
    SELECT h.type_id, e.reporter_id, e.source_class, e.captured_at, e.geo_agreement
    FROM hazards h
    JOIN evidence_hazards eh ON eh.hazard_id = h.id
    JOIN evidence e ON e.id = eh.evidence_id
    WHERE h.building_id = ${buildingId} AND h.status = 'open'
  `);

  const evidenceByType = new Map<HazardTypeId, EvidenceRef[]>();
  for (const row of evidenceRows.rows as unknown as EvidenceRow[]) {
    const refs = evidenceByType.get(row.type_id) ?? [];
    refs.push({
      reporterId: row.reporter_id,
      sourceClass: row.source_class,
      capturedAt: new Date(row.captured_at),
      geoAgreement: row.geo_agreement,
    });
    evidenceByType.set(row.type_id, refs);
  }

  const openHazards: OpenHazard[] = [...evidenceByType].map(([typeId, evidence]) => ({
    typeId,
    confidence: computeConfidence(evidence, now),
  }));
  const ranked = rankHazards(openHazards);
  const level = alertLevel(openHazards);

  const buildingResult = await db.execute(
    sql`SELECT address_text FROM buildings WHERE id = ${buildingId}`,
  );
  const building = buildingResult.rows[0];
  if (!building) throw new Error(`No such building: ${buildingId}`);

  return {
    buildingId,
    score: buildingScore(openHazards),
    alertLevel: level,
    narrative: await narrateAssessment({
      addressText: building.address_text as string,
      alertLevel: level,
      ranked,
    }),
    ranked,
  };
}

/** A Building has exactly one current Assessment; regeneration replaces every field. */
export async function replaceAssessment(record: AssessmentRecord): Promise<void> {
  await db.execute(sql`
    INSERT INTO assessments (building_id, score, alert_level, narrative, ranked, generated_at)
    VALUES (
      ${record.buildingId},
      ${record.score},
      ${record.alertLevel},
      ${record.narrative},
      ${JSON.stringify(record.ranked)}::jsonb,
      now()
    )
    ON CONFLICT (building_id) DO UPDATE SET
      score = EXCLUDED.score,
      alert_level = EXCLUDED.alert_level,
      narrative = EXCLUDED.narrative,
      ranked = EXCLUDED.ranked,
      generated_at = EXCLUDED.generated_at
  `);
}

export async function getAssessment(buildingId: string): Promise<AssessmentRecord | null> {
  const result = await db.execute(sql`
    SELECT building_id, score, alert_level, narrative, ranked
    FROM assessments
    WHERE building_id = ${buildingId}
  `);
  const row = result.rows[0];
  if (!row) return null;

  return {
    buildingId: row.building_id as string,
    score: Number(row.score),
    alertLevel: row.alert_level as AlertLevel,
    narrative: row.narrative as string,
    ranked: row.ranked as OpenHazard[],
  };
}
