import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { sql } from "drizzle-orm";
import type { AssessmentRecord } from "../db/assessments";
import { db } from "../db/client";
import { HAZARD_CATALOGUE, type AuthorityId } from "../domain/hazard-catalogue";
import { routeAuthorities } from "./routing";

const ses = new SESClient(
  process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {},
);

/**
 * Delhi authorities have no submission API. Store the immutable Assessment
 * snapshot, then send an email of record and a complaint suitable for hand filing.
 */
export async function sendEscalation(input: {
  buildingId: string;
  addressText: string;
  assessment: AssessmentRecord;
}): Promise<string[]> {
  if (input.assessment.buildingId !== input.buildingId) {
    throw new Error("Assessment does not belong to the Building being escalated");
  }

  const authorities = routeAuthorities(input.assessment.ranked);
  if (authorities.length === 0) return [];

  // Validate delivery configuration before writing anything that claims to be sent.
  const source = requiredEnvironment("SES_FROM");
  const inbox = requiredEnvironment("ESCALATION_INBOX");
  const escalationIds: string[] = [];
  for (const authority of authorities) {
    const escalationId = await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO escalations (building_id, authority, snapshot)
        VALUES (
          ${input.buildingId},
          ${authority},
          ${JSON.stringify(input.assessment)}::jsonb
        )
        RETURNING id
      `);
      const id = inserted.rows[0]?.id as string | undefined;
      if (!id) throw new Error("Failed to create escalation");

      // The insert and delivery share one unit of work so an SES rejection does
      // not leave a database row falsely marked as sent.
      await ses.send(
        new SendEmailCommand({
          Source: source,
          Destination: { ToAddresses: [inbox] },
          Message: {
            Subject: {
              Data: `[${input.assessment.alertLevel.toUpperCase()}] ${input.addressText} — ref ${id}`,
            },
            Body: {
              Text: {
                Data: complaintBody(input.addressText, input.assessment, authority, id),
              },
            },
          },
        }),
      );
      return id;
    });
    escalationIds.push(escalationId);
  }
  return escalationIds;
}

function complaintBody(
  addressText: string,
  assessment: AssessmentRecord,
  authority: AuthorityId,
  reference: string,
): string {
  const hazards = assessment.ranked
    .map((hazard, index) => {
      const type = HAZARD_CATALOGUE[hazard.typeId];
      return `${index + 1}. ${type.label}${type.byelawRef ? ` [${type.byelawRef}]` : ""}`;
    })
    .join("\n");

  return [
    `Building: ${addressText}`,
    `Alert level: ${assessment.alertLevel}`,
    `Reference: ${reference}`,
    `Addressed to: ${authority.toUpperCase()}`,
    "",
    "Problems on record, most serious first:",
    hazards || "none",
    "",
    assessment.narrative,
    "",
    "This report was generated from resident-submitted evidence. Reply to this address",
    "to acknowledge, or quote the reference above when raising a ticket.",
  ].join("\n");
}

function requiredEnvironment(name: "SES_FROM" | "ESCALATION_INBOX"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function recordExternalTicket(escalationId: string, ticket: string): Promise<void> {
  await db.execute(sql`
    UPDATE escalations
    SET external_ticket = ${ticket}
    WHERE id = ${escalationId}
  `);
}

export async function acknowledgeEscalation(escalationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE escalations
    SET status = 'acknowledged', acknowledged_at = now()
    WHERE id = ${escalationId}
  `);
}
