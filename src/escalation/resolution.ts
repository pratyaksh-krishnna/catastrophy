import { sql } from "drizzle-orm";
import { getAssessment } from "../db/assessments";
import { db } from "../db/client";

/** How long any Reporter has to dispute a claim before it takes effect. */
export const CONTEST_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface ResolutionClaim {
  id: string;
  hazardId: string;
  contestUntil: Date;
}

interface ClaimContextRow {
  building_id: string;
  building_society_id: string | null;
  hazard_status: string;
  opened_at: Date | string;
  evidence_building_id: string;
  evidence_captured_at: Date | string;
  office_bearer_society_id: string;
  approved_at: Date | string | null;
}

/**
 * A claim needs an approved Office-bearer and fresh Evidence from the same
 * Building. It remains non-executing until its contest window closes.
 */
export async function claimResolution(input: {
  hazardId: string;
  officeBearerId: string;
  evidenceId: string;
}): Promise<ResolutionClaim> {
  const contextResult = await db.execute(sql`
    SELECT
      h.building_id,
      b.society_id AS building_society_id,
      h.status AS hazard_status,
      h.opened_at,
      e.building_id AS evidence_building_id,
      e.captured_at AS evidence_captured_at,
      ob.society_id AS office_bearer_society_id,
      ob.approved_at
    FROM hazards h
    JOIN buildings b ON b.id = h.building_id
    JOIN evidence e ON e.id = ${input.evidenceId}
    JOIN office_bearers ob ON ob.id = ${input.officeBearerId}
    WHERE h.id = ${input.hazardId}
  `);
  const context = contextResult.rows[0] as unknown as ClaimContextRow | undefined;
  if (!context) throw new Error("No such Hazard, Evidence, or Office-bearer");
  if (!context.approved_at) throw new Error("Office-bearer is not approved");
  if (!context.building_society_id) {
    throw new Error("Building is not assigned to a Society");
  }
  if (context.building_society_id !== context.office_bearer_society_id) {
    throw new Error("Office-bearer does not represent this Building's Society");
  }
  if (context.hazard_status !== "open") throw new Error("Hazard is not open");
  if (context.evidence_building_id !== context.building_id) {
    throw new Error("Resolution Evidence must belong to the Hazard's Building");
  }
  if (new Date(context.evidence_captured_at) < new Date(context.opened_at)) {
    throw new Error("Resolution Evidence must be fresh");
  }

  const assessment = await getAssessment(context.building_id);
  if (assessment?.alertLevel === "critical") {
    throw new Error("A Building at critical cannot be resolved by claim");
  }

  const contestUntil = new Date(Date.now() + CONTEST_WINDOW_MS);
  const inserted = await db.execute(sql`
    INSERT INTO resolution_claims (
      hazard_id,
      office_bearer_id,
      evidence_id,
      contest_until
    )
    SELECT
      ${input.hazardId},
      ${input.officeBearerId},
      ${input.evidenceId},
      ${contestUntil.toISOString()}
    WHERE NOT EXISTS (
      SELECT 1
      FROM resolution_claims
      WHERE hazard_id = ${input.hazardId}
        AND status IN ('pending', 'disputed')
    )
    RETURNING id
  `);
  const id = inserted.rows[0]?.id as string | undefined;
  if (!id) throw new Error("An active Resolution Claim already exists for this Hazard");
  return { id, hazardId: input.hazardId, contestUntil };
}

/** A dispute rejects an active claim and explicitly keeps its Hazard open. */
export async function disputeClaim(claimId: string): Promise<void> {
  const result = await db.execute(sql`
    WITH disputed AS (
      UPDATE resolution_claims
      SET status = 'disputed'
      WHERE id = ${claimId}
        AND status = 'pending'
        AND contest_until > now()
      RETURNING hazard_id
    )
    UPDATE hazards h
    SET status = 'open', resolved_at = NULL
    FROM disputed d
    WHERE h.id = d.hazard_id
    RETURNING h.id
  `);
  if (result.rows.length === 0) throw new Error("No active Resolution Claim to dispute");
}

/** Apply an uncontested claim only after its window closes. */
export async function settleClaim(
  claimId: string,
  now: Date,
): Promise<"resolved" | "reopened" | "pending"> {
  const result = await db.execute(sql`
    SELECT rc.hazard_id, rc.status, rc.contest_until, rc.created_at, h.building_id
    FROM resolution_claims rc
    JOIN hazards h ON h.id = rc.hazard_id
    WHERE rc.id = ${claimId}
  `);
  const claim = result.rows[0];
  if (!claim) throw new Error("No such Resolution Claim");

  if (now < new Date(claim.contest_until as Date | string)) return "pending";

  if (claim.status === "disputed" || claim.status === "rejected") {
    await db.execute(sql`
      UPDATE resolution_claims
      SET status = 'rejected'
      WHERE id = ${claimId} AND status = 'disputed'
    `);
    return "reopened";
  }
  if (claim.status === "accepted") return "resolved";
  if (claim.status !== "pending") {
    throw new Error(`Resolution Claim cannot be settled from status ${String(claim.status)}`);
  }

  const assessment = await getAssessment(claim.building_id as string);
  if (!assessment) {
    throw new Error("Cannot settle a Resolution Claim without a current Assessment");
  }
  if (assessment.alertLevel === "critical") {
    throw new Error("A Building at critical cannot be resolved by claim");
  }

  const outcome = await db.transaction(async (tx) => {
    // Evidence submission updates the Hazard row before linking Evidence. This
    // lock therefore orders settlement against a concurrent submission: either
    // we see the link, or the later submission reopens the Hazard after commit.
    const locked = await tx.execute(sql`
      SELECT h.id
      FROM hazards h
      JOIN resolution_claims rc ON rc.hazard_id = h.id
      WHERE rc.id = ${claimId}
      FOR UPDATE OF h, rc
    `);
    if (!locked.rows[0]) throw new Error("No such Resolution Claim");

    const newerEvidence = await tx.execute(sql`
      SELECT 1
      FROM resolution_claims rc
      JOIN evidence_hazards eh ON eh.hazard_id = rc.hazard_id
      JOIN evidence e ON e.id = eh.evidence_id
      WHERE rc.id = ${claimId}
        AND e.created_at > rc.created_at
      LIMIT 1
    `);
    if (newerEvidence.rows[0]) {
      await tx.execute(sql`
        UPDATE resolution_claims
        SET status = 'rejected'
        WHERE id = ${claimId} AND status = 'pending'
      `);
      await tx.execute(sql`
        UPDATE hazards
        SET status = 'open', resolved_at = NULL
        WHERE id = ${claim.hazard_id as string}
      `);
      return "reopened" as const;
    }

    const accepted = await tx.execute(sql`
      UPDATE resolution_claims
      SET status = 'accepted'
      WHERE id = ${claimId}
        AND status = 'pending'
        AND contest_until <= ${now.toISOString()}
      RETURNING hazard_id
    `);
    const hazardId = accepted.rows[0]?.hazard_id as string | undefined;
    if (!hazardId) return null;
    await tx.execute(sql`
      UPDATE hazards
      SET status = 'resolved', resolved_at = ${now.toISOString()}
      WHERE id = ${hazardId}
    `);
    return "resolved" as const;
  });
  if (outcome) return outcome;

  // A dispute may have won the row lock between the initial read and the
  // conditional acceptance above. Report the state that actually persisted.
  const latest = await db.execute(sql`
    SELECT status FROM resolution_claims WHERE id = ${claimId}
  `);
  if (latest.rows[0]?.status === "accepted") return "resolved";
  if (latest.rows[0]?.status === "disputed" || latest.rows[0]?.status === "rejected") {
    return "reopened";
  }
  return "pending";
}
