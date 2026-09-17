import { sql } from "drizzle-orm";
import { db } from "./client";

/** Two pins closer than this with a similar address are taken to be one Building. */
export const DEDUPE_RADIUS_M = 25;
/** Beyond this from the claimed Building, ask the submitter to confirm. */
export const LOCATION_CONFIRM_RADIUS_M = 150;
/** trigram similarity floor for treating two address strings as the same place */
export const ADDRESS_SIMILARITY = 0.3;

export interface BuildingInput {
  lat: number;
  lon: number;
  addressText: string;
  societyId?: string;
}

export interface ResolvedBuilding {
  id: string;
  created: boolean;
}

export async function findNearbyBuilding(
  lat: number,
  lon: number,
  addressText: string,
): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT id
    FROM buildings
    WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${DEDUPE_RADIUS_M})
      AND similarity(address_text, ${addressText}) >= ${ADDRESS_SIMILARITY}
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
    LIMIT 1
  `);
  const row = r.rows[0];
  return row ? (row.id as string) : null;
}

export async function resolveOrCreateBuilding(input: BuildingInput): Promise<ResolvedBuilding> {
  const existing = await findNearbyBuilding(input.lat, input.lon, input.addressText);
  if (existing) return { id: existing, created: false };

  const r = await db.execute(sql`
    INSERT INTO buildings (society_id, address_text, location)
    VALUES (
      ${input.societyId ?? null},
      ${input.addressText},
      ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography
    )
    RETURNING id
  `);
  return { id: r.rows[0]!.id as string, created: true };
}

export async function distanceToBuilding(buildingId: string, lat: number, lon: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS d
    FROM buildings WHERE id = ${buildingId}
  `);
  return Number(r.rows[0]!.d);
}
