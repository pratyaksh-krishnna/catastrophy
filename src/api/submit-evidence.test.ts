import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { submitEvidence } from "./submit-evidence.js";

vi.mock("../agents/classifier.js", () => ({
  classifyEvidence: vi.fn(async () => ({
    hazardTypeIds: ["load_bearing_crack"],
    rationale: "crack",
  })),
}));
vi.mock("../media/upload.js", () => ({
  storeEvidenceMedia: vi.fn(async () => ({ originalKey: "original/x", publicKey: "public/x" })),
}));
const { regenerate } = vi.hoisted(() => ({ regenerate: vi.fn(async () => {}) }));
vi.mock("../pipeline/regenerate.js", async (original) => ({
  ...(await original<typeof import("../pipeline/regenerate.js")>()),
  requestRegeneration: regenerate,
}));

afterAll(async () => { await pool.end(); });

async function reporter(): Promise<string> {
  const row = await db.execute(sql`INSERT INTO reporters (pseudonym) VALUES ('anon') RETURNING id`);
  return row.rows[0]!.id as string;
}

const base = () => ({
  reporterId: "",
  addressText: `S${Math.random().toString(36).slice(2, 8)} Marg`,
  note: "long diagonal crack",
  sourceClass: "resident_photo" as const,
  deviceLocation: { lat: 28.5677, lon: 77.2432 },
  capturedAt: new Date(),
});

describe("submitEvidence", () => {
  it("accepts Evidence with no media or EXIF rather than rejecting it", async () => {
    const result = await submitEvidence({ ...base(), reporterId: await reporter() });
    expect(result.evidenceId).toBeTruthy();
    expect(result.geoAgreement).toBe("unknown");
  });

  it("opens the classified Hazards against the Building", async () => {
    const result = await submitEvidence({ ...base(), reporterId: await reporter() });
    const rows = await db.execute(sql`SELECT type_id FROM hazards WHERE building_id = ${result.buildingId}`);
    expect(rows.rows.map((row) => row.type_id)).toContain("load_bearing_crack");
  });

  it("asks for confirmation when the device fix is far from a claimed Building", async () => {
    const shared = base();
    const first = await submitEvidence({ ...shared, reporterId: await reporter() });
    const before = await db.execute(sql`SELECT count(*)::int AS n FROM evidence WHERE building_id = ${first.buildingId}`);
    regenerate.mockClear();
    const second = await submitEvidence({
      ...shared,
      reporterId: await reporter(),
      buildingId: first.buildingId,
      deviceLocation: { lat: 28.6, lon: 77.3 },
    });
    expect(second.needsLocationConfirmation).toBe(true);
    expect(second.evidenceId).toBeNull();
    expect(regenerate).not.toHaveBeenCalled();
    const after = await db.execute(sql`SELECT count(*)::int AS n FROM evidence WHERE building_id = ${first.buildingId}`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    const confirmed = await submitEvidence({
      ...shared,
      reporterId: await reporter(),
      buildingId: first.buildingId,
      deviceLocation: { lat: 28.6, lon: 77.3 },
      confirmLocation: true,
    });
    expect(confirmed.evidenceId).toBeTruthy();
    expect(confirmed.needsLocationConfirmation).toBe(false);
  });

  it("uses the pinned Building point separately from the device fix", async () => {
    const input = {
      ...base(),
      reporterId: await reporter(),
      buildingLocation: { lat: 28.54, lon: 77.21 },
      deviceLocation: { lat: 28.60, lon: 77.30 },
    };
    const pending = await submitEvidence(input);
    expect(pending.needsLocationConfirmation).toBe(true);
    expect(pending.evidenceId).toBeNull();
    const location = await db.execute(sql`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
      FROM buildings WHERE id = ${pending.buildingId}
    `);
    expect(Number(location.rows[0]!.lat)).toBeCloseTo(input.buildingLocation.lat);
    expect(Number(location.rows[0]!.lon)).toBeCloseTo(input.buildingLocation.lon);
  });

  it("queues regeneration instead of building an Assessment in the request", async () => {
    regenerate.mockClear();
    await submitEvidence({ ...base(), reporterId: await reporter() });
    expect(regenerate).toHaveBeenCalledOnce();
  });
});
