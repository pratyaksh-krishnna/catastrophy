import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, pool } from "../../../db/client.js";
import { GET } from "./route.js";

afterAll(async () => {
  await pool.end();
});

describe("GET /api/signals", () => {
  it("returns 200 with a cells array and never the raw signal text", async () => {
    const geohash = `x${Math.random().toString(36).slice(2, 9)}`;
    const sourceId = `S${Math.random().toString(36).slice(2, 10)}`;
    const sentinel = "SENTINEL-ROUTE-RAW-TEXT-4b1d9c-do-not-leak";
    await db.execute(sql`
      INSERT INTO area_signals (geohash, precision, source_id, text, occurred_at)
      VALUES (${geohash}, 6, ${sourceId}, ${sentinel}, now())
    `);

    const response = await GET(new NextRequest("http://localhost/api/signals"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.cells.some((cell: { geohash: string }) => cell.geohash === geohash)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(sourceId);
  });
});
