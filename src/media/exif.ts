import exifr from "exifr";
import sharp from "sharp";

import type { GeoAgreement } from "../domain/confidence";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Device and EXIF fixes within this distance corroborate each other. */
export const EXIF_AGREEMENT_RADIUS_M = 100;

/**
 * Reads the embedded GPS fix when the upload still carries one.
 * Missing or malformed metadata is normal and never rejects Evidence.
 */
export async function readExifLocation(buf: Buffer | Uint8Array): Promise<LatLon | null> {
  try {
    const gps = await exifr.gps(buf);
    if (
      !gps ||
      typeof gps.latitude !== "number" ||
      !Number.isFinite(gps.latitude) ||
      gps.latitude < -90 ||
      gps.latitude > 90 ||
      typeof gps.longitude !== "number" ||
      !Number.isFinite(gps.longitude) ||
      gps.longitude < -180 ||
      gps.longitude > 180
    ) {
      return null;
    }

    return { lat: gps.latitude, lon: gps.longitude };
  } catch {
    return null;
  }
}

/**
 * Produces the derivative served below the resident tier. Sharp removes input
 * metadata unless metadata retention is explicitly requested; rotate also
 * bakes the EXIF orientation into the output pixels before that metadata goes.
 */
export async function stripExif(buf: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(buf).rotate().jpeg({ quality: 85 }).toBuffer();
}

function haversineM(a: LatLon, b: LatLon): number {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

export function compareLocations(device: LatLon, exif: LatLon | null): GeoAgreement {
  if (!exif) return "unknown";

  return haversineM(device, exif) <= EXIF_AGREEMENT_RADIUS_M ? "agree" : "disagree";
}
