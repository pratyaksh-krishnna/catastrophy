import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { resolveOrCreateBuilding } from "../db/buildings.js";

const sesSend = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = sesSend;
  },
  SendEmailCommand: class {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import {
  acknowledgeEscalation,
  recordExternalTicket,
  sendEscalation,
} from "./send.js";

function randomPoint(): { lat: number; lon: number } {
  return { lat: 28.1 + Math.random() * 0.7, lon: 76.8 + Math.random() * 0.7 };
}

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  process.env.SES_FROM = "alerts@example.test";
  process.env.ESCALATION_INBOX = "authority@example.test";
  sesSend.mockReset();
  sesSend.mockResolvedValue({ MessageId: "sent" });
});

describe("sendEscalation", () => {
  it("stores an immutable snapshot and delivers one message per authority", async () => {
    const tag = `E${Math.random().toString(36).slice(2, 10)}`;
    const building = await resolveOrCreateBuilding({
      ...randomPoint(),
      addressText: `${tag} Marg`,
    });
    const assessment = {
      buildingId: building.id,
      score: 0.82,
      alertLevel: "critical" as const,
      narrative: "A serious structural Hazard is well corroborated.",
      ranked: [{ typeId: "column_failure" as const, confidence: 0.9 }],
    };

    const ids = await sendEscalation({
      buildingId: building.id,
      assessment,
      addressText: `${tag} Marg`,
    });
    assessment.narrative = "changed after delivery";

    expect(ids).toHaveLength(2);
    expect(sesSend).toHaveBeenCalledTimes(2);
    const rows = await db.execute(sql`
      SELECT snapshot, authority, status
      FROM escalations
      WHERE building_id = ${building.id}
      ORDER BY authority
    `);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.authority)).toEqual(["ddma", "mcd"]);
    expect((rows.rows[0]!.snapshot as { narrative: string }).narrative).not.toContain("changed");
    expect(rows.rows.every((row) => row.status === "sent")).toBe(true);
  });

  it("creates a new Escalation when a Building later worsens", async () => {
    const tag = `F${Math.random().toString(36).slice(2, 10)}`;
    const building = await resolveOrCreateBuilding({
      ...randomPoint(),
      addressText: `${tag} Marg`,
    });
    const base = {
      buildingId: building.id,
      narrative: "n",
      ranked: [{ typeId: "slab_deflection" as const, confidence: 0.5 }],
    };

    await sendEscalation({
      buildingId: building.id,
      addressText: `${tag} Marg`,
      assessment: { ...base, score: 0.45, alertLevel: "escalated" },
    });
    await sendEscalation({
      buildingId: building.id,
      addressText: `${tag} Marg`,
      assessment: { ...base, score: 0.9, alertLevel: "critical" },
    });

    const rows = await db.execute(sql`
      SELECT snapshot FROM escalations WHERE building_id = ${building.id}
    `);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => (row.snapshot as { alertLevel: string }).alertLevel)).toEqual(
      expect.arrayContaining(["escalated", "critical"]),
    );
  });

  it("sends each authority only once for one generated Assessment", async () => {
    const building = await resolveOrCreateBuilding({
      ...randomPoint(),
      addressText: `I${Math.random().toString(36).slice(2, 10)} Marg`,
    });
    const assessment = {
      buildingId: building.id,
      score: 0.82,
      alertLevel: "critical" as const,
      narrative: "A serious Hazard is on record.",
      ranked: [{ typeId: "column_failure" as const, confidence: 0.9 }],
      generatedAt: new Date(),
    };
    const first = await sendEscalation({ buildingId: building.id, addressText: "Test", assessment });
    const second = await sendEscalation({ buildingId: building.id, addressText: "Test", assessment });
    expect(first).toHaveLength(2);
    expect(second).toEqual([]);
    expect(sesSend).toHaveBeenCalledTimes(2);
  });

  it("records the hand-filed ticket and authority acknowledgement", async () => {
    const tag = `T${Math.random().toString(36).slice(2, 10)}`;
    const building = await resolveOrCreateBuilding({
      ...randomPoint(),
      addressText: `${tag} Marg`,
    });
    const [escalationId] = await sendEscalation({
      buildingId: building.id,
      addressText: `${tag} Marg`,
      assessment: {
        buildingId: building.id,
        score: 0.5,
        alertLevel: "escalated",
        narrative: "n",
        ranked: [{ typeId: "slab_deflection", confidence: 0.6 }],
      },
    });

    await recordExternalTicket(escalationId!, "MCD-311-42");
    await acknowledgeEscalation(escalationId!);

    const result = await db.execute(sql`
      SELECT external_ticket, status, acknowledged_at
      FROM escalations
      WHERE id = ${escalationId}
    `);
    expect(result.rows[0]).toMatchObject({
      external_ticket: "MCD-311-42",
      status: "acknowledged",
    });
    expect(result.rows[0]!.acknowledged_at).not.toBeNull();
  });

  it("does not persist a sent row when SES rejects delivery", async () => {
    const tag = `G${Math.random().toString(36).slice(2, 10)}`;
    const building = await resolveOrCreateBuilding({
      ...randomPoint(),
      addressText: `${tag} Marg`,
    });
    sesSend.mockRejectedValueOnce(new Error("SES unavailable"));

    await expect(
      sendEscalation({
        buildingId: building.id,
        addressText: `${tag} Marg`,
        assessment: {
          buildingId: building.id,
          score: 0.5,
          alertLevel: "escalated",
          narrative: "n",
          ranked: [{ typeId: "slab_deflection", confidence: 0.6 }],
        },
      }),
    ).rejects.toThrow("SES unavailable");

    const rows = await db.execute(sql`
      SELECT id FROM escalations WHERE building_id = ${building.id}
    `);
    expect(rows.rows).toHaveLength(0);
  });

  it("validates delivery configuration before persisting", async () => {
    const previous = process.env.SES_FROM;
    delete process.env.SES_FROM;
    try {
      await expect(
        sendEscalation({
          buildingId: "00000000-0000-0000-0000-000000000000",
          addressText: "Unknown",
          assessment: {
            buildingId: "00000000-0000-0000-0000-000000000000",
            score: 0.5,
            alertLevel: "escalated",
            narrative: "n",
            ranked: [{ typeId: "slab_deflection", confidence: 0.6 }],
          },
        }),
      ).rejects.toThrow(/SES_FROM/);
      expect(sesSend).not.toHaveBeenCalled();
    } finally {
      process.env.SES_FROM = previous;
    }
  });

  it("does not require delivery configuration when there is nothing to route", async () => {
    delete process.env.SES_FROM;
    delete process.env.ESCALATION_INBOX;
    await expect(
      sendEscalation({
        buildingId: "00000000-0000-0000-0000-000000000000",
        addressText: "Unknown",
        assessment: {
          buildingId: "00000000-0000-0000-0000-000000000000",
          score: 0,
          alertLevel: "monitor",
          narrative: "No Hazards are on record.",
          ranked: [],
        },
      }),
    ).resolves.toEqual([]);
    expect(sesSend).not.toHaveBeenCalled();
  });
});
