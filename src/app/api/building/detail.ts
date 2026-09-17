import { sql } from "drizzle-orm";
import { getAssessment } from "../../../db/assessments";
import { db } from "../../../db/client";
import { HAZARD_CATALOGUE } from "../../../domain/hazard-catalogue";
import type { AlertLevel } from "../../../domain/score";

type SupportLabel = "well corroborated" | "some corroboration" | "single unconfirmed report";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BuildingDetail {
  buildingId: string;
  addressText: string;
  alertLevel: AlertLevel;
  narrative: string;
  hazards: Array<{ label: string; support: SupportLabel }>;
}

/** Exact Building detail is available only to a Reporter linked to its Evidence. */
export async function reporterCanAccessBuilding(reporterId: string, buildingId: string): Promise<boolean> {
  if (!UUID.test(reporterId) || !UUID.test(buildingId)) return false;
  const result = await db.execute(sql`
    SELECT 1
    FROM evidence
    WHERE reporter_id = ${reporterId} AND building_id = ${buildingId}
    LIMIT 1
  `);
  return Boolean(result.rows[0]);
}

function supportLabel(confidence: number): SupportLabel {
  if (confidence >= 0.7) return "well corroborated";
  if (confidence >= 0.4) return "some corroboration";
  return "single unconfirmed report";
}

/** Resident-facing projection. Internal Score is intentionally absent. */
export async function buildingDetail(buildingId: string): Promise<BuildingDetail | null> {
  const assessment = await getAssessment(buildingId);
  if (!assessment) return null;

  const building = await db.execute(sql`
    SELECT address_text FROM buildings WHERE id = ${buildingId} LIMIT 1
  `);
  const row = building.rows[0];
  if (!row) return null;

  return {
    buildingId,
    addressText: row.address_text as string,
    alertLevel: assessment.alertLevel,
    narrative: assessment.narrative,
    hazards: assessment.ranked.map((hazard) => ({
      label: HAZARD_CATALOGUE[hazard.typeId].label,
      support: supportLabel(hazard.confidence),
    })),
  };
}
