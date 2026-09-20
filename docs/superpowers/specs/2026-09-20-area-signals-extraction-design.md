# Area Signals extraction — design

**Date:** 2026-09-20. **Status:** approved, in implementation.
**Context:** plan two of [the core plan](../plans/2026-09-18-catastrophy-core.md), which deferred external ingestion. Reference behaviour: [SPEC](../../SPEC.md) § "Area Signals and the public feed".

## Purpose

Turn Delhi news articles and social posts into **Area Signals**: cell-level records of what is being reported in an area, rendered as a second layer on the public map and summarised in prose per cell.

## Invariants

1. A Signal attaches to a **cell**, never to a Building. It never touches Hazards, Confidence, Score, or Assessments.
2. Anything that resolves no finer than a district is **not mapped** — it is dropped.
3. The public surface exposes **summaries and counts only**, never the underlying post text.
4. The Extractor names a place from a closed list. It never returns coordinates.
5. `src/api/heatmap.ts` and the Building heat layer are not modified.

## Out of scope

Source Scout (new source discovery), the feedback loop on Source Class weights, and any path where scraped content becomes Evidence.

## Components

| Module | Responsibility |
|---|---|
| `src/ingest/source.ts` | `ContentSource` interface; `RawItem = {sourceId, text, occurredAt, url?}`. `sourceId` is the dedupe key. |
| `src/ingest/fixture-source.ts` | Replays committed fixtures. Default source. |
| `src/ingest/firecrawl-source.ts` | Live scraping; used only when `FIRECRAWL_API_KEY` is set and `INGEST_SOURCE=firecrawl`. |
| `src/domain/localities.ts` | Delhi gazetteer: closed list of localities → `{label, lat, lon, precision}`, plus `cellFor()` returning a geohash or `null` for district-level entries. |
| `src/agents/extractor.ts` | Bedrock Converse forced tool. Enums: locality ids and hazard type ids. Returns `{localityId, topicId, isRelevant, rationale}`. |
| `src/ingest/pipeline.ts` | fetch → drop seen `sourceId` → extract → resolve cell → insert `area_signals` → mark touched cells. |
| `src/agents/narrator.ts` | Add `narrateCellSummary()` for per-cell prose over signal topics. |
| `src/api/signals.ts`, `src/app/api/signals/route.ts` | Public read: `{geohash, precision, signalCount, summary}` per cell. |
| `src/pipeline/ingest.ts` | Inngest function on a cron plus a manual event trigger. |
| `src/app/public-heatmap.tsx` | Second MapLibre layer, outlined cells, click shows the summary. Built last. |

## Schema (`drizzle/0002_area_signals_dedupe_and_cell_summaries.sql`)

- Unique index on `area_signals (source_id)` for dedupe.
- New `cell_summaries`: `geohash` PK, `precision`, `summary`, `signal_count`, `generated_at`.

## Data flow

```
ContentSource.fetchRecent()
  → pipeline: skip known sourceId
  → extractSignal()            (Bedrock, forced tool, enum-constrained)
  → cellFor(localityId)        (deterministic; null ⇒ drop)
  → INSERT area_signals
  → narrateCellSummary() per touched cell → upsert cell_summaries
  → /api/signals → map layer
```

## Error handling

- Unknown or district-level locality: drop the item, count it, log it. Not an error.
- Extractor failure on one item: log and continue; one bad item never fails the run.
- Source fetch failure: the Inngest run fails and retries.
- Duplicate `source_id`: insert is a no-op.
- Summary failure: the previous summary stands.

## Testing

Vitest, colocated `*.test.ts`, following existing patterns. The Bedrock SDK is mocked exactly as in `src/agents/bedrock.test.ts`; no test makes a live model call. Database tests use `DATABASE_URL_TEST` like the existing db tests. Coverage: gazetteer resolution and district drops, fixture source, extractor tool shape and enum enforcement, pipeline dedupe/drop/insert paths, the signals API contract (no raw text), and the summary upsert.
