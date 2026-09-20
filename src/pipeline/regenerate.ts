import { buildAssessment, replaceAssessment } from "../db/assessments";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { severityOf, type HazardTypeId } from "../domain/hazard-catalogue";
import { inngest } from "./inngest";

/** Ordinary submissions for one Building coalesce into one regeneration. */
export const REGENERATE_DEBOUNCE = "30s";
export const REGENERATE_DEBOUNCE_TIMEOUT = "5m";
const URGENT_SEVERITY = 5;

export function isUrgent(hazardTypeIds: HazardTypeId[]): boolean {
  return hazardTypeIds.some((typeId) => severityOf(typeId) >= URGENT_SEVERITY);
}

export async function requestRegeneration(input: {
  buildingId: string;
  hazardTypeIds: HazardTypeId[];
}): Promise<void> {
  await inngest.send({
    name: isUrgent(input.hazardTypeIds)
      ? "assessment/regenerate.urgent"
      : "assessment/regenerate",
    data: { buildingId: input.buildingId },
  });
}

const OUTBOX_BATCH_SIZE = 10;
const OUTBOX_LEASE_SECONDS = 60;
const OUTBOX_RETRY_SECONDS = 15;

/**
 * Delivers due database-backed requests. Receipt polling and a scheduled
 * Inngest function invoke this after a failed send.
 */
export async function dispatchPendingRegenerations({
  limit = OUTBOX_BATCH_SIZE,
  buildingId,
}: {
  limit?: number;
  buildingId?: string;
} = {}): Promise<void> {
  const leaseToken = crypto.randomUUID();
  const claimed = await db.execute(sql`
    WITH due AS (
      SELECT id
      FROM assessment_regeneration_outbox
      WHERE delivered_at IS NULL
        AND next_attempt_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
        AND (${buildingId ?? null}::uuid IS NULL OR building_id = ${buildingId ?? null}::uuid)
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE assessment_regeneration_outbox outbox
    SET lease_token = ${leaseToken}::uuid,
        lease_until = now() + (${OUTBOX_LEASE_SECONDS} * interval '1 second')
    FROM due
    WHERE outbox.id = due.id
    RETURNING outbox.id, outbox.building_id, outbox.event_name
  `);

  for (const row of claimed.rows) {
    const id = row.id as string;
    const buildingId = row.building_id as string;
    const eventName = row.event_name as "assessment/regenerate" | "assessment/regenerate.urgent";
    try {
      await inngest.send({ name: eventName, data: { buildingId } });
      await db.execute(sql`
        UPDATE assessment_regeneration_outbox
        SET delivered_at = now(), lease_token = NULL, lease_until = NULL, last_error = NULL
        WHERE id = ${id} AND lease_token = ${leaseToken}::uuid
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispatch error";
      await db.execute(sql`
        UPDATE assessment_regeneration_outbox
        SET attempts = attempts + 1,
            next_attempt_at = now() + (${OUTBOX_RETRY_SECONDS} * interval '1 second'),
            lease_token = NULL,
            lease_until = NULL,
            last_error = ${message.slice(0, 500)}
        WHERE id = ${id} AND lease_token = ${leaseToken}::uuid
      `);
    }
  }
}

async function regenerate(input: { event: { data: { buildingId: string } } }) {
  const assessment = await buildAssessment(input.event.data.buildingId, new Date());
  await replaceAssessment(assessment);
  return { buildingId: assessment.buildingId, alertLevel: assessment.alertLevel };
}

export const regenerateAssessment = inngest.createFunction(
  {
    id: "regenerate-assessment",
    triggers: [{ event: "assessment/regenerate" }],
    debounce: {
      period: REGENERATE_DEBOUNCE,
      key: "event.data.buildingId",
      timeout: REGENERATE_DEBOUNCE_TIMEOUT,
    },
  },
  regenerate,
);

/** Severity-5 evidence bypasses the debounce and is assessed immediately. */
export const regenerateAssessmentUrgent = inngest.createFunction(
  {
    id: "regenerate-assessment-urgent",
    triggers: [{ event: "assessment/regenerate.urgent" }],
  },
  regenerate,
);

/** Retries reports left pending while Inngest or its development endpoint was unavailable. */
export const retryPendingRegenerations = inngest.createFunction(
  {
    id: "retry-pending-assessment-regenerations",
    triggers: [{ cron: "*/1 * * * *" }],
  },
  async () => {
    await dispatchPendingRegenerations();
    return { retried: true };
  },
);
