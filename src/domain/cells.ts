import ngeohash from "ngeohash";

/** ADR-0002: a cell renders only once this many distinct Buildings fall inside it. */
export const K_SUPPRESSION = 5;

/** Coarsest cell we will merge up to. Below this, the area is simply not shown. */
export const MIN_PRECISION = 4;

export interface ReportedPoint {
  buildingId: string;
  lat: number;
  lon: number;
  /** Internal Score. Aggregated into intensity; never emitted. */
  score: number;
}

export interface RenderedCell {
  geohash: string;
  precision: number;
  /** Server-side only. ADR-0002 forbids sending this to a public caller. */
  buildingCount: number;
  intensity: number;
}

/**
 * Buckets points into geohash cells at the requested precision, then merges any
 * cell holding fewer than k distinct Buildings into its parent, repeating until
 * every rendered cell clears the threshold. A hot cell in a sparse area is an
 * address, so a cell that never clears it is dropped rather than shown coarsely.
 */
export function suppressCells(
  points: ReportedPoint[],
  startPrecision: number,
  k: number = K_SUPPRESSION,
): RenderedCell[] {
  const byBuilding = new Map<string, ReportedPoint>();
  for (const p of points) byBuilding.set(p.buildingId, p);

  let pending = [...byBuilding.values()];
  const rendered: RenderedCell[] = [];

  for (let precision = startPrecision; precision >= MIN_PRECISION; precision--) {
    const groups = new Map<string, ReportedPoint[]>();
    for (const p of pending) {
      const hash = ngeohash.encode(p.lat, p.lon, precision);
      (groups.get(hash) ?? groups.set(hash, []).get(hash)!).push(p);
    }

    const carried: ReportedPoint[] = [];
    for (const [geohash, members] of groups) {
      if (members.length >= k) {
        rendered.push({
          geohash,
          precision,
          buildingCount: members.length,
          intensity: aggregateIntensity(members),
        });
      } else {
        carried.push(...members);
      }
    }
    pending = carried;
    if (pending.length === 0) break;
  }

  return rendered;
}

/** Noisy-OR of member Scores, so intensity reflects risk rather than headcount. */
function aggregateIntensity(members: ReportedPoint[]): number {
  let combined = 0;
  for (const m of members) combined = 1 - (1 - combined) * (1 - Math.max(0, Math.min(1, m.score)));
  return Math.min(1, combined);
}
