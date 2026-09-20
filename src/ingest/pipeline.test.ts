import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ExtractionResult } from "../agents/extractor.js";
import { extractSignal } from "../agents/extractor.js";
import { db, pool } from "../db/client.js";
import { cellFor, type LocalityId } from "../domain/localities.js";
import { fixtureSource } from "./fixture-source.js";
import { ingestSignals } from "./pipeline.js";
import type { RawItem } from "./source.js";

vi.mock("../agents/extractor.js", () => ({
  extractSignal: vi.fn(),
}));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.mocked(extractSignal).mockReset();
});

function relevant(localityId: LocalityId | null): ExtractionResult {
  return { localityId, topicId: "other", isRelevant: true, rationale: "test" };
}

function irrelevant(): ExtractionResult {
  return { localityId: null, topicId: "other", isRelevant: false, rationale: "test" };
}

/** Wires extractSignal's mocked resolution to the item text so each test is deterministic. */
function mockExtraction(byText: Record<string, ExtractionResult | Error>): void {
  vi.mocked(extractSignal).mockImplementation(async ({ text }) => {
    const outcome = byText[text];
    if (outcome === undefined) throw new Error(`unmocked extraction for text: ${text}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
}

async function rowsFor(sourceIds: string[]) {
  const idList = sql.join(
    sourceIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute(
    sql`SELECT geohash, precision, source_id, text, occurred_at, topic_id FROM area_signals WHERE source_id IN (${idList})`,
  );
  return result.rows;
}

describe("ingestSignals", () => {
  it("inserts a clean run and reports accurate counts", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      {
        sourceId: `${tag}-1`,
        text: `${tag} laxmi nagar report`,
        occurredAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        sourceId: `${tag}-2`,
        text: `${tag} karol bagh report`,
        occurredAt: new Date("2026-01-02T00:00:00Z"),
      },
    ];
    mockExtraction({
      [items[0]!.text]: relevant("laxmi_nagar"),
      [items[1]!.text]: relevant("karol_bagh"),
    });

    const report = await ingestSignals(fixtureSource(items));

    expect(report.fetched).toBe(2);
    expect(report.skippedDuplicate).toBe(0);
    expect(report.droppedIrrelevant).toBe(0);
    expect(report.droppedNoCell).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.inserted).toBe(2);
    expect(report.touchedCells).toEqual(
      expect.arrayContaining([cellFor("laxmi_nagar"), cellFor("karol_bagh")]),
    );
    expect(report.touchedCells).toHaveLength(2);

    const rows = await rowsFor(items.map((i) => i.sourceId));
    expect(rows).toHaveLength(2);
    const bySourceId = new Map(rows.map((r) => [r.source_id as string, r]));
    expect(bySourceId.get(items[0]!.sourceId)).toMatchObject({
      geohash: cellFor("laxmi_nagar")!.geohash,
      precision: cellFor("laxmi_nagar")!.precision,
      text: items[0]!.text,
      topic_id: "other",
    });
    expect(bySourceId.get(items[1]!.sourceId)).toMatchObject({
      geohash: cellFor("karol_bagh")!.geohash,
      precision: cellFor("karol_bagh")!.precision,
      text: items[1]!.text,
      topic_id: "other",
    });
  });

  it("persists the extracted topicId on the inserted row", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      {
        sourceId: `${tag}-topic`,
        text: `${tag} crack report`,
        occurredAt: new Date(),
      },
    ];
    mockExtraction({
      [items[0]!.text]: {
        localityId: "laxmi_nagar",
        topicId: "load_bearing_crack",
        isRelevant: true,
        rationale: "test",
      },
    });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.inserted).toBe(1);

    const rows = await rowsFor([items[0]!.sourceId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic_id: "load_bearing_crack" });
  });

  it("skips items whose sourceId already exists in area_signals on a repeat run", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-dup`, text: `${tag} dup text`, occurredAt: new Date() },
    ];
    mockExtraction({ [items[0]!.text]: relevant("laxmi_nagar") });

    const first = await ingestSignals(fixtureSource(items));
    expect(first.inserted).toBe(1);
    expect(first.skippedDuplicate).toBe(0);

    const second = await ingestSignals(fixtureSource(items));
    expect(second.fetched).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(second.touchedCells).toHaveLength(0);

    const rows = await rowsFor([items[0]!.sourceId]);
    expect(rows).toHaveLength(1);
  });

  it("drops an item whose extraction reports isRelevant false", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-irrelevant`, text: `${tag} irrelevant text`, occurredAt: new Date() },
    ];
    mockExtraction({ [items[0]!.text]: irrelevant() });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.droppedIrrelevant).toBe(1);
    expect(report.inserted).toBe(0);
    expect(report.touchedCells).toHaveLength(0);

    const rows = await rowsFor([items[0]!.sourceId]);
    expect(rows).toHaveLength(0);
  });

  it("drops a district-level locality under droppedNoCell", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-district`, text: `${tag} north delhi report`, occurredAt: new Date() },
    ];
    // north_delhi is precision 4 (district-level) in src/domain/localities.ts
    mockExtraction({ [items[0]!.text]: relevant("north_delhi") });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.droppedNoCell).toBe(1);
    expect(report.inserted).toBe(0);
    expect(report.touchedCells).toHaveLength(0);

    const rows = await rowsFor([items[0]!.sourceId]);
    expect(rows).toHaveLength(0);
  });

  it("drops an item with a null localityId under droppedNoCell", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-nolocality`, text: `${tag} no locality text`, occurredAt: new Date() },
    ];
    mockExtraction({ [items[0]!.text]: relevant(null) });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.droppedNoCell).toBe(1);
    expect(report.inserted).toBe(0);

    const rows = await rowsFor([items[0]!.sourceId]);
    expect(rows).toHaveLength(0);
  });

  it("counts an extractor throw under failed and still completes remaining items", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-bad`, text: `${tag} bad text`, occurredAt: new Date() },
      { sourceId: `${tag}-good`, text: `${tag} good text`, occurredAt: new Date() },
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExtraction({
      [items[0]!.text]: new Error("boom"),
      [items[1]!.text]: relevant("karol_bagh"),
    });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.failed).toBe(1);
    expect(report.inserted).toBe(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    const rows = await rowsFor(items.map((i) => i.sourceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source_id).toBe(items[1]!.sourceId);
  });

  it("dedupes touchedCells when two items map to the same cell", async () => {
    const tag = crypto.randomUUID();
    const items: RawItem[] = [
      { sourceId: `${tag}-a`, text: `${tag} laxmi nagar a`, occurredAt: new Date() },
      { sourceId: `${tag}-b`, text: `${tag} laxmi nagar b`, occurredAt: new Date() },
    ];
    mockExtraction({
      [items[0]!.text]: relevant("laxmi_nagar"),
      [items[1]!.text]: relevant("laxmi_nagar"),
    });

    const report = await ingestSignals(fixtureSource(items));
    expect(report.inserted).toBe(2);
    expect(report.touchedCells).toEqual([cellFor("laxmi_nagar")]);
  });
});
