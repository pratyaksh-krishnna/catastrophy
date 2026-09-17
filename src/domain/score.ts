import { severityOf, type HazardTypeId, type Severity } from "./hazard-catalogue.js";

export type AlertLevel = "monitor" | "act" | "escalated" | "critical";

export interface OpenHazard {
  typeId: HazardTypeId;
  confidence: number;
}

/** Severity times Confidence, normalised. The whole of ADR-0001 in one line. */
export function hazardRisk(hazard: OpenHazard): number {
  return (severityOf(hazard.typeId) / 5) * hazard.confidence;
}

/** Internal only. Never returned from an API route or rendered. */
export function buildingScore(hazards: OpenHazard[]): number {
  let combined = 0;
  for (const hazard of hazards) combined = 1 - (1 - combined) * (1 - hazardRisk(hazard));
  return Math.min(1, combined);
}

export function rankHazards(hazards: OpenHazard[]): OpenHazard[] {
  return [...hazards].sort((a, b) => hazardRisk(b) - hazardRisk(a));
}

const BANDS: ReadonlyArray<{ level: AlertLevel; minScore: number; minSeverity: Severity }> = [
  { level: "critical", minScore: 0.7, minSeverity: 5 },
  { level: "escalated", minScore: 0.4, minSeverity: 4 },
  { level: "act", minScore: 0.15, minSeverity: 1 },
];

/**
 * Bands the Score, then holds the band behind a matching Severity. Forty cracked
 * plaster reports are not an imminent collapse, and must never present as one.
 */
export function alertLevel(hazards: OpenHazard[]): AlertLevel {
  if (hazards.length === 0) return "monitor";
  const score = buildingScore(hazards);
  const maxSeverity = Math.max(...hazards.map((h) => severityOf(h.typeId)));
  for (const band of BANDS) {
    if (score >= band.minScore && maxSeverity >= band.minSeverity) return band.level;
  }
  return "monitor";
}
