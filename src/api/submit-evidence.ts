import { sql } from "drizzle-orm";
import { classifyEvidence } from "../agents/classifier";
import { db } from "../db/client";
import {
  LOCATION_CONFIRM_RADIUS_M,
  distanceToBuilding,
  resolveOrCreateBuilding,
} from "../db/buildings";
import type { GeoAgreement, SourceClass } from "../domain/confidence";
import { HAZARD_TYPE_IDS, type HazardTypeId } from "../domain/hazard-catalogue";
import { compareLocations, readExifLocation, type LatLon } from "../media/exif";
import { storeEvidenceMedia } from "../media/upload";
import { requestRegeneration } from "../pipeline/regenerate";

export interface SubmitEvidenceInput {
  reporterId?: string | undefined;
  addressText: string;
  note: string;
  sourceClass: SourceClass;
  deviceLocation: LatLon;
  buildingLocation?: LatLon | undefined;
  capturedAt: Date;
  buildingId?: string | undefined;
  media?: Buffer | undefined;
  mediaType?: "image/jpeg" | "image/png" | "image/webp" | undefined;
  confirmLocation?: boolean | undefined;
}

export interface SubmitEvidenceResult {
  evidenceId: string | null;
  buildingId: string;
  /** Used by the HTTP boundary to persist the opaque identity cookie; never sent in JSON. */
  reporterId: string | null;
  geoAgreement: GeoAgreement;
  hazardTypeIds: HazardTypeId[];
  needsLocationConfirmation: boolean;
}

const SOURCE_CLASSES = new Set<SourceClass>([
  "official_record",
  "resident_video",
  "resident_photo",
  "news_article",
  "resident_account",
  "social_post",
]);

export class EvidenceInputError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves the opaque Reporter identity kept in an HTTP-only cookie. This keeps
 * the demo frictionless without minting a fresh "independent" Reporter for each
 * submission, which would artificially raise Confidence.
 */
export async function resolvePseudonymousReporter(candidateId?: string): Promise<string> {
  if (candidateId && UUID.test(candidateId)) {
    const existing = await db.execute(sql`SELECT id FROM reporters WHERE id = ${candidateId} LIMIT 1`);
    if (existing.rows[0]) return existing.rows[0].id as string;
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  const created = await db.execute(sql`
    INSERT INTO reporters (pseudonym)
    VALUES (${`Delhi neighbour ${suffix}`})
    RETURNING id
  `);
  return created.rows[0]!.id as string;
}

export function validateEvidenceInput(input: SubmitEvidenceInput): void {
  if (!input.addressText.trim()) throw new EvidenceInputError("Building address is required");
  if (!input.note.trim()) throw new EvidenceInputError("Please describe what you observed");
  if (input.addressText.length > 300) throw new EvidenceInputError("Building address is too long");
  if (input.note.length > 2_000) throw new EvidenceInputError("Evidence description is too long");
  if (!SOURCE_CLASSES.has(input.sourceClass)) throw new EvidenceInputError("Unsupported source class");
  if (
    !Number.isFinite(input.deviceLocation.lat) ||
    !Number.isFinite(input.deviceLocation.lon) ||
    input.deviceLocation.lat < -90 ||
    input.deviceLocation.lat > 90 ||
    input.deviceLocation.lon < -180 ||
    input.deviceLocation.lon > 180
  ) {
    throw new EvidenceInputError("A valid device location is required");
  }
  if (Number.isNaN(input.capturedAt.getTime())) throw new EvidenceInputError("Captured time is invalid");
  if (input.buildingId && !UUID.test(input.buildingId)) throw new EvidenceInputError("Invalid Building id");
  if (input.buildingLocation) {
    const { lat, lon } = input.buildingLocation;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 28.4 || lat > 28.9 || lon < 76.8 || lon > 77.4) {
      throw new EvidenceInputError("Pin the Building within the Delhi map area");
    }
  }
}

/**
 * Accepts one Evidence item, links only enum-validated Hazard Types, then queues
 * Assessment regeneration off the request path. Missing EXIF is neutral.
 */
export async function submitEvidence(input: SubmitEvidenceInput): Promise<SubmitEvidenceResult> {
  validateEvidenceInput(input);

  const buildingPoint = input.buildingLocation ?? input.deviceLocation;
  const buildingId = input.buildingId ?? (await resolveOrCreateBuilding({
    lat: buildingPoint.lat,
    lon: buildingPoint.lon,
    addressText: input.addressText.trim(),
  })).id;

  const distance = await distanceToBuilding(
    buildingId,
    input.deviceLocation.lat,
    input.deviceLocation.lon,
  );
  const needsLocationConfirmation = distance > LOCATION_CONFIRM_RADIUS_M;

  // Stop before media storage, model calls, or Evidence/Hazard writes. A second,
  // explicit request is required to confirm the distant claimed Building.
  if (needsLocationConfirmation && !input.confirmLocation) {
    return {
      evidenceId: null,
      buildingId,
      reporterId: null,
      geoAgreement: "unknown",
      hazardTypeIds: [],
      needsLocationConfirmation: true,
    };
  }

  const reporterId = await resolvePseudonymousReporter(input.reporterId);

  const exifLocation = input.media ? await readExifLocation(input.media) : null;
  const geoAgreement = compareLocations(input.deviceLocation, exifLocation);
  const mediaKeys = input.media
    ? await storeEvidenceMedia(input.media, `${buildingId}/${crypto.randomUUID()}`, input.mediaType ?? "image/jpeg")
    : null;

  const classification = await classifyEvidence({
    note: input.note.trim(),
    sourceClass: input.sourceClass,
  });
  const allowed = new Set<string>(HAZARD_TYPE_IDS);
  const hazardTypeIds = [...new Set(classification.hazardTypeIds.filter((id) => allowed.has(id)))];

  const evidence = await db.execute(sql`
    INSERT INTO evidence (
      building_id, reporter_id, source_class, note, captured_at,
      device_location, exif_location, geo_agreement, s3_key_original, s3_key_public
    )
    VALUES (
      ${buildingId},
      ${reporterId},
      ${input.sourceClass},
      ${input.note.trim()},
      ${input.capturedAt.toISOString()},
      ST_SetSRID(ST_MakePoint(${input.deviceLocation.lon}, ${input.deviceLocation.lat}), 4326)::geography,
      ${exifLocation
        ? sql`ST_SetSRID(ST_MakePoint(${exifLocation.lon}, ${exifLocation.lat}), 4326)::geography`
        : null},
      ${geoAgreement},
      ${mediaKeys?.originalKey ?? null},
      ${mediaKeys?.publicKey ?? null}
    )
    RETURNING id
  `);
  const evidenceId = evidence.rows[0]!.id as string;

  for (const typeId of hazardTypeIds) {
    const hazard = await db.execute(sql`
      INSERT INTO hazards (building_id, type_id)
      VALUES (${buildingId}, ${typeId})
      ON CONFLICT (building_id, type_id)
      DO UPDATE SET status = 'open', resolved_at = NULL
      RETURNING id
    `);
    await db.execute(sql`
      INSERT INTO evidence_hazards (evidence_id, hazard_id)
      VALUES (${evidenceId}, ${hazard.rows[0]!.id})
      ON CONFLICT DO NOTHING
    `);
  }

  // Assessment generation is intentionally never done in the request path.
  await requestRegeneration({ buildingId, hazardTypeIds });

  return {
    evidenceId,
    buildingId,
    reporterId,
    geoAgreement,
    hazardTypeIds,
    needsLocationConfirmation: false,
  };
}
