import { buildAssessment, replaceAssessment } from "../db/assessments";
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
