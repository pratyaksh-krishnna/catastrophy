import type { AssessmentRecord } from "../db/assessments";
import type { AuthorityId } from "../domain/hazard-catalogue";
import { routeAuthorities } from "./routing";

export interface PreviousEscalation {
  authority: AuthorityId;
  snapshot: AssessmentRecord;
}

const LEVEL_ORDER = { monitor: 0, act: 1, escalated: 2, critical: 3 } as const;

/** A new snapshot is sent only when risk rises or a new Hazard appears. */
export function authoritiesNeedingEscalation(
  current: AssessmentRecord,
  previous: PreviousEscalation[],
): AuthorityId[] {
  const lastByAuthority = new Map(previous.map((item) => [item.authority, item.snapshot]));
  return routeAuthorities(current.ranked).filter((authority) => {
    const last = lastByAuthority.get(authority);
    if (!last) return true;
    if (LEVEL_ORDER[current.alertLevel] > LEVEL_ORDER[last.alertLevel]) return true;
    if (current.score > last.score + 1e-6) return true;
    const previousHazards = new Set(last.ranked.map((hazard) => hazard.typeId));
    return current.ranked.some((hazard) => !previousHazards.has(hazard.typeId));
  });
}
