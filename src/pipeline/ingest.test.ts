import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const functionConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const capturedHandlers = vi.hoisted(() => [] as Array<(...args: unknown[]) => unknown>);

vi.mock("./inngest.js", () => ({
  inngest: {
    createFunction: (config: Record<string, unknown>, handler: (...args: unknown[]) => unknown) => {
      functionConfigs.push(config);
      capturedHandlers.push(handler);
      return handler;
    },
  },
}));

const ingestSignalsMock = vi.hoisted(() => vi.fn());
vi.mock("../ingest/pipeline.js", () => ({
  ingestSignals: ingestSignalsMock,
}));

const regenerateCellSummariesMock = vi.hoisted(() => vi.fn());
vi.mock("../ingest/summaries.js", () => ({
  regenerateCellSummaries: regenerateCellSummariesMock,
}));

const firecrawlSourceMock = vi.hoisted(() => vi.fn());
vi.mock("../ingest/firecrawl-source.js", () => ({
  firecrawlSource: firecrawlSourceMock,
}));

const fixtureSourceMock = vi.hoisted(() => vi.fn());
vi.mock("../ingest/fixture-source.js", () => ({
  fixtureSource: fixtureSourceMock,
}));

import { INGEST_CRON, ingestAreaSignals } from "./ingest.js";

describe("ingestAreaSignals", () => {
  const originalIngestSource = process.env.INGEST_SOURCE;

  beforeEach(() => {
    ingestSignalsMock.mockReset();
    regenerateCellSummariesMock.mockReset();
    fixtureSourceMock.mockReset();
    firecrawlSourceMock.mockReset();
    fixtureSourceMock.mockReturnValue({ fetchRecent: vi.fn() });
    firecrawlSourceMock.mockReturnValue({ fetchRecent: vi.fn() });
  });

  afterEach(() => {
    if (originalIngestSource === undefined) delete process.env.INGEST_SOURCE;
    else process.env.INGEST_SOURCE = originalIngestSource;
  });

  it("is registered with id ingest-area-signals and both a cron and event trigger", () => {
    const config = functionConfigs.find((candidate) => candidate.id === "ingest-area-signals");
    expect(config).toBeDefined();
    expect(config?.triggers).toEqual([
      { cron: INGEST_CRON },
      { event: "signals/ingest.requested" },
    ]);
  });

  it("runs ingestSignals then regenerateCellSummaries with the touched cells", async () => {
    const touchedCells = [{ geohash: "ttnfe1", precision: 6 }];
    ingestSignalsMock.mockResolvedValue({
      fetched: 2,
      skippedDuplicate: 0,
      droppedIrrelevant: 0,
      droppedNoCell: 0,
      failed: 0,
      inserted: 2,
      touchedCells,
    });
    regenerateCellSummariesMock.mockResolvedValue({
      cellsConsidered: 1,
      summarised: 1,
      failed: 0,
    });

    const result = await (ingestAreaSignals as unknown as (...args: unknown[]) => Promise<unknown>)();

    expect(ingestSignalsMock).toHaveBeenCalledTimes(1);
    expect(regenerateCellSummariesMock).toHaveBeenCalledWith(touchedCells);
    expect(result).toMatchObject({
      ingest: expect.objectContaining({ inserted: 2, touchedCellCount: 1 }),
      summaries: { cellsConsidered: 1, summarised: 1, failed: 0 },
    });
  });

  it("ingests from fixtures by default", async () => {
    delete process.env.INGEST_SOURCE;
    stubReports();

    await (ingestAreaSignals as unknown as (...args: unknown[]) => Promise<unknown>)();

    expect(fixtureSourceMock).toHaveBeenCalledTimes(1);
    expect(firecrawlSourceMock).not.toHaveBeenCalled();
  });

  it("ingests from firecrawl when INGEST_SOURCE selects it", async () => {
    process.env.INGEST_SOURCE = "firecrawl";
    stubReports();
    const liveSource = { fetchRecent: vi.fn() };
    firecrawlSourceMock.mockReturnValue(liveSource);

    await (ingestAreaSignals as unknown as (...args: unknown[]) => Promise<unknown>)();

    expect(firecrawlSourceMock).toHaveBeenCalledTimes(1);
    expect(fixtureSourceMock).not.toHaveBeenCalled();
    expect(ingestSignalsMock).toHaveBeenCalledWith(liveSource);
  });

  function stubReports() {
    ingestSignalsMock.mockResolvedValue({
      fetched: 0,
      skippedDuplicate: 0,
      droppedIrrelevant: 0,
      droppedNoCell: 0,
      failed: 0,
      inserted: 0,
      touchedCells: [],
    });
    regenerateCellSummariesMock.mockResolvedValue({
      cellsConsidered: 0,
      summarised: 0,
      failed: 0,
    });
  }
});
