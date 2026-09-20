import { sql } from "drizzle-orm";
import { db } from "../db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EvidenceStatus {
  evidenceId: string;
  status: "processing" | "assessed";
  receivedAt: string;
}

/** Reporter projection: no Building id, address, Hazard, Alert Level, or Score. */
export async function reporterEvidenceStatus(reporterId: string, evidenceId: string): Promise<EvidenceStatus | null> {
  if (!UUID.test(reporterId) || !UUID.test(evidenceId)) return null;
  const result = await db.execute(sql`
    SELECT e.id, e.created_at,
      (a.generated_at IS NOT NULL AND a.generated_at >= e.created_at) AS assessed
    FROM evidence e
    LEFT JOIN assessments a ON a.building_id = e.building_id
    WHERE e.id = ${evidenceId} AND e.reporter_id = ${reporterId}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    evidenceId: row.id as string,
    status: row.assessed ? "assessed" : "processing",
    receivedAt: new Date(row.created_at as Date | string).toISOString(),
  };
}

/** Only an approved resident or Office-bearer gets a route to exact detail. */
export async function approvedBuildingForEvidence(reporterId: string, evidenceId: string): Promise<string | null> {
  if (!UUID.test(reporterId) || !UUID.test(evidenceId)) return null;
  const result = await db.execute(sql`
    SELECT e.building_id
    FROM evidence e
    JOIN buildings b ON b.id = e.building_id
    WHERE e.id = ${evidenceId}
      AND e.reporter_id = ${reporterId}
      AND (
        EXISTS (
          SELECT 1 FROM building_residents r
          WHERE r.building_id = b.id
            AND r.reporter_id = e.reporter_id
            AND r.approved_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1 FROM office_bearers ob
          WHERE ob.society_id = b.society_id
            AND ob.reporter_id = e.reporter_id
            AND ob.approved_at IS NOT NULL
        )
      )
    LIMIT 1
  `);
  return result.rows[0]?.building_id as string | undefined ?? null;
}
