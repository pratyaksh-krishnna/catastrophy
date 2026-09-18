import { sql } from "drizzle-orm";
import { getAssessment } from "../../../db/assessments";
import { db } from "../../../db/client";
import { HAZARD_CATALOGUE } from "../../../domain/hazard-catalogue";
import type { AlertLevel } from "../../../domain/score";
import { authoritiesNeedingEscalation, type PreviousEscalation } from "../../../escalation/eligibility";

type SupportLabel = "well corroborated" | "some corroboration" | "single unconfirmed report";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BuildingDetail {
  buildingId: string;
  addressText: string;
  alertLevel: AlertLevel;
  narrative: string;
  hazards: Array<{ label: string; support: SupportLabel }>;
  escalations: Array<{ authority: string; status: string; externalTicket: string | null }>;
  needsEscalation: boolean;
}

/** Exact Building detail requires approved residency or an approved Office-bearer. */
export async function reporterCanAccessBuilding(reporterId: string, buildingId: string): Promise<boolean> {
  if (!UUID.test(reporterId) || !UUID.test(buildingId)) return false;
  const result = await db.execute(sql`
    SELECT 1
    FROM buildings b
    WHERE b.id = ${buildingId}
      AND (
        EXISTS (
          SELECT 1 FROM building_residents r
          WHERE r.building_id = b.id AND r.reporter_id = ${reporterId}
        )
        OR EXISTS (
          SELECT 1 FROM office_bearers ob
          WHERE ob.society_id = b.society_id
            AND ob.reporter_id = ${reporterId}
            AND ob.approved_at IS NOT NULL
        )
      )
    LIMIT 1
  `);
  return Boolean(result.rows[0]);
}

export async function officeBearerForBuilding(reporterId: string, buildingId: string): Promise<boolean> {
  if (!UUID.test(reporterId) || !UUID.test(buildingId)) return false;
  const result = await db.execute(sql`
    SELECT 1
    FROM buildings b
    JOIN office_bearers ob ON ob.society_id = b.society_id
    WHERE b.id = ${buildingId}
      AND ob.reporter_id = ${reporterId}
      AND ob.approved_at IS NOT NULL
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
  const escalations = await db.execute(sql`
    SELECT DISTINCT ON (authority) authority, status, external_ticket, snapshot
    FROM escalations
    WHERE building_id = ${buildingId}
    ORDER BY authority, sent_at DESC, id DESC
  `);

  return {
    buildingId,
    addressText: row.address_text as string,
    alertLevel: assessment.alertLevel,
    narrative: assessment.narrative,
    hazards: assessment.ranked.map((hazard) => ({
      label: HAZARD_CATALOGUE[hazard.typeId].label,
      support: supportLabel(hazard.confidence),
    })),
    escalations: escalations.rows.map((escalation) => ({
      authority: escalation.authority as string,
      status: escalation.status as string,
      externalTicket: escalation.external_ticket as string | null,
    })),
    needsEscalation: authoritiesNeedingEscalation(
      assessment,
      escalations.rows as unknown as PreviousEscalation[],
    ).length > 0,
  };
}
