import { NextResponse } from "next/server";
import {
  DEFAULT_DELHI_BBOX,
  normalizePrecision,
  publicHeatmap,
  type BBox,
} from "../../../api/heatmap";

function optionalNumber(params: URLSearchParams, name: keyof BBox, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const bbox: BBox = {
      minLat: optionalNumber(params, "minLat", DEFAULT_DELHI_BBOX.minLat),
      minLon: optionalNumber(params, "minLon", DEFAULT_DELHI_BBOX.minLon),
      maxLat: optionalNumber(params, "maxLat", DEFAULT_DELHI_BBOX.maxLat),
      maxLon: optionalNumber(params, "maxLon", DEFAULT_DELHI_BBOX.maxLon),
    };
    const rawPrecision = params.get("precision");
    const precision = normalizePrecision(rawPrecision === null ? 7 : Number(rawPrecision));
    const cells = await publicHeatmap(bbox, precision);

    return NextResponse.json(
      { cells },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid heatmap request" },
      { status: 400 },
    );
  }
}
