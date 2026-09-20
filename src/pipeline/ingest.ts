import { firecrawlSource } from "../ingest/firecrawl-source";
import { fixtureSource } from "../ingest/fixture-source";
import { ingestSignals } from "../ingest/pipeline";
import type { ContentSource } from "../ingest/source";
import { regenerateCellSummaries } from "../ingest/summaries";
import { inngest } from "./inngest";

/** Runs on a cron and can also be fired manually from the Inngest dev UI. */
export const INGEST_CRON = "0 */6 * * *";

function chooseSource(): ContentSource {
  if (process.env.INGEST_SOURCE === "firecrawl") return firecrawlSource();
  return fixtureSource();
}

async function ingest() {
  const source = chooseSource();
  const ingestReport = await ingestSignals(source);
  const summaryReport = await regenerateCellSummaries(ingestReport.touchedCells);

  return {
    ingest: {
      fetched: ingestReport.fetched,
      skippedDuplicate: ingestReport.skippedDuplicate,
      droppedIrrelevant: ingestReport.droppedIrrelevant,
      droppedNoCell: ingestReport.droppedNoCell,
      failed: ingestReport.failed,
      inserted: ingestReport.inserted,
      touchedCellCount: ingestReport.touchedCells.length,
    },
    summaries: summaryReport,
  };
}

export const ingestAreaSignals = inngest.createFunction(
  {
    id: "ingest-area-signals",
    triggers: [{ cron: INGEST_CRON }, { event: "signals/ingest.requested" }],
  },
  ingest,
);
