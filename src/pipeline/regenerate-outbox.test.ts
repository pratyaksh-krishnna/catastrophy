import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";

const send = vi.hoisted(() => vi.fn());
vi.mock("./inngest.js", () => ({
  inngest: {
    send,
    createFunction: vi.fn(() => ({})),
  },
}));

import { dispatchPendingRegenerations } from "./regenerate.js";

afterAll(async () => { await pool.end(); });

describe("assessment regeneration outbox", () => {
  beforeEach(() => send.mockReset());

  it("keeps a failed event durable and delivers it on a later retry", async () => {
    const tag = `outbox-${crypto.randomUUID()}`;
    const building = await db.execute(sql`
      INSERT INTO buildings (address_text, location)
      VALUES (${tag}, ST_SetSRID(ST_MakePoint(77.22, 28.58), 4326)::geography)
      RETURNING id
    `);
    const buildingId = building.rows[0]!.id as string;
    const queued = await db.execute(sql`
      INSERT INTO assessment_regeneration_outbox (building_id, event_name)
      VALUES (${buildingId}, 'assessment/regenerate')
      RETURNING id
    `);
    const outboxId = queued.rows[0]!.id as string;

    send.mockRejectedValueOnce(new Error("Inngest unavailable"));
    await dispatchPendingRegenerations({ buildingId });
    const failed = await db.execute(sql`
      SELECT attempts, delivered_at, lease_token, last_error
      FROM assessment_regeneration_outbox WHERE id = ${outboxId}
    `);
    expect(failed.rows[0]).toMatchObject({ attempts: 1, delivered_at: null, lease_token: null });
    expect(failed.rows[0]?.last_error).toContain("Inngest unavailable");

    await db.execute(sql`
      UPDATE assessment_regeneration_outbox SET next_attempt_at = now() WHERE id = ${outboxId}
    `);
    send.mockResolvedValueOnce({ ids: ["event-id"] });
    await dispatchPendingRegenerations({ buildingId });
    expect(send).toHaveBeenCalledWith({ name: "assessment/regenerate", data: { buildingId } });
    const delivered = await db.execute(sql`
      SELECT delivered_at, lease_token FROM assessment_regeneration_outbox WHERE id = ${outboxId}
    `);
    expect(delivered.rows[0]?.delivered_at).toBeTruthy();
    expect(delivered.rows[0]?.lease_token).toBeNull();
  });
});
