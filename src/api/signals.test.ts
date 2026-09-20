import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { publicSignals } from "./signals.js";

afterAll(async () => {
  await pool.end();
});

async function insertSignal(geohash: string, precision: number, text: string, occurredAt = new Date()) {
  const sourceId = `S${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql`
    INSERT INTO area_signals (geohash, precision, source_id, text, occurred_at)
    VALUES (${geohash}, ${precision}, ${sourceId}, ${text}, ${occurredAt.toISOString()})
  `);
  return sourceId;
}

describe("publicSignals", () => {
  it("aggregates two signals in the same cell into one row with signalCount 2", async () => {
    const geohash = `t${Math.random().toString(36).slice(2, 9)}`;
    await insertSignal(geohash, 6, "first report of waterlogging");
    await insertSignal(geohash, 6, "second report of waterlogging");

    const cells = await publicSignals();
    const cell = cells.find((c) => c.geohash === geohash);
    expect(cell).toBeDefined();
    expect(cell!.precision).toBe(6);
    expect(cell!.signalCount).toBe(2);
  });

  it("returns summary null for a cell with no cell_summaries row", async () => {
    const geohash = `u${Math.random().toString(36).slice(2, 9)}`;
    await insertSignal(geohash, 6, "a lone unsummarized signal");

    const cells = await publicSignals();
    const cell = cells.find((c) => c.geohash === geohash);
    expect(cell).toBeDefined();
    expect(cell!.summary).toBeNull();
  });

  it("returns the summary for a cell that has one", async () => {
    const geohash = `v${Math.random().toString(36).slice(2, 9)}`;
    await insertSignal(geohash, 6, "a summarized signal");
    await db.execute(sql`
      INSERT INTO cell_summaries (geohash, precision, summary, signal_count)
      VALUES (${geohash}, 6, 'Reports of waterlogging in this area.', 1)
    `);

    const cells = await publicSignals();
    const cell = cells.find((c) => c.geohash === geohash);
    expect(cell).toBeDefined();
    expect(cell!.summary).toBe("Reports of waterlogging in this area.");
  });

  it("never returns the raw signal text or source id", async () => {
    const geohash = `w${Math.random().toString(36).slice(2, 9)}`;
    const sentinel = "SENTINEL-RAW-TEXT-9f3ac21e-do-not-leak";
    const sourceId = await insertSignal(geohash, 6, sentinel);

    const cells = await publicSignals();
    const serialized = JSON.stringify(cells);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(sourceId);

    const cell = cells.find((c) => c.geohash === geohash);
    expect(cell).toBeDefined();
    expect(Object.keys(cell!).sort()).toEqual(["geohash", "precision", "signalCount", "sources", "summary"]);
    expect(cell!.sources).toEqual([]);
  });

  it("exposes a titled public source with a playable YouTube preview, never a private URL", async () => {
    const geohash = `y${Math.random().toString(36).slice(2, 9)}`;
    const publicId = `https://www.youtube.com/watch?v=VomC2wEvLiA&test=${Math.random()}`;
    const privateId = `http://127.0.0.1/private-${Math.random()}`;
    await db.execute(sql`
      INSERT INTO area_signals (geohash, precision, source_id, text, occurred_at, source_url, source_title, media_url, media_kind)
      VALUES
        (${geohash}, 6, ${publicId}, 'private raw text', now(), ${publicId}, 'Verified <title>', ${publicId}, 'video'),
        (${geohash}, 6, ${privateId}, 'other private raw text', now() - interval '1 minute', ${privateId}, 'Internal', ${privateId}, 'image'),
        (${geohash}, 6, 'http://10.0.0.2/private', 'other raw text', now() - interval '2 minutes', 'http://10.0.0.2/private', 'Internal', null, null),
        (${geohash}, 6, 'http://172.20.0.2/private', 'other raw text', now() - interval '3 minutes', 'http://172.20.0.2/private', 'Internal', null, null),
        (${geohash}, 6, 'http://192.168.1.2/private', 'other raw text', now() - interval '4 minutes', 'http://192.168.1.2/private', 'Internal', null, null),
        (${geohash}, 6, 'http://169.254.1.2/private', 'other raw text', now() - interval '5 minutes', 'http://169.254.1.2/private', 'Internal', null, null),
        (${geohash}, 6, 'http://localhost/private', 'other raw text', now() - interval '6 minutes', 'http://localhost/private', 'Internal', null, null)
    `);

    const cell = (await publicSignals()).find((entry) => entry.geohash === geohash)!;
    expect(cell.sources).toHaveLength(1);
    expect(cell.sources[0]).toEqual({
      title: "Verified <title>",
      url: publicId,
      media: {
        kind: "video",
        url: publicId,
        previewUrl: "https://i.ytimg.com/vi/VomC2wEvLiA/hqdefault.jpg",
        embedUrl: "https://www.youtube-nocookie.com/embed/VomC2wEvLiA?rel=0",
      },
    });
    for (const privateHost of ["127.0.0.1", "10.0.0.2", "172.20.0.2", "192.168.1.2", "169.254.1.2", "localhost"]) {
      expect(JSON.stringify(cell)).not.toContain(privateHost);
    }
    expect(JSON.stringify(cell)).not.toContain("private raw text");
  });

  it("exposes a public HTTPS publisher image preview", async () => {
    const geohash = `z${Math.random().toString(36).slice(2, 9)}`;
    const article = `https://publisher.example.test/article-${Math.random()}`;
    const image = "https://images.publisher-cdn.test/story.png";
    await db.execute(sql`
      INSERT INTO area_signals (geohash, precision, source_id, text, occurred_at, source_url, source_title, media_url, media_kind)
      VALUES (${geohash}, 6, ${article}, 'raw text is private', now(), ${article}, 'Photo report', ${image}, 'image')
    `);

    const cell = (await publicSignals()).find((entry) => entry.geohash === geohash)!;
    expect(cell.sources).toEqual([{
      title: "Photo report",
      url: article,
      media: { kind: "image", url: image },
    }]);
  });
});
