import { sql } from "drizzle-orm";
import ngeohash from "ngeohash";
import { db } from "../db/client";
import { suppressCells, type ReportedPoint } from "../domain/cells";

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** The deliberately narrow shape exposed to unauthenticated callers. */
export interface PublicCell {
  geohash: string;
  precision: number;
  intensity: number;
}

export const DEFAULT_DELHI_BBOX: Readonly<BBox> = {
  minLat: 28.4,
  minLon: 76.8,
  maxLat: 28.9,
  maxLon: 77.4,
};

export const MIN_PUBLIC_PRECISION = 4;
export const MAX_PUBLIC_PRECISION = 7;

export function assertBBox(bbox: BBox): void {
  const values = [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon];
  if (!values.every(Number.isFinite)) throw new Error("Bounding box values must be finite numbers");
  if (bbox.minLat < -90 || bbox.maxLat > 90 || bbox.minLon < -180 || bbox.maxLon > 180) {
    throw new Error("Bounding box values are outside valid latitude/longitude ranges");
  }
  if (bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) {
    throw new Error("Bounding box minimums must be less than maximums");
  }
}

export function normalizePrecision(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Precision must be a finite number");
  return Math.min(MAX_PUBLIC_PRECISION, Math.max(MIN_PUBLIC_PRECISION, Math.trunc(value)));
}

/**
 * Returns heat only: no address, point, Score, or underlying Building count can
 * cross this boundary. Sparse cells are merged or discarded by suppressCells.
 */
export async function publicHeatmap(bbox: BBox, precision: number): Promise<PublicCell[]> {
  assertBBox(bbox);
  const safePrecision = normalizePrecision(precision);

  // Suppression must run over a fixed population. Applying the caller's bbox in
  // SQL would let an attacker slide an edge across the map and infer when the
  // hidden Building count crossed k.
  const rows = await db.execute(sql`
    SELECT
      b.id,
      ST_Y(b.location::geometry) AS lat,
      ST_X(b.location::geometry) AS lon,
      a.score
    FROM buildings b
    JOIN assessments a ON a.building_id = b.id
    WHERE b.location && ST_MakeEnvelope(
      ${DEFAULT_DELHI_BBOX.minLon}, ${DEFAULT_DELHI_BBOX.minLat},
      ${DEFAULT_DELHI_BBOX.maxLon}, ${DEFAULT_DELHI_BBOX.maxLat}, 4326
    )::geography
  `);

  const points: ReportedPoint[] = rows.rows.map((row) => ({
    buildingId: row.id as string,
    lat: Number(row.lat),
    lon: Number(row.lon),
    score: Number(row.score),
  }));

  // buildingCount exists only inside the suppression algorithm and is dropped here.
  return suppressCells(points, safePrecision)
    .filter((cell) => cellIntersectsBBox(cell.geohash, bbox))
    .map(({ geohash, precision: cellPrecision, intensity }) => ({
      geohash,
      precision: cellPrecision,
      intensity,
    }));
}

function cellIntersectsBBox(geohash: string, bbox: BBox): boolean {
  const [cellMinLat, cellMinLon, cellMaxLat, cellMaxLon] = ngeohash.decode_bbox(geohash);
  return !(
    cellMaxLat < bbox.minLat ||
    cellMinLat > bbox.maxLat ||
    cellMaxLon < bbox.minLon ||
    cellMinLon > bbox.maxLon
  );
}
