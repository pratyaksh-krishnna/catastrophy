import {
  HAZARD_CATALOGUE,
  severityOf,
  type AuthorityId,
} from "../domain/hazard-catalogue";
import type { OpenHazard } from "../domain/score";

const IMMINENT_SEVERITY = 5;

/** Route catalogue authorities, adding both DDMA and MCD for any Severity-5 Hazard. */
export function routeAuthorities(ranked: OpenHazard[]): AuthorityId[] {
  const authorities = new Set<AuthorityId>();
  for (const hazard of ranked) {
    authorities.add(HAZARD_CATALOGUE[hazard.typeId].authority);
    if (severityOf(hazard.typeId) >= IMMINENT_SEVERITY) {
      authorities.add("ddma");
      authorities.add("mcd");
    }
  }
  return [...authorities];
}
