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
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn(async () => {}) }));
vi.mock("../pipeline/regenerate.js", async (original) => ({
  ...(await original<typeof import("../pipeline/regenerate.js")>()),
  dispatchPendingRegenerations: dispatch,
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
    dispatch.mockClear();
    const second = await submitEvidence({
      ...shared,
      reporterId: await reporter(),
      buildingId: first.buildingId,
      deviceLocation: { lat: 28.6, lon: 77.3 },
    });
    expect(second.needsLocationConfirmation).toBe(true);
    expect(second.evidenceId).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
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

  it("accepts a distant device fix during local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      const result = await submitEvidence({
        ...base(),
        reporterId: await reporter(),
        buildingLocation: { lat: 28.54, lon: 77.21 },
        deviceLocation: { lat: 19.08, lon: 72.88 },
      });
      expect(result.needsLocationConfirmation).toBe(false);
      expect(result.evidenceId).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
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
    dispatch.mockClear();
    await submitEvidence({ ...base(), reporterId: await reporter() });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("keeps a recorded Evidence successful when dispatch is unavailable", async () => {
    dispatch.mockRejectedValueOnce(new Error("Inngest is unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await submitEvidence({ ...base(), reporterId: await reporter() });
      expect(result.evidenceId).toBeTruthy();
      await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
      const persisted = await db.execute(sql`SELECT id FROM evidence WHERE id = ${result.evidenceId!}`);
      expect(persisted.rows).toHaveLength(1);
      const outbox = await db.execute(sql`
        SELECT delivered_at
        FROM assessment_regeneration_outbox
        WHERE building_id = ${result.buildingId} AND delivered_at IS NULL
      `);
      expect(outbox.rows).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });
});
