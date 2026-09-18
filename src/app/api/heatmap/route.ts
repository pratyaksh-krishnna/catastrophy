import { NextResponse } from "next/server";
import {
  DEFAULT_DELHI_BBOX,
  assertBBox,
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
  let bbox: BBox;
  let precision: number;
  try {
    const params = new URL(request.url).searchParams;
    bbox = {
      minLat: optionalNumber(params, "minLat", DEFAULT_DELHI_BBOX.minLat),
      minLon: optionalNumber(params, "minLon", DEFAULT_DELHI_BBOX.minLon),
      maxLat: optionalNumber(params, "maxLat", DEFAULT_DELHI_BBOX.maxLat),
      maxLon: optionalNumber(params, "maxLon", DEFAULT_DELHI_BBOX.maxLon),
    };
    assertBBox(bbox);
    const rawPrecision = params.get("precision");
    precision = normalizePrecision(rawPrecision === null ? 7 : Number(rawPrecision));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid heatmap request" },
      { status: 400 },
    );
  }

  try {
    const cells = await publicHeatmap(bbox, precision);
    return NextResponse.json(
      { cells },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("Heatmap query failed", error);
    return NextResponse.json({ error: "Heatmap unavailable" }, { status: 503 });
  }
}
