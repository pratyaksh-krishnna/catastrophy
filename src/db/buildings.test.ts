import { describe, it, expect, afterAll } from "vitest";
import { pool } from "./client.js";
import { resolveOrCreateBuilding, distanceToBuilding, LOCATION_CONFIRM_RADIUS_M } from "./buildings.js";

afterAll(async () => { await pool.end(); });

// A full UUID keeps repeated local runs from accidentally crossing the fairly
// permissive trigram threshold on the human-readable suffix alone.
const uniq = () => `T${crypto.randomUUID()}`;

describe("building dedupe", () => {
  it("creates a building when nothing is nearby", async () => {
    const name = uniq();
    const b = await resolveOrCreateBuilding({ lat: 28.7041, lon: 77.1025, addressText: `${name} Block A` });
    expect(b.created).toBe(true);
  });

  it("reuses the same building for a near-identical pin and address", async () => {
    const name = uniq();
    const first = await resolveOrCreateBuilding({ lat: 28.5677, lon: 77.2432, addressText: `${name} Main Road` });
    const second = await resolveOrCreateBuilding({ lat: 28.56772, lon: 77.24322, addressText: `${name} Main Rd` });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("keeps distinct buildings at the same address apart when pinned far enough", async () => {
    const name = uniq();
    const a = await resolveOrCreateBuilding({ lat: 28.61, lon: 77.20, addressText: `${name} Tower` });
    const b = await resolveOrCreateBuilding({ lat: 28.6120, lon: 77.2020, addressText: `${name} Tower` });
    expect(b.id).not.toBe(a.id);
  });

  it("measures distance from a submitted fix to the claimed building", async () => {
    const name = uniq();
    const b = await resolveOrCreateBuilding({ lat: 28.50, lon: 77.30, addressText: `${name} Far` });
    const near = await distanceToBuilding(b.id, 28.50005, 77.30005);
    const far = await distanceToBuilding(b.id, 28.52, 77.32);
    expect(near).toBeLessThan(LOCATION_CONFIRM_RADIUS_M);
    expect(far).toBeGreaterThan(LOCATION_CONFIRM_RADIUS_M);
  });
});
